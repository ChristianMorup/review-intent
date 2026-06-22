# Worktree / Uncommitted-Work Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the working tree is dirty, fold uncommitted + untracked work into the rendered diff and flag the affected files, and teach the authoring skill how to review from a worktree.

**Architecture:** `getDiff` becomes state-aware: clean tree → today's `base...HEAD` (unchanged); dirty tree → one combined diff (`git diff <mergeBase>` + per-untracked-file `git diff --no-index`), plus a `DiffScope` descriptor. The descriptor flows as plain data through the pure `match`/`render` stages, which add a banner and per-file badges. The parser, scorecard, reach, and complexity stages are untouched.

**Tech Stack:** ESM TypeScript (`NodeNext`, `.js` import extensions), vitest, `parse-diff`, git via `execFileSync`.

## Global Constraints

- ESM TypeScript, `"type": "module"`, `NodeNext` resolution — **imports use `.js` extensions** even from `.ts` sources.
- **Purity boundary:** `match.ts` and `render.ts` stay pure — no I/O, no `Date`/random, deterministic. All git invocation stays in `git.ts`.
- **Never silently drop or truncate** — folded-in uncommitted/untracked work must be visible (banner + badges); untracked discovery respects `.gitignore`.
- `git.ts` side-effecting runners are not unit-tested; **pure helpers in it are** (precedent: `complexity.ts`).
- `npm run build` (tsc, strict) is the type-check gate. `npm test` runs all vitest.
- Render additions are static strings only (no `Date`/random) so markup-assertion tests apply.

---

### Task 1: Types + plumbing (clean scope), behavior unchanged

Introduce `DiffScope`, thread it end-to-end with a hard-coded clean scope, and implement the per-file flag logic in `match.ts`. `getDiff` still runs `base...HEAD`; no behavior change yet. Everything compiles and the suite stays green.

**Files:**
- Modify: `src/types.ts` (add `DiffScope`, extend `ReviewModel` and `AnnotatedFile`)
- Modify: `src/git.ts:50-61` (`getDiff` returns `{ text, scope }`)
- Modify: `src/match.ts:23-93` (`buildReviewModel` takes `diffScope`, sets flags, stores it)
- Modify: `src/cli.ts:116,138` (destructure `getDiff`, pass `diffScope`)
- Test: `test/match.test.ts` (update existing call, add flag assertions)

**Interfaces:**
- Produces: `interface DiffScope { includesUncommitted: boolean; uncommittedFiles: string[]; untrackedFiles: string[] }`
- Produces: `getDiff(cwd: string, base: string): { text: string; scope: DiffScope }`
- Produces: `buildReviewModel(artifact, diff, base, scorecard, reach, complexity, diffScope: DiffScope): ReviewModel`
- Produces: `AnnotatedFile.uncommitted?: boolean`, `AnnotatedFile.untracked?: boolean`, `ReviewModel.diffScope: DiffScope`

- [ ] **Step 1: Add the types**

In `src/types.ts`, after the `ReachModel` interface block (around line 212), add:

```ts
/** What the rendered diff covers beyond committed history. Computed by git.ts
 *  from the working-tree state; plain data so match/render stay pure. */
export interface DiffScope {
  /** True when the diff includes uncommitted working-tree changes. */
  includesUncommitted: boolean;
  /** Tracked files with staged/unstaged changes folded in (posix, repo-relative). */
  uncommittedFiles: string[];
  /** Untracked-not-ignored files folded in via --no-index (posix, repo-relative). */
  untrackedFiles: string[];
}
```

In `AnnotatedFile` (around line 108), add two optional flags after `status`:

```ts
  /** True when this file carries uncommitted (staged/unstaged) changes vs HEAD. */
  uncommitted?: boolean;
  /** True when this file is untracked (new, never committed). */
  untracked?: boolean;
```

In `ReviewModel` (around line 224), add after `base: string;`:

```ts
  /** What the rendered diff covers beyond committed history (banner + badges). */
  diffScope: DiffScope;
```

- [ ] **Step 2: Update the failing test for flag-setting**

