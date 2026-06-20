# Review-Page Overview→Detail UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `review.html` flow cleanly from a triaged overview into a navigable, risk-ordered detail view — by adding a clickable file spine, a "review first" callout, risk-ordered + collapsible file sections carrying their own signals, and tiered (collapsible) analytics.

**Architecture:** Add one new **pure** module `src/review-order.ts` that ranks the changed files by review priority and exposes per-file signals (churn, reach fan-in, complexity hotspot, missing-intent). The renderer (`src/render.ts`, still pure) consumes it to: render file sections in priority order with anchors, badges and a collapsible/viewed control; build a clickable file index and a "review first" callout; and wrap the heavy analytics in native `<details>` bands. A small inline vanilla-JS block adds viewed-state (localStorage), a progress counter, and index active-highlighting — consistent with the existing lightbox/mermaid scripts. No measured-vs-claimed data is overridden; ordering and signals are all *derived from the existing model* (purity boundary preserved).

**Tech Stack:** ESM TypeScript (NodeNext, `.js` import extensions), Zod for the artifact contract (unchanged here), Vitest for pure-module unit tests, hand-rolled inline SVG/CSS/JS in the rendered page (no runtime deps).

---

## Design decisions (locked for this plan; adjustable on review)

1. **Layout = single-column + sticky utility bar (not a left rail).** Preserves the existing centred editorial aesthetic and the `--maxw` measure; lowest risk. A slim sticky bar gives persistent *back-to-top* + *reviewed progress*; the file index lives inline after the overview as the spine. (A left-rail "app shell" was the alternative — more powerful, but a much larger layout rewrite and a bigger departure from the current look.)
2. **One review-priority order, used everywhere.** `reviewOrder(model)` ranks files by `sqrt(churn)+sqrt(reach)+hotspot+missing-intent`, demoting noise files, ties broken deterministically. The file index **and** the main file sections both render in this order, so "review first" in the overview matches the reading order below. Each file shows its `#rank`.
3. **Tiering via native `<details>`, nothing deleted.** Page order becomes: masthead → vitals → review-first → file index → Blast radius (open) → Visual summary / Tests / Diagrams (collapsed) → files → orphans. No charts or metrics are removed (the measured-vs-claimed contract stays intact); the exploratory ones just start collapsed so the reviewer reaches the spine and the code faster.
4. **Detail progressive disclosure = native `<details>` per file + JS "seen".** Files are `<details open>` (noise files start collapsed). A "seen" checkbox in the summary collapses+dims the file, updates the progress counter, and persists in `localStorage` keyed by title@base. Works without JS (manual expand/collapse still functions); JS only enhances the seen/progress/active-nav behaviour.
5. **File headers carry overview signals.** Each file head shows badges: `+added −removed`, reach `→ N`, `CCN <max>` (hotspot), `⚠ intent` (gap). Risk is **not** shown per file — risks are global claims, not file-scoped (consistent with the note in `renderChangeScatter`).

### Constraints to respect (from CLAUDE.md + existing tests)
- `render.ts` and `review-order.ts` MUST stay pure: no I/O, no `Date`, no random; deterministic so markup is unit-testable.
- Existing render tests assert literal substrings including `class="visuals"`, `class="tests"`, `class="blast"`-adjacent text ("Blast radius", "Surface area"), and many chart `class="viz-*"` / `<title>` strings. **Keep the outer `<section class="visuals">`, `<section class="tests">`, `<section class="diagrams">` wrappers exactly**; put the collapsible `<details>` *inside* them. All chart internals stay byte-for-byte; collapsed `<details>` still emits its body into the HTML string, so `toContain` assertions remain green.
- Imports use `.js` extensions even from `.ts`.

---

## File structure

- **Create:** `src/review-order.ts` — pure ranking + per-file signals. Responsibility: turn a `ReviewModel` into `RankedFile[]` (priority order) and stable anchor slugs. Reused by the file index, the review-first callout, and the file headers.
- **Create:** `test/review-order.test.ts` — unit tests for ranking, signal extraction, slugs, determinism.
- **Modify:** `src/render.ts` — consume `review-order`; add `renderFileIndex`, `renderReviewFirst`, `renderTopbar`, `fileBadges`, `viewedScript`; convert file sections and analytics sections to `<details>`; reorder `renderHtml`; add CSS; add the viewed/nav script.
- **Modify:** `test/render.test.ts` — add assertions for the new markup (anchors, index, review-first, badges, collapsible files, topbar, script hooks).
- **Modify:** `sample-output.html` — regenerated via `npm run sample` at the end for eyeballing.

