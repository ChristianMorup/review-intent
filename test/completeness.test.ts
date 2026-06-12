import { describe, it, expect } from "vitest";
import { findGaps, formatGaps } from "../src/completeness.js";
import type { ReviewModel, AnnotatedFile } from "../src/types.js";

function model(files: AnnotatedFile[]): ReviewModel {
  return {
    title: "T",
    tldr: "tl;dr",
    overall: "o",
    base: "main",
    diagrams: {},
    risks: [],
    scorecard: {
      filesChanged: files.length,
      byStatus: {},
      hunks: 0,
      added: 0,
      removed: 0,
      testFiles: 0,
      codeFiles: 0,
      badges: [],
    },
    reach: { changed: [], edges: [] },
    files,
    filesWithoutChanges: [],
  };
}

const hunk = (intents: AnnotatedFile["hunks"][number]["intents"]) => ({
  header: "@@ -1 +1 @@",
  newStart: 1,
  newEnd: 1,
  intents,
  lines: [],
});

describe("findGaps", () => {
  it("returns no gaps when every file has why and every hunk has intent", () => {
    const gaps = findGaps(
      model([
        {
          path: "a.ts",
          status: "modified",
          what: "w",
          why: "y",
          unmatchedIntents: [],
          hunks: [hunk([{ anchor: 1, what: "hw", why: "hy" }])],
        },
      ]),
    );
    expect(gaps).toEqual([]);
  });

  it("flags a file with no why", () => {
    const gaps = findGaps(
      model([
        { path: "a.ts", status: "modified", unmatchedIntents: [], hunks: [] },
      ]),
    );
    expect(gaps).toEqual([
      { kind: "file", path: "a.ts", detail: "no what/why written for this changed file" },
    ]);
  });

  it("flags a hunk with no intent even when the file has a why", () => {
    const gaps = findGaps(
      model([
        {
          path: "a.ts",
          status: "modified",
          what: "w",
          why: "y",
          unmatchedIntents: [],
          hunks: [hunk([])],
        },
      ]),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("hunk");
    expect(gaps[0].path).toBe("a.ts");
  });
});

describe("formatGaps", () => {
  it("produces a readable, actionable message mentioning --allow-gaps", () => {
    const msg = formatGaps([{ kind: "file", path: "a.ts", detail: "no what/why written for this changed file" }]);
    expect(msg).toContain("1 gap(s) found");
    expect(msg).toContain("a.ts");
    expect(msg).toContain("--allow-gaps");
  });
});