In `test/match.test.ts`, update the import line to add `DiffScope`:

```ts
import type { DiffFile, ScorecardModel, ReachModel, ComplexityModel, DiffScope } from "../src/types.js";
```

Add a clean scope constant near the other empties (after `emptyComplexity`):

```ts
const cleanScope: DiffScope = { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] };
```

Update the existing `buildReviewModel(...)` call (around line 60) to pass it as the last arg:

```ts
const model = buildReviewModel(artifact, diff, "main", emptyScorecard, emptyReach, emptyComplexity, cleanScope);
```

Add a new `describe` block at the end of the file:

```ts
describe("buildReviewModel diff scope", () => {
  const dirtyScope: DiffScope = {
    includesUncommitted: true,
    uncommittedFiles: ["src/greet.ts"],
    untrackedFiles: ["src/new.ts"],
  };
  const dirtyDiff: DiffFile[] = [
    { path: "src/greet.ts", status: "modified", hunks: [] },
    { path: "src/new.ts", status: "added", hunks: [] },
  ];
  const m = buildReviewModel(artifact, dirtyDiff, "main", emptyScorecard, emptyReach, emptyComplexity, dirtyScope);

  it("stores the diff scope on the model", () => {
    expect(m.diffScope).toEqual(dirtyScope);
  });

  it("flags tracked files as uncommitted and new files as untracked", () => {
    const greet = m.files.find((f) => f.path === "src/greet.ts")!;
    const fresh = m.files.find((f) => f.path === "src/new.ts")!;
    expect(greet.uncommitted).toBe(true);
    expect(greet.untracked).toBeFalsy();
    expect(fresh.untracked).toBe(true);
    expect(fresh.uncommitted).toBeFalsy();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/match.test.ts`
Expected: FAIL — `buildReviewModel` does not accept a 7th argument / `m.diffScope` is undefined.

- [ ] **Step 4: Implement match + git + cli plumbing**

In `src/match.ts`, add `DiffScope` to the type import, change the signature, set flags, and store the scope:

```ts
import type {
  Artifact,
  DiffFile,
  AnnotatedFile,
  AnnotatedHunk,
  HunkIntent,
  ReviewModel,
  ScorecardModel,
  ReachModel,
  ComplexityModel,
  DiffScope,
} from "./types.js";
```

```ts
export function buildReviewModel(
  artifact: Artifact,
  diff: DiffFile[],
  base: string,
  scorecard: ScorecardModel,
  reach: ReachModel,
  complexity: ComplexityModel,
  diffScope: DiffScope,
): ReviewModel {
  const intentByPath = new Map(artifact.files.map((f) => [f.path, f]));
  const diffPaths = new Set(diff.map((f) => f.path));
  const uncommittedSet = new Set(diffScope.uncommittedFiles);
  const untrackedSet = new Set(diffScope.untrackedFiles);
```

In the `files` map's returned object, add the flags (use `|| undefined` so a `false` never serializes as a flag):

```ts
    return {
      path: file.path,
      status: file.status,
      uncommitted: uncommittedSet.has(file.path) || undefined,
      untracked: untrackedSet.has(file.path) || undefined,
      what: fileIntent?.what,
      why: fileIntent?.why,
      unmatchedIntents,
      hunks,
    };
```

In the final returned `ReviewModel`, add `diffScope` after `base`:

```ts
  return {
    title: artifact.title,
    tldr: artifact.tldr,
    overall: artifact.overall,
    base,
    diffScope,
    diagrams: artifact.diagrams,
    ...
```

In `src/git.ts`, change `getDiff` to return the new shape with a clean scope for now (real detection lands in Task 2). Add the `DiffScope` import:

```ts
import { execFileSync } from "node:child_process";
import type { DiffScope } from "./types.js";
```

```ts
export function getDiff(cwd: string, base: string): { text: string; scope: DiffScope } {
  // Fails early with a clear message if cwd is not a git work tree.
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: "ignore",
    });
  } catch {
    throw new GitError(`Not a git repository: ${cwd}`);
  }
  const text = git(["diff", `${base}...HEAD`], cwd);
  const scope: DiffScope = { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] };
  return { text, scope };
}
```