> Note: `renderChangeScatter` already has its own `isHot` matching logic. To avoid touching a working measured chart, this plan does **not** refactor it to use `review-order`'s matcher. Reusing it there is a sensible follow-up but is out of scope.

---

### Task 1: Pure review-order module

**Files:**
- Create: `src/review-order.ts`
- Test: `test/review-order.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/review-order.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reviewOrder, collectSignals, fileSlug } from "../src/review-order.js";
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/review-order.test.ts`
Expected: FAIL — `Cannot find module '../src/review-order.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/review-order.ts`:

```ts
import type { ReviewModel, AnnotatedFile } from "./types.js";
import { isNoisePath } from "./scorecard.js";

/** Per-file signals derived from the measured model — no I/O, deterministic. */
export interface FileSignals {
  path: string;
  /** Stable, unique anchor id for the file's detail section. */
  slug: string;
  status: AnnotatedFile["status"];
  added: number;
  removed: number;
  churn: number;
  hunks: number;
  /** Repo files importing this one (reach fan-in). */
  fanIn: number;
  /** Carries a measured complexity hotspot. */
  hotspot: boolean;
  /** Highest CCN among this file's hotspots, or null. */
  maxCcn: number | null;
  /** File-level what/why absent, or any hunk lacks intent. */
  missingIntent: boolean;
  isNoise: boolean;
}

export interface RankedFile extends FileSignals {
  /** 1-based review priority (1 = review first). */
  rank: number;
  score: number;
}

const norm = (p: string): string => p.replace(/\\/g, "/");

/** Stable, unique, deterministic anchor id for a file section. */
export function fileSlug(index: number): string {
  return `file-${index}`;
}

/** Highest CCN of a measured hotspot matching this file, or null. Matches
 *  lizard's (possibly differently-rooted) path by suffix/basename — same
 *  heuristic the change-map uses. */
function hotspotCcn(model: ReviewModel, path: string): number | null {
  const cx = model.complexity;
  if (!cx.available || cx.hotspots.length === 0) return null;
  const p = norm(path);
  const base = p.split("/").pop() ?? p;
  let max: number | null = null;
  for (const h of cx.hotspots) {
    const hp = norm(h.file);
    const hit =
      hp === p ||
      hp.endsWith("/" + p) ||
      p.endsWith("/" + hp) ||
      (hp.split("/").pop() ?? hp) === base;
    if (hit) max = max === null ? h.ccn : Math.max(max, h.ccn);
  }
  return max;
}

/** Pure: one signal record per changed file, in original diff order. */
export function collectSignals(model: ReviewModel): FileSignals[] {
  return model.files.map((f, i): FileSignals => {
    let added = 0;
    let removed = 0;
    for (const h of f.hunks)
      for (const l of h.lines) {
        if (l.type === "add") added++;
        else if (l.type === "del") removed++;
      }
    const fanIn = model.reach.edges.reduce(
      (n, e) => (norm(e.to) === norm(f.path) ? n + 1 : n),
      0,
    );
    const maxCcn = hotspotCcn(model, f.path);
    const missingIntent = !f.why || f.hunks.some((h) => h.intents.length === 0);
    return {
      path: f.path,
      slug: fileSlug(i),
      status: f.status,
      added,
      removed,
      churn: added + removed,
      hunks: f.hunks.length,
      fanIn,
      hotspot: maxCcn !== null,
      maxCcn,
      missingIntent,
      isNoise: isNoisePath(f.path),
    };
  });
}

/** Pure: files ranked by review priority (most attention-worthy first). Score
 *  blends normalized churn + reach with flat bonuses for a complexity hotspot
 *  and for unexplained changes, then demotes noise. Ties break by churn, then
 *  original diff order — fully deterministic. */
export function reviewOrder(model: ReviewModel): RankedFile[] {
  const sig = collectSignals(model);
  const maxChurn = Math.max(1, ...sig.map((s) => s.churn));
  const maxFan = Math.max(1, ...sig.map((s) => s.fanIn));
  const sq = (v: number, max: number) => Math.sqrt(v) / Math.sqrt(max);

  const scored = sig.map((s, i) => {
    const base =
      sq(s.churn, maxChurn) +
      sq(s.fanIn, maxFan) +
      (s.hotspot ? 0.6 : 0) +
      (s.missingIntent ? 0.5 : 0);
    return { sig: s, i, score: s.isNoise ? base * 0.25 : base };
  });

  scored.sort(
    (a, b) => b.score - a.score || b.sig.churn - a.sig.churn || a.i - b.i,
  );

  return scored.map(
    (x, idx): RankedFile => ({ ...x.sig, score: x.score, rank: idx + 1 }),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/review-order.test.ts`
