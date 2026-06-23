# Live Review Q&A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer ask a question about a hunk on the open MCP review page and get the agent's answer live, inline, while the final approve/request-changes decision still blocks the agent.

**Architecture:** The local `http` server in `mcp.ts` becomes a *session* that outlives a single tool call: it serves the page, carries Server-Sent Events to push answers, and accepts `POST /ask`. Two MCP tools drive it — `review_changes` (starts the session, blocks until the first event) and `answer_review_question` (pushes an answer, blocks until the next event). Each returns a `ReviewEvent` union (`question` | `submitted` | `abandoned`); the agent loops, answering questions until a decision arrives. `render.ts` stays pure: all live-Q&A page behavior is injected by the existing submit-mode client script, so non-submit output is byte-identical.

**Tech Stack:** ESM TypeScript (NodeNext), `@modelcontextprotocol/sdk`, `zod`, Node `http`, browser `EventSource`, vitest.

## Global Constraints

- ESM with `NodeNext`: every relative import uses a `.js` extension even from `.ts` sources.
- **Purity boundary:** `render.ts` must stay pure and deterministic — no I/O, no `Date`, no random. Side effects live only in `mcp.ts` (and the other runner modules). Session state and `Date.now()` belong in `mcp.ts`, never in `render.ts`.
- **Never silently drop or truncate:** unmatched/abandoned/queued states must surface to the agent, never vanish.
- `npm run build` (tsc `strict`) is the type-check gate; there is no linter.
- Tests are vitest, one file per source module, constructed inputs (no git/fs fixtures beyond `test/fixtures/`). Pure exports are unit-tested; the http server is exercised by round-trip tests over `fetch` with `open` mocked and liveness timings shrunk (see existing `test/mcp.test.ts`).
- The MCP transport owns `process.stdout`; every diagnostic goes to `process.stderr` only.

---

### Task 1: `parseAsk` — validate the `POST /ask` body

**Files:**
- Modify: `src/mcp.ts` (add near `parseSubmission`, ~line 48-57)
- Test: `test/mcp.test.ts` (add a `describe("parseAsk", …)` block)

**Interfaces:**
- Produces: `interface AskQuestion { questionId: string; ref: string; question: string }` and `function parseAsk(body: string): AskQuestion`.

- [ ] **Step 1: Write the failing test**

Add to `test/mcp.test.ts` (and add `parseAsk` to the existing import from `../src/mcp.js`):

```ts
describe("parseAsk", () => {
  it("parses a valid ask object", () => {
    expect(parseAsk('{"questionId":"q:src/a.ts:12","ref":"src/a.ts @ L12","question":"why?"}')).toEqual({
      questionId: "q:src/a.ts:12",
      ref: "src/a.ts @ L12",
      question: "why?",
    });
  });

  it("throws on a missing field", () => {
    expect(() => parseAsk('{"questionId":"q","ref":"r"}')).toThrow();
  });

  it("throws on a non-string field", () => {
    expect(() => parseAsk('{"questionId":"q","ref":"r","question":3}')).toThrow();
  });

  it("throws on malformed JSON", () => {
    expect(() => parseAsk("nope")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp.test.ts -t parseAsk`
