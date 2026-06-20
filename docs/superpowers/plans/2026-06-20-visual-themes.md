# Visual Themes + In-Page Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a catalog of 13 visual themes inside every `review.html`, switchable live via a cogwheel in the top-right corner, with the current warm-paper theme as the unchanged default.

**Architecture:** A new pure `themes.ts` module holds theme data (a `makeTheme` helper expands ~16 core palette values into the full token set) and a `themeCss()` emitter. `render.ts` is first refactored to drive every theme-relevant color from a CSS custom property (tokenize step), then consumes `themeCss()`, renders a cogwheel menu built from the theme catalog, and emits an inline switcher script (same `localStorage` + `<script>` pattern already used for rail pinning / comments / tour). The default `paper` theme stays in `:root` with its exact current literal values, so default output is byte-identical.

**Tech Stack:** ESM TypeScript (NodeNext, `.js` import extensions), Vitest, no runtime deps. Pure-module unit tests, one file per source module.

---

## File Structure

- **Create** `src/themes.ts` — `Theme` interface, `TOKEN_KEYS`, `makeTheme()`, `THEMES`, `themeCss()`. Pure data + pure string emitter.
- **Create** `test/themes.test.ts` — completeness/uniqueness of catalog, `themeCss()` shape.
- **Modify** `src/render.ts` — (a) add new tokens to `:root` + replace literals/JS color constants with `var(--token)`; (b) append `themeCss()` to `CSS`; (c) add cogwheel + menu in `renderTopbar`; (d) emit FOUC + switcher scripts.
- **Modify** `test/render.test.ts` — update color-literal assertions; add cogwheel/menu/script assertions.

### Canonical token contract (the full set every theme defines)

`:root` already defines the **core** tokens. This plan adds **derived** and **viz** tokens to `:root` (Task 1) and has `makeTheme` produce all of them for other themes (Task 2).

```
core:    --paper --surface --surface-2 --ink --ink-soft --muted --line --line-2
         --accent --accent-soft --add --add-soft --del --del-soft --warn --warn-soft
derived: --add-border --del-border --warn-border --accent-border --accent-shadow
         --on-accent --glass --code-add --code-del
viz:     --viz-add --viz-add-ink --viz-del --viz-del-ink --viz-warn --viz-accent
         --viz-line --viz-node --viz-node-stroke --viz-accent-stroke --viz-noise
         --viz-other --viz-cell-label --viz-zone --kind-e2e
         --viz-s1 --viz-s2 --viz-s3 --viz-s4 --viz-s5 --viz-s6 --viz-s7 --viz-s8
fonts:   --mono --sans  (overridable per theme; default to current stacks)
```

**Intentionally left fixed** (NOT tokenized — dark scrim/shadows read fine on any background): `rgba(33,31,27,.5)` (modal scrim, line ~1534), `rgba(33,31,27,.22)` (line ~1540), `rgba(33,31,27,.18)` (line ~1769). Leave these literals in place.

---

## Task 1: Tokenize render.ts (no visual change to default)

Pull every theme-relevant color literal into a CSS custom property. Default (`paper`) output stays byte-identical because each new token's default value equals the literal it replaces.

**Files:**
- Modify: `src/render.ts`
- Test: `test/render.test.ts`

- [ ] **Step 1: Extend `:root` with the derived + viz tokens**

In `src/render.ts`, in the `CSS` template (the `:root { … }` block, currently ending at the `--maxw: 1080px;` line ~1228), add these lines just before the closing `}` of `:root`:

```css
  /* derived (were hard-coded literals; defaults reproduce paper exactly) */
  --add-border: #c7e2cd; --del-border: #eccac4;
  --warn-border: #e6d8a8; --accent-border: #cfdcef;
  --accent-shadow: rgba(47,93,156,.1);
  --on-accent: #fff;
  --glass: rgba(255,253,249,.9);
  --code-add: #115c2c; --code-del: #952c22;
  /* visual-summary chart palette */
  --viz-add: #1f9d4d; --viz-add-ink: #137a36;
  --viz-del: #dd574d; --viz-del-ink: #c0362c;
  --viz-warn: #c79100; --viz-accent: #2f5d9c; --viz-line: #e3ded3;
  --viz-node: #ffffff; --viz-node-stroke: #b8b1a4; --viz-accent-stroke: #21456f;
  --viz-noise: #9b958a; --viz-other: #7e776c;
  --viz-cell-label: #23211d; --viz-zone: rgba(189, 58, 46, 0.09);
  --kind-e2e: #7a4fa0;
  --viz-s1: #5b7db1; --viz-s2: #5fa389; --viz-s3: #b08a5a; --viz-s4: #a07ba6;
  --viz-s5: #c47d72; --viz-s6: #7fa86a; --viz-s7: #d0a85a; --viz-s8: #7a93b8;
```