In `src/cli.ts`, update the diff call (line 116) and the model build (line 138):

```ts
  const { text: rawDiff, scope: diffScope } = getDiff(cwd, base);
```

```ts
  const model = buildReviewModel(artifact, diff, base, scorecard, reach, complexity, diffScope);
```

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run test/match.test.ts && npm run build`
Expected: PASS (match tests green) and tsc exits 0.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — render and all other tests still green (render does not read `diffScope` yet).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/git.ts src/match.ts src/cli.ts test/match.test.ts
git commit -m "feat: thread DiffScope through the model (clean scope, no behavior change)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure `parseGitStatus` + state-aware diff assembly

TDD a pure parser for `git status --porcelain`, then wire `getDiff` to detect a dirty tree and fold uncommitted tracked + untracked work into one diff with a populated `DiffScope`.

**Files:**
- Modify: `src/git.ts` (add pure `parseGitStatus`, a `--no-index`-tolerant runner, dirty-tree branch)
- Test: `test/git.test.ts` (new — pure `parseGitStatus` only)

**Interfaces:**
- Consumes: `DiffScope` (Task 1)
- Produces: `export function parseGitStatus(porcelain: string): { uncommittedFiles: string[]; untrackedFiles: string[] }`

- [ ] **Step 1: Write the failing test for the pure parser**

Create `test/git.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseGitStatus } from "../src/git.js";

