import { describe, it, expect } from "vitest";
import { renderHtml, sizeTier, SIZE_TIERS } from "../src/render.js";
import type { ReviewModel } from "../src/types.js";

const tierQuips = (name: string) => SIZE_TIERS.find((t) => t.name === name)!.quips;
const hasQuip = (html: string, quips: string[]) => quips.some((q) => html.includes(q));

const model: ReviewModel = {
  title: "My change",
  tldr: "Five-second headline of the change.",
  overall: "Why this exists with `code` and **bold**.",
  base: "main",
  diffScope: { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] },
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

  it("renders the trimmed signals scorecard with measured badges", () => {
    expect(html).toContain("Signals");
    expect(html).toContain("no test changes");
    expect(html).toContain("touches auth");
    expect(html).toContain('class="badge tone-danger"');
    // The top-line counts moved to vitals; the scorecard no longer repeats them.
    expect(html).not.toContain("Surface area");
    expect(html).not.toContain("Blast radius");
  });

  it("keeps only the signals nothing else surfaces in the scorecard", () => {
    expect(html).toContain("14 code lines");   // test/code line split stays
    // counts vitals now owns are gone from the scorecard
    expect(html).not.toContain("1 new file");
    expect(html).not.toContain("hunks/file");
  });

  it("renders the noise, debt and largest-file signals", () => {
    expect(html).toContain("1 noise file");
    expect(html).toContain("2 debt/debug markers");
    expect(html).toContain("±14");             // largest single-file churn
  });

  it("renders intent coverage in the rings (not a scorecard line)", () => {
    expect(html).toContain("files 1/2");
    expect(html).toContain("hunks 1/3");
    // the diagram-coverage scorecard line is gone
    expect(html).not.toContain("diagrams: class, sequence");
  });

  it("surfaces max complexity in vitals and still renders a hotspots chart", () => {
    expect(html).toContain("max complexity");
    expect(html).toContain('class="viz-complexity"');
    const cx = html.slice(html.indexOf('class="viz-complexity"'));
    expect(cx).toContain("buildScorecard");
    // the scorecard no longer repeats the CCN that vitals shows
    expect(html).not.toContain("max CCN 21");
  });

  it("renders the risk ledger as a table", () => {
    expect(html).toContain("Risk ledger");
    expect(html).toContain("data is request-scoped");
    expect(html).toContain("cache leaks");
    expect(html).toContain("concurrency test");
  });

  it("renders the diff-mass, treemap and reach-ripple charts", () => {
    expect(html).toContain('class="viz-diffmass"');
    expect(html).toContain('class="viz-treemap"');
    expect(html).toContain('class="viz-ripple"');
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

  it("renders the deeper-analysis charts (diff-mass, treemap, reach, change map, rings, complexity)", () => {
    expect(html).toContain('class="deeper"');
    expect(html).toContain('class="viz-diffmass"');
    expect(html).toContain('class="viz-treemap"');
    expect(html).toContain('class="viz-ripple"');
    expect(html).toContain('class="viz-scatter"');
    expect(html).toContain('class="viz-rings"');
    expect(html).toContain('class="viz-complexity"');
  });

  it("diff-mass and treemap describe their measured churn", () => {
    expect(html).toContain("Diff mass");
    expect(html).toContain("± lines per file");
    expect(html).toContain("Change treemap");
    expect(html).toContain("area = churn");
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

  it("renders a claimed Tests card grouped by kind with descriptions and names", () => {
    expect(html).toContain('class="card tests"');
    expect(html).toContain("2 cases described");
    const tests = html.slice(html.indexOf('class="card tests"'));
    expect(tests).toContain("returns null on a cache miss");
    expect(tests).toContain("a second request reuses the warmed cache");
    // the optional real test name is shown for cross-reference
    expect(tests).toContain("CacheMiss_ReturnsNull");
    // known kinds become group headers
    expect(tests).toContain(">unit<");
    expect(tests).toContain(">integration<");
  });

  it("renders the merged file spine with one row per file, anchored and ranked", () => {
    expect(html).toContain('class="spine"');
    const spine = html.slice(html.indexOf('class="spine"'), html.indexOf("</aside>"));
    const rows = spine.match(/class="spine-row"/g) ?? [];
    expect(rows.length).toBe(1);                 // one row per changed file
    expect(spine).toContain('href="#file-0"');   // links into the file's detail section
    expect(spine).toContain("src/a.ts");
    expect(spine).toContain('class="spine-spark"'); // inline diff-mass sparkline
    expect(spine).toContain(">CCN<");            // hotspot chip (src/a.ts is CCN 21)
    expect(html).toContain("1 changed");         // rail count
  });

  it("shows the top-line counts once (deduped into vitals)", () => {
    // The net delta was repeated in vitals + scorecard before; now vitals only.
    expect(html.split("net +6").length - 1).toBe(1);
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

  it("demotes the heavier analytics into one open 'Deeper analysis' disclosure", () => {
    expect(html).toContain('<details class="deeper" open>');
    expect(html).toContain("Deeper analysis");
    expect(html).toContain('class="architecture"'); // diagrams live inside
    expect(html).toContain('class="card tests"');    // tests live inside
    // the old per-section collapsible bands are gone
    expect(html).not.toContain('class="band"');
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

  it("the assembly script selects the page question key q:__page__", () => {
    // assert the collect() ternary that picks the page-level key per kind,
    // so this proves the script reads q:__page__ (not just the textarea markup)
    expect(html).toContain('"q:__page__" : "__page__"');
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

  it("styles the question control distinctly and marks unsent questions", () => {
    expect(html).toContain(".cbtn-q");
    expect(html).toContain(".cbox.has-question");
  });
});

describe("live Q&A (submit mode)", () => {
  it("wires EventSource and /ask only when submit is on", () => {
    const withSubmit = renderHtml(model, { submit: true });
    expect(withSubmit).toContain('new EventSource("/events")');
    expect(withSubmit).toContain('"/ask"');
    expect(withSubmit).toContain("q-ask");
    expect(withSubmit).toContain("q-resolved");
    // The ask-the-agent button is labelled "Submit" and only shows once the
    // question box is expanded (revealed on .cbox.open, like the textarea).
    expect(withSubmit).toContain('ask.textContent = "Submit"');
    expect(withSubmit).not.toContain("Ask the agent now");
    expect(withSubmit).toContain(".cbox.open .q-ask");

    const plain = renderHtml(model);
    expect(plain).not.toContain('new EventSource("/events")');
    expect(plain).not.toContain('"/ask"');
    expect(plain).not.toContain('"q-ask"');
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

describe("renderHtml diff scope", () => {
  it("omits the banner when the tree is clean", () => {
    const html = renderHtml(model);
    expect(html).not.toContain('class="diff-scope-banner"');
  });

  it("renders the banner with counts and per-file badges when dirty", () => {
    const dirty: ReviewModel = {
      ...model,
      diffScope: { includesUncommitted: true, uncommittedFiles: ["src/a.ts"], untrackedFiles: ["src/b.ts"] },
      files: [
        { path: "src/a.ts", status: "modified", uncommitted: true, what: "w", why: "y", unmatchedIntents: [], hunks: [] },
        { path: "src/b.ts", status: "added", untracked: true, what: "w", why: "y", unmatchedIntents: [], hunks: [] },
      ],
    };
    const html = renderHtml(dirty);
    expect(html).toContain("diff-scope-banner");
    expect(html).toContain("1 file with uncommitted changes");
    expect(html).toContain("1 untracked file");
    expect(html).toContain(">uncommitted<");
    expect(html).toContain(">untracked<");
  });
});

describe("renderHtml two-pane shell", () => {
  const html = renderHtml(model);

  it("wraps the page in a shell with a permanent file rail and main column", () => {
    expect(html).toContain('class="shell"');
    expect(html).toContain('<aside class="rail"');
    expect(html).toContain('class="main-col"');
  });

  it("retires the opt-in pin system entirely", () => {
    expect(html).not.toContain("review-intent:pinned");
    expect(html).not.toContain('class="movable"');
    expect(html).not.toContain('class="pin-btn"');
    expect(html).not.toContain("has-pins");
    expect(html).not.toContain("📌");
  });

  it("renders a verdict line derived from measured signals", () => {
    expect(html).toContain('class="verdict');
    // src/a.ts is a CCN-21 hotspot (≥ threshold 15) → warn-tone verdict points there
    expect(html).toContain('class="verdict verdict-warn"');
    expect(html).toContain("complexity hotspot");
  });

  it("shows a green verdict when nothing flags as high-risk", () => {
    const calm = renderHtml({
      ...model,
      complexity: { ...model.complexity, available: false, hotspots: [], maxCcn: 0, worst: null },
      scorecard: { ...model.scorecard, testFiles: 1 },
    });
    expect(calm).toContain('class="verdict verdict-ok"');
    expect(calm).toContain("Nothing flags as high-risk");
    // churn here is 10 + 4 = 14 → small tier; a small-bucket quip is shown
    expect(hasQuip(calm, tierQuips("small"))).toBe(true);
  });

  it("flags a huge change set by measured churn even when nothing else does", () => {
    const huge = renderHtml({
      ...model,
      complexity: { ...model.complexity, available: false, hotspots: [], maxCcn: 0, worst: null },
      scorecard: { ...model.scorecard, added: 16805, removed: 4304, filesChanged: 243, testFiles: 1 },
    });
    expect(huge).toContain('class="verdict verdict-warn"');
    expect(huge).toContain("21109 changed lines across 243 files");
    // a quip from the huge bucket, and none from the small one
    expect(hasQuip(huge, tierQuips("huge"))).toBe(true);
    expect(hasQuip(huge, tierQuips("small"))).toBe(false);
  });

  it("labels a large-but-not-flagged change set without warning", () => {
    const large = renderHtml({
      ...model,
      complexity: { ...model.complexity, available: false, hotspots: [], maxCcn: 0, worst: null },
      scorecard: { ...model.scorecard, added: 600, removed: 200, testFiles: 1 }, // churn 800 → large
    });
    expect(large).toContain('class="verdict verdict-ok"');
    expect(hasQuip(large, tierQuips("large"))).toBe(true);
  });

  it("picks the size word deterministically (stable across renders)", () => {
    const m = {
      ...model,
      complexity: { ...model.complexity, available: false, hotspots: [], maxCcn: 0, worst: null },
      scorecard: { ...model.scorecard, added: 16805, removed: 4304, filesChanged: 243, testFiles: 1 },
    };
    expect(renderHtml(m)).toBe(renderHtml(m));
  });

  it("stacks the change map above the risk ledger under Change summary", () => {
    expect(html).toContain('class="change-summary"');
    expect(html).toContain("Change summary");
    const cs = html.slice(html.indexOf('class="cs-grid"'), html.indexOf('class="deeper"'));
    expect(cs).toContain('class="viz-scatter"');
    expect(cs).toContain("Risk ledger");
    // Change map (measured) leads; the risk ledger (claimed) follows below it.
    expect(cs.indexOf('class="viz-scatter"')).toBeLessThan(cs.indexOf("Risk ledger"));
  });

  it("renders the rail spine in review-priority order across multiple files", () => {
    const multi = renderHtml({
      ...model,
      reach: { changed: [], edges: [] },
      complexity: { ...model.complexity, available: false, hotspots: [], maxCcn: 0, worst: null },
      files: [
        {
          path: "small.ts",
          status: "modified" as const,
          what: "w",
          why: "y",
          unmatchedIntents: [],
          hunks: [
            { header: "@@ -1 +1 @@", newStart: 1, newEnd: 1, intents: [{ anchor: 1, what: "w", why: "y" }], lines: [{ type: "add" as const, content: "a", newNumber: 1 }] },
          ],
        },
        {
          path: "big.ts",
          status: "modified" as const,
          what: "w",
          why: "y",
          unmatchedIntents: [],
          hunks: [
            {
              header: "@@ -1,20 +1,20 @@",
              newStart: 1,
              newEnd: 20,
              intents: [{ anchor: 1, what: "w", why: "y" }],
              lines: Array.from({ length: 20 }, (_, i) => ({ type: "add" as const, content: "x" + i, newNumber: i + 1 })),
            },
          ],
        },
      ],
    });
    const spine = multi.slice(multi.indexOf('class="spine"'), multi.indexOf("</aside>"));
    // big.ts has the larger churn → ranks first (its anchor appears before small.ts's)
    expect(spine.indexOf("big.ts")).toBeLessThan(spine.indexOf("small.ts"));
    expect((spine.match(/class="spine-row"/g) ?? []).length).toBe(2);
  });
});

describe("renderHtml submit flag (MCP tool mode)", () => {
  it("emits byte-identical output when submit is false (the default)", () => {
    // Locks the byte-identity guarantee beyond the substring assertions: every
    // submit-mode insertion must contribute the empty string with no stray chars.
    expect(renderHtml(model)).toBe(renderHtml(model, { submit: false }));
  });

  it("default output has none of the submit-bar markup", () => {
    const def = renderHtml(model);
    expect(def).not.toContain("fb-submit");
    expect(def).not.toContain("fb-approve");
    expect(def).not.toContain('"/submit"');
  });

  it("adds the Approve / Request-changes bar and /submit wiring when submit is true", () => {
    const sub = renderHtml(model, { submit: true });
    expect(sub).toContain('class="fb-submit"');
    expect(sub).toContain('class="fb-approve"');
    expect(sub).toContain('class="fb-request"');
    expect(sub).toContain('"/submit"');
    expect(sub).toContain("Sent — you can close this tab");
    expect(sub).toContain('send("approve")');
    expect(sub).toContain('send("request-changes")');
    // Liveness wiring so the server can detect an abandoned (closed) tab.
    expect(sub).toContain('"/heartbeat"');
    expect(sub).toContain('navigator.sendBeacon("/cancel")');
  });

  it("suppresses the submit bar on an empty diff even when submit is true", () => {
    const empty = {
      ...model,
      files: [],
      reach: { changed: [], edges: [] },
      intentCoverage: { filesCovered: 0, filesTotal: 0, hunksCovered: 0, hunksTotal: 0 },
    };
    const html = renderHtml(empty, { submit: true });
    // The feedback panel early-returns on an empty diff, so the actual submit
    // bar and its buttons are absent (the submit-only stylesheet, harmless, may
    // still reference the .fb-submit class).
    expect(html).not.toContain('class="fb-submit"');
    expect(html).not.toContain('class="fb-approve"');
    expect(html).not.toContain('class="fb-request"');
  });
});

describe("agent review-order override", () => {
  it("uses measured order with no override chrome by default", () => {
    const out = renderHtml(model);
    expect(out).toContain("in review order");
    expect(out).not.toContain('class="file-rank-measured"');
    expect(out).not.toContain('class="order-note"');
  });

  it("leads with the author's order and shows each moved file's measured rank", () => {
    const twoFiles: ReviewModel = {
      ...model,
      files: [
        model.files[0],
        {
          path: "src/zzz.ts",
          status: "added",
          what: "w",
          why: "y",
          unmatchedIntents: [],
          hunks: [
            {
              header: "@@ -0,0 +1,30 @@",
              newStart: 1,
              newEnd: 30,
              intents: [{ anchor: 1, what: "a", why: "b" }],
              lines: Array.from({ length: 30 }, (_, i) => ({
                type: "add" as const,
                content: "x",
                newNumber: i + 1,
              })),
            },
          ],
        },
      ],
      // Measurement ranks src/a.ts first (complexity hotspot + reach beat raw
      // churn); the override forces src/zzz.ts to lead, so both files move and
      // carry a "measured #" badge.
      reviewOrderOverride: ["src/zzz.ts", "src/a.ts"],
    };
    const out = renderHtml(twoFiles);
    expect(out).toContain("in author-set order");
    expect(out).toContain('class="file-rank-measured"');
    expect(out).toContain("measured #");
  });

  it("surfaces override paths that aren't in the diff", () => {
    const out = renderHtml({ ...model, reviewOrderOverride: ["ghost/missing.ts"] });
    expect(out).toContain('class="order-note"');
    expect(out).toContain("ghost/missing.ts");
  });
});

describe("sizeTier", () => {
  it("buckets churn by the hard thresholds", () => {
    expect(sizeTier(0).name).toBe("small");
    expect(sizeTier(199).name).toBe("small");
    expect(sizeTier(200).name).toBe("medium");
    expect(sizeTier(499).name).toBe("medium");
    expect(sizeTier(500).name).toBe("large");
    expect(sizeTier(999).name).toBe("large");
    expect(sizeTier(1000).name).toBe("very large");
    expect(sizeTier(4999).name).toBe("very large");
    expect(sizeTier(5000).name).toBe("huge");
    expect(sizeTier(21109).name).toBe("huge");
  });

  it("flags only very large and huge tiers", () => {
    expect(sizeTier(100).flag).toBe(false);
    expect(sizeTier(800).flag).toBe(false);
    expect(sizeTier(1500).flag).toBe(true);
    expect(sizeTier(9000).flag).toBe(true);
  });

  it("gives every tier a bucket of quips", () => {
    for (const t of SIZE_TIERS) expect(t.quips.length).toBeGreaterThanOrEqual(5);
  });
});
