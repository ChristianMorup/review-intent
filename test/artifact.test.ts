import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadArtifact, ArtifactError } from "../src/artifact.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ri-test-"));
}

function writeArtifact(dir: string, contents: string): void {
  mkdirSync(join(dir, ".review"), { recursive: true });
  writeFileSync(join(dir, ".review", "intent.json"), contents, "utf8");
}

describe("loadArtifact", () => {
  it("loads and validates a well-formed artifact", () => {
    const dir = scratch();
    writeArtifact(
      dir,
      JSON.stringify({
        title: "T",
        tldr: "tl;dr",
        overall: "why",
        diagrams: { class: "classDiagram" },
        files: [
          { path: "a.ts", what: "w", why: "y", hunks: [{ anchor: 1, what: "hw", why: "hy" }] },
        ],
      }),
    );
    const a = loadArtifact(dir);
    expect(a.title).toBe("T");
    expect(a.files[0].hunks[0].anchor).toBe(1);
  });

  it("defaults optional collections", () => {
    const dir = scratch();
    writeArtifact(dir, JSON.stringify({ title: "T", tldr: "tl;dr", overall: "why" }));
    const a = loadArtifact(dir);
    expect(a.files).toEqual([]);
    expect(a.diagrams).toEqual({});
    expect(a.tests).toEqual([]);
  });

  it("loads optional test cases with their kind and name", () => {
    const dir = scratch();
    writeArtifact(
      dir,
      JSON.stringify({
        title: "T",
        tldr: "tl;dr",
        overall: "why",
        tests: [
          { describes: "returns null on a miss", name: "CacheMiss_ReturnsNull", kind: "unit" },
          { describes: "a manual smoke check" },
        ],
      }),
    );
    const a = loadArtifact(dir);
    expect(a.tests).toHaveLength(2);
    expect(a.tests[0]).toEqual({
      describes: "returns null on a miss",
      name: "CacheMiss_ReturnsNull",
      kind: "unit",
    });
    expect(a.tests[1].name).toBeUndefined();
  });

  it("rejects a test case missing its describes sentence", () => {
    const dir = scratch();
    writeArtifact(
      dir,
      JSON.stringify({
        title: "T",
        tldr: "tl;dr",
        overall: "why",
        tests: [{ name: "no describes", kind: "unit" }],
      }),
    );
    expect(() => loadArtifact(dir)).toThrow(/does not match the expected schema/);
  });

  it("throws a friendly error when the artifact is missing", () => {
    expect(() => loadArtifact(scratch())).toThrow(ArtifactError);
  });

  it("throws on invalid JSON", () => {
    const dir = scratch();
    writeArtifact(dir, "{ not json");
    expect(() => loadArtifact(dir)).toThrow(/not valid JSON/);
  });

  it("throws on schema violations (missing required field)", () => {
    const dir = scratch();
    writeArtifact(dir, JSON.stringify({ overall: "no title" }));
    expect(() => loadArtifact(dir)).toThrow(/does not match the expected schema/);
  });

  it("rejects a non-positive hunk anchor", () => {
    const dir = scratch();
    writeArtifact(
      dir,
      JSON.stringify({
        title: "T",
        tldr: "tl;dr",
        overall: "why",
        files: [{ path: "a.ts", what: "w", why: "y", hunks: [{ anchor: 0, what: "hw", why: "hy" }] }],
      }),
    );
    expect(() => loadArtifact(dir)).toThrow(ArtifactError);
  });

  it("rejects an artifact missing the tldr", () => {
    const dir = scratch();
    writeArtifact(dir, JSON.stringify({ title: "T", overall: "why" }));
    expect(() => loadArtifact(dir)).toThrow(/does not match the expected schema/);
  });

  it("rejects a file entry missing what/why", () => {
    const dir = scratch();
    writeArtifact(
      dir,
      JSON.stringify({
        title: "T",
        tldr: "tl;dr",
        overall: "why",
        files: [{ path: "a.ts" }],
      }),
    );
    expect(() => loadArtifact(dir)).toThrow(/does not match the expected schema/);
  });
});
