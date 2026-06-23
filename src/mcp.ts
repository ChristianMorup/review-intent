import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

export type ReviewEvent =
  | { kind: "question"; sessionId: string; questionId: string; ref: string; question: string }
  | { kind: "submitted"; sessionId: string; submission: Submission }
  | { kind: "abandoned"; sessionId: string };

const ABANDONED_TEXT =
  "The reviewer closed the review without submitting a decision — no approval was given. Re-offer the review or ask how they'd like to proceed.";

/** Shape a review event into the MCP tool-result text the agent acts on. */
export function formatEventResult(event: ReviewEvent): string {
  switch (event.kind) {
    case "question":
      return (
        `The reviewer asked a question (id ${event.questionId}) about ${event.ref}:\n\n` +
        `${event.question}\n\n` +
        `Answer it by calling answer_review_question with sessionId="${event.sessionId}", ` +
        `questionId="${event.questionId}", and your answer. Your answer appears live on the ` +
        `still-open review page and the review continues. Keep answering questions until the ` +
        `reviewer submits a decision.`
      );
    case "submitted":
      return formatToolResult(event.submission.decision, event.submission.prompt);
    case "abandoned":
      return ABANDONED_TEXT;
  }
}

// ── Session manager (side-effecting; exercised by round-trip tests) ──────────

interface Session {
  server: ReturnType<typeof createServer>;
  sse: Set<ServerResponse>;
  questions: AskQuestion[];
  waiter: ((e: ReviewEvent) => void) | null;
  pendingTerminal: ReviewEvent | null;
  settled: boolean;
  connected: boolean;
  lastSeen: number;
  liveness?: ReturnType<typeof setInterval>;
}

const sessions = new Map<string, Session>();
let sessionSeq = 0;

/** Read a request body to completion, then hand it to `done`. Mirrors the
 *  /submit body handling that used to be inline; fails the request on a stream
 *  error without tearing the server down. */
function readBody(req: IncomingMessage, res: ServerResponse, done: (body: string) => void): void {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
  req.on("error", () => {
    if (!res.writableEnded) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad request");
    }
  });
}

/** Close the server, stop liveness, and end any open SSE streams. The session
 *  object is kept in the map (so a pending terminal event can still be read);
 *  callers delete it once that event is consumed. */
function stopServer(session: Session): void {
  if (session.liveness) clearInterval(session.liveness);
  for (const res of session.sse) {
    try { res.end(); } catch { /* already closed */ }
  }
  session.sse.clear();
  session.server.close();
}

/** Deliver an event to a parked waiter, or stash it for the next waitForEvent.
 *  Terminal events (submitted/abandoned) settle and stop the server exactly
 *  once. Question events resolve a waiter if one is parked, else queue. */
function resolveEvent(sessionId: string, event: ReviewEvent): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (event.kind === "question") {
    const waiter = session.waiter;
    session.waiter = null;
    if (waiter) waiter(event);
    else session.questions.push({ questionId: event.questionId, ref: event.ref, question: event.question });
    return;
  }

  if (session.settled) return;
  session.settled = true;
  stopServer(session);
  const waiter = session.waiter;
  session.waiter = null;
  if (waiter) {
    sessions.delete(sessionId);
    waiter(event);
  } else {
    session.pendingTerminal = event;
  }
}

const SUBMITTED_PAGE =
  "<!doctype html><meta charset=utf-8><title>Review submitted</title>" +
  "<body style=\"font:16px/1.5 system-ui,sans-serif;padding:3rem;color:#211f1b\">" +
  "<p>Review submitted — you can close this tab.</p>";

