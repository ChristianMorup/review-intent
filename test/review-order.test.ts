import { describe, it, expect } from "vitest";
import { reviewOrder, collectSignals, fileSlug, unmatchedOrderPaths } from "../src/review-order.js";
import type { ReviewModel } from "../src/types.js";

// Minimal model factory: two code files + one lockfile, varying churn/reach/intent.
function makeModel(): ReviewModel {
  return {
    title: "t",
    tldr: "t",
    overall: "t",
    base: "main",
    diagrams: {},
    risks: [],
    tests: [],
    scorecard: {
      filesChanged: 3, byStatus: {}, hunks: 0, added: 0, removed: 0,
      testFiles: 0, codeFiles: 2, testLines: 0, codeLines: 0,
      debtMarkers: 0, noiseFiles: 1, largestFile: null, badges: [],
    },
    reach: {
      changed: ["src/big.ts", "src/hot.ts"],
      // src/hot.ts is imported by two files; src/big.ts by none.
      edges: [
        { from: "src/x.ts", to: "src/hot.ts" },
        { from: "src/y.ts", to: "src/hot.ts" },
      ],
    },
    complexity: {
      available: true, threshold: 15, functionsAnalyzed: 1, maxCcn: 20,
      worst: { file: "src/hot.ts", name: "f", ccn: 20, nloc: 1, params: 0, line: 1 },
      hotspots: [{ file: "src/hot.ts", name: "f", ccn: 20, nloc: 1, params: 0, line: 1 }],
    },
    intentCoverage: { filesCovered: 0, filesTotal: 3, hunksCovered: 0, hunksTotal: 0 },
    files: [
      {
        path: "src/big.ts", status: "modified", what: "w", why: "y",
        unmatchedIntents: [],
        hunks: [{
          header: "@@", newStart: 1, newEnd: 40, intents: [{ anchor: 1, what: "a", why: "b" }],
          lines: Array.from({ length: 40 }, (_, i) => ({ type: "add" as const, content: "x", newNumber: i + 1 })),
        }],
      },
      {
        path: "src/hot.ts", status: "modified", what: "w", why: "y",
        unmatchedIntents: [],
        hunks: [{
          header: "@@", newStart: 1, newEnd: 5, intents: [{ anchor: 1, what: "a", why: "b" }],
          lines: Array.from({ length: 5 }, (_, i) => ({ type: "add" as const, content: "x", newNumber: i + 1 })),
        }],
      },
      {
        // lockfile: huge churn but noise + no intent → must be demoted below code files.
        path: "package-lock.json", status: "modified", what: undefined, why: undefined,
        unmatchedIntents: [],
        hunks: [{
          header: "@@", newStart: 1, newEnd: 200, intents: [],
          lines: Array.from({ length: 200 }, (_, i) => ({ type: "add" as const, content: "x", newNumber: i + 1 })),
        }],
      },
    ],
    filesWithoutChanges: [],
  };
}

describe("collectSignals", () => {
  const sig = collectSignals(makeModel());

  it("computes churn, reach fan-in, hotspot and missing-intent per file", () => {
    const big = sig.find((s) => s.path === "src/big.ts")!;
    const hot = sig.find((s) => s.path === "src/hot.ts")!;
    const lock = sig.find((s) => s.path === "package-lock.json")!;

    expect(big.churn).toBe(40);
    expect(big.fanIn).toBe(0);
    expect(big.hotspot).toBe(false);
    expect(big.missingIntent).toBe(false);

    expect(hot.fanIn).toBe(2);
    expect(hot.hotspot).toBe(true);
    expect(hot.maxCcn).toBe(20);

    expect(lock.isNoise).toBe(true);
    expect(lock.missingIntent).toBe(true); // no why, hunk has no intent
  });

  it("assigns stable per-index slugs", () => {
    expect(sig[0].slug).toBe(fileSlug(0));
    expect(sig[2].slug).toBe("file-2");
  });
});

describe("reviewOrder", () => {
  const ranked = reviewOrder(makeModel());

  it("ranks the high-reach hotspot first and demotes the noise file last", () => {
    expect(ranked[0].path).toBe("src/hot.ts");
    expect(ranked[ranked.length - 1].path).toBe("package-lock.json");
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("is deterministic", () => {
    const a = reviewOrder(makeModel()).map((r) => r.path);
    const b = reviewOrder(makeModel()).map((r) => r.path);
    expect(a).toEqual(b);
  });

  it("mirrors measuredRank into rank when no override is given", () => {
    for (const r of reviewOrder(makeModel())) expect(r.measuredRank).toBe(r.rank);
  });
});

describe("reviewOrder with an agent override", () => {
  it("leads with the agent's listed files, then measured order for the rest", () => {
    const measured = reviewOrder(makeModel());
    const restMeasured = measured
      .filter((r) => r.path !== "package-lock.json")
      .map((r) => r.path);
    const ranked = reviewOrder({ ...makeModel(), reviewOrderOverride: ["package-lock.json"] });
    expect(ranked[0].path).toBe("package-lock.json");
    expect(ranked.slice(1).map((r) => r.path)).toEqual(restMeasured);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("preserves each file's measured rank so the override is auditable", () => {
    const measuredRank = new Map(reviewOrder(makeModel()).map((r) => [r.path, r.rank]));
    const ranked = reviewOrder({ ...makeModel(), reviewOrderOverride: ["package-lock.json", "src/big.ts"] });
    for (const r of ranked) expect(r.measuredRank).toBe(measuredRank.get(r.path));
    // the demoted-by-measurement lockfile now leads, but still shows measured #3
    expect(ranked[0].path).toBe("package-lock.json");
    expect(ranked[0].measuredRank).toBe(3);
    expect(ranked[0].rank).toBe(1);
  });

  it("ignores override entries that match no changed file", () => {
    const ranked = reviewOrder({ ...makeModel(), reviewOrderOverride: ["does/not/exist.ts", "src/hot.ts"] });
    expect(ranked).toHaveLength(3);
    expect(ranked[0].path).toBe("src/hot.ts");
  });
});

describe("unmatchedOrderPaths", () => {
  it("flags override paths that aren't in the diff", () => {
    expect(unmatchedOrderPaths({ ...makeModel(), reviewOrderOverride: ["nope.ts", "src/hot.ts"] })).toEqual([
      "nope.ts",
    ]);
  });

  it("is empty when there is no override", () => {
    expect(unmatchedOrderPaths(makeModel())).toEqual([]);
  });
});