- [ ] **Step 2: Replace the CSS literals with `var(...)`**

In the `CSS` template, make these exact substitutions (the rule selectors are unchanged; only the color value changes):

| Line (approx) | Rule | Change |
|---|---|---|
| 1341 | `.tone-danger` | `border-color: #eccac4` → `border-color: var(--del-border)` |
| 1342 | `.tone-warn` | `border-color: #e6d8a8` → `border-color: var(--warn-border)` |
| 1343 | `.tone-info` | `border-color: #cfdcef` → `border-color: var(--accent-border)` |
| 1344 | `.tone-ok` | `border-color: #c7e2cd` → `border-color: var(--add-border)` |
| 1374 | `.zoomable:hover` | `rgba(47,93,156,.1)` → `var(--accent-shadow)` |
| 1386 | `.viz-cell-label` | `fill: #23211d` → `fill: var(--viz-cell-label)` |
| 1391 | `.viz-danger` | `fill: rgba(189, 58, 46, 0.09)` → `fill: var(--viz-zone)` |
| 1401 | `.viz-lg-zone` | `background: rgba(189, 58, 46, 0.09)` → `background: var(--viz-zone)`; `border: 1px solid #eccac4` → `border: 1px solid var(--del-border)` |
| 1484 | `.ln-add .code` | `color: #115c2c` → `color: var(--code-add)` |
| 1487 | `.ln-del .code` | `color: #952c22` → `color: var(--code-del)` |
| 1505 | (orphan box) | `border: 1px solid #eccac4` → `border: 1px solid var(--del-border)` |
| 1564 | (glass bg) | `rgba(255,253,249,.9)` → `var(--glass)` |
| 1586 | `.rf-card:hover` | `rgba(47,93,156,.1)` → `var(--accent-shadow)` |
| 1637 | `.fbadge-hot` | `border-color: #eccac4` → `border-color: var(--del-border)` |
| 1638 | `.fbadge-gap` | `border-color: #e6d8a8` → `border-color: var(--warn-border)` |
| 1753 | (button) | `color: #fff` → `color: var(--on-accent)` |
| 1762 | (chip) | `border: 1px solid #cfdcef` → `border: 1px solid var(--accent-border)` |

Leave the three `rgba(33,31,27,…)` literals (scrim/shadows, ~1534/1540/1769) untouched.

- [ ] **Step 3: Replace the JS color constants with `var(...)` strings**

These constants feed inline-SVG `fill`/`stroke` attributes; SVG resolves `var()` against the document's custom properties, so swapping the hex for a `var()` reference is sufficient.

In `src/render.ts` lines ~441-459, replace:

```ts
const C_ADD = "var(--viz-add)";
const C_ADD_INK = "var(--viz-add-ink)";
const C_DEL = "var(--viz-del)";
const C_DEL_INK = "var(--viz-del-ink)";
const C_WARN = "var(--viz-warn)";
const C_ACCENT = "var(--viz-accent)";
const C_LINE = "var(--viz-line)";

const CAT_COLOR: Record<FileCategory, string> = {
  test: "var(--viz-add-ink)",
  code: "var(--viz-accent)",
  noise: "var(--viz-noise)",
  other: "var(--viz-other)",
};

const DIR_PALETTE = [
  "var(--viz-s1)", "var(--viz-s2)", "var(--viz-s3)", "var(--viz-s4)",
  "var(--viz-s5)", "var(--viz-s6)", "var(--viz-s7)", "var(--viz-s8)",
];
```

In `rippleNode` (lines ~415-416), replace:

```ts
  const fill = isChanged ? C_ACCENT : "var(--viz-node)";
  const stroke = isChanged ? "var(--viz-accent-stroke)" : "var(--viz-node-stroke)";
```

At line ~568, replace `const stroke = r.hasIntent ? "#ffffff" : C_DEL_INK;` with:

```ts
      const stroke = r.hasIntent ? "var(--viz-node)" : C_DEL_INK;
```

In `KIND_COLOR` / `kindColor` (lines ~902-908), replace:

