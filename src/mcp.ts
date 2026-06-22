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

const SubmissionSchema = z.object({
  decision: z.union([z.literal("approve"), z.literal("request-changes")]),
  prompt: z.string(),
});

/** Parse + validate the POST /submit body. Throws on malformed input. */
export function parseSubmission(body: string): Submission {
  const parsed: unknown = JSON.parse(body);
  return SubmissionSchema.parse(parsed);
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
 * and block until the reviewer POSTs a decision to /submit. Same-origin, so no
 * CORS. All human-facing output goes to stderr — stdout is the MCP transport's.
 *
 * Exported for the round-trip test, which suppresses the browser launch by
 * mocking `open`; production callers always launch it.
 */
export function serveAndBlock(html: string): Promise<Submission> {
  return new Promise<Submission>((resolve, reject) => {
    let settled = false;
    const server = createServer((req, res) => {
      const method = req.method ?? "GET";
      const url = req.url ?? "/";

      if (method === "GET" && (url === "/" || url.startsWith("/?"))) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
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
          if (!settled) {
            settled = true;
            server.close();
            resolve(submission);
          }
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
        const submission = await serveAndBlock(html);
        return {
          content: [
            { type: "text", text: formatToolResult(submission.decision, submission.prompt) },
          ],
        };
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
