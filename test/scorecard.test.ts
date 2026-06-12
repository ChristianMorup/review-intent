import { describe, it, expect } from "vitest";
import { buildScorecard, isTestPath, isCodePath, isNoisePath } from "../src/scorecard.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { DiffFile, DiffLine } from "../src/types.js";

function file(path: string, adds = 1, dels = 0, status: DiffFile["status"] = "modified"): DiffFile {
  const lines = [
    ...Array.from({ length: adds }, () => ({ type: "add" as const, content: "x" })),
    ...Array.from({ length: dels }, () => ({ type: "del" as const, content: "y" })),
  ];
  return { path, status, hunks: [{ header: "@@", newStart: 1, newEnd: adds, lines }] };
}

function fileWithLines(path: string, lines: DiffLine[], status: DiffFile["status"] = "modified"): DiffFile {
  return { path, status, hunks: [{ header: "@@", newStart: 1, newEnd: lines.length, lines }] };
}

describe("path classifiers", () => {
  it("recognises test files", () => {
    expect(isTestPath("src/foo.test.ts")).toBe(true);
    expect(isTestPath("tests/foo.ts")).toBe(true);
    expect(isTestPath("src/foo.ts")).toBe(false);
  });
  it("recognises code files", () => {
    expect(isCodePath("src/foo.ts")).toBe(true);
    expect(isCodePath("README.md")).toBe(false);
  });
  it("recognises noise (lockfiles, generated, build output, binaries)", () => {
    expect(isNoisePath("package-lock.json")).toBe(true);
    expect(isNoisePath("dist/cli.js")).toBe(true);
    expect(isNoisePath("app/bundle.min.js")).toBe(true);
    expect(isNoisePath("docs/logo.png")).toBe(true);
    expect(isNoisePath("src/foo.ts")).toBe(false);
  });
});

describe("buildScorecard line metrics", () => {
  it("splits churned lines into test vs code lines", () => {
    const s = buildScorecard(
      [file("src/a.ts", 3, 1), file("src/a.test.ts", 2, 0), file("README.md", 5, 0)],
      DEFAULT_CONFIG,
    );
    expect(s.codeLines).toBe(4); // a.ts: 3 + 1
    expect(s.testLines).toBe(2); // a.test.ts: 2
  });

  it("counts added lines that introduce debt/debug markers", () => {
    const s = buildScorecard(
      [
        fileWithLines("src/a.ts", [
          { type: "add", content: "  // TODO: clean this up" },
          { type: "add", content: "  console.log(x)" },
          { type: "add", content: "  const fine = 1" },
          { type: "del", content: "  // FIXME removed line does not count" },
        ]),
      ],
      DEFAULT_CONFIG,
    );
    expect(s.debtMarkers).toBe(2);
  });

  it("counts noise files separately from code", () => {
    const s = buildScorecard([file("src/a.ts"), file("package-lock.json", 400, 0)], DEFAULT_CONFIG);
    expect(s.noiseFiles).toBe(1);
  });

  it("reports the single most-churned file", () => {
    const s = buildScorecard([file("src/a.ts", 3, 1), file("src/big.ts", 50, 20)], DEFAULT_CONFIG);
    expect(s.largestFile).toEqual({ path: "src/big.ts", churn: 70 });
  });

  it("has a null largestFile for an empty diff", () => {
    const s = buildScorecard([], DEFAULT_CONFIG);
    expect(s.largestFile).toBeNull();
  });
});

describe("buildScorecard", () => {
  it("counts files, hunks, and added/removed lines", () => {
    const s = buildScorecard([file("src/a.ts", 3, 1), file("src/b.ts", 2, 0)], DEFAULT_CONFIG);
    expect(s.filesChanged).toBe(2);
    expect(s.hunks).toBe(2);
    expect(s.added).toBe(5);
    expect(s.removed).toBe(1);
  });

  it("flags code changes with no test files (danger)", () => {
    const s = buildScorecard([file("src/a.ts")], DEFAULT_CONFIG);
    expect(s.badges).toContainEqual({ label: "no test changes", tone: "danger" });
  });

  it("does not flag missing tests when a test file is touched", () => {
    const s = buildScorecard([file("src/a.ts"), file("src/a.test.ts")], DEFAULT_CONFIG);
    expect(s.testFiles).toBe(1);
    expect(s.badges.find((b) => b.label === "no test changes")).toBeUndefined();
  });

  it("raises a sensitive-path badge for the configured stack", () => {
    const s = buildScorecard([file("infra/main.bicep"), file("src/a.test.ts")], DEFAULT_CONFIG);
    expect(s.badges).toContainEqual({ label: "touches bicep / infra", tone: "danger" });
  });

  it("flags a large change set by line churn", () => {
    const s = buildScorecard([file("src/a.test.ts", 700, 0)], DEFAULT_CONFIG);
    expect(s.badges).toContainEqual({ label: "large change set", tone: "warn" });
  });

  it("survives a malformed sensitive-path regex without crashing", () => {
    const s = buildScorecard([file("src/a.test.ts")], {
      ...DEFAULT_CONFIG,
      sensitivePaths: [{ label: "bad", pattern: "[" }],
    });
    expect(s.filesChanged).toBe(1);
  });
});
