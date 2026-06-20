# Visual themes + in-page theme switcher — design

## Goal

Let the reader of a `review.html` page switch its visual style on the fly via a
small cogwheel in the top-right corner. Ship a catalog of themes in every page;
the **current "warm paper" light theme remains the default** and the rendered
output is byte-identical to today when no theme is selected.

## Scope

- **In-page switcher** (decided). Every theme ships inside each `review.html`;
  the reader toggles live, no rebuild. Choice persists in `localStorage`.
- **13 themes total:**
  - `paper` — current default (warm paper light). Stays in `:root`.
  - **Dev favorites:** `solarized-light`, `solarized-dark`, `nord`, `gruvbox`,
    `catppuccin`
  - **Professional:** `github`, `high-contrast`, `blueprint`
  - **Editorial:** `newsprint`, `sepia`
  - **Playful:** `dark`, `hacker`, `synthwave`

  (Final grouping/labels are presentational and may be tuned during
  implementation; the set above is the target.)

## Non-goals

- Build-time theme selection / CLI `--theme` flag. (Switcher only.)
- Per-block or per-component theming. One theme applies to the whole page.
- Honoring `prefers-color-scheme` automatically. Default is always `paper`
  unless the reader chose otherwise. (Could be a later enhancement.)

## Architecture

### New module: `themes.ts` (pure data + pure CSS emitter)

```ts
export interface Theme {
  id: string;                      // "nord"  — used as [data-theme] value + storage value
  label: string;                   // "Nord"  — shown in the menu
  group: string;                   // "Dev favorites" — menu section heading
  tokens: Record<string, string>;  // CSS custom-property overrides
}

export const THEMES: Theme[];      // ordered; first conceptual entry is `paper`
export function themeCss(): string;// emits the `[data-theme="x"]{ --tok: val; … }` blocks
```

- `paper` is the default and lives in `:root` (already present in `render.ts`
  `CSS`). It is represented in `THEMES` for the menu, but emits **no** override
  block — selecting it just clears `data-theme`.
- Every other theme emits `[data-theme="<id>"] { …token overrides… }`.
- `themeCss()` output is appended to the existing `CSS` string in `render.ts`.
- Pure: static strings only, no `Date`/random. Deterministic.

### Tokenize hard-coded colors (prerequisite work)

`render.ts` currently has ~49 hex/rgba literals. Those already in `:root` are
fine. The ones that must move into semantic tokens so themes can recolor them:

- Tone-badge borders: `#eccac4` (danger), `#e6d8a8` (warn), `#cfdcef` (info),
  `#c7e2cd` (ok) → `--del-border`, `--warn-border`, `--accent-border`,
  `--add-border`.
- Visual-summary legend/zone swatches (e.g. `rgba(189,58,46,.09)`,
  hover shadow `rgba(47,93,156,.1)`) → tokens.
- Inline-SVG chart fills/strokes in `renderVisuals` (diff-mass bars, treemap,
  coverage rings, reach ripple, per-file change map) → a small set of chart
  tokens (e.g. `--viz-add`, `--viz-del`, `--viz-zone`, `--viz-grid`, series
  colors as needed).

**Audit step:** enumerate every color literal in `render.ts`, classify as
"structural/theme-relevant" vs "intentionally fixed", and replace the former
with `var(--token)`. The default token values reproduce today's exact colors,
so `paper` output is unchanged.

### Cogwheel UI (in `renderTopbar`)

- Add a `⚙` button to the existing `.topbar` (top-right), after `↑ Top`.
- Clicking opens a small popover menu listing themes grouped by `group`, with the
  active one marked.
- Selecting a theme:
  - `paper` → remove `data-theme` from `<html>`.
  - other → `document.documentElement.dataset.theme = id`.
  - persist the chosen id to `localStorage` (new key, e.g. `ri-theme`).
- Built from `THEMES` so markup and menu never drift from the catalog.

### No flash of wrong theme (FOUC)

A tiny inline `<script>` at the very top of `<body>` reads the saved id from
`localStorage` and sets `document.documentElement.dataset.theme` before the body
paints. Restores the reader's last choice on load.

### Client JS

The switcher JS is a static string emitted by `render.ts` (or a `themes.ts`
helper), following the existing inline-`<script>` + `localStorage` pattern used
for rail pinning, comment boxes, and the tour. Wrapped in `try/catch` like the
others so a storage failure never breaks the page.

## Design invariants preserved

- **Purity boundary.** `themes.ts` and `render.ts` stay pure — static CSS/JS
  strings, no I/O, no `Date`/random. Side effects remain only in the existing
  effectful modules.
- **Default unchanged.** With no/unknown `data-theme`, the page renders exactly
  as today (`paper` in `:root`, default token values reproduce current colors).
- **Self-contained output.** All themes + switcher ship inline in one
  `review.html`. No external assets.

## Testing

- `themes.test.ts` (new): every `Theme` defines a complete, non-empty token set;
  ids are unique and DOM-safe; `themeCss()` emits one `[data-theme="<id>"]`
  block per non-default theme and none for `paper`.
- `render.test.ts` (update): assert the cogwheel button is present in the
  topbar, the theme `<style>` blocks are present, and the FOUC/switcher scripts
  are emitted. Update any assertions that pinned now-tokenized literal colors.

## Risks / open questions

- **Bulk of the risk is the tokenize step**, not the palettes — chart SVGs are
  the fiddly part. If a chart color is genuinely meant to be fixed regardless of
  theme, leave it literal and note why.
- Some themes (e.g. `high-contrast`, `synthwave`) may need per-theme tweaks to
  diagram/chart tokens beyond the base palette to stay legible; budget for a
  legibility pass per theme.
- Mermaid diagrams render via their own script; theming the mermaid blocks to
  match (light/dark) is a possible follow-up, not required for v1.
