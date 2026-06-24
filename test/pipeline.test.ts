import { describe, it, expect, vi, beforeEach } from "vitest";

// pipeline.ts is side-effecting (shells out via git/reach/complexity), so we
// mock the pipeline-step modules and assert buildReview wires them together,
// threads `base` + the diff scope through, and surfaces gaps from findGaps(model).

const FAKE_SCOPE = {
  includesUncommitted: true,
  uncommittedFiles: ["src/a.ts"],
  untrackedFiles: ["src/new.ts"],
};

vi.mock("../src/git.js", () => ({
  resolveBase: vi.fn(() => "main"),
  getDiff: vi.fn(() => ({ text: "RAW_DIFF_TEXT", scope: FAKE_SCOPE })),
}));
vi.mock("../src/artifact.js", () => ({
  loadArtifact: vi.fn(() => ({ artifact: true })),
  DEFAULT_ARTIFACT_PATH: ".review/intent.json",
}));
vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn(() => ({ complexityThreshold: 15 })),
}));
vi.mock("../src/diff-parser.js", () => ({
  parseDiffText: vi.fn(() => [
    { path: "src/a.ts", status: "modified" },
    { path: "src/b.txt", status: "deleted" },
  ]),
}));
vi.mock("../src/scorecard.js", () => ({
  buildScorecard: vi.fn(() => ({ scorecard: true })),
  isCodePath: vi.fn((p: string) => p.endsWith(".ts")),
}));
vi.mock("../src/reach.js", () => ({
  scanRepo: vi.fn(() => ({ files: ["src/a.ts", "src/c.ts"], truncated: false })),
  buildReachGraph: vi.fn(() => ({ reach: true })),
}));
vi.mock("../src/complexity.js", () => ({
  analyzeComplexity: vi.fn(() => ({ available: false })),
}));
const FAKE_MODEL = { files: [], title: "t", base: "main" };
vi.mock("../src/match.js", () => ({
  buildReviewModel: vi.fn(() => FAKE_MODEL),
}));
const FAKE_GAPS = [{ kind: "file", path: "src/a.ts", detail: "no what/why" }];
vi.mock("../src/completeness.js", () => ({
  findGaps: vi.fn(() => FAKE_GAPS),
}));

import { buildReview, stripToolInputs } from "../src/pipeline.js";
import { resolveBase, getDiff } from "../src/git.js";
import { parseDiffText } from "../src/diff-parser.js";
import { buildReviewModel } from "../src/match.js";
import { findGaps } from "../src/completeness.js";
import { scanRepo, buildReachGraph } from "../src/reach.js";
import { analyzeComplexity } from "../src/complexity.js";

