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
