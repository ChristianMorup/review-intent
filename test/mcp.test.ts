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
  authoringGuide,
  serveAndBlock,
} from "../src/mcp.js";

// Mirrors complexity.test.ts: only the PURE exports are unit-tested. The http
// server, browser launch, and stdio transport (runMcp/serveAndBlock) are
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

describe("serveAndBlock round-trip", () => {
  // Capture the "Review page: http://127.0.0.1:<port>/" stderr line to learn
  // the ephemeral port the server bound to (browser launch is mocked above).
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
    return {
      restore: () => {
        process.stderr.write = orig;
      },
      url: () => captured,
    };
  }

  async function waitForUrl(get: () => string): Promise<string> {
    for (let i = 0; i < 100 && !get(); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return get();
  }

  it("serves the HTML on GET / and resolves with the parsed POST /submit body", async () => {
    const cap = captureUrl();
    const html = "<!DOCTYPE html><title>x</title><body>REVIEW_PAGE_MARKER";
    const blocked = serveAndBlock(html);

    const base = await waitForUrl(cap.url);
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    // GET / returns the submit-mode HTML.
    const page = await fetch(base);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("REVIEW_PAGE_MARKER");

    // POST /submit resolves the blocking promise with the parsed submission.
    const res = await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "request-changes", prompt: "tighten the loop" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("you can close this tab");

    const result = await blocked;
    cap.restore();
    expect(result).toEqual({
      kind: "submitted",
      submission: { decision: "request-changes", prompt: "tighten the loop" },
    });
  });

  it("rejects a malformed /submit body with 400 and keeps blocking", async () => {
    const cap = captureUrl();
    const blocked = serveAndBlock("<title>x</title>");
    const base = await waitForUrl(cap.url);

    const bad = await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    expect(bad.status).toBe(400);

    // The server is still up and still blocking; a valid submit then resolves it.
    const ok = await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve", prompt: "" }),
    });
    expect(ok.status).toBe(200);

    const result = await blocked;
    cap.restore();
    expect(result).toEqual({
      kind: "submitted",
      submission: { decision: "approve", prompt: "" },
    });
  });

  it("resolves as abandoned when the page beacons /cancel", async () => {
    const cap = captureUrl();
    const blocked = serveAndBlock("<title>x</title>");
    const base = await waitForUrl(cap.url);

    await fetch(base); // page connects
    const res = await fetch(base + "cancel", { method: "POST" });
    expect(res.status).toBe(204);

    const result = await blocked;
    cap.restore();
    expect(result).toEqual({ kind: "abandoned" });
  });

  it("resolves as abandoned when heartbeats stop after the page connected", async () => {
    const cap = captureUrl();
    // Tiny liveness window so the test is fast and deterministic.
    const blocked = serveAndBlock("<title>x</title>", { liveGraceMs: 120, checkMs: 40 });
    const base = await waitForUrl(cap.url);

    await fetch(base); // page connects, then sends no heartbeats
    const result = await blocked;
    cap.restore();
    expect(result).toEqual({ kind: "abandoned" });
  });

  it("does not abandon while heartbeats keep arriving, then accepts a submit", async () => {
    const cap = captureUrl();
    const blocked = serveAndBlock("<title>x</title>", { liveGraceMs: 120, checkMs: 40 });
    const base = await waitForUrl(cap.url);

    await fetch(base);
    // Beat a few times across more than one grace window — must NOT abandon.
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 60));
      await fetch(base + "heartbeat", { method: "POST" });
    }
    await fetch(base + "submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve", prompt: "ok" }),
    });

    const result = await blocked;
    cap.restore();
    expect(result).toEqual({ kind: "submitted", submission: { decision: "approve", prompt: "ok" } });
  });
});