describe("buildReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolveBase as ReturnType<typeof vi.fn>).mockReturnValue("main");
    (getDiff as ReturnType<typeof vi.fn>).mockReturnValue({
      text: "RAW_DIFF_TEXT",
      scope: FAKE_SCOPE,
    });
    (buildReviewModel as ReturnType<typeof vi.fn>).mockReturnValue(FAKE_MODEL);
    (findGaps as ReturnType<typeof vi.fn>).mockReturnValue(FAKE_GAPS);
    (scanRepo as ReturnType<typeof vi.fn>).mockReturnValue({
      files: ["src/a.ts", "src/c.ts"],
      truncated: false,
    });
    (buildReachGraph as ReturnType<typeof vi.fn>).mockReturnValue({ reach: true });
    (analyzeComplexity as ReturnType<typeof vi.fn>).mockReturnValue({ available: false });
  });

  it("resolves the base and feeds getDiff the resolved base", () => {
    buildReview({ cwd: "/repo", base: "develop" });
    // resolveBase receives the cwd and the explicit base override.
    expect(resolveBase).toHaveBeenCalledWith("/repo", "develop");
    // getDiff is called with the resolved base.
    expect(getDiff).toHaveBeenCalledWith("/repo", "main");
  });

  it("returns the model from buildReviewModel and gaps from findGaps(model)", () => {
    const out = buildReview({ cwd: "/repo" });
    expect(out.model).toBe(FAKE_MODEL);
    expect(out.gaps).toBe(FAKE_GAPS);
    expect(findGaps).toHaveBeenCalledWith(FAKE_MODEL);
  });

  it("threads base and the diff scope positionally into buildReviewModel", () => {
    buildReview({ cwd: "/repo" });
    const call = (buildReviewModel as ReturnType<typeof vi.fn>).mock.calls[0];
    // signature: (artifact, diff, base, scorecard, reach, complexity, diffScope)
    expect(call[2]).toBe("main");
    // Scope is threaded through stripToolInputs; with no .review inputs present it
    // is content-equal to the original (a new object, so toEqual not toBe).
    expect(call[6]).toEqual(FAKE_SCOPE);
  });

  it("strips review-intent's own inputs (.review/) from the diff and scope", () => {
    (parseDiffText as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { path: "src/a.ts", status: "modified" },
      { path: ".review/intent.json", status: "added" },
    ]);
    (getDiff as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      text: "RAW_DIFF_TEXT",
      scope: { includesUncommitted: true, uncommittedFiles: [], untrackedFiles: [".review/intent.json"] },
    });
    buildReview({ cwd: "/repo" });
    const call = (buildReviewModel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].map((f: { path: string }) => f.path)).toEqual(["src/a.ts"]);
    expect(call[6].untrackedFiles).toEqual([]);
    expect(call[6].includesUncommitted).toBe(false);
  });

  it("derives changedCodePaths (non-deleted code files) for reach + complexity", () => {
    buildReview({ cwd: "/repo" });
    // src/a.ts is .ts and modified; src/b.txt is deleted -> dropped.
    expect(buildReachGraph).toHaveBeenCalledWith(
      ["src/a.ts", "src/c.ts"],
      ["src/a.ts"],
      { scanTruncated: false },
    );
    expect(analyzeComplexity).toHaveBeenCalledWith("/repo", ["src/a.ts"], 15);
  });
});

describe("stripToolInputs", () => {
  const diff = [
    { path: "src/a.ts", status: "modified" },
    { path: ".review/intent.json", status: "added" },
    { path: ".review/config.json", status: "modified" },
  ] as never;
  const scope = {
    includesUncommitted: true,
    uncommittedFiles: ["src/a.ts", ".review/config.json"],
    untrackedFiles: [".review/intent.json"],
  };

  it("drops the artifact, config, and anything under .review/ from the diff", () => {
    const out = stripToolInputs(diff, scope, ".review/intent.json");
    expect(out.diff.map((f) => f.path)).toEqual(["src/a.ts"]);
  });

  it("drops review inputs from the scope counts, keeping real changes", () => {
    const out = stripToolInputs(diff, scope, ".review/intent.json");
    expect(out.scope.uncommittedFiles).toEqual(["src/a.ts"]);
    expect(out.scope.untrackedFiles).toEqual([]);
    expect(out.scope.includesUncommitted).toBe(true); // src/a.ts still dirty
  });

  it("clears includesUncommitted when only the artifact was dirty", () => {
    const out = stripToolInputs(
      [{ path: ".review/intent.json", status: "added" }] as never,
      { includesUncommitted: true, uncommittedFiles: [], untrackedFiles: [".review/intent.json"] },
      ".review/intent.json",
    );
    expect(out.diff).toEqual([]);
    expect(out.scope.includesUncommitted).toBe(false);
  });

  it("matches a custom --artifact path outside .review/", () => {
    const out = stripToolInputs(
      [{ path: "docs/intent.json", status: "added" }, { path: "src/a.ts", status: "modified" }] as never,
      { includesUncommitted: true, uncommittedFiles: [], untrackedFiles: ["docs/intent.json"] },
      "docs/intent.json",
    );
    expect(out.diff.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(out.scope.untrackedFiles).toEqual([]);
  });

  it("normalizes backslash paths (windows)", () => {
    const out = stripToolInputs(
      [{ path: ".review\\intent.json", status: "added" }] as never,
      { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] },
      ".review/intent.json",
    );
    expect(out.diff).toEqual([]);
  });
});
