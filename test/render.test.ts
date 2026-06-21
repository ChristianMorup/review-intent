import { describe, it, expect } from "vitest";
import { renderHtml } from "../src/render.js";
import type { ReviewModel } from "../src/types.js";

const model: ReviewModel = {
  title: "My change",
  tldr: "Five-second headline of the change.",
  overall: "Why this exists with `code` and **bold**.",
  base: "main",
  diagrams: {
    class: "classDiagram\n  Foo <|-- Bar",
    sequence: "sequenceDiagram\n  A->>B: hi",
  },
  risks: [
    { assumption: "data is request-scoped", ifFalse: "cache leaks", howYoudKnow: "concurrency test" },
  ],
  tests: [
    { describes: "returns null on a cache miss", name: "CacheMiss_ReturnsNull", kind: "unit" },
    { describes: "a second request reuses the warmed cache", kind: "integration" },
  ],
  scorecard: {
    filesChanged: 2,
    byStatus: { modified: 1, added: 1 },
    hunks: 3,
    added: 10,
    removed: 4,
    testFiles: 0,
    codeFiles: 2,
    testLines: 0,
    codeLines: 14,
    debtMarkers: 2,
    noiseFiles: 1,
    largestFile: { path: "src/a.ts", churn: 14 },
    badges: [
      { label: "no test changes", tone: "danger" },
      { label: "touches auth", tone: "danger" },
    ],
  },
  complexity: {
    available: true,
    threshold: 15,
    functionsAnalyzed: 12,
    maxCcn: 21,
    worst: { file: "src/a.ts", name: "buildScorecard", ccn: 21, nloc: 79, params: 2, line: 31 },
    hotspots: [{ file: "src/a.ts", name: "buildScorecard", ccn: 21, nloc: 79, params: 2, line: 31 }],
  },
  intentCoverage: { filesCovered: 1, filesTotal: 2, hunksCovered: 1, hunksTotal: 3 },
  reach: {
    changed: ["src/a.ts"],
    edges: [{ from: "src/caller.ts", to: "src/a.ts" }],
    truncatedNote: "1 additional edge(s) hidden (per-node cap)",
  },
  files: [
    {
      path: "src/a.ts",
      status: "modified",
      what: "file level what",
      why: "file level note",
      unmatchedIntents: [{ anchor: 99, what: "orphan what", why: "orphan note" }],
      hunks: [
        {
          header: "@@ -1,2 +1,3 @@",
          newStart: 1,
          newEnd: 3,
          intents: [{ anchor: 1, what: "hunk what", why: "why this hunk" }],
          lines: [
            { type: "del", content: 'return "<b>old</b>";', oldNumber: 1 },
            { type: "add", content: 'return "new";', newNumber: 1 },
            { type: "normal", content: "}", oldNumber: 2, newNumber: 2 },
          ],
        },
      ],
    },
  ],
  filesWithoutChanges: [{ path: "src/z.ts", why: "context only" }],
};