describe("parseGitStatus", () => {
  it("classifies staged, unstaged, and both-column changes as uncommitted (by path)", () => {
    const out = " M src/a.ts\nM  src/b.ts\nMM src/c.ts\nA  src/d.ts\nD  src/e.ts\n";
    const { uncommittedFiles, untrackedFiles } = parseGitStatus(out);
    expect(uncommittedFiles).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"]);
    expect(untrackedFiles).toEqual([]);
  });

  it("classifies ?? entries as untracked", () => {
    const { uncommittedFiles, untrackedFiles } = parseGitStatus("?? src/new.ts\n?? docs/x.md\n");
    expect(untrackedFiles).toEqual(["src/new.ts", "docs/x.md"]);
    expect(uncommittedFiles).toEqual([]);
  });

  it("takes the new path for a rename", () => {
    const { uncommittedFiles } = parseGitStatus("R  src/old.ts -> src/new.ts\n");
    expect(uncommittedFiles).toEqual(["src/new.ts"]);
  });

  it("dequotes paths that git wrapped in double quotes", () => {
    const { untrackedFiles } = parseGitStatus('?? "src/with space.ts"\n');
    expect(untrackedFiles).toEqual(["src/with space.ts"]);
  });

  it("ignores blank lines and an empty status", () => {
    expect(parseGitStatus("")).toEqual({ uncommittedFiles: [], untrackedFiles: [] });
    expect(parseGitStatus("\n\n")).toEqual({ uncommittedFiles: [], untrackedFiles: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/git.test.ts`
Expected: FAIL — `parseGitStatus` is not exported.

- [ ] **Step 3: Implement `parseGitStatus` and the dirty-tree diff**

In `src/git.ts`, add the pure parser (export it):

```ts
/**
 * Parse `git status --porcelain` (v1) into the files that carry uncommitted work.
 * Pure and unit-tested. Untracked = `??` lines; everything else with a status is
 * a tracked change (rename → new path). Paths are dequoted for the common case;
 * exotic C-escapes in non-ASCII paths are a known limitation.
 */
export function parseGitStatus(porcelain: string): {
  uncommittedFiles: string[];
  untrackedFiles: string[];
} {
  const uncommittedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue; // need "XY <path>"
    const status = line.slice(0, 2);
    let rest = line.slice(3);
    if (status === "??") {
      untrackedFiles.push(dequote(rest));
      continue;
    }
    const arrow = rest.indexOf(" -> ");
    if (arrow !== -1) rest = rest.slice(arrow + 4); // rename: take the new path
    uncommittedFiles.push(dequote(rest));
  }
  return { uncommittedFiles, untrackedFiles };
}

function dequote(p: string): string {
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) return p.slice(1, -1);
  return p;
}
```

Add a `--no-index`-tolerant runner (git diff implies `--exit-code`, returning 1 when files differ):

```ts
/** Like git(), but for `git diff --no-index`, which returns exit 1 when the
 *  files differ — that is success here, not an error. Exit ≥ 2 still throws. */
function gitDiffNoIndex(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message: string };
    if (e.status === 1 && typeof e.stdout === "string") return e.stdout;
    throw new GitError((e.stderr || e.message).trim());
  }
}
```

Replace the body of `getDiff` (keep the work-tree guard) with the state-aware build:

```ts
export function getDiff(cwd: string, base: string): { text: string; scope: DiffScope } {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "ignore" });
  } catch {
    throw new GitError(`Not a git repository: ${cwd}`);
  }

  const mergeBase = git(["merge-base", base, "HEAD"], cwd).trim();
  const { uncommittedFiles, untrackedFiles } = parseGitStatus(git(["status", "--porcelain"], cwd));
  const dirty = uncommittedFiles.length > 0 || untrackedFiles.length > 0;

  if (!dirty) {
    // Identical to the previous `base...HEAD` (merge-base..HEAD), committed-only.
    return {
      text: git(["diff", mergeBase, "HEAD"], cwd),
      scope: { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] },
    };
  }

  // Fork point → current working tree: committed + uncommitted tracked changes.
  let text = git(["diff", mergeBase], cwd);
  // Untracked files are invisible to `git diff`; fold each in via --no-index.
  for (const f of untrackedFiles) {
    text += gitDiffNoIndex(["diff", "--no-index", "--", "/dev/null", f], cwd);
  }
  return { text, scope: { includesUncommitted: true, uncommittedFiles, untrackedFiles } };
}
```

- [ ] **Step 4: Run the parser test to verify it passes**

Run: `npx vitest run test/git.test.ts`
Expected: PASS — all `parseGitStatus` cases green.

- [ ] **Step 5: Build and run the full suite**

Run: `npm run build && npm test`
Expected: PASS — tsc exits 0, all tests green.

- [ ] **Step 6: Smoke-test against a real dirty tree**

Run (bash): `node --experimental-strip-types src/cli.ts --no-open --allow-gaps --out "$TMPDIR/ri-smoke.html" >/dev/null 2>&1; grep -c "diff-scope-banner" "$TMPDIR/ri-smoke.html" || true`
Expected: runs without error. (The banner markup arrives in Task 4; here we only confirm the dirty diff assembles and renders without throwing.)

- [ ] **Step 7: Commit**

```bash
git add src/git.ts test/git.test.ts
git commit -m "feat: fold uncommitted + untracked work into the diff when the tree is dirty

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Parser fixture — untracked `--no-index` block

Lock the contract that a `git diff --no-index /dev/null <file>` block parses to a repo-relative *added* file, so the untracked path can never silently mis-parse.

