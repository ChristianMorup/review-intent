import { describe, it, expect } from "vitest";
import { buildReviewModel } from "../src/match.js";
import { ArtifactSchema } from "../src/types.js";
import type { DiffFile, ScorecardModel, ReachModel, ComplexityModel } from "../src/types.js";

const emptyScorecard: ScorecardModel = {
  filesChanged: 1,
  byStatus: { modified: 1 },
  hunks: 2,
  added: 0,
  removed: 0,
  testFiles: 0,
  codeFiles: 1,
  testLines: 0,
  codeLines: 0,
  debtMarkers: 0,
  noiseFiles: 0,
  largestFile: null,
  badges: [],
};
const emptyReach: ReachModel = { changed: [], edges: [] };
const emptyComplexity: ComplexityModel = {
  available: true,
  threshold: 15,
  functionsAnalyzed: 0,
  maxCcn: 0,
  worst: null,
  hotspots: [],
};

const diff: DiffFile[] = [
  {
    path: "src/greet.ts",
    status: "modified",
    hunks: [
      { header: "@@ -1,4 +1,5 @@", newStart: 1, newEnd: 5, lines: [] },
      { header: "@@ -10,2 +11,3 @@", newStart: 11, newEnd: 13, lines: [] },
    ],
  },
];

const artifact = ArtifactSchema.parse({
  title: "T",
  tldr: "tl;dr",
  overall: "why",
  files: [
    {
      path: "src/greet.ts",
      what: "file what",
      why: "file note",
      hunks: [
        { anchor: 3, what: "w1", why: "into first hunk" },
        { anchor: 12, what: "w2", why: "into second hunk" },
        { anchor: 999, what: "w3", why: "matches no hunk" },
      ],
    },
    { path: "src/untouched.ts", what: "uw", why: "not in diff" },
  ],
});

describe("buildReviewModel", () => {
  const model = buildReviewModel(artifact, diff, "main", emptyScorecard, emptyReach, emptyComplexity);

  it("attaches each hunk intent to the hunk whose new-line range contains the anchor", () => {
    expect(model.files[0].hunks[0].intents.map((i) => i.why)).toEqual(["into first hunk"]);
    expect(model.files[0].hunks[1].intents.map((i) => i.why)).toEqual(["into second hunk"]);
  });

  it("surfaces intents that match no hunk instead of dropping them", () => {
    expect(model.files[0].unmatchedIntents).toEqual([
      { anchor: 999, what: "w3", why: "matches no hunk" },
    ]);
  });

  it("carries file-level what/why", () => {
    expect(model.files[0].what).toBe("file what");
    expect(model.files[0].why).toBe("file note");
  });

  it("lists artifact files that are absent from the diff", () => {
    expect(model.filesWithoutChanges).toEqual([
      { path: "src/untouched.ts", why: "not in diff" },
    ]);
  });

  it("passes through base and overall", () => {
    expect(model.base).toBe("main");
    expect(model.overall).toBe("why");
  });

  it("carries scorecard, reach, complexity, and risks onto the model", () => {
    expect(model.scorecard).toBe(emptyScorecard);
    expect(model.reach).toBe(emptyReach);
    expect(model.complexity).toBe(emptyComplexity);
    expect(model.risks).toEqual([]); // defaulted by the schema
  });

  it("passes the agent-described tests straight through (pure display, no join)", () => {
    const withTests = ArtifactSchema.parse({
      title: "T",
      tldr: "t",
      overall: "o",
      tests: [{ describes: "returns null on a miss", kind: "unit" }],
    });
    const m = buildReviewModel(withTests, diff, "main", emptyScorecard, emptyReach, emptyComplexity);
    expect(m.tests).toEqual([{ describes: "returns null on a miss", kind: "unit" }]);
  });

  it("defaults tests to an empty array when none are authored", () => {
    expect(model.tests).toEqual([]);
  });

  it("reports full intent coverage when every file and hunk is annotated", () => {
    expect(model.intentCoverage).toEqual({
      filesCovered: 1,
      filesTotal: 1,
      hunksCovered: 2,
      hunksTotal: 2,
    });
  });
});

describe("buildReviewModel intent coverage with gaps", () => {
  const partialDiff: DiffFile[] = [
    {
      path: "src/covered.ts",
      status: "modified",
      hunks: [{ header: "@@ -1 +1 @@", newStart: 1, newEnd: 2, lines: [] }],
    },
    {
      path: "src/bare.ts",
      status: "modified",
      hunks: [{ header: "@@ -1 +1 @@", newStart: 1, newEnd: 2, lines: [] }],
    },
  ];
  const partialArtifact = ArtifactSchema.parse({
    title: "T",
    tldr: "t",
    overall: "o",
    files: [
      {
        path: "src/covered.ts",
        what: "w",
        why: "y",
        hunks: [{ anchor: 1, what: "hw", why: "hy" }],
      },
      // src/bare.ts has no artifact entry at all
    ],
  });

  it("counts only files and hunks that carry intent", () => {
    const m = buildReviewModel(partialArtifact, partialDiff, "main", emptyScorecard, emptyReach, emptyComplexity);
    expect(m.intentCoverage).toEqual({
      filesCovered: 1,
      filesTotal: 2,
      hunksCovered: 1,
      hunksTotal: 2,
    });
  });
});
