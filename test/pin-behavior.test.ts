import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { renderHtml } from "../src/render.js";
import { buildReviewModel } from "../src/match.js";
import { ArtifactSchema } from "../src/types.js";
import type {
  DiffFile,
  ScorecardModel,
  ReachModel,
  ComplexityModel,
  DiffScope,
} from "../src/types.js";

// The pin-to-rail enhancement is an inline <script> in the rendered page, so it
// is exercised here by actually running it in jsdom — vitest's pure-module tests
// never execute it, which is how the "can't re-pin after unpinning everything"
// regression reached a browser. This locks the toggle behavior.

const scorecard: ScorecardModel = {
  filesChanged: 1,
  byStatus: { modified: 1 },
  hunks: 1,
  added: 5,
  removed: 0,
  testFiles: 0,
  codeFiles: 1,
  testLines: 0,
  codeLines: 5,
  debtMarkers: 0,
  noiseFiles: 0,
  largestFile: { path: "src/a.ts", churn: 5 },
  badges: [],
};
const reach: ReachModel = { changed: ["src/a.ts"], edges: [] };
const complexity: ComplexityModel = {
  available: true,
  threshold: 15,
  functionsAnalyzed: 1,
  maxCcn: 3,
  worst: null,
  hotspots: [],
};
const cleanScope: DiffScope = { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] };
const diff: DiffFile[] = [
  {
    path: "src/a.ts",
    status: "modified",
    hunks: [{ header: "@@ -1,1 +1,2 @@", newStart: 1, newEnd: 2, lines: [] }],
  },
];
const artifact = ArtifactSchema.parse({
  title: "T",
  tldr: "tldr",
  overall: "why",
  files: [{ path: "src/a.ts", what: "w", why: "y" }],
});
const html = renderHtml(
  buildReviewModel(artifact, diff, "main", scorecard, reach, complexity, cleanScope),
);

// Build a fresh page each time; force the wide media query so the rail engages.
function load() {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://example.com/", // gives jsdom a working localStorage
    beforeParse(win) {
      (win as unknown as { matchMedia: (q: string) => unknown }).matchMedia = (q: string) => ({
        matches: /min-width:\s*1500px/.test(q),
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
    },
  });
  const doc = dom.window.document;
  const rail = () =>
    [...doc.getElementById("rail")!.children].map((e) => e.getAttribute("data-movable"));
  const click = (k: string) => {
    const btn = doc.querySelector(`.movable[data-movable="${k}"] .pin-btn`)!;
    btn.dispatchEvent(new dom.window.Event("click", { bubbles: true, cancelable: true }));
  };
  return { doc, rail, click };
}

describe("pin-to-rail behavior (wide screen)", () => {
  it("auto-docks the overview into the rail by default", () => {
    const { rail, doc } = load();
    expect(rail().length).toBeGreaterThan(0);
    expect(doc.body.classList.contains("has-pins")).toBe(true);
  });

  it("re-pins after everything has been unpinned (the regression)", () => {
    const { rail, click, doc } = load();
    const initial = rail();
    expect(initial.length).toBeGreaterThan(0);

    initial.forEach((k) => click(k!)); // unpin everything
    expect(rail()).toEqual([]);
    expect(doc.body.classList.contains("has-pins")).toBe(false);

    click("vitals"); // pinning must still work
    expect(rail()).toContain("vitals");
    expect(doc.body.classList.contains("has-pins")).toBe(true);
  });
});