Expected: FAIL — `parseAsk is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

In `src/mcp.ts`, after the `parseSubmission` block:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp.test.ts -t parseAsk`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp.ts test/mcp.test.ts
git commit -m "feat: add parseAsk for the live-review /ask body"
```

---

### Task 2: `ReviewEvent` + `formatEventResult` — shape events into tool-result text

**Files:**
- Modify: `src/mcp.ts` (add after `formatToolResult`, ~line 79)
- Test: `test/mcp.test.ts` (add a `describe("formatEventResult", …)` block)

**Interfaces:**
- Consumes: `formatToolResult` (existing), `Submission` (existing).
- Produces:
  ```ts
  type ReviewEvent =
    | { kind: "question"; sessionId: string; questionId: string; ref: string; question: string }
    | { kind: "submitted"; sessionId: string; submission: Submission }
    | { kind: "abandoned"; sessionId: string };
  function formatEventResult(event: ReviewEvent): string;
  ```

- [ ] **Step 1: Write the failing test**

Add to `test/mcp.test.ts` (add `formatEventResult` to the import):

```ts
describe("formatEventResult", () => {
  it("turns a question event into instructions naming the session + question id", () => {
    const text = formatEventResult({
      kind: "question",
      sessionId: "sid-1",
      questionId: "q:src/a.ts:12",
      ref: "src/a.ts @ L12",
      question: "Why drop the cache here?",
    });
    expect(text).toContain("Why drop the cache here?");
    expect(text).toContain("src/a.ts @ L12");
    expect(text).toContain("answer_review_question");
    expect(text).toContain("sid-1");
    expect(text).toContain("q:src/a.ts:12");
  });

  it("delegates a submitted event to formatToolResult", () => {
    const text = formatEventResult({
      kind: "submitted",
      sessionId: "sid-1",
      submission: { decision: "request-changes", prompt: "do X" },
    });
    expect(text).toBe(formatToolResult("request-changes", "do X"));
  });

  it("returns the no-decision message for an abandoned event", () => {
    const text = formatEventResult({ kind: "abandoned", sessionId: "sid-1" });
    expect(text).toContain("without submitting a decision");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp.test.ts -t formatEventResult`
Expected: FAIL — `formatEventResult is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/mcp.ts`, after `formatToolResult`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp.test.ts -t formatEventResult`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp.ts test/mcp.test.ts
git commit -m "feat: add ReviewEvent union and formatEventResult"
```

---

### Task 3: Session manager — refactor `serveAndBlock` into `openReviewSession` + `waitForEvent`

This replaces the single blocking `serveAndBlock`/`ReviewResult` with a session that persists across tool calls. This task preserves today's submit / cancel / heartbeat behavior through the new API; SSE and `/ask` arrive in Task 4.

**Files:**
- Modify: `src/mcp.ts` (replace `serveAndBlock` and `ReviewResult`, ~lines 39-225; update `runMcp`'s call site enough to compile — full tool wiring is Task 5)
- Test: `test/mcp.test.ts` (rewrite the `describe("serveAndBlock round-trip", …)` block to drive the new API)

**Interfaces:**
- Consumes: `parseSubmission`, `ReviewEvent`, `Submission`.
- Produces:
  ```ts
  function openReviewSession(html: string, opts?: { liveGraceMs?: number; checkMs?: number }): Promise<string>;
  function waitForEvent(sessionId: string): Promise<ReviewEvent>;
  ```
  An internal module-level `sessions: Map<string, Session>`, `resolveEvent(sessionId, event)`, and `stopServer(session)` that later tasks build on. `Session` carries `pendingTerminal: ReviewEvent | null` (used in Task 4; initialized to `null` here).

- [ ] **Step 1: Write the failing tests**

Replace the entire `describe("serveAndBlock round-trip", …)` block in `test/mcp.test.ts` with the following (keep the `captureUrl` / `waitForUrl` helpers — move them inside the new block). Update the import to bring in `openReviewSession, waitForEvent` and drop `serveAndBlock`:

```ts
describe("review session round-trip", () => {
  function captureUrl(): { restore: () => void; url: () => string } {
    let captured = "";
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: typeof process.stderr.write }).write = ((
      chunk: string | Uint8Array,
    ): boolean => {
      const s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const m = s.match(/Review page: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (m) captured = m[1];
      return true;
    }) as typeof process.stderr.write;
    return { restore: () => { process.stderr.write = orig; }, url: () => captured };
  }

  it("serves the HTML on GET / and resolves with the parsed POST /submit body", async () => {
    const cap = captureUrl();
    const html = "<!DOCTYPE html><title>x</title><body>REVIEW_PAGE_MARKER";
    const sessionId = await openReviewSession(html);
    const base = cap.url();
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const event = waitForEvent(sessionId);

    const page = await fetch(base);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("REVIEW_PAGE_MARKER");

    const res = await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "request-changes", prompt: "tighten the loop" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("you can close this tab");

    cap.restore();
    expect(await event).toEqual({
      kind: "submitted",
      sessionId,
      submission: { decision: "request-changes", prompt: "tighten the loop" },
    });
  });

  it("rejects a malformed /submit body with 400 and keeps blocking", async () => {
    const cap = captureUrl();
    const sessionId = await openReviewSession("<title>x</title>");
    const base = cap.url();
    const event = waitForEvent(sessionId);

    const bad = await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    expect(bad.status).toBe(400);

    await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve", prompt: "" }),
    });

    cap.restore();
    expect(await event).toEqual({
      kind: "submitted",
      sessionId,
      submission: { decision: "approve", prompt: "" },
    });
  });

  it("resolves as abandoned when the page beacons /cancel", async () => {
    const cap = captureUrl();
    const sessionId = await openReviewSession("<title>x</title>");
    const base = cap.url();
    const event = waitForEvent(sessionId);

    await fetch(base);
    const res = await fetch(base + "cancel", { method: "POST" });
    expect(res.status).toBe(204);

    cap.restore();
    expect(await event).toEqual({ kind: "abandoned", sessionId });
  });

  it("resolves as abandoned when heartbeats stop after the page connected", async () => {
    const cap = captureUrl();
    const sessionId = await openReviewSession("<title>x</title>", { liveGraceMs: 120, checkMs: 40 });
    const base = cap.url();
    const event = waitForEvent(sessionId);

    await fetch(base);
    cap.restore();
    expect(await event).toEqual({ kind: "abandoned", sessionId });
  });

  it("does not abandon while heartbeats keep arriving, then accepts a submit", async () => {
    const cap = captureUrl();
    const sessionId = await openReviewSession("<title>x</title>", { liveGraceMs: 120, checkMs: 40 });
    const base = cap.url();
    const event = waitForEvent(sessionId);

    await fetch(base);
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 60));
      await fetch(base + "heartbeat", { method: "POST" });
    }
    await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve", prompt: "ok" }),
    });

    cap.restore();
    expect(await event).toEqual({ kind: "submitted", sessionId, submission: { decision: "approve", prompt: "ok" } });
  });

  it("returns abandoned for an unknown session id", async () => {
    expect(await waitForEvent("sid-does-not-exist")).toEqual({
      kind: "abandoned",
      sessionId: "sid-does-not-exist",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/mcp.test.ts -t "review session round-trip"`
Expected: FAIL — `openReviewSession is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/mcp.ts`: add `type ServerResponse` and `type IncomingMessage` to the `node:http` import:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
```

Delete the `ReviewResult` type and the entire `serveAndBlock` function. Replace with the session manager:

```ts
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
      if (!sessions.has(sessionId)) reject(err);
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
```

Then update `runMcp` to compile: replace the `const result = await serveAndBlock(html);` block with the session flow (full wiring is Task 5, but this keeps the build green):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/mcp.test.ts`
Expected: PASS (all blocks, including the rewritten round-trip).

- [ ] **Step 5: Verify the build is green**

Run: `npm run build`
Expected: tsc exits 0 (no unused `ReviewResult`, all types resolve).

- [ ] **Step 6: Commit**

```bash
git add src/mcp.ts test/mcp.test.ts
git commit -m "refactor: turn serveAndBlock into a persistent review session"
```

---

### Task 4: SSE + `/ask` + `deliverAnswer` — live questions and answers

**Files:**
- Modify: `src/mcp.ts` (add `/events` + `/ask` routes to `handleRequest`; add `deliverAnswer`)
- Test: `test/mcp.test.ts` (add tests to the `describe("review session round-trip", …)` block)

**Interfaces:**
- Consumes: `parseAsk`, `resolveEvent`, `sessions`, `Session`.
- Produces: `function deliverAnswer(sessionId: string, questionId: string, answer: string): boolean` — writes an SSE `answer` event to every open `/events` stream for the session; returns `false` if the session is gone or already settled.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the `describe("review session round-trip", …)` block, and add `deliverAnswer, parseAsk` to the import if not already present:

```ts
it("turns a POST /ask into a question event", async () => {
  const cap = captureUrl();
  const sessionId = await openReviewSession("<title>x</title>");
  const base = cap.url();
  const event = waitForEvent(sessionId);

  await fetch(base);
  const res = await fetch(base + "ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: "q:a:1", ref: "src/a.ts @ L1", question: "why?" }),
  });
  expect(res.status).toBe(204);

  cap.restore();
  expect(await event).toEqual({
    kind: "question",
    sessionId,
    questionId: "q:a:1",
    ref: "src/a.ts @ L1",
    question: "why?",
  });
  // Clean up the still-open session so it doesn't leak across tests.
  await fetch(base + "cancel", { method: "POST" }).catch(() => {});
});

it("rejects a malformed /ask body with 400 and keeps the session open", async () => {
  const cap = captureUrl();
  const sessionId = await openReviewSession("<title>x</title>");
  const base = cap.url();
  const event = waitForEvent(sessionId);

  await fetch(base);
  const bad = await fetch(base + "ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
  });
  expect(bad.status).toBe(400);

  const good = await fetch(base + "ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: "q:a:1", ref: "r", question: "q" }),
  });
  expect(good.status).toBe(204);

  cap.restore();
  expect((await event).kind).toBe("question");
  await fetch(base + "cancel", { method: "POST" }).catch(() => {});
});

it("pushes an answer to the open /events stream via deliverAnswer", async () => {
  const cap = captureUrl();
  const sessionId = await openReviewSession("<title>x</title>");
  const base = cap.url();

  // Open the SSE stream and read the first answer frame.
  const ac = new AbortController();
  const streamP = fetch(base + "events", { signal: ac.signal });
  // Give the server a tick to register the stream.
  await new Promise((r) => setTimeout(r, 30));

  const ok = deliverAnswer(sessionId, "q:a:1", "because the cache is request-scoped");
  expect(ok).toBe(true);

  const stream = await streamP;
  const reader = stream.body!.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  expect(text).toContain("event: answer");
  expect(text).toContain("q:a:1");
  expect(text).toContain("because the cache is request-scoped");

  ac.abort();
  cap.restore();
  await fetch(base + "cancel", { method: "POST" }).catch(() => {});
});

it("deliverAnswer returns false for an unknown session", () => {
  expect(deliverAnswer("sid-nope", "q", "a")).toBe(false);
});

it("queues a question that arrives with no waiter, then drains it on the next waitForEvent", async () => {
  const cap = captureUrl();
  const sessionId = await openReviewSession("<title>x</title>");
  const base = cap.url();
  await fetch(base);

  // No waitForEvent parked yet: the ask must queue, not be lost.
  await fetch(base + "ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: "q:a:2", ref: "r", question: "queued?" }),
  });

  const event = await waitForEvent(sessionId);
  cap.restore();
  expect(event).toEqual({ kind: "question", sessionId, questionId: "q:a:2", ref: "r", question: "queued?" });
  await fetch(base + "cancel", { method: "POST" }).catch(() => {});
});