Expected: PASS (both describes green).

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/review-order.ts test/review-order.test.ts
git commit -m "feat: pure review-order module — rank files by review priority"
```

---

### Task 2: Risk-ordered, collapsible file sections with signal badges

**Files:**
- Modify: `src/render.ts` — imports; `renderHtml` file loop (`render.ts:45-47`); `renderFile` (`render.ts:861-882`); add `fileBadges`.
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/render.test.ts` inside the top-level `describe("renderHtml", ...)` block (it can use the existing `html` constant):

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render.test.ts -t "collapsible section"`
Expected: FAIL — current output uses `<section class="file">` with no `id`/`<details>`.

- [ ] **Step 3: Add the import and a `fileBadges` helper**

At the top of `src/render.ts`, add to the existing import block:

```ts
import { reviewOrder, type RankedFile } from "./review-order.js";
```

Add this helper next to `renderFile` (e.g. just above it, near `render.ts:861`):

```ts
/** Compact measured signals shown in a file's head — same data the overview
 *  ranks on, carried down to the diff so context isn't lost on the way. */
function fileBadges(r: RankedFile): string {
  const b: string[] = [
    `<span class="fbadge fbadge-churn" title="lines added / removed">+${r.added} −${r.removed}</span>`,
  ];
  if (r.fanIn > 0)
    b.push(`<span class="fbadge fbadge-reach" title="repo files importing this one (reach)">→ ${r.fanIn}</span>`);
  if (r.hotspot)
    b.push(`<span class="fbadge fbadge-hot" title="measured cyclomatic complexity hotspot">CCN ${r.maxCcn}</span>`);
  if (r.missingIntent)
    b.push(`<span class="fbadge fbadge-gap" title="some of this file has no written intent">⚠ intent</span>`);
  return `<span class="fbadges">${b.join("")}</span>`;
}
```

- [ ] **Step 4: Rewrite `renderFile` to take a `RankedFile` and emit a `<details>`**

Replace the whole `renderFile` function (`render.ts:861-882`) with:

```ts
function renderFile(file: AnnotatedFile, r: RankedFile): string {
  // Noise files (lockfiles, generated) start collapsed; real code starts open.
  const open = r.isNoise ? "" : " open";
  return `<details class="file${r.isNoise ? " is-noise" : ""}" id="${r.slug}"${open}>
  <summary class="file-head">
    <span class="status status-${file.status}">${file.status}</span>
    <code class="path">${esc(file.path)}</code>
    <span class="file-rank" title="review priority">#${r.rank}</span>
    ${fileBadges(r)}
    <label class="viewed-toggle" title="Mark as reviewed"><input type="checkbox" class="viewed-cb" /> seen</label>
  </summary>
  <div class="file-body">
  ${
    file.why
      ? `<div class="file-intent">${whatWhy(file.what, file.why)}</div>`
      : `<div class="file-intent missing">⚠ No rationale (what/why) written for this changed file.</div>`
  }
  ${file.hunks.map(renderHunk).join("\n")}
  ${
    file.unmatchedIntents.length
      ? `<div class="unmatched">
    <h4>Notes not matched to a hunk</h4>
    ${file.unmatchedIntents.map((n) => `<div class="note"><span class="anchor">line ${n.anchor}</span>${whatWhy(n.what, n.why)}</div>`).join("")}
  </div>`
      : ""
  }
  </div>
</details>`;
}
```

- [ ] **Step 5: Render the files in review-priority order in `renderHtml`**

In `renderHtml`, just before the `return` (near `render.ts:15`), compute the ranking once:

```ts
  const ranked = reviewOrder(model);
  const byPath = new Map(model.files.map((f) => [f.path, f]));
```

Replace the `<main>` block (`render.ts:45-47`) with:

```ts
<main>
  ${
    ranked.length === 0
      ? `<p class="empty">No file changes in this diff.</p>`
      : ranked.map((r) => renderFile(byPath.get(r.path)!, r)).join("\n")
  }
