# Reviewer Questions — Design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Branch (intended):** a feature branch for this work

## Problem

The rendered `review.html` lets a reviewer leave **comments** (💬) on any hunk or
file; those comments assemble into a single copy-paste prompt addressed to the
change-making agent (reviewer → agent). But a comment and an **open question** are
different speech acts: "simplify this" is an instruction; "should the timeout stay
30s?" is an unresolved decision that *blocks* sign-off until the agent answers.
Today both collapse into one undifferentiated comment stream, and the comment
affordance itself (a tiny bare 💬) is easy to miss.

This is especially valuable for agent-generated code, where the reviewer's main job
is interrogating decisions the agent made silently.

## Goal

Let a reviewer mark feedback as either a **comment** or a **question**, with both
kinds flowing into the copy-to-agent prompt — questions surfaced first, in their own
section, because they are the blocking decisions. Make the comment affordance more
visible in the process.

Explicitly **reviewer → agent** (a reviewer-side, client-side feature). This is
distinct from comments only in *kind*, not in direction.

## Non-goals (YAGNI)

- No agent-authored `reviewQuestions` field in `.review/intent.json`. (Considered and
  cut — the value the user wants is the reviewer posing questions, not the agent.)
- No interaction with the completeness gate. Questions are reviewer state, never part
  of intent coverage.
- No threading, no per-question resolved/unresolved toggle. A question is text in a
  box, like a comment.

## Approach

Generalize the existing single-kind comment system into a two-kind **reviewer
annotation** system. Reuse the comment machinery (markup shell, localStorage
persistence, prompt assembly, copy) rather than building a parallel one — the two
kinds differ only by a `data-akind` attribute and how they group in the output.

This keeps `render.ts` the single home for all rendering and preserves its **pure,
deterministic** `ReviewModel -> string` contract: everything added is a static
string (markup + CSS + one generalized script), no `Date`/random, so the existing
markup-assertion tests still apply.

## Components (all in `src/render.ts`)

### 1. Annotation affordance — generalize `commentBox()`

Today `commentBox(cid, ref, kind, hdr)` emits one `.cbox` with a 💬 `.cbtn` and one
`.cinput` textarea. Generalize it to emit **two** labeled controls side by side:

- **`💬 Comment`** button → comment textarea (`data-akind="comment"`)
- **`❓ Ask`** button → question textarea (`data-akind="question"`)

Both textareas keep the `.cinput` class (so the one script still selects them) and
carry the existing `data-ref` / `data-hdr`. Comment cids stay **exactly as they are
today** (`file-<i>-hunk-<j>`, the file slug, `__page__`) so already-saved comments
load unchanged; question cids are namespaced with a `q:` prefix so the two kinds
never collide in the flat store:

- comment cid: `<base-cid>` (unchanged)
- question cid: `q:<base-cid>`

Placement is unchanged: each hunk, each file, and the page-level panel.

### 2. Visibility + visual distinction (CSS)

- Replace the tiny bare-emoji `.cbtn` with always-visible **labeled pills** carrying
  text (`💬 Comment`, `❓ Ask`). This is the "make the comment button more visible"
  requirement.
- The question control gets a distinct accent and a `.has-question` filled-dot
  marker, mirroring the existing `.has-comment` dot, so a box with an unsent question
  reads differently from one with a comment.

### 3. Persistence — keep the existing store

Keep the existing localStorage key `review-intent:comments:<title>@<base>` (so any
saved comments survive). The store is a flat `{ cid: text }` map; comment cids are
untouched and question cids carry the `q:` prefix, so the two kinds stay separate
within it. No schema/version change.

### 4. Prompt assembly — two sections, questions first

Generalize `assemble()` to walk the same DOM (files in review order → file box →
hunk boxes → page-level) but bucket each non-empty textarea by its `data-akind`.
Emit two top-level sections, **questions first**, each grouped by file → hunk ref
exactly as comments are today:

```
Review feedback on "<title>" (<base>...HEAD).
Sign-off: 2 / 5 files reviewed. 1 question, 1 comment below.

# Questions (please answer)
## src/http.ts
### src/http.ts:42  (@@ -40,6 +40,8 @@)
- Should the timeout stay 30s?

# Comments
## src/cache.ts
- simplify this
```

Rules:
- A section is omitted entirely when it has no items (no empty `# Questions`).
- The header count line reports both: `X question(s), Y comment(s) below` (or
  `No feedback yet.` when both are zero, leaving the output empty as today).
- The `.fb-summary` line becomes `N / M files reviewed · X questions · Y comments`.
- Page-level feedback gains an "Overall question" textarea beside the existing
  "Overall comment"; both land under a `## General` group in their respective
  section.

### 5. Copy

Unchanged — the existing `navigator.clipboard` + `execCommand` fallback copies the
assembled `.fb-output` value. The output simply now contains both sections.

## Data flow

```
reviewer types in a 💬 or ❓ box
  → input listener writes store[c|q:cid] and persists to localStorage
  → assemble() re-buckets all .cinput by data-akind, rebuilds .fb-output
  → "Copy as prompt" copies .fb-output (questions section first, then comments)
  → reviewer pastes back to the change-making agent
```

## Error / edge handling

- Empty boxes contribute nothing; whitespace-only is trimmed (existing `clean()`).
- Zero files → feedback panel is not rendered (existing guard), so neither kind
  appears; unchanged.
- `file://` clipboard flakiness is already covered by the dual copy path; reused.

## Testing (`test/render.test.ts`)

Mirror the existing comment assertions on the emitted markup:

1. Every hunk and every file emits a question button + a `data-akind="question"`
   textarea with a `q:`-prefixed cid and a precise `path:line` ref.
2. The feedback panel renders an "Overall question" textarea.
3. The assembled-prompt script contains the `# Questions (please answer)` and
   `# Comments` section headers and buckets by `data-akind`.
4. The existing comment assertions still pass unchanged (comment cids are not
   re-prefixed).

## Docs

Update the README "Comment straight back to the agent" section to "Comment **and
question** the agent" — describe the two kinds and that questions are emitted first
in the copied prompt. No skill change (this never touches `intent.json`).

## Invariants preserved

- `render.ts` stays pure and deterministic.
- Nothing is silently dropped — every non-empty box appears in the prompt.
- Reviewer (claimed/feedback) state stays separate from measured data.