**Files:**
- Create: `test/fixtures/no-index-untracked.diff`
- Test: `test/diff-parser.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `parseDiffText` (existing, unchanged)

- [ ] **Step 1: Create the fixture**

Create `test/fixtures/no-index-untracked.diff` with the exact shape git emits (verified: `b/<path>` prefix, `--- /dev/null`):

```
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..e5c5c55
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+line one
+line two
```

- [ ] **Step 2: Write the failing test**

In `test/diff-parser.test.ts`, add at the end:

```ts
describe("parseDiffText on a --no-index untracked block", () => {
  const noIndex = readFileSync(
    join(import.meta.dirname, "fixtures", "no-index-untracked.diff"),
    "utf8",
  );
  const files = parseDiffText(noIndex);

  it("parses the untracked file as an added file at its repo-relative path", () => {
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/new.ts");
    expect(files[0].status).toBe("added");
  });

  it("captures the added lines", () => {
    const adds = files[0].hunks[0].lines.filter((l) => l.type === "add");
    expect(adds.map((l) => l.content)).toEqual(["line one", "line two"]);
  });
});
```

- [ ] **Step 3: Run to verify it passes**

Run: `npx vitest run test/diff-parser.test.ts`
Expected: PASS — parse-diff already handles the `new file mode` header (verified manually); this fixture locks it.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/no-index-untracked.diff test/diff-parser.test.ts
git commit -m "test: lock --no-index untracked block parsing to an added file

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Render — banner + per-file badges

Surface the scope: a top banner with counts when the diff includes uncommitted work, and an `uncommitted` / `untracked` badge on each flagged file.

**Files:**
- Modify: `src/render.ts` (new `renderDiffScopeBanner`, call site after `</header>`, badge in `renderFile`, CSS)
- Test: `test/render.test.ts` (add `diffScope` to the model literal; new assertions)

**Interfaces:**
- Consumes: `ReviewModel.diffScope`, `AnnotatedFile.uncommitted`, `AnnotatedFile.untracked` (Task 1)

- [ ] **Step 1: Add `diffScope` to the existing test model and write failing assertions**

In `test/render.test.ts`, add `diffScope` to the `model` literal (after `base: "main",`):

```ts
  diffScope: { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] },
