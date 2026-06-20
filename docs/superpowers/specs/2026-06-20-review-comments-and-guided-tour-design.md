# Review comments + guided tour — design

Date: 2026-06-20
Status: approved (design), pending implementation

## Summary

Two reviewer-side enhancements to the rendered `review.html`:

1. **Review comments + sign-off** — a reviewer can attach a comment to any diff
   hunk, any changed file, and the review as a whole. All comments are gathered
   in a panel at the bottom of the page and assembled into a single
   **agent-addressed markdown prompt** that the reviewer copies and feeds back to
   the change-making agent as the next instruction. Sign-off reuses the existing
   per-file "viewed" checkboxes; no new verdict concept.
2. **Guided tour** — a numbered prev/next walkthrough that steps through the
   changed-file sections in the existing `reviewOrder` ranking (most blast-radius
   first), scrolling to and expanding each file in turn.

Both are pure client-side additions: extra markup, CSS, and inline `<script>`
blocks emitted by `render.ts`. No backend, no API, no new dependency.

## Design invariants preserved

- **Purity boundary.** `render.ts` stays a pure, deterministic `ReviewModel ->
  string` function. The new state (comment text, tour position) lives in the
  browser at runtime — comment text in `localStorage`, tour position in memory —
  exactly like the existing `viewed` and `pinned` enhancements. No `Date`, no
  random, no I/O at render time.
- **Never silently drop.** Every non-empty comment appears in the assembled
  output; nothing is truncated. The tour visits every ranked file.
- **Claimed vs measured.** Untouched. Comments are a new reviewer-authored layer,
  orthogonal to the agent's claims and the CLI's measurements.
- **No untrusted HTML.** Comment text is only ever assigned to `textarea.value`
  (never `innerHTML`), so reviewer input cannot inject markup.

## A. Comments

### Anchoring & identity

Each comment has a stable, deterministic id used as its `localStorage` key, and a
human-readable location reference used in the assembled prompt. `render.ts`
already assigns each file a stable `slug = file-${index}` (index = position in
`model.files`, robust to duplicate paths). Comments key off the same index.

| Scope | Comment id (`data-cid`) | Reference (`data-ref`) | Extra |
|-------|-------------------------|------------------------|-------|
| Hunk  | `file-${index}-hunk-${j}` | `path:newStart-newEnd` (or `path:newStart` if equal) | `data-hdr` = the `@@` header |
| File  | `file-${index}`          | `path`                 | — |
| Page  | `__page__`               | — (rendered as "General") | — |

`DiffHunk` already carries `newStart`/`newEnd`, so the hunk reference is exact.

### UI

- **Hunk comment** lives at the bottom of the hunk's existing `.hunk-notes`
  aside (the intent column) — reviewer's note sits beside the agent's intent.
- **File comment** lives in the file body, just after the file-intent block.
- **Page comment** lives in the feedback panel (below).

Each is a `.cbox` containing a small `💬` toggle button (`.cbtn`) and a hidden
`textarea.cinput`. Clicking the toggle reveals and focuses the textarea. A box
with non-empty text gets a `has-comment` class (shows a filled dot) so commented
spots are visible even when a file is collapsed. A box with stored text starts
revealed on load.

### Persistence

One new `localStorage` key, mirroring the viewed/pinned pattern:
`review-intent:comments:${title}@${base}` → `{ [cid]: text }`. The key string is
JSON-encoded with the existing `</` → `<\/` guard. On `input`, trimmed-empty
text deletes its entry; otherwise the raw value is stored.

## B. Gathered feedback panel

A `<section class="review-feedback" id="feedback">` rendered after the
`filesWithoutChanges` block (bottom of the content column), containing:

1. The page-level (`__page__`) comment textarea.
2. A **live, readonly** `textarea.fb-output` re-assembled on every comment change.
   Chosen over generate-on-click so the reviewer can read/edit the prompt and so
   copy works even where the async clipboard API is blocked (`file://`).
