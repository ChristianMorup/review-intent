# Worktree / Uncommitted-Work Review — Design

**Date:** 2026-06-22
**Status:** Approved (pending spec review)
**Branch (intended):** a feature branch for this work

## Problem

`review-intent` renders `git diff <base>...HEAD` — committed history only. The
authoring skill (`SKILL_CONTENT` in `skill.ts`) says nothing about how to use the
tool from a **git worktree**, which is the common shape of agent-driven work: the
agent does its changes in a linked worktree on a feature branch, then wants the
review.

Two things bite, and the second is the real one:

1. **cwd ambiguity.** Everything keys off `process.cwd()` — the diff target, the
   artifact load, the reach/complexity repo scans. In a worktree there are two
   roots; the tool must run from the *worktree* root. The skill currently says
   "from the repo root," which is ambiguous.

2. **Uncommitted work is silently dropped.** `base...HEAD` is committed-only
   (`merge-base(base,HEAD)..HEAD`). In worktree-based agent flows the work is
   frequently still uncommitted/untracked when the review is requested, so the
   page is empty or stale — with no warning. That directly violates this repo's
   **"Never silently drop or truncate"** invariant; the dropped thing here is the
   entire uncommitted change set.

## Goal

When the working tree is dirty, fold uncommitted **and** untracked work into the
rendered diff automatically, and flag — at the **file level** — which files carry
uncommitted/untracked content so the reviewer always knows whether what they're
reviewing is actually committed. Update the authoring skill to cover worktree use.

## Non-goals (YAGNI)

- **No per-line "uncommitted" marking.** The dirty-tree command produces one
  combined diff (fork point → working tree); committed and uncommitted edits to a
  file interleave in the same hunks and git can't separate them there. Per-line
  marking would require computing `base...HEAD` and `HEAD..worktree` separately
  and reconciling per hunk — cut. File-level flagging answers the reviewer's real
  question ("is this committed?") without that complexity.
- **No opt-in flag.** Behavior is auto-detected from repo state: clean tree →
  unchanged; dirty tree → fold in + flag. (An explicit flag was considered and
  cut — auto-detect is lower friction for the agent loop and the loud banner keeps
  it honest.)
- **No worktree detection.** The change is keyed on working-tree dirtiness, not on
  "is this a worktree." It therefore helps any dirty checkout, not just worktrees;
  worktrees are simply where it matters most.
- **No ignored files.** Untracked discovery uses `--exclude-standard`, so
  `.gitignore`d files never appear.

## Approach

Make `getDiff` state-aware. It computes the fork point once
(`git merge-base <base> HEAD`) and checks dirtiness (`git status --porcelain`):

- **Clean tree** → `git diff <mergeBase> HEAD`. Byte-identical to today's
  `base...HEAD`, so existing behavior is untouched.
- **Dirty tree** → assemble one unified-diff string from:
  - `git diff <mergeBase>` — committed **and** uncommitted *tracked* changes
    relative to the fork point (a superset of `...HEAD`).
  - one `git diff --no-index -- /dev/null <file>` block per untracked-not-ignored
    file (`git ls-files --others --exclude-standard`), concatenated on.

The result is still a single unified-diff string handed to `diff-parser`. **The
parser, scorecard, reach, complexity, match, and render stages are unchanged in
shape** — they just receive a more complete diff, plus one new plain-data
descriptor (`DiffScope`) for the file-level flags and banner.

The purity boundary is preserved: all git invocation stays in `git.ts`; `match.ts`
and `render.ts` receive `DiffScope` as plain data and remain pure/deterministic.

## Components

### 1. `git.ts` — state-aware diff + scope (side-effecting)

- Compute `mergeBase = git merge-base <base> HEAD`.
- `git status --porcelain` once → classify changed paths into tracked-dirty and
  untracked. Renamed entries (`R old -> new`) take the new path.
- Clean → `git diff <mergeBase> HEAD`. Dirty → `git diff <mergeBase>` plus the
  per-untracked-file `--no-index` blocks.