```ts
const KIND_COLOR: Record<string, string> = {
  unit: C_ADD_INK,
  integration: C_ACCENT,
  e2e: "var(--kind-e2e)",
  manual: C_WARN,
};
const kindColor = (key: string): string => KIND_COLOR[key] ?? "var(--viz-other)";
```

- [ ] **Step 4: Update `test/render.test.ts` assertions that pinned literal colors**

Run `npx vitest run test/render.test.ts` and read failures. Any assertion checking for a raw hex (e.g. `#1f9d4d`, `#5b7db1`, `#7a4fa0`, `#eccac4`) in the output must change to expect the corresponding `var(--…)` reference, OR be relaxed to assert structure (e.g. the chart `<rect>`/`<circle>` exists). Example transformation:

```ts
// before
expect(html).toContain('fill="#1f9d4d"');
// after
expect(html).toContain('fill="var(--viz-add)"');
```

- [ ] **Step 5: Verify default output is unchanged and tests pass**

Run: `npm run build && npx vitest run`
Expected: all green. Then `npm run sample` and confirm `sample-output.html` still renders identically in a browser (paper theme, charts colored as before).

- [ ] **Step 6: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "refactor: tokenize theme-relevant colors in render.ts"
```

---

## Task 2: themes.ts core — type, makeTheme, themeCss, dark + hacker

**Files:**
- Create: `src/themes.ts`
- Test: `test/themes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/themes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { THEMES, TOKEN_KEYS, themeCss, makeTheme } from "../src/themes.js";