3. A summary line (`.fb-summary`): `N / M files reviewed · K comment(s)`.
4. A **Copy as prompt** button (`.fb-copy`): tries `navigator.clipboard.write
   Text`, falls back to selecting the textarea + `execCommand("copy")`. Shows a
   transient "Copied!".

### Assembled prompt format (agent-addressed markdown)

```
Review feedback on "<title>" (<base>...HEAD).
Sign-off: <done> / <total> files reviewed. Address each item below.

## <file path>
- <file-level comment>
### <path:range>  (<@@ header>)
- <hunk comment>

## General
- <page-level comment>
```

- Files are walked in DOM order (= review order, since `main` renders ranked).
- Empty comments are omitted; a file with no comments emits no heading.
- The output textarea is empty when there are no comments at all.
- Newlines inside a comment are preserved (indented under the bullet).

## C. Guided tour

`render.ts` injects the ranked tour order — `[{slug, path}, ...]` from
`reviewOrder(model)` — into the tour script (so the tour is driven by the same
deterministic ranking the page already shows, and tests can assert the array).

- A **Guided review** button (`.tb-tour`) in the sticky topbar starts the tour.
- A fixed pill control (`#tour`, hidden until started) shows
  `Reviewing <cur> of <total> — <path>` with **‹ Prev**, **Next ›**, **Exit**.
- Prev/Next set the current index, force-open the target file `<details>`,
  `scrollIntoView({behavior:"smooth", block:"start"})`, and apply a transient
  `tour-flash` highlight class. Prev disabled at the first, Next at the last.
- Keyboard: ←/→ navigate, Esc exits (only while touring).
- The tour does **not** auto-toggle `viewed` — tour navigation and sign-off stay
  separate, unsurprising concerns.

## D. Code changes

- `src/render.ts`
  - `renderHunk(hunk, fileIndex, hunkIndex, path)` — thread file index + path so
    it can emit the hunk `.cbox` with the right `data-cid`/`data-ref`/`data-hdr`.
    Update the call site in `renderFile` to pass `(h, r.index, j, file.path)`.
  - `renderFile` — emit the file-level `.cbox` after the file-intent block.
  - New `renderFeedbackPanel(model)` — the bottom panel; add to the content column.
  - New `commentBox(cid, ref, kind, hdr?)` helper for the shared markup.
  - Topbar — add the `.tb-tour` button; add the `#tour` pill markup (near LIGHTBOX).
  - New `commentScript(model)` and `tourScript(model, ranked)`; wire both into the
    document next to `viewedScript`/`pinScript`.
  - CSS — append a block for `.cbox`/`.cbtn`/`.cinput`, `.review-feedback`,
    `.tour`, and `.tour-flash`.
- `src/review-order.ts` — reused unchanged for the tour order.
- `test/render.test.ts` — new assertions (below).

## E. Testing

`render.ts` stays pure, so all of this is asserted on the emitted markup string,
per the existing convention:

- Every hunk emits a `.cbox[data-ckind="hunk"]` whose `.cinput` has a `data-cid`
  of `file-${i}-hunk-${j}` and a `data-ref` of `path:range`.
- Every changed file emits a file-level `.cbox[data-ckind="file"]`.
- The feedback panel renders with the `__page__` cinput, `.fb-output`, `.fb-copy`.
- The tour control (`#tour`) and the topbar `.tb-tour` button render.
- The injected tour-order array matches `reviewOrder(model)` slugs and paths, in
  order.
- The comment and tour scripts embed the deterministic storage key / order.

## Out of scope (YAGNI)

- Per-risk adjudication toggles and an overall approve/request-changes verdict
  (deferred; sign-off = viewed only).
- Quoting full hunk source in the prompt (the `path:range` + `@@` header is the
  precise reference; the agent can open the lines).
- Server-side persistence or sharing of comments.
