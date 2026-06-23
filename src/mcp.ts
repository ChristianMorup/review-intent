import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import open from "open";
import { buildReview } from "./pipeline.js";
import { renderHtml } from "./render.js";
import { formatGaps } from "./completeness.js";
import { GitError } from "./git.js";
import { ArtifactError } from "./artifact.js";
import { ConfigError } from "./config.js";
import { SKILL_CONTENT } from "./skill.js";

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * RAW zod shape (NOT a z.object). The MCP SDK's registerTool expects a raw
 * shape for inputSchema and wraps it itself — passing z.object here would
 * double-wrap and mis-describe the tool.
 */
export const reviewToolInputShape = {
  cwd: z.string().optional(),
  base: z.string().optional(),
  artifact: z.string().optional(),
  allowGaps: z.boolean().optional(),
};

export type Decision = "approve" | "request-changes";

export interface Submission {
  decision: Decision;
  prompt: string;
}

/**
 * The outcome of a review session: either the reviewer submitted a decision, or
 * they closed the page without one (abandoned). Distinguishing the two keeps the
 * agent from ever reading a closed-without-deciding review as an approval.
 */
export type ReviewResult =
  | { kind: "submitted"; submission: Submission }
  | { kind: "abandoned" };

const SubmissionSchema = z.object({
  decision: z.union([z.literal("approve"), z.literal("request-changes")]),
  prompt: z.string(),
});

/** Parse + validate the POST /submit body. Throws on malformed input. */
export function parseSubmission(body: string): Submission {
  const parsed: unknown = JSON.parse(body);
  return SubmissionSchema.parse(parsed);
}

export interface AskQuestion {
  questionId: string;
  ref: string;
  question: string;
}

const AskSchema = z.object({
  questionId: z.string(),
  ref: z.string(),
  question: z.string(),
});

/** Parse + validate the POST /ask body. Throws on malformed input. */
export function parseAsk(body: string): AskQuestion {
  const parsed: unknown = JSON.parse(body);
  return AskSchema.parse(parsed);
}

/**
 * The authoring contract, derived from the skill's single source of truth with
 * its YAML frontmatter stripped (the frontmatter is a skill-file artifact; an
 * MCP prompt/resource doesn't want it). Lets the honesty guidance ship with the
 * server, so it's available even when the authoring skill isn't installed.
 */
export function authoringGuide(skillContent: string = SKILL_CONTENT): string {
  const frontmatter = skillContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const body = frontmatter ? skillContent.slice(frontmatter[0].length) : skillContent;
  return body.trim();
}

/** Shape the reviewer's decision + assembled prompt into the tool-result text. */
export function formatToolResult(decision: Decision, prompt: string): string {
  if (prompt.trim() === "") {
    return decision === "approve"
      ? "Reviewer decision: approve\n\nApproved — no changes requested."
      : "Reviewer decision: request-changes\n\nChanges requested, but no specific feedback was provided.";
  }
  return `Reviewer decision: ${decision}\n\n${prompt}`;
}

// ── Side-effecting runner (not unit-tested; manual smoke test) ───────────────

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Render the submit-mode HTML on an ephemeral local server, open the browser,
 * and resolve when the reviewer either submits a decision (POST /submit) or
 * abandons the review by closing the tab. Same-origin, so no CORS. All
 * human-facing output goes to stderr — stdout is the MCP transport's.
 *
 * Abandonment is detected by liveness, not an arbitrary duration cap: the page
 * heartbeats while it's open (and beacons /cancel on unload). Once the page has
 * connected, a gap longer than `liveGraceMs` with no heartbeat means the tab is
 * gone, so the agent is unblocked with { kind: "abandoned" } rather than hanging
 * forever. An open-but-idle tab keeps heartbeating, so a slow human review is
 * never cut short.
 *
 * Exported for tests, which suppress the browser launch by mocking `open` and
 * shrink the liveness timings.
 */