</main>
```

- [ ] **Step 6: Run the render tests**

Run: `npx vitest run test/render.test.ts`
Expected: PASS — the two new assertions pass and all existing assertions still pass (the single-file model still renders `id="file-0"`; multi-file ordering is covered by Task 1's tests).

- [ ] **Step 7: Type-check**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: risk-ordered, collapsible file sections with signal badges"
```

---

### Task 3: Clickable file-index spine

**Files:**
- Modify: `src/render.ts` — add `renderFileIndex`; call it in `renderHtml`.
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("renderHtml", ...)`:

```ts
  it("renders a clickable, review-ordered file index", () => {
    expect(html).toContain('class="file-index"');
    const idx = html.slice(html.indexOf('class="file-index"'));
    expect(idx).toContain('href="#file-0"'); // links into the file's detail section
    expect(idx).toContain("src/a.ts");
    expect(idx).toContain("1 changed");      // count line
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/render.test.ts -t "file index"`
Expected: FAIL — no `file-index` markup yet.

- [ ] **Step 3: Add `renderFileIndex`**

Add to `src/render.ts` (near the other section renderers):

```ts
/** The spine: every changed file as a clickable row, in review-priority order,
 *  carrying its measured signals. Links jump to the file's detail <details>. */
function renderFileIndex(ranked: RankedFile[]): string {
  if (ranked.length === 0) return "";
  const rows = ranked
    .map(
      (r) => `<li class="fi-row">
    <a class="fi-link" href="#${r.slug}">
      <span class="fi-rank">#${r.rank}</span>
      <span class="status status-${r.status}">${r.status}</span>
      <code class="fi-path">${esc(r.path)}</code>
      <span class="fi-sig">
        <span class="fi-churn" title="± lines">+${r.added} −${r.removed}</span>
        ${r.fanIn ? `<span class="fi-reach" title="dependents (reach)">→ ${r.fanIn}</span>` : ""}
        ${r.hotspot ? `<span class="fi-hot" title="complexity hotspot">CCN ${r.maxCcn}</span>` : ""}
        ${r.missingIntent ? `<span class="fi-gap" title="unexplained change">⚠</span>` : ""}
      </span>
    </a>
  </li>`,
    )
    .join("\n  ");
  const n = ranked.length;
  return `<nav class="file-index" aria-label="Changed files">
  <h2>Files <span class="muted fi-count">${n} changed · review-ordered</span></h2>
  <ol class="fi-list">
  ${rows}
  </ol>
</nav>`;
}
```

- [ ] **Step 4: Call it in `renderHtml`**

In `renderHtml`, insert the index immediately after `${renderVitals(model)}` (`render.ts:35`):

```ts
${renderVitals(model)}

${renderFileIndex(ranked)}
```

(`ranked` is already in scope from Task 2.)

- [ ] **Step 5: Run the render tests**

Run: `npx vitest run test/render.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: clickable review-ordered file index (overview→detail spine)"
```

---

### Task 4: "Review first" callout

**Files:**
- Modify: `src/render.ts` — add `renderReviewFirst`; call it in `renderHtml`.
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("renderHtml", ...)`:

```ts
  it("renders a 'review first' callout naming the top-ranked file and its reasons", () => {
    expect(html).toContain('class="review-first"');
    const rf = html.slice(html.indexOf('class="review-first"'));
    expect(rf).toContain("Review first");
    expect(rf).toContain('href="#file-0"');
    expect(rf).toContain("a.ts");
    expect(rf).toContain("CCN 21"); // the hotspot reason
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/render.test.ts -t "review first"`
Expected: FAIL — no `review-first` markup.

- [ ] **Step 3: Add `renderReviewFirst`**

Add to `src/render.ts`:

```ts
/** Actionable triage: the up-to-three files most worth a reviewer's first pass,
 *  each with the measured reasons it surfaced. Empty when nothing stands out. */
function renderReviewFirst(ranked: RankedFile[]): string {
  const top = ranked.filter((r) => r.score > 0).slice(0, 3);
  if (top.length === 0) return "";
  const card = (r: RankedFile) => {
    const reasons: string[] = [];
    if (r.churn > 0) reasons.push(`${r.churn} lines`);
    if (r.fanIn > 0) reasons.push(`imported by ${r.fanIn}`);
    if (r.hotspot) reasons.push(`CCN ${r.maxCcn}`);
    if (r.missingIntent) reasons.push(`no intent`);
    return `<a class="rf-card" href="#${r.slug}">
      <span class="rf-rank">#${r.rank}</span>
      <code class="rf-path">${esc(shortPath(r.path, 40))}</code>
      <span class="rf-reasons">${reasons.map((x) => `<span>${esc(x)}</span>`).join("")}</span>
    </a>`;
  };
  return `<section class="review-first">
  <h2>Review first</h2>
  <div class="rf-cards">${top.map(card).join("")}</div>
</section>`;
}
```

(`shortPath` already exists at `render.ts:774`.)

- [ ] **Step 4: Call it in `renderHtml`**

Insert between vitals and the file index:

```ts
${renderVitals(model)}

${renderReviewFirst(ranked)}

${renderFileIndex(ranked)}
```

- [ ] **Step 5: Run the render tests**

Run: `npx vitest run test/render.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: 'review first' triage callout above the file index"
```

---

### Task 5: Tier the analytics + sticky utility bar

**Files:**
- Modify: `src/render.ts` — `renderHtml` order + `id="top"`; wrap analytics sections in `<details>`; add `renderTopbar`.
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("renderHtml", ...)`:

```ts
  it("wraps the heavy analytics in collapsible bands (blast open, visuals closed)", () => {
    // Blast radius starts open; the visual summary starts collapsed.
    expect(html).toContain('<details class="band" open>');
    expect(html).toContain('<details class="band">');
    // outer section wrappers preserved for styling + existing assertions
    expect(html).toContain('class="visuals"');
    expect(html).toContain('class="tests"');
  });

  it("renders a sticky top bar with a reviewed-progress counter and back-to-top", () => {
    expect(html).toContain('class="topbar"');
    expect(html).toContain('class="tb-progress"');
    expect(html).toContain('href="#top"');
    expect(html).toContain('id="top"');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/render.test.ts -t "collapsible bands"`
Expected: FAIL — sections aren't `<details>` and there's no topbar.

- [ ] **Step 3: Add `renderTopbar`**

Add to `src/render.ts`:

```ts
/** Slim sticky bar: persistent wayfinding across the long scroll. The progress
 *  counter is updated client-side as files are marked "seen". */
function renderTopbar(model: ReviewModel): string {
  const n = model.files.length;
  return `<div class="topbar">
  <span class="tb-title">${esc(model.title)}</span>
  <span class="tb-progress" data-total="${n}">0 / ${n} reviewed</span>
  <a class="tb-top" href="#top">↑ Top</a>
</div>`;
}
```

- [ ] **Step 4: Convert `renderBlastRadius` to an open band**

Replace `renderBlastRadius` (`render.ts:111-120`) with:

```ts
function renderBlastRadius(model: ReviewModel): string {
  return `<section class="blast">
  <details class="band" open>
    <summary class="band-head"><h2>Blast radius</h2></summary>
    <div class="band-body">
      <div class="blast-grid">
        ${renderScorecard(model)}
        ${renderRisks(model.risks)}
      </div>
      ${renderReach(model.reach)}
    </div>
  </details>
</section>`;
}
```

- [ ] **Step 5: Convert `renderVisuals` to a closed band**

In `renderVisuals` (`render.ts:366-382`), replace the trailing `return` template with:

```ts
  return `<section class="visuals">
  <details class="band">
    <summary class="band-head"><h2>Visual summary <span class="src">measured</span></h2></summary>
    <div class="band-body">
      <div class="viz-grid">
        ${blocks.join("\n    ")}
      </div>
    </div>
  </details>
</section>`;
```

- [ ] **Step 6: Convert `renderTests` to a closed band**

In `renderTests` (`render.ts:837-840`), replace the trailing `return` template with:

```ts
  return `<section class="tests">
  <details class="band">
    <summary class="band-head"><h2>Tests <span class="src">claimed</span> <span class="muted test-count">${n} case${n === 1 ? "" : "s"} described</span></h2></summary>
    <div class="band-body">
      ${blocks}
    </div>
  </details>
</section>`;
```

- [ ] **Step 7: Convert `renderDiagrams` to a closed band**

In `renderDiagrams` (`render.ts:853-858`), replace the trailing `return` template with:

```ts
  return `<section class="diagrams">
  <details class="band">
    <summary class="band-head"><h2>Diagrams</h2></summary>
    <div class="band-body">
      <div class="diagram-grid">
${block("Class diagram", cls)}
${block("Sequence diagram (changed steps highlighted)", sequence)}
      </div>
    </div>
  </details>
</section>`;
```

- [ ] **Step 8: Reorder `renderHtml` and add the topbar + `#top` anchor**

Replace the body opening + section sequence in `renderHtml` (`render.ts:24-49`) so the order is: topbar → masthead(`id="top"`) → vitals → review-first → file index → blast (open) → visuals → tests → diagrams → main → orphans:

```ts
<body>
${renderTopbar(model)}
<header class="page-head" id="top">
  <div class="eyebrow">Intent review <span class="eyebrow-diff">${esc(model.base)}…HEAD</span></div>
  <h1>${esc(model.title)}</h1>
  <div class="tldr">${md(model.tldr)}</div>
  <details class="overall-wrap">
    <summary>Full summary</summary>
    <div class="overall">${md(model.overall)}</div>
  </details>
</header>

${renderVitals(model)}

${renderReviewFirst(ranked)}

${renderFileIndex(ranked)}

${renderBlastRadius(model)}

${renderVisuals(model)}

${renderTests(model.tests)}

${renderDiagrams(model)}

<main>
  ${
    ranked.length === 0
      ? `<p class="empty">No file changes in this diff.</p>`
      : ranked.map((r) => renderFile(byPath.get(r.path)!, r)).join("\n")
  }
</main>

${renderFilesWithoutChanges(model)}
```

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: PASS. If any existing assertion fails, it will be a CSS-only concern deferred to Task 6 — but markup `toContain` assertions should all hold because section wrappers and chart internals are unchanged.

- [ ] **Step 10: Type-check and commit**

```bash
npm run build
git add src/render.ts test/render.test.ts
git commit -m "feat: tier analytics into collapsible bands + sticky utility bar"
```

---

### Task 6: CSS for the new components

**Files:**
- Modify: `src/render.ts` — the `CSS` template literal (`render.ts:961-1306`).
- Test: `test/render.test.ts` (no new test; existing suite must stay green).

- [ ] **Step 1: Update the band-head selectors that used to target `> h2`**

In the CSS string, replace the section-eyebrow rule (`render.ts:1000`):

```css
.blast > h2, .visuals > h2, .tests > h2, .diagrams > h2 {
```

with:

```css
.band-head h2 {
```

And update the test-count rule (`render.ts:1159`) from `.tests > h2 .test-count` to:

```css
.tests .test-count {
```

- [ ] **Step 2: Add the new component styles**

Append the following block to the end of the `CSS` template literal, just before the closing backtick (`render.ts:1306`):

```css
/* ── Sticky utility bar ── */
html { scroll-behavior: smooth; }
.topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: 16px;
  padding: 9px 18px; background: rgba(255,253,249,.9);
  backdrop-filter: blur(6px); border-bottom: 1px solid var(--line);
  font: 12px/1 var(--mono);
}
.tb-title { font-weight: 700; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-progress { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.tb-top { color: var(--accent); text-decoration: none; }

/* ── Review-first callout ── */
.review-first { max-width: var(--maxw); margin: 0 auto; padding: 22px 40px; border-top: 1px solid var(--line); }
.review-first > h2 {
  margin: 0 0 14px; font-size: 12px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .14em;
}
.rf-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.rf-card {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px; border: 1px solid var(--line-2); border-radius: 9px;
  background: var(--surface); text-decoration: none; color: var(--ink);
  transition: border-color .15s, box-shadow .15s;
}
.rf-card:hover { border-color: var(--accent); box-shadow: 0 2px 14px rgba(47,93,156,.1); }
.rf-rank { font: 700 13px/1 var(--mono); color: var(--accent); }
.rf-path { font-size: 12.5px; }
.rf-reasons { display: flex; flex-wrap: wrap; gap: 4px 8px; width: 100%; }
.rf-reasons span {
  font: 600 10px/1.5 var(--mono); color: var(--ink-soft);
  background: var(--surface-2); border-radius: 4px; padding: 2px 6px;
}

/* ── File index (spine) ── */
.file-index { max-width: var(--maxw); margin: 0 auto; padding: 28px 40px; border-top: 1px solid var(--line); }
.file-index > h2 {
  margin: 0 0 14px; font-size: 12px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .14em;
}
.fi-count { font-weight: 400; text-transform: none; letter-spacing: 0; font-family: var(--sans); font-size: 12px; }
.fi-list { list-style: none; margin: 0; padding: 0; }
.fi-row { border-bottom: 1px solid var(--line); }
.fi-row:last-child { border-bottom: 0; }
.fi-link {
  display: flex; align-items: center; gap: 12px; padding: 8px 6px;
  text-decoration: none; color: var(--ink); border-radius: 6px;
}
.fi-link:hover { background: var(--surface-2); }
.fi-link.active { background: var(--accent-soft); }
.fi-rank { font: 700 12px/1 var(--mono); color: var(--accent); width: 2.4em; flex: none; }
.fi-path { font-size: 12.5px; flex: 1 1 auto; background: none; padding: 0; }
.fi-sig { display: flex; gap: 4px 10px; flex: none; font: 11px/1.4 var(--mono); color: var(--muted); }
.fi-sig .fi-hot { color: var(--del); font-weight: 700; }
.fi-sig .fi-gap { color: var(--warn); font-weight: 700; }

/* ── Collapsible analytics bands ── */
.band { border: 0; }
.band-head { cursor: pointer; list-style: none; }
.band-head::-webkit-details-marker { display: none; }
.band-head h2 { display: inline-flex; align-items: baseline; gap: 12px; }
.band-head h2::before {
  content: "›"; font-size: 15px; color: var(--muted); transition: transform .15s; display: inline-block;
}
.band[open] > .band-head h2::before { transform: rotate(90deg); }
.band-body { padding-top: 22px; }

/* ── File head badges + collapsible files + viewed state ── */
.file > summary.file-head { cursor: pointer; list-style: none; }
.file > summary.file-head::-webkit-details-marker { display: none; }
.file-head { flex-wrap: wrap; }
.file-rank { font: 700 11px/1 var(--mono); color: var(--accent); }
.fbadges { display: inline-flex; flex-wrap: wrap; gap: 4px 6px; }
.fbadge {
  font: 600 10px/1.5 var(--mono); border-radius: 4px; padding: 2px 6px;
  background: var(--surface); border: 1px solid var(--line-2); color: var(--ink-soft);
}
.fbadge-hot { color: var(--del); border-color: #eccac4; background: var(--del-soft); }
.fbadge-gap { color: var(--warn); border-color: #e6d8a8; background: var(--warn-soft); }
.viewed-toggle {
  margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
  font: 600 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
  cursor: pointer; user-select: none;
}
.file.viewed { opacity: .55; }
.file.viewed:hover { opacity: 1; }

@media (max-width: 820px) {
  .review-first, .file-index { padding: 22px; }
  .fi-sig { width: 100%; }
}
```

- [ ] **Step 3: Regenerate the sample and run the suite**

Run: `npm run sample && npm test`
Expected: tests PASS; `sample-output.html` updated.

- [ ] **Step 4: Visual check**

Open `sample-output.html` in a browser. Confirm: sticky bar stays on scroll; review-first cards link into files; file index rows are clickable and risk-ordered; Blast radius is expanded, Visual summary / Tests / Diagrams are collapsed and expand on click; file heads show rank + badges; clicking a file head collapses/expands it.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts sample-output.html
git commit -m "style: layout + styling for spine, review-first, bands, file badges"
```

---

### Task 7: Viewed-state + active-nav JavaScript

**Files:**
- Modify: `src/render.ts` — add `viewedScript(model)`; wire it into `renderHtml` next to the other scripts (`render.ts:53-54`).
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("renderHtml", ...)`:

```ts
  it("ships the viewed-state / progress / active-nav script", () => {
    expect(html).toContain("viewed-cb");          // referenced by the script
    expect(html).toContain("localStorage");        // persistence
    expect(html).toContain("tb-progress");         // counter target
    expect(html).toContain("IntersectionObserver"); // index active-highlight
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/render.test.ts -t "viewed-state"`
Expected: FAIL — `IntersectionObserver` / `localStorage` not yet emitted.

- [ ] **Step 3: Add `viewedScript`**

Add to `src/render.ts` (near `LIGHTBOX_SCRIPT`, `render.ts:1321`):

```ts
/** Static, dependency-free progressive enhancement: persist "seen" files,
 *  keep the topbar counter in sync, and highlight the active file in the index.
 *  Storage key is deterministic (title@base) so it stays per-change. */
function viewedScript(model: ReviewModel): string {
  const KEY = `review-intent:viewed:${model.title}@${model.base}`;
  return `<script>
  (function () {
    var KEY = ${JSON.stringify(KEY)};
    var store;
    try { store = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { store = {}; }
    var files = Array.prototype.slice.call(document.querySelectorAll("details.file"));
    var prog = document.querySelector(".tb-progress");
    function update() {
      if (!prog) return;
      var done = files.filter(function (f) { return f.classList.contains("viewed"); }).length;
      prog.textContent = done + " / " + files.length + " reviewed";
    }
    files.forEach(function (f) {
      var cb = f.querySelector(".viewed-cb");
      var toggle = f.querySelector(".viewed-toggle");
      if (!cb) return;
      if (store[f.id]) { cb.checked = true; f.classList.add("viewed"); f.open = false; }
      // Don't let the control toggle the <details> it lives in.
      if (toggle) toggle.addEventListener("click", function (e) { e.stopPropagation(); });
      cb.addEventListener("change", function () {
        if (cb.checked) { f.classList.add("viewed"); f.open = false; store[f.id] = 1; }
        else { f.classList.remove("viewed"); delete store[f.id]; }
        try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
        update();
      });
    });
    update();

    var links = {};
    document.querySelectorAll(".file-index a[href^='#']").forEach(function (a) {
      links[a.getAttribute("href").slice(1)] = a;
    });
    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var a = links[en.target.id];
          if (a) a.classList.toggle("active", en.isIntersecting);
        });
      }, { rootMargin: "-45% 0px -45% 0px" });
      files.forEach(function (f) { io.observe(f); });
    }
  })();
