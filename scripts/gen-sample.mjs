// Dev-only: render a representative ReviewModel to sample-output.html so the
// visual summary can be eyeballed without a live git repo. Not part of the build.
import { writeFileSync } from "node:fs";
import { renderHtml } from "../dist/render.js";

const hunk = (newStart, adds, dels, intents = []) => ({
  header: `@@ -${newStart},${dels} +${newStart},${adds} @@`,
  newStart,
  newEnd: newStart + adds,
  intents,
  lines: [
    ...Array.from({ length: dels }, (_, i) => ({ type: "del", content: `old ${i}`, oldNumber: newStart + i })),
    ...Array.from({ length: adds }, (_, i) => ({ type: "add", content: `new ${i}`, newNumber: newStart + i })),
  ],
});

const file = (path, status, adds, dels, why) => ({
  path,
  status,
  what: why ? "changed things" : undefined,
  why,
  unmatchedIntents: [],
  hunks: [hunk(1, adds, dels, why ? [{ anchor: 1, what: "w", why: "y" }] : [])],
});

const model = {
  title: "Add intent-coverage gate and blast-radius visuals",
  tldr: "Adds 10 measured metrics and 5 SVG visualizations to the review page.",
  overall: "This change set extends the **scorecard** and adds a visual summary. Rejected a charting dependency in favour of pure inline SVG so `render.ts` stays deterministic.",
  base: "main",
  diffScope: { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] },
  diagrams: { class: "classDiagram\n  Scorecard <|-- Visuals", sequence: undefined },
  risks: [
    { assumption: "Diff line counts approximate churn well", ifFalse: "Treemap areas mislead", howYoudKnow: "Compare with git --stat" },
  ],
  tests: [
    { describes: "An empty diff renders a valid page but omits the churn-driven charts.", name: "omits churn charts on empty diff", kind: "unit" },
    { describes: "The treemap places one rectangle per changed file, sized by its ± lines.", name: "treemap labels each file", kind: "unit" },
    { describes: "A note whose anchor lands in no hunk still shows, under 'not matched'.", kind: "unit" },
    { describes: "Rendering a real branch opens the page with every section populated.", kind: "e2e" },
    { describes: "Eyeball sample-output.html in a browser to confirm the visuals read well.", kind: "manual" },
  ],
  scorecard: {
    filesChanged: 7,
    byStatus: { modified: 4, added: 2, deleted: 1 },
    hunks: 14,
    added: 320,
    removed: 96,
    testFiles: 1,
    codeFiles: 5,
    testLines: 40,
    codeLines: 360,
    debtMarkers: 3,
    noiseFiles: 1,
    largestFile: { path: "src/render.ts", churn: 240 },
    badges: [
      { label: "large change set", tone: "warn" },
      { label: "touches dependencies", tone: "danger" },
    ],
  },
  complexity: {
    available: true,
    threshold: 15,
    functionsAnalyzed: 22,
    maxCcn: 21,
    worst: { file: "src/scorecard.ts", name: "buildScorecard", ccn: 21, nloc: 79, params: 2, line: 31 },
    hotspots: [
      { file: "src/scorecard.ts", name: "buildScorecard", ccn: 21, nloc: 79, params: 2, line: 31 },
      { file: "src/render.ts", name: "renderScorecard", ccn: 18, nloc: 60, params: 1, line: 60 },
    ],
  },
  intentCoverage: { filesCovered: 5, filesTotal: 7, hunksCovered: 10, hunksTotal: 14 },
  reach: {
    changed: ["src/render.ts", "src/scorecard.ts"],
    edges: [
      { from: "src/cli.ts", to: "src/render.ts" },
      { from: "src/cli.ts", to: "src/scorecard.ts" },
      { from: "src/match.ts", to: "src/scorecard.ts" },
      { from: "test/render.test.ts", to: "src/render.ts" },
      { from: "test/scorecard.test.ts", to: "src/scorecard.ts" },
    ],
  },
  files: [
    file("src/render.ts", "modified", 200, 40, "Add the visual-summary section and ripple."),
    file("src/scorecard.ts", "modified", 40, 6, "Compute the new diff-only metrics."),
    file("src/types.ts", "modified", 30, 4, "Extend ScorecardModel and ReviewModel."),
    file("src/match.ts", "modified", 18, 2, "Compute intent coverage in the join."),
    file("test/render.test.ts", "modified", 40, 0, "Cover the five charts."),
    file("package-lock.json", "modified", 0, 44, undefined),
    file("src/legacy.ts", "deleted", 0, 0, "Removed dead module."),
  ],
  filesWithoutChanges: [],
};

writeFileSync(new URL("../sample-output.html", import.meta.url), renderHtml(model), "utf8");
console.log("wrote sample-output.html");
