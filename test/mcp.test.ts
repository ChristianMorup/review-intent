import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Suppress the real browser launch so the round-trip test stays headless and
// deterministic. `open` is fire-and-forget inside serveAndBlock.
vi.mock("open", () => ({ default: vi.fn(async () => undefined) }));

import {
  reviewToolInputShape,
  parseSubmission,
  parseAsk,
  formatToolResult,
  formatEventResult,
  authoringGuide,
  openReviewSession,
  waitForEvent,
  deliverAnswer,
} from "../src/mcp.js";

// Mirrors complexity.test.ts: only the PURE exports are unit-tested. The http
// server, browser launch, and stdio transport (runMcp) are
// side-effecting and exercised by a manual smoke test, not vitest.

describe("formatToolResult", () => {
  it("passes a request-changes prompt through verbatim", () => {
    expect(formatToolResult("request-changes", "do X")).toBe(
      "Reviewer decision: request-changes\n\ndo X",
    );
  });

  it("passes an approve-with-prompt through verbatim", () => {
    expect(formatToolResult("approve", "fix the typo")).toBe(
      "Reviewer decision: approve\n\nfix the typo",
    );
  });

  it("renders a clear no-changes message when approving with an empty prompt", () => {
    const expected = "Reviewer decision: approve\n\nApproved — no changes requested.";
    expect(formatToolResult("approve", "")).toBe(expected);
    expect(formatToolResult("approve", "   ")).toBe(expected);
    expect(formatToolResult("approve", "\n\t  ")).toBe(expected);
  });

  it("flags a request-changes with no feedback rather than emitting an empty body", () => {
    const expected =
      "Reviewer decision: request-changes\n\nChanges requested, but no specific feedback was provided.";
    expect(formatToolResult("request-changes", "")).toBe(expected);
    expect(formatToolResult("request-changes", "   ")).toBe(expected);
  });
});

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

describe("authoringGuide", () => {
  it("strips a leading YAML frontmatter block and trims", () => {
    const src = "---\nname: x\ndescription: y\n---\n\n# Heading\n\nBody text.\n";
    expect(authoringGuide(src)).toBe("# Heading\n\nBody text.");
  });

  it("tolerates CRLF frontmatter delimiters", () => {
    const src = "---\r\nname: x\r\n---\r\nBody.\r\n";
    expect(authoringGuide(src)).toBe("Body.");
  });

  it("returns content unchanged (trimmed) when there is no frontmatter", () => {
    expect(authoringGuide("# Just a doc\n")).toBe("# Just a doc");
  });

  it("derives the real contract from SKILL_CONTENT without its frontmatter", () => {
    const guide = authoringGuide();
    expect(guide.startsWith("---")).toBe(false);
    expect(guide).toContain("Authoring an honest intent artifact");
    expect(guide).toContain("honesty contract");
  });
});

describe("parseSubmission", () => {
  it("parses a valid submission object", () => {
    expect(parseSubmission('{"decision":"approve","prompt":"x"}')).toEqual({
      decision: "approve",
      prompt: "x",
    });
    expect(
      parseSubmission('{"decision":"request-changes","prompt":"please redo"}'),
    ).toEqual({ decision: "request-changes", prompt: "please redo" });
  });

  it("throws on an invalid decision", () => {
    expect(() => parseSubmission('{"decision":"reject","prompt":"x"}')).toThrow();
    expect(() => parseSubmission('{"decision":"request_changes","prompt":"x"}')).toThrow();
  });

  it("throws on a non-string prompt", () => {
    expect(() => parseSubmission('{"decision":"approve","prompt":42}')).toThrow();
    expect(() => parseSubmission('{"decision":"approve"}')).toThrow();
  });

  it("throws on malformed JSON", () => {
    expect(() => parseSubmission("not json")).toThrow();
    expect(() => parseSubmission("")).toThrow();
  });
});

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

describe("reviewToolInputShape", () => {
  it("is a raw zod shape with exactly the expected keys", () => {
    expect(Object.keys(reviewToolInputShape).sort()).toEqual(
      ["allowGaps", "artifact", "base", "cwd"].sort(),
    );
    for (const v of Object.values(reviewToolInputShape)) {
      expect(v).toBeInstanceOf(z.ZodType);
    }
  });

  it("wraps into a z.object whose fields are all optional", () => {
    const schema = z.object(reviewToolInputShape);
    expect(schema.safeParse({}).success).toBe(true);
    expect(
      schema.safeParse({ cwd: "/repo", base: "main", artifact: ".review/x.json", allowGaps: true })
        .success,
    ).toBe(true);
  });

  it("rejects a non-boolean allowGaps", () => {
    const schema = z.object(reviewToolInputShape);
    expect(schema.safeParse({ allowGaps: "no" }).success).toBe(false);
  });
});

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

    const ok = await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve", prompt: "" }),
    });
    expect(ok.status).toBe(200);

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

    // Open the SSE stream and drain frames until the answer arrives (the
    // server sends a `: connected` comment frame first).
    const ac = new AbortController();
    const streamP = fetch(base + "events", { signal: ac.signal });
    // Give the server a tick to register the stream.
    await new Promise((r) => setTimeout(r, 30));

    const ok = deliverAnswer(sessionId, "q:a:1", "because the cache is request-scoped");
    expect(ok).toBe(true);

    const stream = await streamP;
    const reader = stream.body!.getReader();
    let text = "";
    while (!text.includes("event: answer")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
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

  it("deliverAnswer returns false for a settled session", async () => {
    const cap = captureUrl();
    const sessionId = await openReviewSession("<title>x</title>");
    const base = cap.url();

    await fetch(base);
    // Submit with no waiter parked: the session settles (settled=true) and is
    // kept in the map with a stashed terminal event, so this hits the `settled`
    // guard in deliverAnswer rather than the unknown-session guard.
    const res = await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve", prompt: "ok" }),
    });
    expect(res.status).toBe(200);

    cap.restore();
    expect(deliverAnswer(sessionId, "q:a:1", "x")).toBe(false);
    // Drain the stashed terminal so the session doesn't leak.
    await waitForEvent(sessionId);
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
});