</script>`;
}
```

- [ ] **Step 4: Wire it into `renderHtml`**

In `renderHtml`, add the script next to the existing two (`render.ts:53-54`):

```ts
${MERMAID_SCRIPT}
${LIGHTBOX_SCRIPT}
${viewedScript(model)}
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Visual check**

Open the regenerated sample (run `npm run sample` first). Tick a file's "seen" box: the file collapses + dims, the topbar counter increments. Reload: the state is restored. Scroll: the active file is highlighted in the index.

- [ ] **Step 7: Type-check and commit**

```bash
npm run build && npm run sample
git add src/render.ts sample-output.html test/render.test.ts
git commit -m "feat: viewed-state persistence, progress counter, active-nav highlight"
```

---

### Task 8: Final verification

**Files:** none (verification + sample only).

- [ ] **Step 1: Full test + build gate**

Run: `npm test && npm run build`
Expected: all tests PASS; no TypeScript errors.

- [ ] **Step 2: Regenerate and eyeball the sample end-to-end**

Run: `npm run sample`
Open `sample-output.html`. Walk the full overview→detail journey:
- Overview is skimmable: vitals → "review first" → file index, all above the fold-ish, before any chart.
- The file index and review-first cards both jump to the correct file detail sections.
- Files are ordered most-to-least review-worthy; the `#1` file matters most.
- Analytics bands collapse/expand; Blast radius open by default.
- File heads carry rank + churn/reach/CCN/intent badges matching the index.
- "seen" collapses+dims+persists; topbar counter tracks it; back-to-top works.