export function serveAndBlock(
  html: string,
  opts: { liveGraceMs?: number; checkMs?: number } = {},
): Promise<ReviewResult> {
  const liveGraceMs = opts.liveGraceMs ?? 12_000;
  const checkMs = opts.checkMs ?? 3_000;
  return new Promise<ReviewResult>((resolve, reject) => {
    let settled = false;
    let connected = false;
    let lastSeen = Date.now();
    let liveness: ReturnType<typeof setInterval> | undefined;

    function finish(result: ReviewResult): void {
      if (settled) return;
      settled = true;
      if (liveness) clearInterval(liveness);
      server.close();
      resolve(result);
    }

    const server = createServer((req, res) => {
      const method = req.method ?? "GET";
      const url = req.url ?? "/";

      if (method === "GET" && (url === "/" || url.startsWith("/?"))) {
        connected = true;
        lastSeen = Date.now();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      // Liveness ping from the open page — proof the tab is still there.
      if (method === "POST" && url === "/heartbeat") {
        connected = true;
        lastSeen = Date.now();
        res.writeHead(204);
        res.end();
        return;
      }

      // Unload beacon — the reviewer closed the tab without deciding.
      if (method === "POST" && url === "/cancel") {
        res.writeHead(204);
        res.end();
        finish({ kind: "abandoned" });
        return;
      }

      if (method === "POST" && url === "/submit") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          let submission: Submission;
          try {
            submission = parseSubmission(Buffer.concat(chunks).toString("utf8"));
          } catch (err) {
            res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Invalid submission");
            process.stderr.write(
              `review-intent mcp: ignored malformed /submit body: ${(err as Error).message}\n`,
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            "<!doctype html><meta charset=utf-8><title>Review submitted</title>" +
              "<body style=\"font:16px/1.5 system-ui,sans-serif;padding:3rem;color:#211f1b\">" +
              "<p>Review submitted — you can close this tab.</p>",
          );
          finish({ kind: "submitted", submission });
        });
        // A client that aborts mid-body emits 'error' on the request stream;
        // without a listener Node would throw in the http callback. Fail the
        // request but keep the server blocking for a real submit.
        req.on("error", () => {
          if (!res.writableEnded) {
            res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Bad request");
          }
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    });

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        if (liveness) clearInterval(liveness);
        reject(err);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      const reviewUrl = `http://127.0.0.1:${addr.port}/`;
      process.stderr.write(`Review page: ${reviewUrl}\n`);
      // Fire-and-forget: a failed browser launch must not abort the review;
      // the URL is on stderr so the reviewer can open it manually.
      void open(reviewUrl).catch((err: unknown) => {
        process.stderr.write(
          `review-intent mcp: could not open browser (${(err as Error).message}); open ${reviewUrl} manually\n`,
        );
      });
      // Once the page has connected, a heartbeat gap past the grace window means
      // the tab was closed — unblock the agent instead of waiting forever.
      liveness = setInterval(() => {
        if (connected && Date.now() - lastSeen > liveGraceMs) {
          finish({ kind: "abandoned" });
        }
      }, checkMs);
    });
  });
}

/**
 * Start the MCP stdio server exposing the single `review_changes` tool. The
 * StdioServerTransport is the SOLE owner of process.stdout (the JSON-RPC
 * channel); every diagnostic in this module goes to process.stderr only.
 */
export async function runMcp(_argv: string[]): Promise<void> {
  const server = new McpServer({
    name: "review-intent",
    version: readPackageVersion(),
  });

  server.registerTool(
    "review_changes",
    {
      title: "Review changes",
      description:
        "Render the branch diff (base...HEAD) as an intent-annotated review page, open it in the reviewer's browser, block until they approve or request changes, and return their decision plus assembled feedback.",
      inputSchema: reviewToolInputShape,
    },
    async (args) => {
      const cwd = args.cwd ?? process.cwd();
      const allowGaps = args.allowGaps ?? false;

      let build;
      try {
        build = buildReview({ cwd, base: args.base, artifact: args.artifact });
      } catch (err) {
        if (
          err instanceof GitError ||
          err instanceof ArtifactError ||
          err instanceof ConfigError
        ) {
          return { content: [{ type: "text", text: err.message }], isError: true };
        }
        return {
          content: [{ type: "text", text: `Unexpected error: ${(err as Error).message}` }],
          isError: true,
        };
      }

      // Completeness-gate parity with the CLI: refuse to open the browser when
      // intent is incomplete and the caller didn't opt into a draft.
      if (build.gaps.length > 0 && !allowGaps) {
        return {
          content: [{ type: "text", text: formatGaps(build.gaps) }],
          isError: true,
        };
      }

      // An empty diff renders no submit bar (the feedback panel is suppressed
      // when there are no changed files), so serving it would block forever
      // waiting for a POST that can never arrive. Return a clean no-op instead.
      if (build.model.files.length === 0) {
        return {
          content: [
            { type: "text", text: `No changes to review for ${build.model.base}...HEAD.` },
          ],
        };
      }

      const html = renderHtml(build.model, { submit: true });
      try {
        const result = await serveAndBlock(html);
        const text =
          result.kind === "abandoned"
            ? "The reviewer closed the review without submitting a decision — no approval was given. Re-offer the review or ask how they'd like to proceed."
            : formatToolResult(result.submission.decision, result.submission.prompt);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Review server error: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  // Ship the authoring contract alongside the tool, so the honesty guidance is
  // available even when the review-intent-authoring skill isn't installed. The
  // skill stays the auto-trigger; these are the on-demand mirrors.
  const guide = authoringGuide();

  // Resource: the agent can read the guide as context before authoring intent.
  server.registerResource(
    "authoring-guide",
    "review-intent://authoring-guide",
    {
      title: "Authoring honest review intent",
      description:
        "How to author an honest .review/intent.json — the why, real rejected alternatives, and assumptions — before calling review_changes.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide }],
    }),
  );

  // Prompt: the reviewer can invoke the guide as a slash command to steer the
  // change-making agent toward authoring intent honestly.
  server.registerPrompt(
    "author_intent",
    {
      title: "Author review intent",
      description:
        "Load the contract for authoring an honest .review/intent.json before review.",
    },
    () => ({
      messages: [{ role: "user", content: { type: "text", text: guide } }],
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