```

Add a new `describe` block at the end:

```ts
describe("renderHtml diff scope", () => {
  it("omits the banner when the tree is clean", () => {
    const html = renderHtml(model);
    expect(html).not.toContain("diff-scope-banner");
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — "diff-scope-banner" not found in the dirty render.

- [ ] **Step 3: Implement the banner, the call site, and the badge**

In `src/render.ts`, add the banner function (near `renderTopbar`, around line 216):

```ts
function renderDiffScopeBanner(model: ReviewModel): string {
  const s = model.diffScope;
  if (!s.includesUncommitted) return "";
  const u = s.uncommittedFiles.length;
  const t = s.untrackedFiles.length;
  const parts: string[] = [];
  if (u) parts.push(`${u} file${u === 1 ? "" : "s"} with uncommitted changes`);
  if (t) parts.push(`${t} untracked file${t === 1 ? "" : "s"}`);
  return `<div class="diff-scope-banner" role="note">⚠ This review includes ${parts.join(
    " + ",
  )} — not yet committed (relative to HEAD).</div>`;
}
```

Add the call site in `renderHtml` immediately after `</header>` (line 38) and before `<div class="layout">`:

```ts
</header>
${renderDiffScopeBanner(model)}

<div class="layout">
```

In `renderFile` (around line 1142), add a scope badge right after `${fileBadges(r)}`:

```ts
    ${fileBadges(r)}
    ${
      file.untracked
        ? `<span class="fbadge fbadge-uncommitted" title="new file, not yet committed">untracked</span>`
        : file.uncommitted
          ? `<span class="fbadge fbadge-uncommitted" title="has uncommitted changes (relative to HEAD)">uncommitted</span>`
          : ""
    }
```

Add CSS — find the `.badges`/`.badge` block (around line 1439) and add after it:

```css
.diff-scope-banner {
  margin: 0 auto 18px; max-width: var(--maxw, 1100px);
  padding: 10px 14px; border-radius: 8px;
  background: var(--warn-soft); color: var(--warn);
  border: 1px solid var(--warn); font-size: 14px;
}
.fbadge-uncommitted { background: var(--warn-soft); color: var(--warn); }
```

(If `--maxw` is not a defined token, drop the `max-width` line — confirm against the existing `.page-head`/layout width rule and match it.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/render.test.ts`
Expected: PASS — banner, counts, and badges present; clean render omits the banner.

- [ ] **Step 5: Build and full suite**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 6: Regenerate the sample for eyeballing**

Run: `npm run sample`
Expected: writes `sample-output.html` without error. (No assertion; this keeps the committed sample current.)

- [ ] **Step 7: Commit**

```bash
git add src/render.ts test/render.test.ts sample-output.html
git commit -m "feat: render an uncommitted-work banner and per-file scope badges

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Skill — worktree guidance

Teach the authoring skill how to review from a worktree, and fix the ambiguous "from the repo root" line.

**Files:**
- Modify: `src/skill.ts` (`SKILL_CONTENT`)
- Test: `test/skill.test.ts` (add a content assertion)

**Interfaces:**
- Consumes: nothing. `SKILL_CONTENT` round-trips byte-for-byte through install/uninstall; existing round-trip tests compare against the constant and stay valid.

- [ ] **Step 1: Write the failing content assertion**

In `test/skill.test.ts`, add at the end:

```ts
describe("SKILL_CONTENT worktree guidance", () => {
  it("explains reviewing from a worktree", () => {
    expect(SKILL_CONTENT).toContain("Reviewing from a worktree");
  });
  it("says uncommitted and untracked work is folded in automatically", () => {
    expect(SKILL_CONTENT.toLowerCase()).toContain("untracked");
    expect(SKILL_CONTENT).toMatch(/don't need to commit|no need to commit|folded in/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/skill.test.ts`
Expected: FAIL — "Reviewing from a worktree" not present.

- [ ] **Step 3: Add the worktree subsection and tighten the run line**

In `src/skill.ts`, in `SKILL_CONTENT`, add a new subsection immediately before the `## After writing it` section:

```
### Reviewing from a worktree

If you did the work in a git worktree (common for agent-driven changes), a few
things matter:

- **Run \`review-intent\` from the worktree's own root.** It keys everything off
  the current directory — the diff it produces, the artifact it reads, and the
  repo scans for reach and complexity. Running it from the main checkout reviews
  the wrong tree.
- **You don't need to commit first.** If the working tree is dirty, review-intent
  folds your uncommitted *and* untracked changes into the diff automatically and
  flags those files (a banner up top, an \`uncommitted\`/\`untracked\` badge per
  file). What you ultimately hand off for *merge* is still the committed history —
  the badges make the difference visible so the reviewer is never misled.
- **The base resolves automatically.** \`main\`/\`master\` are shared across linked
  worktrees, so they resolve from inside a worktree with no extra flags. Pass
  \`--base <ref>\` if your worktree forked from a different branch.
```

Then change the existing run instruction (currently "run `review-intent` via Bash from the repo root") in the `## After writing it` section to:

```
If the user accepts, run \`review-intent\` via Bash from the root of the working
tree you made the changes in (the worktree root, if you used one). It diffs the
current branch against main and opens the rendered page in the browser.
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/skill.test.ts`
Expected: PASS — including the existing round-trip/install tests (they compare against the updated constant).

- [ ] **Step 5: Build and full suite**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/skill.ts test/skill.test.ts
git commit -m "docs: teach the authoring skill to review from a worktree

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Auto-detect dirty tree → Task 2 (`getDiff` dirtiness branch). ✓
- Combined `git diff <mergeBase>` + per-file `--no-index` → Task 2. ✓
- Untracked via `--no-index`, `.gitignore`-respecting via `git status --porcelain` (which omits ignored files by default) → Task 2. ✓
- `DiffScope` type + model/file fields → Task 1. ✓
- File-level flags in `match.ts` (pure) → Task 1. ✓
- Banner + per-file badges in `render.ts` (pure) → Task 4. ✓
- Skill worktree guidance + "from the repo root" fix → Task 5. ✓
- Tests: match flags (Task 1), pure status parse (Task 2), `--no-index` parse fixture (Task 3), render banner/badges (Task 4), skill content (Task 5); `git.ts` runners untested per convention. ✓
- Three flagged risks: `--no-index` exit 1 (Task 2 `gitDiffNoIndex`), path-prefix normalization (Task 3 fixture — verified clean), porcelain path normalization incl. rename/quote (Task 2 `parseGitStatus` + tests). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The one conditional ("if `--maxw` is not a token, drop the line") is an explicit, bounded instruction with a concrete fallback, not a placeholder.

**Type consistency:** `DiffScope` shape, `getDiff` return `{ text, scope }`, `buildReviewModel` 7-arg signature, and `AnnotatedFile.uncommitted/untracked` are used identically across Tasks 1, 2, and 4. `parseGitStatus` return shape matches its consumer in `getDiff`.
