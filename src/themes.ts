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
  "--viz-accent-stroke", "--viz-cell-stroke", "--viz-noise", "--viz-other",
  "--viz-cell-label", "--viz-zone", "--kind-e2e",
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

const DEFAULT_SERIES: [string, string, string, string, string, string, string, string] = [
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
    "--viz-accent-stroke": c.accent, "--viz-cell-stroke": c.surface,
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
];

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
