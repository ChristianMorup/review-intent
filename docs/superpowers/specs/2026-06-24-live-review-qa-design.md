# Live review Q&A — design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Component:** `src/mcp.ts`, `src/render.ts` (+ tests)

## Problem

The MCP `review_changes` tool opens an intent-annotated review page and blocks
until the reviewer approves or requests changes. The reviewer gets exactly one
round trip: any question about a hunk's intent can only be folded into the final
submission, after which the agent acts and re-renders a *fresh* page. The page
closes between rounds, and there is no way to interrogate a chunk and get the
agent's answer **while the review stays open**.

We want: the reviewer asks a question about a hunk, the agent answers it live,
the answer appears inline on the still-open page, and the final approve /
request-changes decision still blocks the agent until the reviewer returns it.

## Constraint that shapes the whole design

MCP **sampling** (`sampling/createMessage`, server→client LLM request) is the
obvious way for the server to "ask the agent" mid-call. It is **not implemented
in Claude Code's MCP client** (open issue anthropics/claude-code#1785; never
shipped; not declared at init). Elicitation (#2799) is likewise unimplemented.

Therefore the server cannot wake the agent's reasoning while a tool call blocks.
A blocked agent is a frozen agent. The only way to get *the agent's* answer is to
**return control to the agent** so it takes a turn. The design below does exactly
that, while preserving the "blocks until decision" feel via tool calls that each
park on the next event.

The server deliberately does **not** make its own LLM/API call to answer
questions: `review-intent` is a pure renderer (see `README.md` / `CLAUDE.md`),
and a fresh API call would not be *the agent that made the changes* — it would
re-derive intent from the diff, defeating the product's purpose.

## Architecture — two channels

1. **Page ↔ review-intent server** (the local `http` server in `serveAndBlock`).
   Upgraded from request/response-only to also carry **Server-Sent Events** via a
   `GET /events` stream. Page→server stays plain `POST`. SSE is chosen over
   WebSocket because it needs no new dependency (browser `EventSource` is
   built-in; WebSocket would pull in `ws`), and it fits the existing plain-`http`
   server. This channel is fully under our control — no MCP limitation applies.

2. **Agent ↔ server** (MCP stdio, `StdioServerTransport`). Unchanged transport.
   No sampling. The agent drives the session via tool calls that each block until
   the next review event, so the agent is idle (parked) between events rather than
   busy-polling.

## Tool surface — two tools, backward compatible

### `review_changes(cwd?, base?, artifact?, allowGaps?)`

Signature unchanged. Builds the review (`buildReview`), applies the completeness
gate, renders the submit-mode page, opens the browser, registers a **session**,
then **blocks until the first review event** and returns a `ReviewEvent`.

If the reviewer never asks a question, this blocks straight through to their
decision — **byte-for-byte today's behavior**. The empty-diff and gate/error
early returns are unchanged.

### `answer_review_question(sessionId, answer)`

New tool. Looks up the session, pushes `answer` to the open page over SSE
(`event: answer`), then **blocks until the next review event** and returns the
next `ReviewEvent`. If the session is unknown/closed, returns an `abandoned`
event rather than hanging.

### `ReviewEvent` (returned by both tools)

```ts
type ReviewEvent =
  | { kind: "question"; sessionId: string; ref: string; label: string; question: string }
  | { kind: "submitted"; sessionId: string; submission: Submission }
  | { kind: "abandoned"; sessionId: string };
```

The agent's loop (made explicit in the tool descriptions):

```
ev = review_changes(...)
while ev.kind == "question":
    ev = answer_review_question(ev.sessionId, <agent's answer to ev.question>)
# ev.kind is now "submitted" or "abandoned" -> report decision / re-offer
```

Each call ends parked on the next event, so "blocking until the reviewer decides"
holds across the entire session, with questions answered live in between.

## Session state

A module-level `Map<string, Session>` in `mcp.ts` (a side-effecting module —
within the project's purity boundary). A `Session` holds:

- the `http.Server` instance and its URL,
- the registered SSE client response handle(s),
- a FIFO queue of pending questions,
- a single "resolve next event" hook (the promise resolver the current parked
  tool call is waiting on),
- liveness bookkeeping (`connected`, `lastSeen`) reused from today's heartbeat.

`sessionId` is generated server-side and returned to the agent inside the first
`ReviewEvent`. Use an incrementing module counter rather than
`Date.now()`/`Math.random()` — those are banned in pure modules for determinism,
and a counter keeps ids stable and test-friendly even though the runner is a
side-effecting module where they would technically be allowed. One active review
at a time is the expected case, but the map supports more.

## Data flow

1. Page loads in submit mode → opens `EventSource("/events")`; server stores the
   response handle in the session and starts SSE keepalive comments.
2. Reviewer types a question on a hunk/file (reusing the existing
   `data-akind="question"` inputs) and clicks a new **"Ask now"** button →
   `POST /ask { ref, label, question }`.
3. Server enqueues the question and resolves the parked tool call with
   `{ kind: "question", ... }`.
4. Agent receives the question, formulates an answer, calls
   `answer_review_question(sessionId, answer)`.
5. Server emits SSE `event: answer { ref, answer }`; the page renders it inline
   beneath that question and marks the question **resolved**.
6. `answer_review_question` then parks on the next event.
7. Approve / Request-changes (`POST /submit`) and tab close (`POST /cancel` +
   heartbeat gap) are unchanged but also resolve the parked tool call — with
   `submitted` / `abandoned` respectively.

## Page (render.ts) changes — purity preserved

`render.ts` stays pure and deterministic. It only emits, gated on `submit`:

- an `EventSource("/events")` bootstrap that listens for `event: answer` and
  injects the answer into the DOM under the matching `ref`,
- an **"Ask now"** button next to each question input (per-hunk, per-file, and
  the overall question), which POSTs `/ask` and shows a pending state until the
  SSE answer arrives.

Answers are rendered **client-side** from SSE data, so no server-side
nondeterminism enters the emitted HTML. The existing copy-as-prompt and submit
flow is untouched.

Once a question is answered live, it is marked resolved and **dropped from the
"questions to resolve" section of the final assembled prompt**, so the reviewer
does not re-ask it on submit. (Decision: answered questions are not retained as a
Q&A record in the submit prompt for v1 — YAGNI; revisit if a transcript is
wanted.)

## Edge cases (kept visible — project rule: never silently drop)

- **Page closed mid-wait** → SSE stream end / `POST /cancel` / heartbeat gap
  resolves the parked tool call with `abandoned`. Same liveness logic as today.
- **Multiple questions before the agent answers** → FIFO queue; one `question`
  event per `answer_review_question` round until drained.
- **`answer_review_question` for an unknown/closed session** → returns
  `abandoned`; never hangs.
- **SSE client reconnect** (browser auto-reconnect) → server re-registers the
  handle against the existing session; queued answers are replay-safe (answers
  carry their `ref`, page is idempotent on re-delivery).
- **Tool-call duration**: the per-call block is bounded by "until the next
  question or the decision" — the same order of magnitude as today's single
  blocking call, which already supports arbitrarily long human reviews. No
  keepalive/"waiting" event is added (YAGNI); add one only if a tool timeout is
  observed in practice.

## Pure helpers (unit-tested)

- `parseAsk(body)` — parse + Zod-validate the `POST /ask` body
  (`{ ref, label, question }`), mirroring `parseSubmission`.
- An event→tool-result formatter that turns a `ReviewEvent` into the MCP tool
  result text (e.g. a `question` event yields text instructing the agent to call
  `answer_review_question` with the given `sessionId`). Mirrors
  `formatToolResult`.
- A pure session-state reducer (enqueue question / record answer / resolve event)
  so sequencing is testable without sockets.

## Testing

- **render.ts (pure)**: assert submit-mode markup contains the `EventSource`
  bootstrap and the "Ask now" buttons; assert non-submit markup is unchanged.
  Same approach as the existing heartbeat-markup assertions.
- **mcp.ts**: extend the current `serveAndBlock` tests (which mock `open` and
  shrink liveness timings) to drive the full sequence: `POST /ask` →
  `question` event; `answer_review_question` → SSE `answer` delivered; `POST
  /submit` → `submitted`; tab close → `abandoned`; unknown session →
  `abandoned`. Unit-test `parseAsk` and the event formatter directly.

## Risk

The session loop lives in the **tool descriptions** — the agent must reliably
keep answering questions and re-parking until a decision arrives. This is the
inherent soft spot of a sampling-less design: it rests on the agent following the
descriptions, not a protocol guarantee. Mitigation: write the `question`-event
tool-result text and both tool descriptions to state the loop explicitly and
unambiguously.

## Out of scope (v1)

- Persisting the live Q&A as a transcript in the artifact or submit prompt.
- A "waiting"/keepalive event for tool timeouts (add only if observed).
- More than the existing one-review-at-a-time workflow (the session map supports
  it, but no multi-review UX is built).
- WebSocket transport.