describe("themes", () => {
  it("every theme defines every token key", () => {
    for (const t of THEMES) {
      for (const k of TOKEN_KEYS) {
        expect(t.tokens[k], `${t.id} missing ${k}`).toBeTruthy();
      }
    }
  });

  it("theme ids are unique and DOM-safe", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("includes the named themes", () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["dark", "hacker"]));
  });

  it("themeCss emits one selector per theme and no :root", () => {
    const css = themeCss();
    for (const t of THEMES) {
      expect(css).toContain(`[data-theme="${t.id}"]`);
    }
    expect(css).not.toContain(":root");
  });

  it("makeTheme expands core values into the full token set", () => {
    const t = makeTheme("x", "X", "Test", {
      paper: "#000", surface: "#111", surface2: "#222", ink: "#fff",
      inkSoft: "#ddd", muted: "#999", line: "#333", line2: "#444",
      accent: "#0af", accentSoft: "#013", add: "#0f0", addSoft: "#020",
      del: "#f00", delSoft: "#200", warn: "#fa0", warnSoft: "#210",
    });
    for (const k of TOKEN_KEYS) expect(t.tokens[k]).toBeTruthy();
    expect(t.tokens["--paper"]).toBe("#000");
    expect(t.tokens["--add-border"]).toBe("#0f0"); // derived aliases core
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/themes.test.ts`
Expected: FAIL — cannot find module `../src/themes.js`.

- [ ] **Step 3: Implement `src/themes.ts`**

```ts
/** Pure: visual theme catalog + CSS emitter. No I/O, no Date/random.
 *  `paper` (the default) lives in render.ts `:root`; this module supplies
 *  every *other* theme as a `[data-theme="id"]` override block. */

export interface Theme {
  id: string;
  label: string;
  group: string;
  tokens: Record<string, string>;
}

/** Canonical token contract — every theme must define all of these. */
export const TOKEN_KEYS = [
  "--paper", "--surface", "--surface-2", "--ink", "--ink-soft", "--muted",
  "--line", "--line-2", "--accent", "--accent-soft",
  "--add", "--add-soft", "--del", "--del-soft", "--warn", "--warn-soft",
  "--add-border", "--del-border", "--warn-border", "--accent-border",
  "--accent-shadow", "--on-accent", "--glass", "--code-add", "--code-del",
  "--viz-add", "--viz-add-ink", "--viz-del", "--viz-del-ink", "--viz-warn",
  "--viz-accent", "--viz-line", "--viz-node", "--viz-node-stroke",
  "--viz-accent-stroke", "--viz-noise", "--viz-other", "--viz-cell-label",
  "--viz-zone", "--kind-e2e",
  "--viz-s1", "--viz-s2", "--viz-s3", "--viz-s4",
  "--viz-s5", "--viz-s6", "--viz-s7", "--viz-s8",
] as const;

/** The ~16 core palette values an author supplies; everything else is derived. */
interface Core {
  paper: string; surface: string; surface2: string;
  ink: string; inkSoft: string; muted: string;
  line: string; line2: string;
  accent: string; accentSoft: string;
  add: string; addSoft: string; del: string; delSoft: string;
  warn: string; warnSoft: string;
  // optional overrides (sensible defaults below)
  onAccent?: string; glass?: string; codeAdd?: string; codeDel?: string;
  cellLabel?: string; accentShadow?: string;
  sans?: string; mono?: string;
  series?: [string, string, string, string, string, string, string, string];
}

const DEFAULT_SERIES: Core["series"] = [
  "#5b7db1", "#5fa389", "#b08a5a", "#a07ba6",
  "#c47d72", "#7fa86a", "#d0a85a", "#7a93b8",
];

/** Expand core palette into the full token record. Derived tokens alias core
 *  values (no color math) so a theme stays ~16 lines; any token can still be
 *  overridden by adding it to the returned record after the fact. */
export function makeTheme(id: string, label: string, group: string, c: Core): Theme {
  const s = c.series ?? DEFAULT_SERIES;
  const tokens: Record<string, string> = {
    "--paper": c.paper, "--surface": c.surface, "--surface-2": c.surface2,
    "--ink": c.ink, "--ink-soft": c.inkSoft, "--muted": c.muted,
    "--line": c.line, "--line-2": c.line2,
    "--accent": c.accent, "--accent-soft": c.accentSoft,
    "--add": c.add, "--add-soft": c.addSoft,
    "--del": c.del, "--del-soft": c.delSoft,
    "--warn": c.warn, "--warn-soft": c.warnSoft,
    "--add-border": c.add, "--del-border": c.del,
    "--warn-border": c.warn, "--accent-border": c.accent,
    "--accent-shadow": c.accentShadow ?? "rgba(0,0,0,.2)",
    "--on-accent": c.onAccent ?? "#fff",
    "--glass": c.glass ?? c.surface,
    "--code-add": c.codeAdd ?? c.add,
    "--code-del": c.codeDel ?? c.del,
    "--viz-add": c.add, "--viz-add-ink": c.add,
    "--viz-del": c.del, "--viz-del-ink": c.del,
    "--viz-warn": c.warn, "--viz-accent": c.accent, "--viz-line": c.line,
    "--viz-node": c.surface, "--viz-node-stroke": c.line2,
    "--viz-accent-stroke": c.accent,
    "--viz-noise": c.muted, "--viz-other": c.muted,
    "--viz-cell-label": c.cellLabel ?? c.ink,
    "--viz-zone": c.delSoft, "--kind-e2e": c.accent,
    "--viz-s1": s[0], "--viz-s2": s[1], "--viz-s3": s[2], "--viz-s4": s[3],
    "--viz-s5": s[4], "--viz-s6": s[5], "--viz-s7": s[6], "--viz-s8": s[7],
  };
  if (c.sans) tokens["--sans"] = c.sans;
  if (c.mono) tokens["--mono"] = c.mono;
  return { id, label, group, tokens };
}

export const THEMES: Theme[] = [
  makeTheme("dark", "Dark", "Playful", {
    paper: "#1b1a17", surface: "#232220", surface2: "#2c2a26",
    ink: "#ece9e1", inkSoft: "#b8b2a6", muted: "#847d6f",
    line: "#34322c", line2: "#44413a",
    accent: "#6fa3e0", accentSoft: "#20303f",
    add: "#56c07a", addSoft: "#18301f", del: "#e8786c", delSoft: "#3a201d",
    warn: "#d6a64a", warnSoft: "#332a16",
  }),
  makeTheme("hacker", "Hacker", "Playful", {
    paper: "#000800", surface: "#021202", surface2: "#001a00",
    ink: "#33ff66", inkSoft: "#1faf47", muted: "#0f7a2e",
    line: "#093d12", line2: "#0e5a1c",
    accent: "#7dff7d", accentSoft: "#00270c",
    add: "#39ff77", addSoft: "#002a0e", del: "#ff5f56", delSoft: "#2a0a08",
    warn: "#d4ff3a", warnSoft: "#1d2a00", onAccent: "#000",
    mono: 'ui-monospace, "JetBrains Mono", "Cascadia Code", Consolas, monospace',
  }),
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/themes.test.ts`
Expected: PASS (includes dark + hacker; `makeTheme` expands tokens).

- [ ] **Step 5: Commit**

```bash
git add src/themes.ts test/themes.test.ts
git commit -m "feat: themes module with makeTheme, dark and hacker themes"
```

---

## Task 3: Add the remaining 10 theme palettes

**Files:**
- Modify: `src/themes.ts`
- Test: `test/themes.test.ts`

- [ ] **Step 1: Update the test to assert the full catalog**

In `test/themes.test.ts`, replace the "includes the named themes" test with:

```ts
  it("ships the full catalog", () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toEqual([
      "dark", "hacker", "solarized-light", "solarized-dark", "nord",
      "gruvbox", "catppuccin", "github", "high-contrast", "blueprint",
      "newsprint", "sepia", "synthwave",
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/themes.test.ts -t "full catalog"`
Expected: FAIL — array has only `dark`, `hacker`.

- [ ] **Step 3: Append the 10 themes to the `THEMES` array**

Insert these `makeTheme(...)` entries into `THEMES` after `hacker`, before the closing `]`:

```ts
  makeTheme("solarized-light", "Solarized Light", "Dev favorites", {
    paper: "#fdf6e3", surface: "#fdf6e3", surface2: "#eee8d5",
    ink: "#586e75", inkSoft: "#657b83", muted: "#93a1a1",
    line: "#eee8d5", line2: "#d6cfbb",
    accent: "#268bd2", accentSoft: "#dcebf2",
    add: "#859900", addSoft: "#eef0d8", del: "#dc322f", delSoft: "#f6e0db",
    warn: "#b58900", warnSoft: "#f3ead0",
  }),
  makeTheme("solarized-dark", "Solarized Dark", "Dev favorites", {
    paper: "#002b36", surface: "#073642", surface2: "#003744",
    ink: "#93a1a1", inkSoft: "#839496", muted: "#586e75",
    line: "#0a4250", line2: "#135561",
    accent: "#268bd2", accentSoft: "#03323e",
    add: "#859900", addSoft: "#14331f", del: "#dc322f", delSoft: "#33161a",
    warn: "#b58900", warnSoft: "#2e2812",
  }),
  makeTheme("nord", "Nord", "Dev favorites", {
    paper: "#2e3440", surface: "#3b4252", surface2: "#434c5e",
    ink: "#eceff4", inkSoft: "#d8dee9", muted: "#9aa5b5",
    line: "#434c5e", line2: "#4c566a",
    accent: "#88c0d0", accentSoft: "#2b333f",
    add: "#a3be8c", addSoft: "#2c3a2e", del: "#bf616a", delSoft: "#3a2a2c",
    warn: "#ebcb8b", warnSoft: "#3a3424",
  }),
  makeTheme("gruvbox", "Gruvbox", "Dev favorites", {
    paper: "#282828", surface: "#32302f", surface2: "#3c3836",
    ink: "#ebdbb2", inkSoft: "#d5c4a1", muted: "#a89984",
    line: "#3c3836", line2: "#504945",
    accent: "#83a598", accentSoft: "#2b3331",
    add: "#b8bb26", addSoft: "#2f3318", del: "#fb4934", delSoft: "#3a201c",
    warn: "#fabd2f", warnSoft: "#3a3014",
  }),
  makeTheme("catppuccin", "Catppuccin", "Dev favorites", {
    paper: "#1e1e2e", surface: "#313244", surface2: "#45475a",
    ink: "#cdd6f4", inkSoft: "#bac2de", muted: "#9399b2",
    line: "#313244", line2: "#585b70",
    accent: "#89b4fa", accentSoft: "#2a2c41",
    add: "#a6e3a1", addSoft: "#26342a", del: "#f38ba8", delSoft: "#361f2a",
    warn: "#f9e2af", warnSoft: "#36321f",
  }),
  makeTheme("github", "GitHub", "Professional", {
    paper: "#ffffff", surface: "#ffffff", surface2: "#f6f8fa",
    ink: "#1f2328", inkSoft: "#656d76", muted: "#8c959f",
    line: "#d0d7de", line2: "#afb8c1",
    accent: "#0969da", accentSoft: "#ddf4ff",
    add: "#1a7f37", addSoft: "#dafbe1", del: "#cf222e", delSoft: "#ffebe9",
    warn: "#9a6700", warnSoft: "#fff8c5",
  }),
  makeTheme("high-contrast", "High Contrast", "Professional", {
    paper: "#ffffff", surface: "#ffffff", surface2: "#f0f0f0",
    ink: "#000000", inkSoft: "#000000", muted: "#3a3a3a",
    line: "#000000", line2: "#000000",
    accent: "#0000cc", accentSoft: "#e6e6ff",
    add: "#006400", addSoft: "#e6f5e6", del: "#b00000", delSoft: "#ffe6e6",
    warn: "#7a4d00", warnSoft: "#fff3e0",
  }),
  makeTheme("blueprint", "Blueprint", "Professional", {
    paper: "#0d2747", surface: "#123257", surface2: "#16395f",
    ink: "#dbeafe", inkSoft: "#a9c7ee", muted: "#6f93c0",
    line: "#1d4373", line2: "#2a558c",
    accent: "#5ad1ff", accentSoft: "#0e2c4d",
    add: "#5ee0a0", addSoft: "#103a2c", del: "#ff8a8a", delSoft: "#3a1d22",
    warn: "#ffd166", warnSoft: "#33301a",
  }),
  makeTheme("newsprint", "Newsprint", "Editorial", {
    paper: "#f7f5ef", surface: "#ffffff", surface2: "#ece9e1",
    ink: "#111111", inkSoft: "#333333", muted: "#6b6b6b",
    line: "#cfcabf", line2: "#b3ada0",
    accent: "#8a1f11", accentSoft: "#f1e3e0",
    add: "#1a6b34", addSoft: "#e6f0e8", del: "#a31d12", delSoft: "#f6e3e0",
    warn: "#8a6400", warnSoft: "#f1ead4",
    sans: 'Iowan Old Style, Georgia, "Times New Roman", Times, serif',
  }),
  makeTheme("sepia", "Sepia", "Editorial", {
    paper: "#e9dcc3", surface: "#f3e9d6", surface2: "#ddcfb2",
    ink: "#4a3b28", inkSoft: "#5f4d34", muted: "#8a7552",
    line: "#d4c4a3", line2: "#c4b08a",
    accent: "#8a5a2b", accentSoft: "#ead9bf",
    add: "#5c6e2a", addSoft: "#dfe0bf", del: "#9c3b28", delSoft: "#ecd5cc",
    warn: "#95702a", warnSoft: "#ece0c0",
  }),
  makeTheme("synthwave", "Synthwave", "Playful", {
    paper: "#1a1033", surface: "#251447", surface2: "#2f1a57",
    ink: "#f6e6ff", inkSoft: "#d3b8f0", muted: "#9a7fc0",
    line: "#3a2470", line2: "#4d2f8f",
    accent: "#ff5fd2", accentSoft: "#2e1450",
    add: "#36f9c5", addSoft: "#0e3a32", del: "#ff5f6d", delSoft: "#3a1622",
    warn: "#ffd23f", warnSoft: "#332a10",
  }),
```

- [ ] **Step 4: Run the full themes test**

Run: `npx vitest run test/themes.test.ts`
Expected: PASS — 13 themes, all token-complete, ids unique/DOM-safe.

- [ ] **Step 5: Commit**

```bash
git add src/themes.ts test/themes.test.ts
git commit -m "feat: add 10 more themes (solarized, nord, gruvbox, catppuccin, github, high-contrast, blueprint, newsprint, sepia, synthwave)"
```

---

## Task 4: Wire themeCss() into render + cogwheel menu

**Files:**
- Modify: `src/render.ts`
- Test: `test/render.test.ts`

- [ ] **Step 1: Implement `themeCss()` in `src/themes.ts`**

Append to `src/themes.ts`:

```ts
/** Emit a `[data-theme="id"]{…}` block per theme. `paper` (default) is NOT
 *  emitted — it lives in render.ts `:root`. Deterministic string output. */
export function themeCss(): string {
  return THEMES.map((t) => {
    const decls = Object.entries(t.tokens)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
    return `[data-theme="${t.id}"] {\n${decls}\n}`;
  }).join("\n");
}
```

- [ ] **Step 2: Append `themeCss()` to the `CSS` string in render.ts**

At the top of `src/render.ts`, add to the imports:

```ts
import { THEMES, themeCss } from "./themes.js";
```

At the very end of the `CSS` template literal (just before its closing backtick), add:

```ts
${themeCss()}
```

- [ ] **Step 3: Write the failing render test for the cogwheel + theme blocks**

Add to `test/render.test.ts` (reuse the existing helper that builds a minimal `ReviewModel` and calls `renderHtml`; if none exists, copy the model-construction from a nearby test in the file):

```ts
it("emits the theme switcher cogwheel and theme blocks", () => {
  const html = renderHtml(model); // `model` per existing test setup
  expect(html).toContain('class="tb-gear"');           // cogwheel button
  expect(html).toContain('class="theme-menu"');        // popover menu
  expect(html).toContain('[data-theme="nord"]');       // a theme CSS block
  expect(html).toContain('data-theme-id="hacker"');    // a menu option
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run test/render.test.ts -t "theme switcher"`
Expected: FAIL — `tb-gear` / `theme-menu` not found.

- [ ] **Step 5: Add the cogwheel + menu markup to `renderTopbar`**

Replace `renderTopbar` (lines ~161-169) with:

```ts
function renderTopbar(model: ReviewModel): string {
  const n = model.files.length;
  const groups: string[] = [];
  const seen = new Set<string>();
  for (const t of THEMES) if (!seen.has(t.group)) { seen.add(t.group); groups.push(t.group); }
  const menu = groups
    .map((g) => {
      const opts = THEMES.filter((t) => t.group === g)
        .map(
          (t) =>
            `<button type="button" class="theme-opt" role="menuitemradio" data-theme-id="${t.id}">${esc(t.label)}</button>`,
        )
        .join("");
      return `<div class="theme-grp"><div class="theme-grp-h">${esc(g)}</div>${opts}</div>`;
    })
    .join("");
  return `<div class="topbar">
  <span class="tb-title">${esc(model.title)}</span>
  <span class="tb-progress" data-total="${n}">0 / ${n} reviewed</span>
  ${n > 0 ? `<button class="tb-tour" type="button">▶ Guided review</button>` : ""}
  <a class="tb-top" href="#top">↑ Top</a>
  <div class="tb-theme">
    <button class="tb-gear" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Change theme" title="Change theme">⚙</button>
    <div class="theme-menu" role="menu" hidden>
      <button type="button" class="theme-opt" role="menuitemradio" data-theme-id="paper">Paper (default)</button>
      ${menu}
    </div>
  </div>
</div>`;
}
```

- [ ] **Step 6: Add menu/gear CSS to the `CSS` template**

Add near the other `.topbar` rules in the `CSS` template (search for `.tb-top` to find the block):

```css
.tb-theme { position: relative; }
.tb-gear {
  background: none; border: 0; cursor: pointer; font-size: 15px;
  color: var(--muted); padding: 4px 6px; line-height: 1; border-radius: 6px;
}
.tb-gear:hover { color: var(--ink); background: var(--surface-2); }
.theme-menu {
  position: absolute; right: 0; top: 130%; z-index: 50;
  background: var(--surface); border: 1px solid var(--line-2);
  border-radius: 10px; padding: 8px; min-width: 180px;
  box-shadow: 0 10px 30px rgba(33,31,27,.18);
  display: grid; gap: 8px;
}
.theme-menu[hidden] { display: none; }
.theme-grp-h {
  font: 600 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em;
  color: var(--muted); margin: 2px 4px 4px;
}
.theme-opt {
  display: block; width: 100%; text-align: left; background: none; border: 0;
  cursor: pointer; padding: 5px 8px; border-radius: 6px; color: var(--ink-soft);
  font: 13px/1.2 var(--sans);
}
.theme-opt:hover { background: var(--surface-2); color: var(--ink); }
.theme-opt[aria-checked="true"] { color: var(--accent); font-weight: 600; }
```

- [ ] **Step 7: Run to verify it passes & build**

Run: `npm run build && npx vitest run test/render.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/render.ts src/themes.ts test/render.test.ts
git commit -m "feat: render theme CSS and cogwheel menu"
```

---

## Task 5: Theme switcher script + no-flash restore

**Files:**
- Modify: `src/render.ts`
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test for the scripts**

Add to `test/render.test.ts`:

```ts
it("emits the FOUC-restore and switcher scripts", () => {
  const html = renderHtml(model);
  expect(html).toContain("review-intent:theme");      // localStorage key
  expect(html).toContain("dataset.theme");             // applies theme on <html>
  expect(html).toContain('querySelectorAll(".theme-opt")'); // switcher wiring
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/render.test.ts -t "FOUC-restore"`
Expected: FAIL.

- [ ] **Step 3: Add a `themeScript()` function in render.ts**

Add near the other script builders (e.g. after `pinScript`, ~line 157):

```ts
/** Restore the saved theme before paint (no flash) and wire the cogwheel menu.
 *  Static string — pure. Same localStorage + <script> pattern as pinScript. */
function themeScript(): string {
  return `<script>
  (function () {
    var KEY = "review-intent:theme";
    var root = document.documentElement;
    function applyId(id) {
      if (!id || id === "paper") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", id);
    }
    var saved;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    applyId(saved);
    document.addEventListener("DOMContentLoaded", function () {
      var gear = document.querySelector(".tb-gear");
      var menu = document.querySelector(".theme-menu");
      if (!gear || !menu) return;
      var current = saved || "paper";
      function mark() {
        menu.querySelectorAll(".theme-opt").forEach(function (o) {
          o.setAttribute("aria-checked", o.getAttribute("data-theme-id") === current ? "true" : "false");
        });
      }
      function open(v) {
        menu.hidden = !v;
        gear.setAttribute("aria-expanded", v ? "true" : "false");
      }
      mark();
      gear.addEventListener("click", function (e) {
        e.stopPropagation();
        open(menu.hidden);
      });
      menu.querySelectorAll(".theme-opt").forEach(function (o) {
        o.addEventListener("click", function () {
          current = o.getAttribute("data-theme-id");
          applyId(current);
          try { localStorage.setItem(KEY, current); } catch (e) {}
          mark();
          open(false);
        });
      });
      document.addEventListener("click", function (e) {
        if (!menu.hidden && !menu.contains(e.target) && e.target !== gear) open(false);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") open(false);
      });
    });
  })();
</script>`;
}
```

- [ ] **Step 4: Emit the script — restore early, wire late**

The restore must run before paint. In `renderHtml`, the `themeScript()` `<script>` sets `data-theme` synchronously at parse time and defers wiring to `DOMContentLoaded`, so a single placement right after `<body>` works for both. Find where `renderTopbar(model)` is emitted (line ~27, just after `<body>`) and place the script immediately before it:

```ts
<body>
${themeScript()}
${renderTopbar(model)}
```

- [ ] **Step 5: Run to verify it passes & build**

Run: `npm run build && npx vitest run`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: theme switcher script with no-flash restore"
```

---

## Task 6: Sample regen + manual verification

**Files:**
- Modify: `sample-output.html` (generated)

- [ ] **Step 1: Regenerate the sample**

Run: `npm run sample`
Expected: `sample-output.html` rewritten, no errors.

- [ ] **Step 2: Manual check in a browser**

Open `sample-output.html`. Verify:
- Default load is the paper theme, unchanged from before this work.
- The ⚙ in the top-right opens a grouped menu of all 13 themes (Paper + 12).
- Selecting Dark, Hacker, Nord, GitHub, Synthwave, etc. recolors the whole page **including** the visual-summary charts (bars, treemap, rings, reach ripple) and the diff code lines — no stray light-on-dark patches.
- Reload keeps the last chosen theme (no flash of paper first).
- Escape / outside-click closes the menu; the active theme is marked.

Note any theme that reads poorly (e.g. chart series muddy on a dark bg) — these are the per-theme legibility tweaks flagged in the spec; adjust the offending token(s) directly in that theme's `makeTheme(...)` override or via the optional `series` field.

- [ ] **Step 3: Commit**

```bash
git add sample-output.html
git commit -m "chore: regenerate sample with theme switcher"
```

---

## Self-Review notes

- **Spec coverage:** in-page switcher (T4/T5), 13 themes incl. default paper (T2/T3), cogwheel top-right (T4), tokenize charts+CSS (T1), purity preserved (themes.ts/render.ts emit static strings — no Date/random), self-contained output (all themes inline), FOUC restore (T5), tests (T2/T3 themes.test.ts, T1/T4/T5 render.test.ts). Mermaid theming explicitly deferred (spec non-goal).
- **Type consistency:** `Theme`/`TOKEN_KEYS`/`makeTheme`/`themeCss` names are identical across themes.ts and its imports in render.ts. Menu uses `data-theme-id`; script reads `getAttribute("data-theme-id")` — consistent. Storage key `review-intent:theme` identical in restore and write paths. CSS class names (`tb-gear`, `theme-menu`, `theme-opt`, `theme-grp`) consistent between `renderTopbar`, the CSS block, and `themeScript`.
- **No placeholders:** every code step contains full content; theme palettes are concrete hex values.
- **Known tradeoff (not a gap):** derived/viz tokens alias core palette values via `makeTheme`; the spec already calls out a per-theme legibility pass (T6 step 2) for any chart/diagram colors that need hand-tuning beyond the base palette.