describe("renderHtml", () => {
  const html = renderHtml(model);

  it("produces a full HTML document", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>My change — intent review</title>");
  });

  it("renders the tldr lede above the full summary", () => {
    expect(html).toContain('class="tldr"');
    expect(html).toContain("Five-second headline of the change.");
  });

  it("escapes diff content to prevent HTML injection", () => {
    expect(html).toContain("&lt;b&gt;old&lt;/b&gt;");
    expect(html).not.toContain('return "<b>old</b>"');
  });

  it("renders the minimal markdown subset in intent prose", () => {
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("emits mermaid blocks with escaped sources", () => {
    expect(html).toContain('<pre class="mermaid">classDiagram');
    expect(html).toContain('<pre class="mermaid">sequenceDiagram');
    // arrows must be escaped inside the pre
    expect(html).toContain("A-&gt;&gt;B: hi");
  });

  it("shows the per-hunk intent, file intent, and unmatched notes", () => {
    expect(html).toContain("why this hunk");
    expect(html).toContain("hunk what");
    expect(html).toContain("file level note");
    expect(html).toContain("orphan note");
  });

  it("emits the FOUC-restore and switcher scripts", () => {
    expect(html).toContain("review-intent:theme");            // localStorage key
    expect(html).toContain("dataset.theme");                  // applies theme on <html>
    expect(html).toContain('querySelectorAll(".theme-opt")'); // switcher wiring
  });

  it("lists files not present in the diff", () => {
    expect(html).toContain("Intent for files not in this diff");
    expect(html).toContain("src/z.ts");
  });

  it("loads mermaid and the base badge", () => {
    expect(html).toContain("mermaid.initialize");
    expect(html).toContain("main…HEAD");
  });

  it("renders the blast-radius scorecard with badges", () => {
    expect(html).toContain("Blast radius");
    expect(html).toContain("Surface area");
    expect(html).toContain("no test changes");
    expect(html).toContain("touches auth");
    expect(html).toContain('class="badge tone-danger"');
  });

  it("renders the derived surface-area metrics", () => {
    expect(html).toContain("net +6");          // added − removed
    expect(html).toContain("14 code lines");   // test/code line split
    expect(html).toContain("1 new file");      // byStatus.added
    expect(html).toContain("1.5 hunks/file");  // hunks ÷ files
  });

  it("renders the noise, debt, largest-file and fan-in metrics", () => {
    expect(html).toContain("1 noise file");
    expect(html).toContain("2 debt/debug markers");
    expect(html).toContain("±14");             // largest single-file churn
    expect(html).toContain("1 dependent");     // reach fan-in count
  });

  it("renders intent coverage and diagram coverage", () => {
    expect(html).toContain("1/2 files");
    expect(html).toContain("1/3 hunks");
    expect(html).toContain("diagrams: class, sequence");
  });

  it("renders measured complexity in the scorecard and a hotspots chart", () => {
    expect(html).toContain("max CCN 21");
    const cx = html.slice(html.indexOf('class="viz-complexity"'));
    expect(html).toContain('class="viz-complexity"');
    expect(cx).toContain("buildScorecard");
  });

  it("renders the risk ledger as a table", () => {
    expect(html).toContain("Risk ledger");
    expect(html).toContain("data is request-scoped");
    expect(html).toContain("cache leaks");
    expect(html).toContain("concurrency test");
  });

  it("renders the reach as a radial ripple carrying the importer and truncation note", () => {
    expect(html).toContain('class="viz-ripple"');
    expect(html).toContain("<svg");
    expect(html).toContain("src/caller.ts");
    expect(html).toContain("additional edge(s) hidden");
  });

  it("gives the reach ripple nodes role-explaining tooltips", () => {
    const ripple = html.slice(html.indexOf('class="viz-ripple"'));
    expect(ripple).toContain("<title>src/a.ts — changed file</title>");
    expect(ripple).toContain("<title>src/caller.ts — imports a changed file</title>");
  });

  it("describes and tooltips the diff-mass rows", () => {
    const diffmass = html.slice(html.indexOf('class="viz-diffmass"'));
    expect(diffmass).toContain("<title>src/a.ts — +1 −1 (code)</title>");
    const cap = html.slice(html.indexOf('class="viz-diffmass"'));
    expect(cap).toContain("bar length = lines added");
  });

  it("describes and tooltips the treemap cells", () => {
    const treemap = html.slice(html.indexOf('class="viz-treemap"'));
    expect(treemap).toContain("<title>src/a.ts — 2 lines changed</title>");
    expect(treemap).toContain("area ∝ lines changed");
  });

  it("describes and tooltips the coverage rings", () => {
    const rings = html.slice(html.indexOf('class="viz-rings"'));
    expect(rings).toContain("<title>1 of 2 files carry intent (50%)</title>");
    expect(rings).toContain("<title>1 of 3 hunks carry intent (33%)</title>");
    expect(html).toContain("--allow-gaps");
  });

  it("describes and tooltips the complexity hotspots", () => {
    const cx = html.slice(html.indexOf('class="viz-complexity"'));
    expect(cx).toContain("<title>buildScorecard — CCN 21 (threshold 15) at src/a.ts:31</title>");
    expect(cx).toContain("independent paths through the code");
  });

  it("renders a visual-summary section with all five charts", () => {
    expect(html).toContain('class="visuals"');
    expect(html).toContain('class="viz-diffmass"');
    expect(html).toContain('class="viz-treemap"');
    expect(html).toContain('class="viz-rings"');
    expect(html).toContain('class="viz-scatter"');
  });

  it("labels the diff-mass and treemap charts with the changed file", () => {
    // both charts are driven by per-file churn derived from the diff lines
    const diffmass = html.slice(html.indexOf('class="viz-diffmass"'));
    expect(diffmass).toContain("src/a.ts");
  });

  it("shows intent-coverage percentages in the rings", () => {
    expect(html).toContain("50%"); // 1/2 files annotated
    expect(html).toContain("33%"); // 1/3 hunks annotated
  });

  it("plots the per-file change map with measured axes and a dot per file", () => {
    const scatter = html.slice(html.indexOf('class="viz-scatter"'));
    expect(scatter).toContain("downstream reach");
    expect(scatter).toContain("churn");
    // src/a.ts carries a CCN-21 hotspot (≥ threshold 15) → flagged red
    expect(scatter).toContain('class="viz-dot viz-dot-hot"');
    expect(scatter).toContain("a.ts");
  });

  it("gives each change-map dot a native tooltip with its measured numbers", () => {
    const scatter = html.slice(html.indexOf('class="viz-scatter"'));
    expect(scatter).toContain(
      "<title>src/a.ts — 2 lines changed · 1 hunk · imported by 1 file · complexity hotspot</title>",
    );
  });

  it("renders a change-map legend keying colour, size and the review-first zone", () => {
    const legend = html.slice(html.indexOf('class="viz-legend"'));
    expect(legend).toContain("complexity hotspot (CCN ≥ 15)");
    expect(legend).toContain("more hunks");
    expect(legend).toContain("review-first zone");
  });

  it("renders a claimed Tests section grouped by kind with descriptions and names", () => {
    expect(html).toContain('class="tests"');
    expect(html).toContain("2 cases described");
    const tests = html.slice(html.indexOf('class="tests"'));
    expect(tests).toContain("returns null on a cache miss");
    expect(tests).toContain("a second request reuses the warmed cache");
    // the optional real test name is shown for cross-reference
    expect(tests).toContain("CacheMiss_ReturnsNull");
    // known kinds become group headers
    expect(tests).toContain(">unit<");
    expect(tests).toContain(">integration<");
  });

  it("renders a 'review first' callout naming the top-ranked file and its reasons", () => {
    expect(html).toContain('class="review-first"');
    const rf = html.slice(html.indexOf('class="review-first"'));
    expect(rf).toContain("Review first");
    expect(rf).toContain('href="#file-0"');
    expect(rf).toContain("a.ts");
    expect(rf).toContain("CCN 21"); // the hotspot reason
  });

  it("renders a clickable, review-ordered file index", () => {
    expect(html).toContain('class="file-index"');
    const idx = html.slice(html.indexOf('class="file-index"'));
    expect(idx).toContain('href="#file-0"'); // links into the file's detail section
    expect(idx).toContain("src/a.ts");
    expect(idx).toContain("1 changed");      // count line
  });

  it("renders each file as a collapsible section with a stable anchor id", () => {
    expect(html).toContain('<details class="file" id="file-0" open>');
    expect(html).toContain('<summary class="file-head">');
  });

  it("shows per-file signal badges and a review rank in the file head", () => {
    const head = html.slice(html.indexOf('id="file-0"'));
    expect(head).toContain('class="file-rank"');   // #1, #2, ...
    expect(head).toContain('class="fbadge fbadge-churn"');
    expect(head).toContain('class="fbadge fbadge-hot"'); // src/a.ts is a CCN-21 hotspot
    expect(head).toContain('class="viewed-cb"');         // "seen" checkbox
  });

  it("wraps the heavy analytics in collapsible bands (blast open, visuals closed)", () => {
    expect(html).toContain('<details class="band" open>');
    expect(html).toContain('<details class="band">');
    expect(html).toContain('class="visuals"');
    expect(html).toContain('class="tests"');
  });

  it("renders a sticky top bar with a reviewed-progress counter and back-to-top", () => {
    expect(html).toContain('class="topbar"');
    expect(html).toContain('class="tb-progress"');
    expect(html).toContain('href="#top"');
    expect(html).toContain('id="top"');
  });

  it("ships the viewed-state / progress / active-nav script", () => {
    expect(html).toContain("viewed-cb");          // referenced by the script
    expect(html).toContain("localStorage");        // persistence
    expect(html).toContain("tb-progress");         // counter target
    expect(html).toContain("IntersectionObserver"); // index active-highlight
  });

  it("emits a hunk comment box with a stable id and precise line ref", () => {
    expect(html).toContain('data-ckind="hunk"');
    expect(html).toContain('data-cid="file-0-hunk-0"');
    expect(html).toContain('data-ref="src/a.ts:1-3"');
  });

  it("emits a file-level comment box keyed on the file slug", () => {
    expect(html).toContain('data-ckind="file"');
    expect(html).toContain('<textarea class="cinput" data-cid="file-0" data-ref="src/a.ts"');
  });

  it("emits a hunk question box with a q-prefixed id and precise line ref", () => {
    expect(html).toContain('data-akind="question"');
    expect(html).toContain('data-cid="q:file-0-hunk-0"');
    expect(html).toContain('<button class="cbtn cbtn-q"');
  });

  it("emits a file-level question box keyed on the q-prefixed file slug", () => {
    expect(html).toContain('<textarea class="cinput" data-cid="q:file-0" data-ref="src/a.ts"');
  });

  it("tags every comment textarea with data-akind=comment", () => {
    expect(html).toContain('data-cid="file-0-hunk-0" data-ref="src/a.ts:1-3"');
    expect(html).toMatch(/data-cid="file-0"[^>]*data-akind="comment"/);
  });

  it("renders the feedback panel with page comment, output, and copy button", () => {
    expect(html).toContain('class="review-feedback"');
    expect(html).toContain('data-cid="__page__"');
    expect(html).toContain('class="fb-output"');
    expect(html).toContain('class="fb-copy"');
  });

  it("renders a page-level overall question box", () => {
    expect(html).toContain('data-cid="q:__page__"');
    expect(html).toMatch(/data-cid="q:__page__"[^>]*data-akind="question"/);
  });

  it("embeds the comment script with the per-change storage key", () => {
    expect(html).toContain("review-intent:comments:My change@main");
    expect(html).toContain("Review feedback on");
  });

  it("assembles questions and comments into two labelled sections", () => {
    expect(html).toContain("# Questions (please answer)");
    expect(html).toContain("# Comments");
    expect(html).toContain('data-akind="question"');
    const qi = html.indexOf("# Questions (please answer)");
    const ci = html.indexOf("# Comments");
    expect(qi).toBeGreaterThan(-1);
    expect(ci).toBeGreaterThan(qi);
  });

  it("reads back the q-prefixed page question key from the store", () => {
    expect(html).toContain('"q:__page__"');
  });

  it("renders the guided-tour control and start button", () => {
    expect(html).toContain('id="tour"');
    expect(html).toContain('class="tb-tour"');
  });

  it("injects the tour order from the review ranking", () => {
    expect(html).toContain('[{"slug":"file-0","path":"src/a.ts"}]');
  });

  it("emits the theme switcher cogwheel and theme blocks", () => {
    expect(html).toContain('class="tb-gear"');           // cogwheel button
    expect(html).toContain('class="theme-menu"');        // popover menu
    expect(html).toContain('[data-theme="nord"]');       // a theme CSS block
    expect(html).toContain('data-theme-id="hacker"');    // a menu option
  });
});

describe("renderHtml when lizard is unavailable", () => {
  it("surfaces the reason instead of silently dropping complexity", () => {
    const html = renderHtml({
      ...model,
      complexity: {
        available: false,
        threshold: 0,
        functionsAnalyzed: 0,
        maxCcn: 0,
        worst: null,
        hotspots: [],
        note: "lizard not found — run `pip install lizard` to enable complexity metrics",
      },
    });
    expect(html).toContain("lizard not found");
    expect(html).not.toContain('class="viz-complexity"');
  });
});

describe("renderHtml visuals with an empty diff", () => {
  it("omits churn-driven charts but still renders a document", () => {
    const empty = {
      ...model,
      files: [],
      reach: { changed: [], edges: [] },
      intentCoverage: { filesCovered: 0, filesTotal: 0, hunksCovered: 0, hunksTotal: 0 },
    };
    const html = renderHtml(empty);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toContain('class="viz-diffmass"'); // no churn to chart
  });
});

describe("renderHtml with no risks declared", () => {
  it("shows the honesty nudge instead of an empty table", () => {
    const html = renderHtml({ ...model, risks: [] });
    expect(html).toContain("No risks declared");
  });
});

describe("renderHtml with no tests described", () => {
  it("omits the Tests section entirely (it is optional)", () => {
    const html = renderHtml({ ...model, tests: [] });
    expect(html).not.toContain('class="tests"');
  });
});

describe("renderHtml with intent gaps (--allow-gaps draft)", () => {
  it("renders red markers for a file with no why and a hunk with no intent", () => {
    const gappy = {
      ...model,
      files: [
        {
          path: "src/gap.ts",
          status: "modified" as const,
          what: undefined,
          why: undefined,
          unmatchedIntents: [],
          hunks: [
            {
              header: "@@ -1 +1 @@",
              newStart: 1,
              newEnd: 1,
              intents: [],
              lines: [{ type: "add" as const, content: "x", newNumber: 1 }],
            },
          ],
        },
      ],
    };
    const html = renderHtml(gappy);
    expect(html).toContain("No rationale (what/why) written");
    expect(html).toContain("No intent for this hunk");
    expect(html).toContain('class="file-intent missing"');
  });
});

describe("renderHtml storage key escaping", () => {
  it("escapes a </script> sequence in the title so the script tag is not broken", () => {
    const html = renderHtml({ ...model, title: "fix </script> now" });
    // the raw, unescaped sequence from the title must NOT appear (it would close the tag)
    expect(html).not.toContain("viewed:fix </script> now");
    // the escaped form is what gets emitted into the JS string literal
    expect(html).toContain("fix <\\/script> now");
  });
});

describe("renderHtml with duplicate file paths", () => {
  it("renders each file by index, so same-path entries do not collapse", () => {
    const dup = {
      ...model,
      reach: { changed: [], edges: [] },
      complexity: { ...model.complexity, available: false, hotspots: [], maxCcn: 0, worst: null },
      files: [
        {
          path: "src/dup.ts",
          status: "modified" as const,
          what: "first what",
          why: "first why",
          unmatchedIntents: [],
          hunks: [
            {
              header: "@@ -1 +1 @@",
              newStart: 1,
              newEnd: 1,
              intents: [{ anchor: 1, what: "alpha what", why: "alpha why" }],
              lines: [{ type: "add" as const, content: "ALPHA_LINE", newNumber: 1 }],
            },
          ],
        },
        {
          path: "src/dup.ts",
          status: "modified" as const,
          what: "second what",
          why: "second why",
          unmatchedIntents: [],
          hunks: [
            {
              header: "@@ -2 +2 @@",
              newStart: 2,
              newEnd: 2,
              intents: [{ anchor: 2, what: "beta what", why: "beta why" }],
              lines: [{ type: "add" as const, content: "BETA_LINE", newNumber: 2 }],
            },
          ],
        },
      ],
    };
    const html = renderHtml(dup);
    // Both files get their own anchor section…
    expect(html).toContain('id="file-0"');
    expect(html).toContain('id="file-1"');
    // …and their distinct content is preserved (neither is collapsed onto the other).
    expect(html).toContain("ALPHA_LINE");
    expect(html).toContain("BETA_LINE");
    expect(html).toContain("alpha why");
    expect(html).toContain("beta why");
  });
});

describe("renderHtml pin-to-rail layout", () => {
  const html = renderHtml(model);

  it("wraps the content in a layout shell with a rail and content column", () => {
    expect(html).toContain('class="layout"');
    expect(html).toContain('<aside class="rail" id="rail"');
    expect(html).toContain('class="content"');
  });

  it("wraps each movable block with a pin control and a stable key", () => {
    expect(html).toContain('class="movable" data-movable="vitals"');
    expect(html).toContain('class="movable" data-movable="file-index"');
    expect(html).toContain('class="movable" data-movable="blast"');
    expect(html).toContain('class="pin-btn"');
  });

  it("does not wrap an empty (omitted) block — no orphan pin button", () => {
    // No tests described → the Tests block renders empty and must not become a
    // bare movable wrapper with a dangling pin button.
    const noTests = renderHtml({ ...model, tests: [] });
    expect(noTests).not.toContain('data-movable="tests"');
  });

  it("ships the pin relocation/persistence script", () => {
    expect(html).toContain("matchMedia");          // wide-screen gate
    expect(html).toContain("has-pins");             // shell toggle
    expect(html).toContain("review-intent:pinned"); // per-change persistence key
  });
});