- [ ] **Step 3: Confirm determinism (purity invariant)**

Run: `npx vitest run` (the render tests render the same model twice in places; ensure no `Date`/random crept into `review-order.ts` or the new render code). If desired, add a quick local check:

```ts
// scratch — not committed
import { renderHtml } from "./dist/render.js";
// renderHtml(model) === renderHtml(model) must hold
```

- [ ] **Step 4: Commit any sample drift**

```bash
git add sample-output.html
git commit -m "chore: regenerate sample-output.html"
```

---

## Self-review notes

- **Spec coverage:** five UX problems from the review → Task 3 (spine/no-nav), Task 2 (risk ordering + lost context badges), Tasks 4–5 (overview triage + tiering/density), Tasks 2+7 (progressive disclosure / viewed state). All covered.
- **Purity:** `review-order.ts` and all new render code are deterministic; the only side-effecting code is client-side JS in the emitted string, consistent with the existing lightbox/mermaid scripts.
- **No measured/claimed override:** ordering and badges are derived from already-measured model fields; nothing agent-authored is promoted over measured data.
- **Test-compat risk:** the one real hazard is the section-head CSS selector change (Task 6 Step 1) and the `<section>`→`<details>` body move; outer `class="visuals"/"tests"/"diagrams"` wrappers and all chart internals are preserved, so `toContain` assertions hold. Task 5 Step 9 / Task 6 Step 3 run the full suite to catch regressions.
- **Out of scope (noted):** refactoring `renderChangeScatter` to reuse `review-order`'s hotspot matcher; a true left-rail app shell.