function handleRequest(
  sessionId: string,
  session: Session,
  html: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  if (method === "GET" && (url === "/" || url.startsWith("/?"))) {
    session.connected = true;
    session.lastSeen = Date.now();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (method === "POST" && url === "/heartbeat") {
    session.connected = true;
    session.lastSeen = Date.now();
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === "POST" && url === "/cancel") {
    res.writeHead(204);
    res.end();
    resolveEvent(sessionId, { kind: "abandoned", sessionId });
    return;
  }

  if (method === "POST" && url === "/submit") {
    readBody(req, res, (body) => {
      let submission: Submission;
      try {
        submission = parseSubmission(body);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid submission");
        process.stderr.write(`review-intent mcp: ignored malformed /submit body: ${(err as Error).message}\n`);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SUBMITTED_PAGE);
      resolveEvent(sessionId, { kind: "submitted", sessionId, submission });
    });
    return;
  }

  if (method === "GET" && url === "/events") {
    session.connected = true;
    session.lastSeen = Date.now();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    session.sse.add(res);
    req.on("close", () => session.sse.delete(res));
    return;
  }

  if (method === "POST" && url === "/ask") {
    readBody(req, res, (body) => {
      let ask: AskQuestion;
      try {
        ask = parseAsk(body);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid question");
        process.stderr.write(`review-intent mcp: ignored malformed /ask body: ${(err as Error).message}\n`);
        return;
      }
      res.writeHead(204);
      res.end();
      resolveEvent(sessionId, {
        kind: "question",
        sessionId,
        questionId: ask.questionId,
        ref: ask.ref,
        question: ask.question,
      });
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

/**
 * Render the submit-mode HTML on an ephemeral local server, open the browser,
 * register a session, and resolve with its id. The session outlives a single
 * tool call so the agent can answer questions (Task 4) without closing the page.
 * Liveness: once the page connects, a heartbeat gap past `liveGraceMs` abandons
 * the review. All human-facing output goes to stderr.
 */
export function openReviewSession(
  html: string,
  opts: { liveGraceMs?: number; checkMs?: number } = {},
): Promise<string> {
  const liveGraceMs = opts.liveGraceMs ?? 12_000;
  const checkMs = opts.checkMs ?? 3_000;
  return new Promise<string>((resolve, reject) => {
    const sessionId = `sid-${++sessionSeq}`;
    const session: Session = {
      server: undefined as unknown as ReturnType<typeof createServer>,
      sse: new Set(),
      questions: [],
      waiter: null,
      pendingTerminal: null,
      settled: false,
      connected: false,
      lastSeen: 0,
    };
    const server = createServer((req, res) => handleRequest(sessionId, session, html, req, res));
    session.server = server;

    server.on("error", (err) => {
      if (!session.settled) {
        session.settled = true;
        if (session.liveness) clearInterval(session.liveness);
        reject(err);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      sessions.set(sessionId, session);
      const addr = server.address() as AddressInfo;
      const reviewUrl = `http://127.0.0.1:${addr.port}/`;
      process.stderr.write(`Review page: ${reviewUrl}\n`);
      void open(reviewUrl).catch((err: unknown) => {
        process.stderr.write(
          `review-intent mcp: could not open browser (${(err as Error).message}); open ${reviewUrl} manually\n`,
        );
      });
      session.lastSeen = Date.now();
      session.liveness = setInterval(() => {
        if (session.connected && Date.now() - session.lastSeen > liveGraceMs) {
          resolveEvent(sessionId, { kind: "abandoned", sessionId });
        }
      }, checkMs);
      resolve(sessionId);
    });
  });
}

/**
 * Park until the session's next event. Drains a queued question or a stashed
 * terminal event immediately; otherwise registers as the sole waiter. An unknown
 * (closed/never-opened) session resolves abandoned rather than hanging.
 */
export function waitForEvent(sessionId: string): Promise<ReviewEvent> {
  const session = sessions.get(sessionId);
  if (!session) return Promise.resolve({ kind: "abandoned", sessionId });

  if (session.pendingTerminal) {
    const event = session.pendingTerminal;
    sessions.delete(sessionId);
    return Promise.resolve(event);
  }
  const queued = session.questions.shift();
  if (queued) {
    return Promise.resolve({ kind: "question", sessionId, ...queued });
  }
  if (session.settled) {
    sessions.delete(sessionId);
    return Promise.resolve({ kind: "abandoned", sessionId });
  }
  return new Promise<ReviewEvent>((resolve) => {
    session.waiter = resolve;
  });
}

/**
 * Push an answer to every open SSE stream for the session. Returns false when
 * the session is gone or already settled (the page is no longer listening), so
 * the caller can still fall through to waitForEvent for a stashed decision.
 */
export function deliverAnswer(sessionId: string, questionId: string, answer: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.settled) return false;
  // JSON.stringify yields a single line, so the SSE `data:` frame stays intact
  // even when the answer contains newlines.
  const payload = JSON.stringify({ questionId, answer });
  for (const res of session.sse) {
    res.write(`event: answer\ndata: ${payload}\n\n`);
  }
  return true;
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
        const sessionId = await openReviewSession(html);
        const event = await waitForEvent(sessionId);
        return { content: [{ type: "text", text: formatEventResult(event) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Review server error: ${(err as Error).message}` }],
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
