import { describe, it, expect } from "vitest";
import {
  parseCsvLine,
  parseLizardCsv,
  buildComplexityModel,
  unavailableComplexity,
  isAnalyzablePath,
} from "../src/complexity.js";

// Real rows captured from `lizard --csv` (no header; commas appear inside the
// quoted location and long-name fields, so a naive split would be wrong).
const ROW_SIMPLE = `4,1,18,1,5,"isTestPath@18-22@src/scorecard.ts","src/scorecard.ts","isTestPath","isTestPath ( path )",18,22`;
const ROW_COMMAS = `79,21,473,2,89,"buildScorecard@31-119@src/scorecard.ts","src/scorecard.ts","buildScorecard","buildScorecard ( diff DiffFile , config RepoConfig , )",31,119`;

describe("isAnalyzablePath", () => {
  it("accepts the stack's languages and rejects the rest", () => {
    for (const p of ["a.cs", "a.ts", "a.tsx", "a.js", "a.py"]) {
      expect(isAnalyzablePath(p)).toBe(true);
    }
    for (const p of ["main.bicep", "appsettings.json", "README.md"]) {
      expect(isAnalyzablePath(p)).toBe(false);
    }
  });
});

describe("parseCsvLine", () => {
  it("keeps commas that live inside quoted fields", () => {
    const f = parseCsvLine(ROW_COMMAS);
    expect(f).toHaveLength(11);
    expect(f[1]).toBe("21"); // CCN
    expect(f[7]).toBe("buildScorecard"); // function name
    expect(f[8]).toBe("buildScorecard ( diff DiffFile , config RepoConfig , )"); // long name
  });
});

describe("parseLizardCsv", () => {
  it("maps each row to a per-function record", () => {
    const fns = parseLizardCsv(`${ROW_SIMPLE}\n${ROW_COMMAS}\n`);
    expect(fns).toEqual([
      { file: "src/scorecard.ts", name: "isTestPath", ccn: 1, nloc: 4, params: 1, line: 18 },
      { file: "src/scorecard.ts", name: "buildScorecard", ccn: 21, nloc: 79, params: 2, line: 31 },
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseLizardCsv("\n\n")).toEqual([]);
  });
});

describe("buildComplexityModel", () => {
  const fns = parseLizardCsv(`${ROW_SIMPLE}\n${ROW_COMMAS}\n`);

  it("aggregates max CCN, worst function and threshold hotspots", () => {
    const m = buildComplexityModel(fns, 15);
    expect(m.available).toBe(true);
    expect(m.functionsAnalyzed).toBe(2);
    expect(m.maxCcn).toBe(21);
    expect(m.worst?.name).toBe("buildScorecard");
    expect(m.hotspots.map((h) => h.name)).toEqual(["buildScorecard"]); // only the >=15 one
  });

  it("orders hotspots worst-first", () => {
    const many = buildComplexityModel(
      [
        { file: "a", name: "low", ccn: 16, nloc: 1, params: 0, line: 1 },
        { file: "a", name: "high", ccn: 40, nloc: 1, params: 0, line: 2 },
      ],
      15,
    );
    expect(many.hotspots.map((h) => h.name)).toEqual(["high", "low"]);
  });
});

describe("unavailableComplexity", () => {
  it("carries a visible note instead of pretending zero complexity", () => {
    const m = unavailableComplexity("lizard not installed");
    expect(m.available).toBe(false);
    expect(m.note).toBe("lizard not installed");
    expect(m.hotspots).toEqual([]);
  });
});