it("returns a submit that arrives while the agent is away (no waiter parked)", async () => {
  const cap = captureUrl();
  const sessionId = await openReviewSession("<title>x</title>");
  const base = cap.url();
  await fetch(base);

  // Submit with nobody parked — must be stashed and returned on next wait.
  await fetch(base + "submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approve", prompt: "lgtm" }),
  });

  cap.restore();
  expect(await waitForEvent(sessionId)).toEqual({
    kind: "submitted",
    sessionId,
    submission: { decision: "approve", prompt: "lgtm" },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/mcp.test.ts -t "review session round-trip"`
Expected: FAIL — `deliverAnswer is not a function` and `/ask` returns 404.

- [ ] **Step 3: Write the implementation**

In `src/mcp.ts`, add the `/events` and `/ask` routes to `handleRequest`, just before the final 404 fallthrough:

```ts
  if (method === "GET" && url === "/events") {
    session.connected = true;
    session.lastSeen = Date.now();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
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
```

Add `deliverAnswer` after `waitForEvent`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/mcp.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/mcp.ts test/mcp.test.ts
git commit -m "feat: add SSE answer push and /ask question route to the review session"
```

---

### Task 5: Wire the MCP tools — `review_changes` returns events, add `answer_review_question`

`runMcp` is the side-effecting stdio entry point and is not unit-tested (project convention); this task is wiring, verified by `npm run build` and a manual smoke test.

**Files:**
- Modify: `src/mcp.ts` (`runMcp`: finalize the `review_changes` handler from Task 3; add the `answerToolInputShape` export and register `answer_review_question`)
- Test: `test/mcp.test.ts` (add an export-shape assertion for `answerToolInputShape`)

**Interfaces:**
- Consumes: `openReviewSession`, `waitForEvent`, `deliverAnswer`, `formatEventResult`.
- Produces: `answerToolInputShape` (a raw zod shape, like `reviewToolInputShape`).

- [ ] **Step 1: Write the failing test**

Add to `test/mcp.test.ts` (add `answerToolInputShape` to the import):

```ts
describe("answerToolInputShape", () => {
  it("is a raw zod shape with sessionId, questionId, answer", () => {
    expect(Object.keys(answerToolInputShape).sort()).toEqual(["answer", "questionId", "sessionId"]);
    const schema = z.object(answerToolInputShape);
    expect(schema.safeParse({ sessionId: "sid-1", questionId: "q:a:1", answer: "because" }).success).toBe(true);
    expect(schema.safeParse({ sessionId: "sid-1", questionId: "q:a:1" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp.test.ts -t answerToolInputShape`
Expected: FAIL — `answerToolInputShape is not defined`.

- [ ] **Step 3: Write the implementation**

In `src/mcp.ts`, near `reviewToolInputShape`, add:

```ts
export const answerToolInputShape = {
  sessionId: z.string(),
  questionId: z.string(),
  answer: z.string(),
};
```

Confirm the `review_changes` handler tail (from Task 3) reads exactly:

```ts
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
```

In the `review_changes` tool `description`, append the loop guidance:

```
"…and return their decision plus assembled feedback. If the reviewer asks a question instead of deciding, this returns a question event; answer it with answer_review_question and keep answering until a decision is returned."
```

Register the second tool after the `review_changes` registration:

```ts
  server.registerTool(
    "answer_review_question",
    {
      title: "Answer a review question",
      description:
        "Answer a question the reviewer asked during an open review (from a review_changes question event). Pushes your answer to the live review page and blocks until the next event — another question, or the reviewer's final decision. Keep calling this for each question until you receive a submitted or abandoned result.",
      inputSchema: answerToolInputShape,
    },
    async (args) => {
      deliverAnswer(args.sessionId, args.questionId, args.answer);
      const event = await waitForEvent(args.sessionId);
      return { content: [{ type: "text", text: formatEventResult(event) }] };
    },
  );
```

- [ ] **Step 4: Run test + build**

Run: `npx vitest run test/mcp.test.ts -t answerToolInputShape && npm run build`
Expected: test PASS; tsc exits 0.

- [ ] **Step 5: Manual smoke test**

Run `npm run build`, then drive the MCP server (or via the configured client) on a branch with a `.review/intent.json`. Confirm: the page opens; typing a question and clicking **Ask the agent now** returns a question event to the agent; the agent's answer appears inline on the page; Approve/Request-changes still returns the decision. Note this is a manual check (no automated coverage of `runMcp`).

- [ ] **Step 6: Commit**

```bash
git add src/mcp.ts test/mcp.test.ts
git commit -m "feat: wire review_changes events and the answer_review_question tool"
```

---

### Task 6: Live-Q&A page behavior in the submit-mode client script

All of this lives in `render.ts`'s existing submit-mode script and the shared `collect()` — no new markup function, so non-submit output stays byte-identical and `render.ts` stays pure (it emits a static script string; the browser does the DOM work).

**Files:**
- Modify: `src/render.ts` (`commentScript`: extend the `${submit ? …}` block ~line 1741-1777; add a resolved-question guard in `collect()` ~line 1660-1681; add CSS for `.q-ask` / `.q-answer` near the `.cbox` styles ~line 1475-1493)
- Test: `test/render.test.ts` (add assertions for the new submit-mode script tokens and the non-submit absence)

**Interfaces:**
- Consumes: existing question textareas (`.cinput[data-akind="question"]`, `data-cid="q:…"`, `data-ref`), the `clean()` and `assemble()` helpers already in the script, and the `/ask` + `/events` server routes from Task 4.
- Produces: no new exports — page behavior only.

- [ ] **Step 1: Write the failing tests**

Add to `test/render.test.ts`:

```ts
describe("live Q&A (submit mode)", () => {
  it("wires EventSource and /ask only when submit is on", () => {
    const withSubmit = renderHtml(model, { submit: true });
    expect(withSubmit).toContain('new EventSource("/events")');
    expect(withSubmit).toContain('"/ask"');
    expect(withSubmit).toContain("q-ask");
    expect(withSubmit).toContain("q-resolved");

    const plain = renderHtml(model);
    expect(plain).not.toContain('new EventSource("/events")');
    expect(plain).not.toContain('"/ask"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/render.test.ts -t "live Q&A"`
Expected: FAIL — tokens not found in submit-mode output.

- [ ] **Step 3a: Skip resolved questions in `collect()`**

In `src/render.ts`, inside the `collect` function, add a helper at the top of the function body and guard each question pickup. Replace the file-level and hunk-level pickups and the page-level pickup so a resolved question is excluded:

```js
    function collect(akind, files) {
      var lines = [], count = 0;
      function live(el) { var b = el.closest(".cbox"); return !(akind === "question" && b && b.classList.contains("q-resolved")); }
      files.forEach(function (f) {
        var code = f.querySelector(".path");
        var path = code ? code.textContent : f.id;
        var section = [];
        var fc = f.querySelector('.cbox-group[data-ckind="file"] .cinput[data-akind="' + akind + '"]');
        if (fc && clean(fc.value) && live(fc)) { section.push("- " + indent(fc.value)); count++; }
        f.querySelectorAll('.cbox-group[data-ckind="hunk"] .cinput[data-akind="' + akind + '"]').forEach(function (hc) {
          if (clean(hc.value) && live(hc)) {
            var ref = hc.getAttribute("data-ref"), hdr = hc.getAttribute("data-hdr");
            section.push("### " + ref + (hdr ? "  (" + hdr + ")" : ""));
            section.push("- " + indent(hc.value));
            count++;
          }
        });
        if (section.length) { lines.push("## " + path); lines.push.apply(lines, section); lines.push(""); }
      });
      var pgCid = akind === "question" ? "q:__page__" : "__page__";
      var pg = document.querySelector('.cinput[data-cid="' + pgCid + '"]');
      if (pg && clean(pg.value) && live(pg)) { lines.push("## General"); lines.push("- " + indent(pg.value)); lines.push(""); count++; }
      return { lines: lines, count: count };
    }
```

- [ ] **Step 3b: Add the live-Q&A wiring to the submit block**

In `src/render.ts`, inside the `${submit ? \`` block in `commentScript` (after the existing approve/request wiring, before the closing backtick at ~line 1777), append:

```js
    // ── Live Q&A: ask the agent about a hunk while the review stays open ──
    var es = null;
    try { es = new EventSource("/events"); } catch (e) {}
    function ansSlot(cbox) {
      var slot = cbox.querySelector(".q-answer");
      if (!slot) { slot = document.createElement("div"); slot.className = "q-answer"; cbox.appendChild(slot); }
      return slot;
    }
    Array.prototype.slice.call(document.querySelectorAll('.cinput[data-akind="question"]')).forEach(function (ta) {
      var cbox = ta.closest(".cbox"); if (!cbox) return;
      var ask = document.createElement("button");
      ask.type = "button"; ask.className = "q-ask"; ask.textContent = "Ask the agent now";
      ta.insertAdjacentElement("afterend", ask);
      ask.addEventListener("click", function () {
        var q = clean(ta.value); if (!q) return;
        var qid = ta.getAttribute("data-cid");
        var ref = ta.getAttribute("data-ref") || qid;
        ask.disabled = true; ask.textContent = "Waiting for the agent…";
        var slot = ansSlot(cbox); slot.className = "q-answer pending"; slot.textContent = "Waiting for the agent…";
        fetch("/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: qid, ref: ref, question: q })
        }).catch(function () {
          ask.disabled = false; ask.textContent = "Ask the agent now";
          slot.className = "q-answer"; slot.textContent = "Could not reach the review server — is it still running?";
        });
      });
    });
    if (es) es.addEventListener("answer", function (ev) {
      var data; try { data = JSON.parse(ev.data); } catch (e) { return; }
      var ta = document.querySelector('.cinput[data-cid="' + data.questionId + '"]');
      if (!ta) return;
      var cbox = ta.closest(".cbox"); if (!cbox) return;
      var slot = ansSlot(cbox); slot.className = "q-answer"; slot.textContent = "";
      var lbl = document.createElement("strong"); lbl.textContent = "Agent: ";
      slot.appendChild(lbl); slot.appendChild(document.createTextNode(data.answer));
      cbox.classList.add("q-resolved");
      var ask = cbox.querySelector(".q-ask");
      if (ask) { ask.disabled = true; ask.textContent = "Answered ✓"; }
      assemble();
    });
```

- [ ] **Step 3c: Add CSS for the new elements**

In `src/render.ts`, near the `.cbox` styles (~line 1493), add:

```css
.q-ask { margin-top: 8px; align-self: flex-start; font: inherit; font-size: 0.85em; padding: 3px 10px; border: 1px solid var(--add); border-radius: 6px; background: var(--add-soft, var(--accent-soft)); color: var(--add); cursor: pointer; }
.q-ask:disabled { opacity: 0.7; cursor: default; }
.q-answer { margin-top: 8px; padding: 8px 10px; border-left: 3px solid var(--add); background: var(--accent-soft); border-radius: 0 6px 6px 0; white-space: pre-wrap; }
.q-answer.pending { opacity: 0.7; font-style: italic; }
.cbox.q-resolved .cbtn-q::after { content: " ✓"; }
```

- [ ] **Step 4: Run the render tests**

Run: `npx vitest run test/render.test.ts`
Expected: PASS, including the new `live Q&A` block. Confirm no other render snapshot/markup test regressed (the submit block is additive; non-submit output unchanged).

- [ ] **Step 5: Regenerate the sample and eyeball it**

Run: `npm run sample`
Then open `sample-output.html` (CLI mode, no submit) and confirm it is unchanged in spirit — no "Ask the agent now" buttons appear (they are submit-mode only). Commit the regenerated sample only if it changed meaningfully.

- [ ] **Step 6: Run the full suite + build**

Run: `npm test && npm run build`
Expected: all tests PASS; tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: live ask-the-agent Q&A on the review page"
```

---

## Self-Review

**Spec coverage:**
- Sampling constraint / agent-driven loop → Tasks 3-5 (session + two tools + loop in descriptions). ✓
- SSE channel (`/events`) → Task 4. ✓
- Two tools, backward compatible (`review_changes` blocks straight to decision when no question) → Tasks 3 & 5 (waitForEvent returns `submitted` directly). ✓
- `ReviewEvent` union → Task 2. ✓
- Session state map → Task 3. ✓
- `render.ts` purity preserved; page behavior in submit-mode script → Task 6 (no new markup, gated, deterministic string). ✓
- Edge cases — page closed (cancel/heartbeat → abandoned) Tasks 3; multiple questions FIFO queue Task 4; unknown/closed session → abandoned Tasks 3-4; submit while agent away → pendingTerminal Task 4. ✓
- Answered questions dropped from final prompt → Task 6 `collect()` `q-resolved` guard. ✓
- Pure helpers `parseAsk` + event formatter unit-tested → Tasks 1-2. ✓
- Testing plan (render markup asserts; mcp round-trip) → Tasks 1-6. ✓
- Out of scope (transcript persistence, keepalive event, multi-review UX, WebSocket) → not implemented, by design. ✓

**Type consistency:** `ReviewEvent` (Task 2) carries `sessionId` on every variant and `questionId`/`ref`/`question` on `question`; `resolveEvent`/`waitForEvent`/`deliverAnswer` (Tasks 3-4) and the tools (Task 5) use those exact names; the page sends `{ questionId, ref, question }` to `/ask` (Task 6) matching `AskSchema`/`parseAsk` (Task 1), and reads `{ questionId, answer }` from the SSE frame matching `deliverAnswer`'s payload (Task 4). `answerToolInputShape` keys (`sessionId`, `questionId`, `answer`) match `deliverAnswer`'s parameters. Consistent.

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. Note: `SUBMITTED_PAGE` reproduces today's inline submit-confirmation HTML verbatim (extracted to a constant for reuse) — not a placeholder.