- `getDiff` returns `{ text: string; scope: DiffScope }` instead of a bare string
  (cli.ts is its only caller).

**Known implementation risks (carried into the plan):**

- `git diff --no-index` implies `--exit-code`: it returns **exit code 1** when the
  files differ. The current `git()` helper throws on any non-zero exit, so this one
  call needs a variant that treats exit 1 as success (and still surfaces real
  errors, exit ≥ 2).
- `--no-index` emits different path prefixes (e.g. `a/dev/null b/<file>`). Verify
  the emitted header normalizes so `diff-parser` extracts the repo-relative `path`
  matching the rest of the diff; covered by a fixture test.
- `git status --porcelain` paths must normalize to the same posix, repo-relative
  form as `DiffFile.path` so `match.ts` can match them. Quoted paths (spaces /
  non-ASCII, `core.quotePath`) need unquoting.

### 2. `types.ts` — the descriptor and flags

```ts
export interface DiffScope {
  /** True when the rendered diff includes uncommitted working-tree changes. */
  includesUncommitted: boolean;
  /** Tracked files with staged/unstaged changes folded in (posix, repo-relative). */
  uncommittedFiles: string[];
  /** Untracked-not-ignored files folded in via --no-index (posix, repo-relative). */
  untrackedFiles: string[];
}
```

- `ReviewModel` gains `diffScope: DiffScope`.
- `AnnotatedFile` gains optional `uncommitted?: boolean` and `untracked?: boolean`.

### 3. `match.ts` — set per-file flags (stays pure)

`buildReviewModel` takes `diffScope` as a new parameter, stores it on the model,
and sets each `AnnotatedFile`'s `uncommitted` / `untracked` flag by membership in
the scope's path arrays. No I/O.

### 4. `render.ts` — banner + badges (stays pure)

- When `diffScope.includesUncommitted`, emit a top **banner** with counts, e.g.
  "Includes 3 files with uncommitted changes + 2 untracked files — not yet
  committed." (Uncommitted is relative to HEAD, not to base.) Absent entirely
  when clean.
- Per file, emit an `uncommitted` or `untracked (new, not yet committed)` badge,
  reusing existing badge styling. Static strings only — no `Date`/random.

### 5. `cli.ts` — wire it

Destructure `{ text, scope }` from `getDiff`; pass `scope` into
`buildReviewModel`. No other change.

### 6. `skill.ts` — worktree guidance

Add a short **"Reviewing from a worktree"** subsection to `SKILL_CONTENT` and
tighten the existing "from the repo root" line:

- Run `review-intent` from the **worktree's own root** — cwd determines the diff
  target, the artifact, and the reach/complexity scans.
- No need to commit first: a dirty tree's uncommitted + untracked work is folded
  in automatically and flagged in the render. What you hand off for *merge* is
  still the committed history; the badges make the difference visible.
- `main`/`master` resolve automatically across linked worktrees; pass `--base` if
  the worktree forked from a different branch.

(`skill.ts` round-trips `SKILL_CONTENT` byte-for-byte through install/uninstall;
editing the constant is the only change needed — no test churn beyond it.)

## Testing

- `match.test.ts` — per-file `uncommitted` / `untracked` flags set correctly from a
  given `DiffScope`; `diffScope` stored on the model.
- `render.test.ts` — banner renders with counts when `includesUncommitted`; absent
  when clean; per-file badges present for flagged files.
- `diff-parser.test.ts` — a fixture of `--no-index` untracked-file output parses to
  the correct repo-relative `path` (the prefix-normalization risk).
- `git.ts` stays untested per the repo's convention (side-effecting module).

## Design invariants honored

- **Never silently drop.** The whole point: uncommitted/untracked work is folded in
  and flagged rather than dropped. Untracked discovery is visible in the banner.
- **Purity boundary.** All git calls stay in `git.ts`; `match.ts`/`render.ts` take
  `DiffScope` as plain data and stay pure/deterministic.
- **Claimed vs. measured.** The dirty-tree banner and badges are measured,
  CLI-computed facts shown next to the author's claims — never overridable by the
  artifact.
