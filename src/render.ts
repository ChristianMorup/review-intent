import type {
  ReviewModel,
  AnnotatedFile,
  AnnotatedHunk,
  DiffLine,
  IntentCoverage,
  ComplexityModel,
  ReachModel,
  Risk,
  TestCase,
} from "./types.js";
import { reviewOrder, type RankedFile } from "./review-order.js";
import { THEMES, themeCss } from "./themes.js";
import { isCodePath, isTestPath, isNoisePath } from "./scorecard.js";

/** Pure: produce a self-contained HTML document from the review model.
 *  With `opts.submit` the page gains an Approve / Request-changes bar that POSTs
 *  the assembled prompt to a same-origin `/submit` endpoint (used by the MCP
 *  tool). With submit off (the default) the output is byte-identical to before. */
export function renderHtml(model: ReviewModel, opts?: { submit?: boolean }): string {
  const submit = opts?.submit === true;
  const ranked = reviewOrder(model);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(model.title)} — intent review</title>
<style>${CSS}</style>${submit ? `<style>.fb-submit{display:flex;gap:12px;align-items:center;margin-top:14px}.fb-approve{font:600 12px/1 var(--mono);cursor:pointer;color:var(--on-accent);background:var(--add);border:1px solid var(--add);border-radius:8px;padding:9px 16px}.fb-request{font:600 12px/1 var(--mono);cursor:pointer;color:var(--ink);background:var(--surface);border:1px solid var(--line-2);border-radius:8px;padding:9px 16px}.fb-sent{color:var(--muted);font:600 12px/1 var(--mono)}</style>` : ""}
</head>
<body>
${themeScript()}
${renderTopbar(model)}
${renderDiffScopeBanner(model)}

<div class="shell">
<aside class="rail" aria-label="Changed files">
${renderFileSpine(ranked)}
</aside>
<div class="main-col">
<header class="page-head" id="top">
  <div class="eyebrow">Intent review <span class="eyebrow-diff">${esc(model.base)}…HEAD</span></div>
  <h1>${esc(model.title)}</h1>
  <div class="tldr">${md(model.tldr)}</div>
  <details class="overall-wrap">
    <summary>Full summary</summary>
    <div class="overall">${md(model.overall)}</div>
  </details>
</header>
${renderVerdict(model)}
${renderVitals(model)}
${renderChangeSummary(model)}
${renderDeeperAnalysis(model)}

<section class="diffs">
  <div class="section-eyebrow">Diffs <span class="section-eyebrow-sub">— in review order</span></div>
  <main>
  ${
    ranked.length === 0
      ? `<p class="empty">No file changes in this diff.</p>`
      : ranked.map((r) => renderFile(model.files[r.index], r)).join("\n")
  }
  </main>
</section>

${renderFilesWithoutChanges(model)}
${renderFeedbackPanel(model, submit)}
</div>
</div>

${LIGHTBOX}
${TOUR}

${MERMAID_SCRIPT}
${LIGHTBOX_SCRIPT}
${viewedScript(model)}
${commentScript(model, submit)}
${tourScript(model, ranked)}
</body>
</html>`;
}

/** Restore the saved theme before paint (no flash) and wire the cogwheel menu.
 *  Static string — pure. Same localStorage + <script> pattern as pinScript. */
function themeScript(): string {
  return `<script>
  (function () {
    var KEY = "review-intent:theme";
    var root = document.documentElement;
    function applyId(id) {
      if (!id || id === "paper") delete root.dataset.theme;
      else root.dataset.theme = id;
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

/** Banner shown when the diff includes uncommitted working-tree changes.
 *  Returns empty string when the diff is clean (pure; no I/O). */
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

/** Slim sticky bar: persistent wayfinding across the long scroll. The progress
 *  counter is updated client-side as files are marked "seen". */
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
            `<button type="button" class="theme-opt" role="menuitemradio" aria-checked="false" data-theme-id="${esc(t.id)}">${esc(t.label)}</button>`,
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
    <div class="theme-menu" role="menu" aria-label="Theme" hidden>
      <button type="button" class="theme-opt" role="menuitemradio" aria-checked="true" data-theme-id="paper">Paper (default)</button>
      ${menu}
    </div>
  </div>
</div>`;
}

/** The overview strip: the handful of measured numbers that define the change's
 *  shape, scannable at a glance. Pure — derived from data already on the model. */
function renderVitals(model: ReviewModel): string {
  const s = model.scorecard;
  const ic = model.intentCoverage;
  const net = s.added - s.removed;
  const hunkCov = ic.hunksTotal
    ? Math.round((ic.hunksCovered / ic.hunksTotal) * 100)
    : null;
  const cx = model.complexity;

  type Vital = { value: string; label: string; tone?: "add" | "del" | "warn" };
  const vitals: Vital[] = [
    { value: `${s.filesChanged}`, label: s.filesChanged === 1 ? "file" : "files" },
    {
      value: `+${s.added} −${s.removed}`,
      label: `net ${net >= 0 ? "+" : "−"}${Math.abs(net)} lines`,
    },
    { value: `${s.hunks}`, label: s.hunks === 1 ? "hunk" : "hunks" },
    {
      value: hunkCov === null ? "—" : `${hunkCov}%`,
      label: "intent covered",
      tone: hunkCov === null ? undefined : hunkCov >= 80 ? "add" : hunkCov >= 50 ? "warn" : "del",
    },
    {
      value: `${model.risks.length}`,
      label: model.risks.length === 1 ? "risk declared" : "risks declared",
      tone: model.risks.length === 0 ? "warn" : undefined,
    },
    {
      value: cx.available ? `${cx.maxCcn}` : "—",
      label: cx.available ? "max complexity" : "complexity n/a",
      tone: cx.available && cx.hotspots.length ? "del" : undefined,
    },
    {
      value: `${model.reach.edges.length}`,
      label: model.reach.edges.length === 1 ? "dependent" : "dependents",
    },
  ];

  return `<section class="vitals" aria-label="Change vitals">
  ${vitals
    .map(
      (v) => `<div class="vital${v.tone ? ` vital-${v.tone}` : ""}">
    <span class="vital-num">${esc(v.value)}</span>
    <span class="vital-lbl">${esc(v.label)}</span>
  </div>`,
    )
    .join("\n  ")}
</section>`;
}

/** The verdict line: one measured sentence telling the reviewer where to look,
 *  derived from the same hotspot + test-gap signals the scorecard computes. The
 *  tone box turns red when something is flagged, green when nothing stands out.
 *  Empty on an empty diff — there is nothing to triage. */
function renderVerdict(model: ReviewModel): string {
  if (model.files.length === 0) return "";
  const s = model.scorecard;
  const cx = model.complexity;
  const hotspots = cx.available ? cx.hotspots : [];
  const hotFiles = [...new Set(hotspots.map((h) => basename(h.file)))].slice(0, 3);
  // "code changed but tests didn't" — measured, the same signal the badge uses.
  const codeNoTests = s.codeFiles > 0 && s.testFiles === 0;

  const parts: string[] = [];
  if (hotFiles.length) {
    parts.push(
      `${hotspots.length} complexity hotspot${plural(hotspots.length)} (${hotFiles.join(", ")}) ${hotspots.length === 1 ? "carries" : "carry"} the most risk — start there.`,
    );
  }
  if (codeNoTests) {
    parts.push(`Code changed but no test files did — confirm the change is covered.`);
  }
  const flagged = parts.length > 0;
  const msg = flagged
    ? parts.join(" ")
    : `Nothing flags as high-risk — the change set is small and the intent is covered. Skim in the order on the left.`;
  return `<div class="verdict ${flagged ? "verdict-warn" : "verdict-ok"}" role="note">
  <span class="verdict-icon" aria-hidden="true">${flagged ? "⚑" : "✓"}</span>
  <div class="verdict-msg">${esc(msg)}</div>
</div>`;
}

/** Change summary band: the one decision chart (change map — reach × churn)
 *  stacked above the claimed risk ledger, each full-width. Measured above
 *  claimed, deliberately. */
function renderChangeSummary(model: ReviewModel): string {
  return `<section class="change-summary">
  <div class="section-eyebrow">Change summary</div>
  <div class="cs-grid">
    ${renderChangeScatter(model)}
    ${renderRisks(model.risks)}
  </div>
</section>`;
}

/** The trimmed scorecard: only the measured signals nothing else on the page
 *  shows. The top-line counts (files, ±lines, hunks, intent %, reach, max CCN)
 *  now live once in the vitals row, so they are deliberately absent here. */
function renderScorecardSignals(model: ReviewModel): string {
  const s = model.scorecard;
  const cx = model.complexity;
  const badges = s.badges.length
    ? s.badges
        .map((b) => `<span class="badge tone-${b.tone}">${esc(b.label)}</span>`)
        .join("")
    : `<span class="badge tone-ok">no flags</span>`;

  const plr = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const signals: string[] = [
    `<span>${s.testLines} test / ${s.codeLines} code lines</span>`,
  ];
  if (s.debtMarkers > 0) {
    signals.push(`<span class="flag">${plr(s.debtMarkers, "debt/debug marker")} added</span>`);
  }
  if (s.noiseFiles > 0) {
    signals.push(`<span class="flag">${plr(s.noiseFiles, "noise file")}</span>`);
  }
  if (s.largestFile) {
    signals.push(
      `<span>largest: <code>${esc(s.largestFile.path)}</code> ±${s.largestFile.churn}</span>`,
    );
  }
  if (!cx.available) {
    signals.push(`<span class="muted">complexity: ${esc(cx.note ?? "n/a")}</span>`);
  }

  return `<div class="card scorecard">
  <h3>Signals <span class="src">measured</span></h3>
  <div class="metrics metrics-extra">${signals.join("")}</div>
  <div class="badges">${badges}</div>
</div>`;
}

function renderRisks(risks: Risk[]): string {
  if (risks.length === 0) {
    return `<div class="card risks">
  <h3>Risk ledger <span class="src">claimed</span></h3>
  <div class="nudge">No risks declared. Per the honesty contract an empty ledger is itself a signal — is this change really assumption-free?</div>
</div>`;
  }
  const rows = risks
    .map(
      (r) => `<tr>
    <td>${md(r.assumption)}</td>
    <td>${md(r.ifFalse)}</td>
    <td>${r.howYoudKnow ? md(r.howYoudKnow) : '<span class="muted">—</span>'}</td>
  </tr>`,
    )
    .join("");
  return `<div class="card risks">
  <h3>Risk ledger <span class="src">claimed</span></h3>
  <table class="risk-table">
    <thead><tr><th>Assumption</th><th>If false</th><th>How you'd know</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

// ── Visual summary charts: pure inline-SVG, driven by the measured model ──

// Light-canvas palette. Semantic fills tuned to read on the warm-paper canvas.
const C_ADD = "var(--viz-add)";
const C_ADD_INK = "var(--viz-add-ink)";
const C_DEL = "var(--viz-del)";
const C_DEL_INK = "var(--viz-del-ink)";
const C_WARN = "var(--viz-warn)";
const C_ACCENT = "var(--viz-accent)";
const C_LINE = "var(--viz-line)";

// ── File-level churn stats + the diff-mass and treemap charts ──

type FileCategory = "test" | "code" | "noise" | "other";

interface FileStat {
  path: string;
  added: number;
  removed: number;
  churn: number;
  category: FileCategory;
  hasIntent: boolean;
}

const CAT_COLOR: Record<FileCategory, string> = {
  test: C_ADD_INK,
  code: C_ACCENT,
  noise: "var(--viz-noise)",
  other: "var(--viz-other)",
};

const DIR_PALETTE = [
  "var(--viz-s1)", "var(--viz-s2)", "var(--viz-s3)", "var(--viz-s4)",
  "var(--viz-s5)", "var(--viz-s6)", "var(--viz-s7)", "var(--viz-s8)",
];

function dirColor(p: string): string {
  const dir = p.includes("/") ? p.slice(0, p.indexOf("/")) : "·";
  let h = 0;
  for (const ch of dir) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DIR_PALETTE[h % DIR_PALETTE.length];
}

function fileStats(model: ReviewModel): FileStat[] {
  return model.files.map((f): FileStat => {
    let added = 0;
    let removed = 0;
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type === "add") added++;
        else if (l.type === "del") removed++;
      }
    }
    const category: FileCategory = isTestPath(f.path)
      ? "test"
      : isNoisePath(f.path)
        ? "noise"
        : isCodePath(f.path)
          ? "code"
          : "other";
    return { path: f.path, added, removed, churn: added + removed, category, hasIntent: !!f.why };
  });
}

/** Diff mass — diverging add/remove bars per file, sorted by churn. */
function renderDiffMass(stats: FileStat[]): string {
  if (stats.length === 0) return "";
  const rows = [...stats].sort((a, b) => b.churn - a.churn);
  const cap = 25;
  const shown = rows.slice(0, cap);
  const hidden = rows.length - shown.length;
  const maxSide = Math.max(1, ...shown.map((s) => Math.max(s.added, s.removed)));

  const W = 720;
  const rowH = 22;
  const pad = 10;
  const plotL = 200;
  const plotR = W - 86;
  const xc = (plotL + plotR) / 2;
  const half = (plotR - plotL) / 2 - 4;
  const scale = half / maxSide;
  const H = pad * 2 + shown.length * rowH;

  const body = shown
    .map((f, i) => {
      const y = pad + i * rowH;
      const mid = y + rowH / 2;
      const remW = f.removed * scale;
      const addW = f.added * scale;
      const mark = f.hasIntent
        ? `<circle cx="9" cy="${mid}" r="3" fill="${C_ADD}" />`
        : `<circle cx="9" cy="${mid}" r="3" fill="none" stroke="${C_DEL}" stroke-width="1.5" />`;
      const tip = `${f.path} — +${f.added} −${f.removed} (${f.category})${f.hasIntent ? "" : " · no intent written"}`;
      return `<g><title>${esc(tip)}</title>${mark}
    <text x="18" y="${mid + 3}" class="viz-label" fill="${CAT_COLOR[f.category]}">${esc(shortPath(f.path, 26))}</text>
    <rect x="${(xc - remW).toFixed(1)}" y="${y + 4}" width="${remW.toFixed(1)}" height="${rowH - 8}" fill="${C_DEL}" fill-opacity="0.9" />
    <rect x="${xc.toFixed(1)}" y="${y + 4}" width="${addW.toFixed(1)}" height="${rowH - 8}" fill="${C_ADD}" fill-opacity="0.9" />
    <text x="${plotR + 6}" y="${mid + 3}" class="viz-num">+${f.added} −${f.removed}</text></g>`;
    })
    .join("\n    ");

  const axis = `<line x1="${xc}" y1="${pad}" x2="${xc}" y2="${H - pad}" class="viz-axis" />`;
  const more =
    hidden > 0 ? ` ${hidden} more file${plural(hidden)} not charted (showing the ${cap} largest).` : "";

  return `<div class="card viz viz-span zoomable">
  <h3>Diff mass <span class="src">± lines per file</span></h3>
  <svg class="viz-diffmass" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    ${axis}
    ${body}
  </svg>
  <p class="viz-cap">One row per changed file, longest diff first: bar length = lines added (green, right) vs removed (red, left). The dot is filled ● when intent was written for the file, hollow ○ when it wasn't. Hover a row for its path and counts.${more}</p>
</div>`;
}

/** Change treemap — squarified, area ∝ churn, colour = directory. */
function renderTreemap(stats: FileStat[]): string {
  if (stats.length === 0) return "";
  const W = 720;
  const H = 300;
  const sorted = [...stats].sort((a, b) => b.churn - a.churn);
  const total = sorted.reduce((n, s) => n + s.churn, 0);
  const scale = (W * H) / total;
  const items = sorted.map((s) => ({ ...s, area: s.churn * scale }));
  const rects = squarify(items, { x: 0, y: 0, w: W, h: H });

  const cells = rects
    .map((r) => {
      const stroke = r.hasIntent ? "var(--viz-cell-stroke)" : C_DEL_INK;
      const sw = r.hasIntent ? 1 : 2;
      const label =
        r.w > 54 && r.h > 18
          ? `<text x="${(r.x + 5).toFixed(1)}" y="${(r.y + 15).toFixed(1)}" class="viz-cell-label">${esc(shortPath(basename(r.path), Math.max(3, Math.floor(r.w / 7))))}</text>`
          : "";
      const tip = `${r.path} — ${r.churn} line${plural(r.churn)} changed${r.hasIntent ? "" : " · no intent written"}`;
      return `<g><title>${esc(tip)}</title><rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="${dirColor(r.path)}" fill-opacity="0.82" stroke="${stroke}" stroke-width="${sw}" />${label}</g>`;
    })
    .join("\n    ");

  return `<div class="card viz viz-span zoomable">
  <h3>Change treemap <span class="src">area = churn</span></h3>
  <svg class="viz-treemap" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
    ${cells}
  </svg>
  <p class="viz-cap">Every changed file as a rectangle: area ∝ lines changed, so the biggest tiles are where most of the diff lives. Colour groups files by top-level directory; a red outline marks a file with no intent written. Hover a tile for its path and line count.</p>
</div>`;
}

interface SqItem extends FileStat {
  area: number;
}
interface SqRect extends SqItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap layout (Bruls et al.) — deterministic, no I/O. */
function squarify(items: SqItem[], rect: { x: number; y: number; w: number; h: number }): SqRect[] {
  const out: SqRect[] = [];
  const queue = items.slice();
  let { x, y, w, h } = rect;
  let row: SqItem[] = [];

  const sum = (r: SqItem[]) => r.reduce((n, it) => n + it.area, 0);
  const worst = (r: SqItem[], side: number): number => {
    const s = sum(r);
    if (s === 0) return Infinity;
    const max = Math.max(...r.map((it) => it.area));
    const min = Math.min(...r.map((it) => it.area));
    const s2 = s * s;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };
  const layoutRow = (r: SqItem[]): void => {
    const s = sum(r);
    if (w <= h) {
      const stripH = s / w;
      let cxp = x;
      for (const it of r) {
        const cw = it.area / stripH;
        out.push({ ...it, x: cxp, y, w: cw, h: stripH });
        cxp += cw;
      }
      y += stripH;
      h -= stripH;
    } else {
      const stripW = s / h;
      let cyp = y;
      for (const it of r) {
        const ch = it.area / stripW;
        out.push({ ...it, x, y: cyp, w: stripW, h: ch });
        cyp += ch;
      }
      x += stripW;
      w -= stripW;
    }
  };

  while (queue.length) {
    const side = Math.min(w, h);
    const next = queue[0];
    if (row.length === 0 || worst(row, side) >= worst([...row, next], side)) {
      row.push(next);
      queue.shift();
    } else {
      layoutRow(row);
      row = [];
    }
  }
  if (row.length) layoutRow(row);
  return out;
}

/** Reach ripple — changed files at the centre, importers rippling outward, one
 *  line per dependency edge. Returns "" when nothing imports the change set, so
 *  the card drops out of the grid like the other empty charts. */
function renderReachRipple(reach: ReachModel): string {
  if (reach.edges.length === 0) return "";
  const note = reach.truncatedNote
    ? `<div class="reach-note">⚠ ${esc(reach.truncatedNote)}</div>`
    : "";
  return `<div class="card reach zoomable">
  <h3>Reach <span class="src">measured · heuristic</span></h3>
  <p class="muted">Changed files sit at the centre; files that import them ripple outward (line = "depends on"). Heuristic — may miss or over-match.</p>
  ${reachRipple(reach)}
  ${note}
</div>`;
}

/** Inline-SVG radial "ripple": changed files at the centre, importers on an
 *  outer ring, with a connecting line per dependency edge. Pure & deterministic. */
function reachRipple(reach: ReachModel): string {
  const W = 720;
  const H = 420;
  const cx = W / 2;
  const cy = H / 2;
  const cap = 36;
  const importers = [...new Set(reach.edges.map((e) => e.from))];
  const shown = importers.slice(0, cap);
  const hidden = importers.length - shown.length;

  const cpos = new Map<string, { x: number; y: number }>();
  reach.changed.forEach((c, i) => {
    if (reach.changed.length === 1) {
      cpos.set(c, { x: cx, y: cy });
    } else {
      const a = (i / reach.changed.length) * 2 * Math.PI - Math.PI / 2;
      cpos.set(c, { x: cx + 64 * Math.cos(a), y: cy + 64 * Math.sin(a) });
    }
  });

  const ipos = new Map<string, { x: number; y: number }>();
  shown.forEach((f, i) => {
    const a = (i / shown.length) * 2 * Math.PI - Math.PI / 2;
    ipos.set(f, { x: cx + 190 * Math.cos(a), y: cy + 150 * Math.sin(a) });
  });

  const rings = `<circle cx="${cx}" cy="${cy}" r="155" class="ripple-ring" /><circle cx="${cx}" cy="${cy}" r="80" class="ripple-ring" />`;
  const lines = reach.edges
    .filter((e) => ipos.has(e.from) && cpos.has(e.to))
    .map((e) => {
      const a = ipos.get(e.from)!;
      const b = cpos.get(e.to)!;
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="ripple-edge" />`;
    })
    .join("");
  const iNodes = shown.map((f) => rippleNode(ipos.get(f)!, f, false)).join("");
  const cNodes = reach.changed.map((c) => rippleNode(cpos.get(c)!, c, true)).join("");
  const more =
    hidden > 0
      ? `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="ripple-label">+${hidden} more importer(s) not drawn</text>`
      : "";

  return `<svg class="viz-ripple" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
  ${rings}${lines}${iNodes}${cNodes}${more}
</svg>`;
}

function rippleNode(
  p: { x: number; y: number },
  path: string,
  isChanged: boolean,
): string {
  const r = isChanged ? 8 : 5;
  const fill = isChanged ? C_ACCENT : "var(--viz-node)";
  const stroke = isChanged ? "var(--viz-accent-stroke)" : "var(--viz-node-stroke)";
  const ly = isChanged ? p.y - 13 : p.y + 16;
  const tip = isChanged ? `${path} — changed file` : `${path} — imports a changed file`;
  return `<g class="ripple-node">
  <title>${esc(tip)}</title>
  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
  <text x="${p.x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" class="ripple-label">${esc(shortPath(path, 22))}</text>
</g>`;
}

/** Deeper analysis: the demoted analytics, behind one open disclosure so they
 *  stay available without piling up above the diffs. Architecture (the authored
 *  diagrams) leads, full-width; coverage / complexity / signals / tests follow
 *  in a grid. Empty cards drop out, so an analysis-light change collapses to a
 *  short disclosure rather than a wall of blank panels. */
function renderDeeperAnalysis(model: ReviewModel): string {
  const diagrams = renderDiagrams(model);
  const stats = fileStats(model).filter((s) => s.churn > 0);
  const grid = [
    renderDiffMass(stats),
    renderTreemap(stats),
    renderReachRipple(model.reach),
    renderComplexityHotspots(model.complexity),
    renderCoverageRings(model.intentCoverage),
    renderScorecardSignals(model),
  ].filter(Boolean);
  const tests = renderTests(model.tests);
  if (!diagrams && grid.length === 0 && !tests) return "";
  return `<details class="deeper" open>
  <summary class="deeper-head"><span class="deeper-plus" aria-hidden="true">＋</span> Deeper analysis <span class="deeper-sub">— architecture · coverage · complexity · tests</span></summary>
  <div class="deeper-body">
    ${diagrams}
    ${grid.length ? `<div class="deeper-grid">\n    ${grid.join("\n    ")}\n  </div>` : ""}
    ${tests}
  </div>
</details>`;
}

/** Intent coverage — donut rings for files & hunks annotated. */
function renderCoverageRings(ic: IntentCoverage): string {
  if (ic.filesTotal === 0 && ic.hunksTotal === 0) return "";
  return `<div class="card viz zoomable">
  <h3>Intent coverage <span class="src">measured</span></h3>
  <div class="viz-rings">
    ${coverageRing("files", "file", ic.filesCovered, ic.filesTotal)}
    ${coverageRing("hunks", "hunk", ic.hunksCovered, ic.hunksTotal)}
  </div>
  <p class="viz-cap">Share of changed files (each needs a what + why) and diff hunks (each needs an anchored note) that carry agent-written intent. The completeness gate normally forces both to 100% — anything lower means the page was rendered with <code>--allow-gaps</code> and some of the change is unexplained.</p>
</div>`;
}

function coverageRing(label: string, unit: string, num: number, den: number): string {
  const f = den ? num / den : 0;
  const pct = Math.round(f * 100);
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = (f * c).toFixed(1);
  const color = f >= 0.8 ? C_ADD : f >= 0.5 ? C_WARN : C_DEL;
  const tip = `${num} of ${den} ${unit}${plural(den)} carry intent (${pct}%)`;
  return `<svg viewBox="0 0 120 150" class="viz-ring-svg" role="img">
  <title>${esc(tip)}</title>
  <circle cx="60" cy="60" r="${r}" fill="none" stroke="${C_LINE}" stroke-width="12" />
  <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${dash} ${c.toFixed(1)}" transform="rotate(-90 60 60)" />
  <text x="60" y="67" text-anchor="middle" class="viz-ring-pct">${pct}%</text>
  <text x="60" y="135" text-anchor="middle" class="viz-ring-label">${esc(label)} ${num}/${den}</text>
</svg>`;
}

/** Complexity hotspots — horizontal CCN bars for the most complex changed
 *  functions (measured by lizard). Rendered only when analysis ran and found any. */
function renderComplexityHotspots(cx: ComplexityModel): string {
  if (!cx.available || cx.hotspots.length === 0) return "";
  const rows = cx.hotspots;
  const maxC = Math.max(...rows.map((r) => r.ccn));
  const W = 720;
  const rowH = 24;
  const pad = 10;
  const barL = 300;
  const barR = W - 60;
  const barMax = barR - barL;
  const H = pad * 2 + rows.length * rowH;

  const body = rows
    .map((r, i) => {
      const y = pad + i * rowH;
      const mid = y + rowH / 2;
      const w = (r.ccn / maxC) * barMax;
      const color = r.ccn >= cx.threshold * 2 ? C_DEL : C_WARN;
      const label = `${r.name} · ${basename(r.file)}:${r.line}`;
      const tip = `${r.name} — CCN ${r.ccn} (threshold ${cx.threshold}) at ${r.file}:${r.line}`;
      return `<g><title>${esc(tip)}</title><text x="6" y="${mid + 3}" class="viz-label">${esc(shortPath(label, 44))}</text>
    <rect x="${barL}" y="${y + 4}" width="${w.toFixed(1)}" height="${rowH - 8}" fill="${color}" fill-opacity="0.85" />
    <text x="${(barL + w + 6).toFixed(1)}" y="${mid + 3}" class="viz-num">${r.ccn}</text></g>`;
    })
    .join("\n    ");

  return `<div class="card viz viz-span zoomable">
  <h3>Complexity hotspots <span class="src">lizard · CCN</span></h3>
  <svg class="viz-complexity" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    ${body}
  </svg>
  <p class="viz-cap">Changed functions whose measured cyclomatic complexity (CCN — the number of independent paths through the code) is at or above the repo threshold of ${cx.threshold}; bars at ≥ 2× threshold turn red. These are the functions most likely to hide a bug or be hard to test. Hover a bar for its file and line.</p>
</div>`;
}

/** #5 Change map — one dot per changed file, placed by measured blast radius
 *  (downstream reach) against measured size (churn), so the file that most
 *  deserves a reviewer's attention is the one in the top-right. Everything here
 *  is measured: there is no honest per-file "candor" signal (risks aren't
 *  file-scoped and per-hunk intent is forced complete by the gate). */
function renderChangeScatter(model: ReviewModel): string {
  const cx = model.complexity;
  const norm = (p: string) => p.replace(/\\/g, "/");

  // Files carrying a complexity hotspot — measured; empty when lizard didn't run.
  const hotFiles = cx.available ? cx.hotspots.map((h) => norm(h.file)) : [];
  const isHot = (path: string): boolean => {
    const p = norm(path);
    const base = p.split("/").pop() ?? p;
    return hotFiles.some(
      (h) => h === p || h.endsWith("/" + p) || p.endsWith("/" + h) || (h.split("/").pop() ?? h) === base,
    );
  };
  const fanInOf = (path: string): number =>
    model.reach.edges.reduce((n, e) => (norm(e.to) === norm(path) ? n + 1 : n), 0);

  const pts = model.files
    .map((f) => {
      let churn = 0;
      for (const h of f.hunks)
        for (const l of h.lines) if (l.type === "add" || l.type === "del") churn++;
      return { path: f.path, churn, fanIn: fanInOf(f.path), hunks: f.hunks.length, hot: isHot(f.path) };
    })
    .filter((p) => p.churn > 0 || p.fanIn > 0);
  if (pts.length === 0) return "";

  const maxChurn = Math.max(...pts.map((p) => p.churn), 1);
  const maxFan = Math.max(...pts.map((p) => p.fanIn), 1);
  const maxHunks = Math.max(...pts.map((p) => p.hunks), 1);

  const W = 720;
  const H = 380;
  const mL = 54;
  const mR = 18;
  const mT = 22;
  const mB = 46;
  const plotW = W - mL - mR;
  const plotH = H - mT - mB;
  // sqrt on the magnitude axes so one huge file doesn't crush the rest into the
  // corner; monotonic, so the visual order still reflects the real order.
  const sq = (v: number, max: number) => (max > 0 ? Math.sqrt(v) / Math.sqrt(max) : 0);
  const X = (fan: number) => mL + sq(fan, maxFan) * plotW;
  const Y = (churn: number) => mT + (1 - sq(churn, maxChurn)) * plotH;
  const R = (hunks: number) => 5 + sq(hunks, maxHunks) * 9;
  const midX = mL + plotW / 2;
  const midY = mT + plotH / 2;

  // Files with the same downstream reach land on the same x-column and would
  // overlap (commonly the many files nothing imports, all at the left axis).
  // Dodge each column's dots horizontally — deterministic, ordered by churn —
  // so every file stays individually visible and hoverable. The column's centre
  // still reads as its reach value; the spread is clamped inside the plot.
  const minX = mL + 16;
  const maxX = W - mR - 16;
  const columns = new Map<number, typeof pts>();
  for (const p of pts) {
    const key = Math.round(X(p.fanIn));
    const arr = columns.get(key);
    if (arr) arr.push(p);
    else columns.set(key, [p]);
  }
  const dodgeX = new Map<string, number>();
  for (const [key, group] of columns) {
    const ordered = [...group].sort((a, b) => a.churn - b.churn || (a.path < b.path ? -1 : 1));
    const n = ordered.length;
    // Step the dodge by the widest dot in the column (its diameter + a 4px gap)
    // so dots never overlap. If a column holds too many same-reach files to fit
    // the plot width, compress the step to fit rather than spilling off-plot.
    const maxR = Math.max(...ordered.map((p) => R(p.hunks)));
    let step = 2 * maxR + 4;
    const availW = maxX - minX;
    if (n > 1 && (n - 1) * step > availW) step = availW / (n - 1);
    const run = (n - 1) * step;
    let start = key - run / 2;
    if (start + run > maxX) start = maxX - run;
    if (start < minX) start = minX;
    ordered.forEach((p, i) => dodgeX.set(p.path, start + i * step));
  }
  const PX = (p: { path: string; fanIn: number }) => dodgeX.get(p.path) ?? X(p.fanIn);

  // Label the files nearest the top-right (highest combined reach + churn) so a
  // dense change doesn't become a wall of text; the rest stay as bare dots.
  const weight = (p: (typeof pts)[number]) => sq(p.fanIn, maxFan) + sq(p.churn, maxChurn);
  const labelled = new Set([...pts].sort((a, b) => weight(b) - weight(a)).slice(0, 6).map((p) => p.path));

  const circles = pts
    .map((p) => {
      const cls = p.hot ? "viz-dot viz-dot-hot" : "viz-dot";
      // Native SVG tooltip — full path + the measured numbers behind the dot.
      const tip = `${p.path} — ${p.churn} line${plural(p.churn)} changed · ${p.hunks} hunk${plural(p.hunks)} · imported by ${p.fanIn} file${plural(p.fanIn)}${p.hot ? " · complexity hotspot" : ""}`;
      return `<circle cx="${PX(p).toFixed(1)}" cy="${Y(p.churn).toFixed(1)}" r="${R(p.hunks).toFixed(1)}" class="${cls}"><title>${esc(tip)}</title></circle>`;
    })
    .join("\n    ");

  // Place labels for the notable files: flip to the left of dots near the right
  // edge so text never spills off the viewBox, and nudge each one down past the
  // previous label on its side so a stacked column stays legible. Deterministic
  // — no glyph measurement, just fixed line spacing.
  const GAP = 13;
  const lastY: Record<"l" | "r", number> = { l: -Infinity, r: -Infinity };
  const labels = pts
    .filter((p) => labelled.has(p.path))
    .map((p) => ({ p, x: PX(p), y: Y(p.churn), r: R(p.hunks) }))
    .sort((a, b) => a.y - b.y)
    .map(({ p, x, y, r }) => {
      const side: "l" | "r" = x > mL + plotW * 0.62 ? "l" : "r";
      const ly = Math.max(y + 3, lastY[side] + GAP);
      lastY[side] = ly;
      const lx = side === "r" ? x + r + 4 : x - r - 4;
      const anchor = side === "r" ? "" : ` text-anchor="end"`;
      return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}"${anchor} class="viz-label">${esc(shortPath(basename(p.path), 22))}</text>`;
    })
    .join("\n    ");

  const dots = `${circles}\n    ${labels}`;

  // Glyph key. When lizard didn't run, colour carries no meaning, so say so
  // rather than implying every dot is hotspot-free.
  const dotSwatch = (cls: string) =>
    `<svg class="viz-lg-dot" viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="5" class="${cls}" /></svg>`;
  const colorKey = cx.available
    ? `<span class="viz-lg">${dotSwatch("viz-dot")}no hotspot</span>
    <span class="viz-lg">${dotSwatch("viz-dot viz-dot-hot")}complexity hotspot (CCN ≥ ${cx.threshold})</span>`
    : `<span class="viz-lg">${dotSwatch("viz-dot")}changed file</span>
    <span class="viz-lg viz-lg-muted">complexity not measured (lizard unavailable)</span>`;

  return `<div class="card viz viz-span zoomable">
  <h3>Change map <span class="src">per file · measured</span></h3>
  <svg class="viz-scatter" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    <rect x="${midX}" y="${mT}" width="${plotW / 2}" height="${plotH / 2}" class="viz-danger" />
    <line x1="${mL}" y1="${midY}" x2="${W - mR}" y2="${midY}" class="viz-axis" />
    <line x1="${midX}" y1="${mT}" x2="${midX}" y2="${H - mB}" class="viz-axis" />
    <line x1="${mL}" y1="${mT}" x2="${mL}" y2="${H - mB}" stroke="${C_LINE}" />
    <line x1="${mL}" y1="${H - mB}" x2="${W - mR}" y2="${H - mB}" stroke="${C_LINE}" />
    <text x="${W - mR}" y="${H - mB + 24}" text-anchor="end" class="viz-axis-label">downstream reach →</text>
    <text x="${mL - 8}" y="${mT - 8}" class="viz-axis-label">↑ churn (± lines)</text>
    <text x="${midX + 8}" y="${mT + 16}" class="viz-axis-label viz-danger-label">high churn · high reach — review first</text>
    ${dots}
  </svg>
  <div class="viz-legend">
    ${colorKey}
    <span class="viz-lg"><svg class="viz-lg-dot" viewBox="0 0 36 14" width="34" height="13" aria-hidden="true"><circle cx="5" cy="7" r="3" class="viz-dot" /><circle cx="26" cy="7" r="6" class="viz-dot" /></svg>more hunks → bigger dot</span>
    <span class="viz-lg"><span class="viz-lg-zone"></span>review-first zone</span>
  </div>
  <p class="viz-cap">Each dot is one changed file, placed by how far it reaches — repo files that import it (x) — against how much it changed in lines (y). The further toward the top-right, the more it warrants a close read. Hover a dot for its exact numbers.</p>
</div>`;
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

/** "" for 1, "s" otherwise — for tooltip/caption pluralization. */
function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/** Truncate a path from the left, keeping the tail (most specific part). */
function shortPath(p: string, max: number): string {
  if (p.length <= max) return p;
  return "…" + p.slice(p.length - (max - 1));
}

// ── Tests: agent-described cases (claimed; pure display, never measured) ──

const KIND_ORDER = ["unit", "integration", "e2e", "manual"];
const KIND_COLOR: Record<string, string> = {
  unit: C_ADD_INK,
  integration: C_ACCENT,
  e2e: "var(--kind-e2e)",
  manual: C_WARN,
};
const kindColor = (key: string): string => KIND_COLOR[key] ?? "var(--viz-other)";

/** Pure: render the agent's human-readable test descriptions, grouped by kind.
 *  Returns "" when none were authored (the section is optional). */
function renderTests(tests: TestCase[]): string {
  if (tests.length === 0) return "";

  // Group by normalized kind, then order: known kinds first (fixed order), then
  // any other kinds in first-appearance order, then the untagged group last.
  const groups = new Map<string, TestCase[]>();
  for (const t of tests) {
    const key = (t.kind ?? "").trim().toLowerCase();
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  const keys = [...groups.keys()];
  const ordered = [
    ...KIND_ORDER.filter((k) => groups.has(k)),
    ...keys.filter((k) => k !== "" && !KIND_ORDER.includes(k)),
    ...(groups.has("") ? [""] : []),
  ];
  // A lone untagged group needs no header (it would just say "other").
  const flat = ordered.length === 1 && ordered[0] === "";

  const blocks = ordered
    .map((key) => {
      const items = groups
        .get(key)!
        .map((t) => {
          const name = t.name
            ? ` <code class="test-name">${esc(t.name)}</code>`
            : "";
          return `<li class="test-case">${md(t.describes)}${name}</li>`;
        })
        .join("\n      ");
      const header = flat
        ? ""
        : `<h4 class="test-kind">${esc(key || "other")}</h4>`;
      return `<div class="test-group" style="--k:${kindColor(key)}">
      ${header}
      <ul class="test-list">
      ${items}
      </ul>
    </div>`;
    })
    .join("\n    ");

  const n = tests.length;
  return `<div class="card tests">
  <h3>Tests <span class="src">claimed</span> <span class="muted test-count">${n} case${n === 1 ? "" : "s"} described</span></h3>
  ${blocks}
</div>`;
}

/** Architecture diagrams (the authored class + sequence mermaid). A plain
 *  full-width block — the surrounding "Deeper analysis" disclosure provides the
 *  collapse, so this no longer wraps itself in a band. */
function renderDiagrams(model: ReviewModel): string {
  const { class: cls, sequence } = model.diagrams;
  if (!cls && !sequence) return "";
  const block = (heading: string, src?: string) =>
    src
      ? `<section class="diagram zoomable">
  <h2>${esc(heading)}</h2>
  <pre class="mermaid">${esc(src)}</pre>
</section>`
      : "";
  return `<div class="architecture">
  <div class="section-subhead">Architecture <span class="src">authored</span></div>
  <div class="diagram-grid">
${block("Class diagram", cls)}
${block("Sequence diagram (changed steps highlighted)", sequence)}
  </div>
</div>`;
}

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

/** The merged file rail: the review-first ranking and the file index folded
 *  into one sticky spine. Each row is a clickable, review-ordered entry carrying
 *  an inline diff-mass sparkline (the old standalone chart, per-file) plus its
 *  measured chips. Anchors (`#file-<i>`) and ranked order are preserved so the
 *  viewed-state highlight and the guided tour keep working. */
function renderFileSpine(ranked: RankedFile[]): string {
  if (ranked.length === 0) {
    return `<div class="spine-head"><span class="spine-title">Files</span></div>
  <p class="spine-empty">No files changed in this diff.</p>`;
  }
  // Sparkline scale: longest single side across all files, each bar capped at
  // 40px so one big file doesn't blow out the rail. Centre axis at x=42 of 84.
  const maxSide = Math.max(1, ...ranked.map((r) => Math.max(r.added, r.removed)));
  const cap = 40;
  const rows = ranked
    .map((r) => {
      const remW = (r.removed / maxSide) * cap;
      const addW = (r.added / maxSide) * cap;
      const remX = 42 - remW;
      const spark = `<svg class="spine-spark" viewBox="0 0 84 10" width="84" height="10" aria-hidden="true">
        <line x1="42" y1="0" x2="42" y2="10" class="spine-axis" />
        <rect x="${remX.toFixed(1)}" y="2" width="${remW.toFixed(1)}" height="6" fill="${C_DEL}" fill-opacity=".85" />
        <rect x="42" y="2" width="${addW.toFixed(1)}" height="6" fill="${C_ADD}" fill-opacity=".85" />
      </svg>`;
      const chips =
        (r.hotspot
          ? `<span class="spine-chip spine-chip-ccn" title="complexity hotspot — CCN ${r.maxCcn}">CCN</span>`
          : "") +
        (r.missingIntent
          ? `<span class="spine-chip spine-chip-gap" title="some of this file has no written intent">GAP</span>`
          : "");
      return `<a class="spine-row" href="#${r.slug}">
    <span class="spine-rank">${r.rank}</span>
    <span class="spine-path">${esc(r.path)}</span>
    <span class="spine-sig">
      ${spark}
      <span class="spine-counts">+${r.added} −${r.removed}</span>
      ${chips}
    </span>
  </a>`;
    })
    .join("\n  ");
  const n = ranked.length;
  return `<div class="spine-head">
    <span class="spine-title">Files</span>
    <span class="spine-count">${n} changed</span>
  </div>
  <p class="spine-sub">Ranked by reach × churn — top of the list reads first.</p>
  <nav class="spine" aria-label="Changed files">
  ${rows}
  </nav>`;
}

function renderFile(file: AnnotatedFile, r: RankedFile): string {
  // Noise files (lockfiles, generated) start collapsed; real code starts open.
  const open = r.isNoise ? "" : " open";
  return `<details class="file${r.isNoise ? " is-noise" : ""}" id="${r.slug}"${open}>
  <summary class="file-head">
    <span class="status status-${file.status}">${file.status}</span>
    <code class="path">${esc(file.path)}</code>
    <span class="file-rank" title="review priority">#${r.rank}</span>
    ${fileBadges(r)}
    ${
      file.untracked
        ? `<span class="fbadge fbadge-uncommitted" title="new file, not yet committed">untracked</span>`
        : file.uncommitted
          ? `<span class="fbadge fbadge-uncommitted" title="has uncommitted changes (relative to HEAD)">uncommitted</span>`
          : ""
    }
    <label class="viewed-toggle" title="Mark as reviewed"><input type="checkbox" class="viewed-cb" /> seen</label>
  </summary>
  <div class="file-body">
  ${
    file.why
      ? `<div class="file-intent">${whatWhy(file.what, file.why)}</div>`
      : `<div class="file-intent missing">⚠ No rationale (what/why) written for this changed file.</div>`
  }
  ${annotateBox(r.slug, file.path, "file")}
  ${file.hunks.map((h, j) => renderHunk(h, r.index, j, file.path)).join("\n")}
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

/** A reviewer annotation affordance: a Comment box and an Ask box, side by
 *  side, each a hidden textarea the script persists. Pure markup; the textareas
 *  carry the data the assembled prompt is built from. `cid` is the comment's
 *  localStorage key (the question reuses it with a `q:` prefix); `ref` is the
 *  human-readable location shown in the prompt. `data-akind` lets the script tell
 *  comments from questions; `data-ckind` (on the group) tells hunk from file. */
function annotateBox(cid: string, ref: string, kind: "hunk" | "file", hdr?: string): string {
  const hdrAttr = hdr ? ` data-hdr="${esc(hdr)}"` : "";
  const where = kind === "hunk" ? "this hunk" : "this file";
  return `<div class="cbox-group" data-ckind="${kind}">
    <div class="cbox" data-akind="comment">
      <button class="cbtn" type="button" aria-label="Add a comment" title="Add a comment">Comment</button>
      <textarea class="cinput" data-cid="${esc(cid)}" data-ref="${esc(ref)}"${hdrAttr} data-akind="comment" placeholder="Note to the agent about ${where}…"></textarea>
    </div>
    <div class="cbox cbox-q" data-akind="question">
      <button class="cbtn cbtn-q" type="button" aria-label="Ask a question" title="Ask a question">Ask</button>
      <textarea class="cinput" data-cid="q:${esc(cid)}" data-ref="${esc(ref)}"${hdrAttr} data-akind="question" placeholder="Question for the agent about ${where}…"></textarea>
    </div>
  </div>`;
}

/** Render a what/why pair (the structured per-change intent). */
function whatWhy(what: string | undefined, why: string): string {
  const whatBlock = what
    ? `<div class="what"><span class="lbl">What</span> ${md(what)}</div>`
    : "";
  return `<div class="ww">${whatBlock}<div class="why"><span class="lbl">Why</span> ${md(why)}</div></div>`;
}

function renderHunk(hunk: AnnotatedHunk, fileIndex: number, hunkIndex: number, path: string): string {
  const cid = `file-${fileIndex}-hunk-${hunkIndex}`;
  const ref = `${path}:${hunk.newStart}${hunk.newEnd !== hunk.newStart ? `-${hunk.newEnd}` : ""}`;
  return `<div class="hunk-row">
  <div class="hunk-diff">
    <div class="hunk-header">${esc(hunk.header)}</div>
    <table class="diff">${hunk.lines.map(renderLine).join("")}</table>
  </div>
  <aside class="hunk-notes">
    ${
      hunk.intents.length
        ? hunk.intents.map((i) => `<div class="note">${whatWhy(i.what, i.why)}</div>`).join("")
        : `<div class="note missing">⚠ No intent for this hunk.</div>`
    }
    ${annotateBox(cid, ref, "hunk", hunk.header)}
  </aside>
</div>`;
}

function renderLine(line: DiffLine): string {
  const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  return `<tr class="ln ln-${line.type}">
  <td class="num">${line.oldNumber ?? ""}</td>
  <td class="num">${line.newNumber ?? ""}</td>
  <td class="sign">${sign}</td>
  <td class="code">${esc(line.content) || "&nbsp;"}</td>
</tr>`;
}

function renderFilesWithoutChanges(model: ReviewModel): string {
  if (model.filesWithoutChanges.length === 0) return "";
  return `<section class="orphans">
  <h2>Intent for files not in this diff</h2>
  <ul>${model.filesWithoutChanges
    .map(
      (f) =>
        `<li><code>${esc(f.path)}</code>${f.why ? `: ${md(f.why)}` : ""}</li>`,
    )
    .join("")}</ul>
</section>`;
}

/** Gathered review feedback: page-level comment + a live, readonly prompt the
 *  reviewer copies back to the agent. Assembly happens client-side in
 *  commentScript; this is the pure markup shell. */
function renderFeedbackPanel(model: ReviewModel, submit = false): string {
  if (model.files.length === 0) return "";
  return `<section class="review-feedback" id="feedback">
  <h2>Review feedback</h2>
  <p class="rf-hint">Comment or ask a question on any hunk or file, add overall notes here, then copy the assembled prompt back to the agent. Questions are listed first — they're the decisions the agent must resolve.</p>
  <label class="fb-general">
    <span class="fb-general-lbl">Overall comment</span>
    <textarea class="cinput fb-general-input" data-cid="__page__" data-ref="__general__" data-akind="comment" placeholder="Overall feedback on the change set…"></textarea>
  </label>
  <label class="fb-general">
    <span class="fb-general-lbl">Overall question</span>
    <textarea class="cinput fb-general-input" data-cid="q:__page__" data-ref="__general__" data-akind="question" placeholder="An overall question for the agent…"></textarea>
  </label>
  <div class="fb-summary"></div>
  <h3 class="fb-out-head">Prompt for the agent</h3>
  <textarea class="fb-output" readonly placeholder="Comments you add are gathered here as a prompt for the agent."></textarea>
  <div class="fb-actions">
    <button class="fb-copy" type="button">Copy as prompt</button>
    <span class="fb-copied" hidden>Copied ✓</span>
  </div>${submit ? `
  <div class="fb-submit">
    <button class="fb-approve" type="button">Approve</button>
    <button class="fb-request" type="button">Request changes</button>
    <span class="fb-sent" hidden>Sent — you can close this tab</span>
  </div>` : ""}
</section>`;
}

/** Escape text for safe HTML embedding. Also used for mermaid sources so the
 *  browser hands the correct characters to mermaid via textContent. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Tiny markdown subset: paragraphs, inline code, bold, italic, links.
 *  Deliberately minimal — intent prose, not a full document renderer. */
function md(src: string): string {
  const paragraphs = src.trim().split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      const inline = esc(p)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(
          /\[([^\]]+)\]\((https?:[^)]+)\)/g,
          '<a href="$2" rel="noreferrer">$1</a>',
        )
        .replace(/\n/g, "<br>");
      return `<p>${inline}</p>`;
    })
    .join("\n");
}

const CSS = `
/* ── review-intent · clean editorial dossier ───────────────────────────────
   Light, warm-paper canvas. Prose is set in a humanist sans; every *measured*
   value — vitals, metrics, code, labels — is set in mono, so the page reads
   like an instrument. Colour is rationed: green/red/amber carry meaning, one
   quiet blue carries structure. */
:root {
  --paper: #f5f3ee;      /* page canvas (warm paper) */
  --surface: #fffdf9;    /* cards / raised panels */
  --surface-2: #efece4;  /* recessed: diff gutter, file headers */
  --ink: #211f1b;        /* primary text */
  --ink-soft: #565249;   /* secondary text */
  --muted: #8e887c;      /* tertiary / labels */
  --line: #e4ded2;       /* hairline */
  --line-2: #d6cfbf;     /* stronger hairline */
  --accent: #2f5d9c;     /* the one structural accent */
  --accent-soft: #e9eff7;
  --add: #1f7a3d; --add-soft: #ebf4ed;
  --del: #bd3a2e; --del-soft: #faece9;
  --warn: #8a6400; --warn-soft: #f5eed8;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, Helvetica, Arial, sans-serif;
  --maxw: 1080px;
  /* Width of the two-pane shell (sticky file rail + main content column). */
  --shellw: 1500px;
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
  --viz-cell-stroke: #ffffff;
  --viz-noise: #9b958a; --viz-other: #7e776c;
  --viz-cell-label: #23211d; --viz-zone: rgba(189, 58, 46, 0.09);
  --kind-e2e: #7a4fa0;
  --viz-s1: #5b7db1; --viz-s2: #5fa389; --viz-s3: #b08a5a; --viz-s4: #a07ba6;
  --viz-s5: #c47d72; --viz-s6: #7fa86a; --viz-s7: #d0a85a; --viz-s8: #7a93b8;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font: 15px/1.6 var(--sans);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}

/* ── Two-pane shell: a permanent file rail beside the main column ── */
.shell {
  max-width: var(--shellw); margin: 0 auto;
  display: grid; grid-template-columns: 312px minmax(0, 1fr); align-items: start;
}
.rail {
  position: sticky; top: 43px; align-self: start;
  max-height: calc(100vh - 43px); overflow: auto;
  border-right: 1px solid var(--line); padding: 24px 20px 40px;
}
.main-col { min-width: 0; padding: 0 44px; }

/* Reusable section heads — the small lettered eyebrow and a lighter sub-head. */
.section-eyebrow {
  font: 700 12px/1 var(--mono); text-transform: uppercase; letter-spacing: .14em;
  color: var(--muted); margin: 0 0 16px;
}
.section-eyebrow-sub {
  font: 400 11px/1 var(--sans); text-transform: none; letter-spacing: 0; color: var(--muted);
}
.section-subhead {
  font: 700 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .1em;
  color: var(--muted); margin: 0 0 14px; display: flex; align-items: center; gap: 10px;
}

/* Below the rail breakpoint the shell collapses to one column and the rail
   un-sticks to a banded strip at the top. */
@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .rail {
    position: static; max-height: 320px; overflow: auto;
    border-right: 0; border-bottom: 1px solid var(--line); padding: 20px 22px;
  }
  .main-col { padding: 0 22px; }
}

/* ── Masthead ── */
.page-head { max-width: 760px; padding: 44px 0 28px; }
.eyebrow {
  font: 600 12px/1 var(--mono); letter-spacing: .08em; color: var(--muted);
  text-transform: uppercase; margin-bottom: 18px;
}
.eyebrow-diff {
  color: var(--accent); background: var(--accent-soft);
  border-radius: 5px; padding: 3px 8px; margin-left: 4px; letter-spacing: .02em;
}
.page-head h1 {
  margin: 0 0 18px; font-size: clamp(26px, 4vw, 38px); line-height: 1.12;
  font-weight: 720; letter-spacing: -.02em; max-width: 22ch;
}
.tldr {
  max-width: 70ch; font-size: 19px; line-height: 1.5; color: var(--ink-soft);
  margin: 0 0 22px;
}
.tldr p { margin: 0; }
.overall-wrap { max-width: 72ch; border-top: 1px solid var(--line); padding-top: 16px; }
.overall-wrap > summary {
  cursor: pointer; color: var(--muted); font: 600 11px/1 var(--mono);
  text-transform: uppercase; letter-spacing: .1em; list-style: none;
  display: inline-flex; align-items: center; gap: 7px; user-select: none;
}
.overall-wrap > summary::-webkit-details-marker { display: none; }
.overall-wrap > summary::before { content: "›"; font-size: 15px; transition: transform .15s; display: inline-block; }
.overall-wrap[open] > summary::before { transform: rotate(90deg); }
.overall { color: var(--ink-soft); margin-top: 14px; font-size: 15px; }
.overall p { margin: 0 0 12px; }

/* ── File rail · merged spine (priority list + nav in one) ── */
.spine-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
.spine-title {
  font: 700 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .14em; color: var(--muted);
}
.spine-count { font: 11px/1 var(--mono); color: var(--muted); }
.spine-sub { font-size: 11.5px; color: var(--muted); margin: 0 0 16px; line-height: 1.4; }
.spine-empty { color: var(--muted); font-size: 13px; }
.spine { display: flex; flex-direction: column; gap: 2px; }
.spine-row {
  display: grid; grid-template-columns: 22px 1fr; gap: 3px 10px;
  padding: 9px; border-radius: 8px; text-decoration: none; color: var(--ink);
}
.spine-row:hover { background: var(--surface-2); }
.spine-row.active { background: var(--accent-soft); }
.spine-row.viewed { opacity: .5; }
.spine-row.viewed:hover { opacity: 1; }
.spine-rank {
  grid-row: span 2; font: 700 12px/1.4 var(--mono); color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.spine-path { font: 12px/1.35 var(--mono); overflow-wrap: anywhere; }
.spine-sig { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.spine-spark { flex: none; }
.spine-axis { stroke: var(--line-2); stroke-width: 1; }
.spine-counts {
  font: 10.5px/1 var(--mono); color: var(--muted); white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.spine-chip {
  font: 700 9px/1.4 var(--mono); border-radius: 4px; padding: 1px 4px;
}
.spine-chip-ccn { color: var(--del); background: var(--del-soft); border: 1px solid var(--del-border); }
.spine-chip-gap { color: var(--warn); background: var(--warn-soft); border: 1px solid var(--warn-border); }

/* ── Verdict line: one measured "where to look" sentence ── */
.verdict {
  display: flex; gap: 12px; align-items: flex-start;
  padding: 14px 16px; border-radius: 10px; max-width: 760px; margin: 0 0 28px;
  border: 1px solid var(--line-2); background: var(--surface);
}
.verdict-warn { background: var(--del-soft); border-color: var(--del-border); }
.verdict-ok { background: var(--add-soft); border-color: var(--add-border); }
.verdict-icon { font-size: 15px; line-height: 1.4; flex: none; margin-top: 1px; }
.verdict-warn .verdict-icon { color: var(--del); }
.verdict-ok .verdict-icon { color: var(--add); }
.verdict-msg { font-size: 14.5px; line-height: 1.5; color: var(--ink); }

/* ── Change summary band: change map stacked above the risk ledger, each
   spanning the full content column (as wide as the test overview) ── */
.change-summary { margin: 0 0 28px; }
.cs-grid {
  display: grid; grid-template-columns: 1fr;
  gap: 18px; align-items: start;
}

/* ── Deeper analysis: the demoted analytics behind one disclosure ── */
.deeper { margin: 0 0 32px; }
.deeper-head {
  cursor: pointer; list-style: none; display: flex; align-items: center; gap: 10px;
  font: 700 12px/1 var(--mono); text-transform: uppercase; letter-spacing: .14em; color: var(--muted);
  padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
}
.deeper-head::-webkit-details-marker { display: none; }
.deeper-plus { color: var(--muted); transition: transform .15s; display: inline-block; }
.deeper[open] > .deeper-head .deeper-plus { transform: rotate(45deg); }
.deeper-sub {
  font: 400 11px/1 var(--sans); text-transform: none; letter-spacing: 0; color: var(--muted);
}
.deeper-body { padding-top: 22px; }
.architecture { margin-bottom: 28px; }
.deeper-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px; align-items: start;
}

/* ── Vitals: the single, deduped source of the top-line counts ── */
.vitals {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 1px; background: var(--line);
  border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
  margin: 0 0 32px;
}
/* Cells sit on the surface; the 1px grid gap reveals the container's line colour
   as a hairline between every cell — clean dividers at any column count. */
.vital {
  min-width: 0; padding: 14px 18px; background: var(--surface);
  display: flex; flex-direction: column; gap: 5px;
}
.vital-num {
  font: 600 26px/1 var(--mono); letter-spacing: -.01em; color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.vital-lbl {
  font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted);
}
.vital-add .vital-num { color: var(--add); }
.vital-del .vital-num { color: var(--del); }
.vital-warn .vital-num { color: var(--warn); }

/* ── Cards ── */
.card {
  background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
  padding: 18px 20px;
}
.card h3 {
  margin: 0 0 14px; font-size: 14px; font-weight: 680;
  display: flex; align-items: center; gap: 10px;
}
/* claimed vs measured provenance tag — quiet, lettered */
.src {
  font: 600 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em;
  color: var(--muted); background: var(--surface-2);
  border-radius: 4px; padding: 3px 7px;
}

.blast-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.metrics { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-bottom: 14px; font: 13px/1.4 var(--mono); }
.metrics > span { font-variant-numeric: tabular-nums; }
.metrics b { font-weight: 680; }
.metrics .add { color: var(--add); }
.metrics .del { color: var(--del); }
.metrics-extra {
  font-size: 12px; color: var(--ink-soft); gap: 8px 16px;
  padding-top: 14px; border-top: 1px solid var(--line);
}
.metrics-extra code { font-size: 11px; padding: 1px 5px; }
.metrics-extra .flag { color: var(--del); font-weight: 700; }
.muted { color: var(--muted); }
.badges { display: flex; flex-wrap: wrap; gap: 8px; }
.badge {
  font: 600 11px/1.5 var(--mono); letter-spacing: .02em;
  border-radius: 6px; padding: 3px 9px; border: 1px solid var(--line-2);
  color: var(--ink-soft); background: var(--surface-2);
}
.tone-danger { background: var(--del-soft); color: var(--del); border-color: var(--del-border); }
.tone-warn { background: var(--warn-soft); color: var(--warn); border-color: var(--warn-border); }
.tone-info { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-border); }
.tone-ok { background: var(--add-soft); color: var(--add); border-color: var(--add-border); }

.risk-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.risk-table th {
  text-align: left; color: var(--muted); font: 600 11px/1 var(--mono);
  text-transform: uppercase; letter-spacing: .06em;
  padding: 0 10px 8px; border-bottom: 1px solid var(--line-2);
}
.risk-table td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; color: var(--ink-soft); }
.risk-table tr:last-child td { border-bottom: 0; }
.risk-table td p, .risks .nudge p { margin: 0; }
.nudge { color: var(--warn); font-size: 13.5px; background: var(--warn-soft); border-radius: 8px; padding: 12px 14px; }
/* ── Visual-summary charts (change map · coverage rings · complexity) ── */
.viz.viz-span { grid-column: auto; }
.viz svg { width: 100%; height: auto; display: block; }
.viz-diffmass, .viz-treemap, .viz-complexity, .viz-scatter { max-width: 720px; }
.zoomable { cursor: zoom-in; position: relative; transition: border-color .15s, box-shadow .15s; }
.zoomable:hover { border-color: var(--accent); box-shadow: 0 2px 14px var(--accent-shadow); }
.zoomable::after {
  content: "⤢ expand"; position: absolute; top: 10px; right: 12px;
  font: 600 10px/1 var(--mono); letter-spacing: .04em; color: var(--accent);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 5px;
  padding: 3px 7px; opacity: 0; transition: opacity .15s; pointer-events: none;
}
.zoomable:hover::after { opacity: 1; }
.viz-cap { color: var(--muted); font-size: 11.5px; margin: 10px 0 0; line-height: 1.5; }
.viz-label { font-family: var(--mono); font-size: 11px; fill: var(--ink-soft); }
.viz-num { fill: var(--muted); font-family: var(--mono); font-size: 10px; }
.viz-axis { stroke: var(--line-2); stroke-width: 1; }
.viz-rings { display: flex; gap: 8px; justify-content: space-around; }
.viz-ring-svg { max-width: 150px; }
.viz-ring-pct { fill: var(--ink); font-size: 22px; font-weight: 700; font-family: var(--sans); }
.viz-ring-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
.viz-danger { fill: var(--viz-zone); }
.viz-danger-label { fill: var(--del); }
.viz-axis-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
.viz-cell-label { fill: var(--viz-cell-label); font-family: var(--mono); font-size: 10px; font-weight: 600; }
.viz-ripple { max-width: 720px; margin: 0 auto; }
.ripple-ring { fill: none; stroke: var(--line-2); stroke-dasharray: 3 5; }
.ripple-edge { stroke: var(--accent); stroke-width: 1; opacity: 0.32; }
.ripple-label { fill: var(--muted); font-family: var(--mono); font-size: 10px; }
.reach-note { color: var(--warn); font-size: 12px; margin-top: 10px; }
.viz-dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2.5; }
.viz-dot-hot { fill: var(--del); }
.viz-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 12px; }
.viz-lg { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-soft); }
.viz-lg-muted { color: var(--muted); }
.viz-lg-dot { flex: none; }
.viz-lg-zone { width: 13px; height: 13px; border-radius: 3px; background: var(--viz-zone); border: 1px solid var(--del-border); }

/* ── Tests (claimed) ── */
.tests .test-count { font-size: 12px; font-weight: 400; font-family: var(--sans); text-transform: none; letter-spacing: 0; color: var(--muted); }
.tests h3 { margin-bottom: 16px; }
/* Tests is its own full-width section under Deeper analysis, below the grid. */
.deeper-body > .tests { margin-top: 16px; }
.test-group { margin-bottom: 22px; max-width: 80ch; }
.test-group:last-child { margin-bottom: 0; }
.test-kind {
  display: flex; align-items: center; gap: 12px; margin: 0 0 8px;
  font: 700 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em;
  color: var(--k, var(--muted));
}
.test-kind::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.test-list { list-style: none; margin: 0; padding: 0; }
.test-case {
  position: relative; padding: 8px 0 8px 22px; border-bottom: 1px solid var(--line);
  color: var(--ink-soft);
}
.test-group:last-child .test-case:last-child { border-bottom: 0; }
.test-case::before {
  content: ""; position: absolute; left: 4px; top: 15px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--k, var(--muted));
}
.test-case p { display: inline; margin: 0; }
.test-name {
  font-size: 11px; color: var(--muted);
  background: var(--surface-2); margin-left: 7px;
}

/* ── Diagrams ── */
.diagram-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 18px; align-items: start;
}
.diagram { margin: 0; }
.diagram h2 { font-size: 13px; color: var(--ink-soft); margin: 0 0 10px; font-weight: 680; }
.diagram.zoomable { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; }
.mermaid {
  background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
  padding: 16px; overflow: auto;
}

/* ── File diffs — the primary content, now the visual centre ── */
.diffs { padding-bottom: 80px; }
main { display: flex; flex-direction: column; gap: 24px; }
.file {
  border: 1px solid var(--line); border-radius: 10px;
  overflow: hidden; background: var(--surface);
}
.file-head {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-bottom: 1px solid var(--line); background: var(--surface-2);
}
.path { font-family: var(--mono); font-size: 13px; color: var(--ink); min-width: 0; overflow-wrap: anywhere; }
.status {
  font: 700 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em;
  padding: 4px 8px; border-radius: 5px;
}
.status-added { background: var(--add-soft); color: var(--add); }
.status-deleted { background: var(--del-soft); color: var(--del); }
.status-modified { background: var(--accent-soft); color: var(--accent); }
.status-renamed { background: var(--warn-soft); color: var(--warn); }
.file-intent {
  padding: 16px; color: var(--ink-soft); border-bottom: 1px solid var(--line);
}
.file-intent p { margin: 0 0 8px; }
.hunk-row {
  display: grid; grid-template-columns: 1fr 340px; gap: 0;
  border-top: 1px solid var(--line);
}
.hunk-diff { overflow: auto; min-width: 0; }
.hunk-header {
  font-family: var(--mono); font-size: 12px; color: var(--accent);
  padding: 7px 14px; background: var(--surface-2); border-bottom: 1px solid var(--line);
}
table.diff { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 12.5px; }
.ln td { padding: 1px 8px; white-space: pre; vertical-align: top; }
.num { color: var(--muted); text-align: right; width: 1%; user-select: none; }
.sign { width: 1%; user-select: none; color: var(--muted); }
.code { width: 100%; color: var(--ink); }
.ln-add { background: var(--add-soft); }
.ln-add .code { color: var(--code-add); }
.ln-add .sign { color: var(--add); }
.ln-del { background: var(--del-soft); }
.ln-del .code { color: var(--code-del); }
.ln-del .sign { color: var(--del); }
.hunk-notes {
  border-left: 1px solid var(--line); padding: 14px 16px; background: var(--paper);
}
.note { margin-bottom: 12px; }
.note:last-child { margin-bottom: 0; }
.note p { margin: 0 0 6px; }
.ww .what, .ww .why { margin-bottom: 7px; }
.ww .why { margin-bottom: 0; }
.ww p { margin: 0; display: inline; }
.lbl {
  display: inline-block; font: 700 9.5px/1.6 var(--mono); text-transform: uppercase;
  letter-spacing: .06em; color: var(--muted); margin-right: 7px;
  border: 1px solid var(--line-2); border-radius: 4px; padding: 1px 5px; vertical-align: 1px;
}
.missing {
  color: var(--del); font-weight: 600; font-size: 13px;
  background: var(--del-soft); border: 1px solid var(--del-border); border-radius: 8px;
  padding: 10px 12px;
}
.file-intent.missing { margin: 0; border-radius: 0; border-left: 0; border-right: 0; }
.anchor {
  display: inline-block; font-family: var(--mono); font-size: 11px;
  color: var(--muted); margin-bottom: 4px;
}
.unmatched, .orphans { padding: 14px 16px; border-top: 1px solid var(--line); color: var(--ink-soft); }
.orphans { background: transparent; }
.orphans h2 { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .14em; margin: 0 0 12px; }
.orphans ul { margin: 0; padding-left: 20px; }
.unmatched h4 { margin: 0 0 8px; color: var(--warn); font: 700 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em; }
code {
  font-family: var(--mono); font-size: .92em;
  background: var(--surface-2); padding: 1px 5px; border-radius: 4px;
}
.empty { color: var(--muted); }
a { color: var(--accent); text-underline-offset: 2px; }
@media (max-width: 820px) {
  .hunk-row { grid-template-columns: 1fr; }
  .hunk-notes { border-left: 0; border-top: 1px dashed var(--line-2); }
}

/* ── Lightbox: click a thumbnail to view a figure full-size ── */
#lightbox {
  position: fixed; inset: 0; z-index: 1000; display: none;
  align-items: center; justify-content: center; padding: 40px;
  background: rgba(33, 31, 27, 0.5); backdrop-filter: blur(3px);
}
#lightbox.open { display: flex; }
.lightbox-stage {
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 12px;
  padding: 24px 28px; max-width: 1100px; width: 100%; max-height: 90vh; overflow: auto;
  box-shadow: 0 24px 60px rgba(33,31,27,.22);
}
.lightbox-stage .card { background: transparent; border: 0; padding: 0; cursor: auto; }
.lightbox-stage .zoomable::after { content: none; }
.lightbox-stage svg { max-height: none; }
.lightbox-stage .mermaid { max-height: none; overflow: auto; border: 0; padding: 0; }
.lightbox-stage .diagram.zoomable { border: 0; padding: 0; }
.lightbox-stage .diagram.zoomable h2 { font-size: 16px; }
.lightbox-close {
  position: fixed; top: 16px; right: 22px; z-index: 1001;
  background: var(--surface); color: var(--ink); border: 1px solid var(--line-2);
  border-radius: 8px; font-size: 18px; line-height: 1; cursor: pointer;
  padding: 8px 13px;
}
.lightbox-close:hover { border-color: var(--accent); color: var(--accent); }

/* ── Sticky utility bar ── */
html { scroll-behavior: smooth; scroll-padding-top: 48px; }
.topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: 16px;
  /* Align the bar's content with the shell's left gutter (rail inset) on wide
     screens; floor to a small inset on narrow ones. */
  padding: 9px max(18px, calc((100% - var(--shellw)) / 2 + 20px));
  background: var(--glass);
  backdrop-filter: blur(6px); border-bottom: 1px solid var(--line);
  font: 12px/1 var(--mono);
}
/* Title absorbs all shrinkage and truncates; the counter + link never shrink. */
.tb-title { flex: 0 1 auto; min-width: 0; font-weight: 700; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-progress { flex: none; margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tb-top { flex: none; color: var(--accent); text-decoration: none; white-space: nowrap; }
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
.fbadge-hot { color: var(--del); border-color: var(--del-border); background: var(--del-soft); }
.fbadge-gap { color: var(--warn); border-color: var(--warn-border); background: var(--warn-soft); }
.fbadge-uncommitted { background: var(--warn-soft); color: var(--warn); border-color: var(--warn-border); }
.diff-scope-banner {
  max-width: var(--shellw); margin: 14px auto 6px; padding: 10px 14px;
  border-radius: 8px; background: var(--warn-soft); color: var(--warn);
  border: 1px solid var(--warn); font-size: 14px;
}
.viewed-toggle {
  margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
  font: 600 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
  cursor: pointer; user-select: none;
}
.file.viewed { opacity: .55; }
.file.viewed:hover { opacity: 1; }

/* ── Phones ── */
@media (max-width: 560px) {
  .vital-num { font-size: 22px; }
  /* The 3-column risk ledger can't stay legible much below ~460px — let it
     scroll inside its card rather than crushing every column to a sliver. */
  .risks { overflow-x: auto; }
  .risk-table { min-width: 440px; }
  /* Give the lightbox the whole small screen. */
  #lightbox { padding: 12px; }
  .lightbox-close { top: 8px; right: 10px; }
}


/* ── Review annotations (comments + questions) ── */
.cbox-group { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
/* File-level Comment/Ask row sits directly in the unpadded .file-body — inset it
   to align with the .file-intent box above and give the hunk below breathing room. */
.file-body > .cbox-group { padding: 0 16px 14px; }
.hunk-notes .cbox-group { margin-top: 12px; border-top: 1px dashed var(--line-2); padding-top: 10px; }
.cbox { display: inline-flex; }
.cbox.open { flex-basis: 100%; flex-direction: column; }
.cbtn {
  font: 600 12px/1 var(--mono); cursor: pointer; color: var(--ink-soft);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 7px; padding: 6px 11px;
}
.cbtn:hover { border-color: var(--accent); color: var(--accent); }
.cbox.has-comment .cbtn { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.cbox.has-comment .cbtn::after { content: " •"; }
.cbtn-q { color: var(--add); }
.cbtn-q:hover { border-color: var(--add); color: var(--add); }
.cbox.has-question .cbtn-q { border-color: var(--add); background: var(--add-soft, var(--accent-soft)); color: var(--add); }
.cbox.has-question .cbtn-q::after { content: " •"; }
.cinput {
  display: none; width: 100%; margin-top: 8px; resize: vertical; min-height: 54px;
  font: 13px/1.5 var(--sans); color: var(--ink);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 8px; padding: 8px 10px;
}
.cbox.open .cinput { display: block; }
.q-ask { display: none; margin-top: 8px; align-self: flex-start; font: inherit; font-size: 0.85em; padding: 3px 10px; border: 1px solid var(--add); border-radius: 6px; background: var(--add-soft, var(--accent-soft)); color: var(--add); cursor: pointer; }
.cbox.open .q-ask { display: inline-block; }
.q-ask:disabled { opacity: 0.7; cursor: default; }
.q-answer { display: none; margin-top: 8px; padding: 8px 10px; border-left: 3px solid var(--add); background: var(--accent-soft); border-radius: 0 6px 6px 0; white-space: pre-wrap; }
.cbox.open .q-answer { display: block; }
.q-answer.pending { opacity: 0.7; font-style: italic; }
.cbox.q-resolved .cbtn-q::after { content: " ✓"; }

/* ── Review feedback panel ── */
.review-feedback { max-width: var(--maxw); margin: 0 auto; padding: 36px 40px; border-top: 1px solid var(--line); }
.review-feedback > h2 {
  margin: 0 0 8px; font-size: 12px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .14em;
}
.rf-hint { color: var(--muted); font-size: 13px; margin: 0 0 18px; max-width: 72ch; }
.fb-general { display: block; margin-bottom: 14px; }
.fb-general-lbl { display: block; font: 600 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 6px; }
.fb-general-input {
  display: block; width: 100%; resize: vertical; min-height: 60px;
  font: 13px/1.5 var(--sans); color: var(--ink);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 8px; padding: 8px 10px;
}
.fb-summary { font: 12px/1 var(--mono); color: var(--muted); margin-bottom: 14px; }
.fb-out-head { margin: 0 0 8px; font-size: 13px; font-weight: 680; color: var(--ink-soft); }
.fb-output {
  display: block; width: 100%; min-height: 160px; resize: vertical;
  font: 12.5px/1.55 var(--mono); color: var(--ink);
  background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 8px; padding: 12px 14px;
}
.fb-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.fb-copy {
  font: 600 12px/1 var(--mono); cursor: pointer; color: var(--on-accent);
  background: var(--accent); border: 1px solid var(--accent); border-radius: 8px; padding: 9px 16px;
}
.fb-copy:hover { filter: brightness(1.06); }
.fb-copied { color: var(--add); font: 600 12px/1 var(--mono); }

/* ── Guided tour ── */
.tb-tour {
  flex: none; font: 600 11px/1 var(--mono); cursor: pointer; color: var(--accent);
  background: var(--accent-soft); border: 1px solid var(--accent-border); border-radius: 6px; padding: 5px 9px;
}
.tb-tour:hover { border-color: var(--accent); }
.tour {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 80;
  display: flex; align-items: center; gap: 12px;
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 12px;
  padding: 10px 14px; box-shadow: 0 10px 30px rgba(33,31,27,.18);
  font: 12px/1.2 var(--mono); max-width: calc(100vw - 32px);
}
.tour[hidden] { display: none; }
.tour-status { color: var(--ink-soft); }
.tour-status b { color: var(--ink); }
.tour-path { font-size: 11.5px; background: none; padding: 0; color: var(--accent); overflow-wrap: anywhere; }
.tour-btn {
  flex: none; font: 600 12px/1 var(--mono); cursor: pointer; color: var(--ink-soft);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 7px; padding: 6px 10px;
}
.tour-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.tour-btn:disabled { opacity: .4; cursor: default; }
.tour-flash { animation: tour-flash 1.2s ease-out; }
@keyframes tour-flash {
  0% { box-shadow: 0 0 0 3px var(--accent); }
  100% { box-shadow: 0 0 0 3px transparent; }
}
@media (max-width: 560px) {
  .tour { flex-wrap: wrap; justify-content: center; bottom: 10px; }
}
${themeCss()}
`;

const MERMAID_SCRIPT = `<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "strict" });
</script>`;

/** Empty overlay the lightbox script clones the clicked figure into. */
const LIGHTBOX = `<div id="lightbox" role="dialog" aria-modal="true" aria-label="Figure detail">
  <button class="lightbox-close" type="button" aria-label="Close">✕</button>
  <div class="lightbox-stage"></div>
</div>`;

/** Fixed guided-review control, hidden until the tour starts. */
const TOUR = `<div class="tour" id="tour" hidden role="region" aria-label="Guided review">
  <button class="tour-btn tour-prev" type="button">‹ Prev</button>
  <span class="tour-status">Reviewing <b class="tour-cur">1</b> of <b class="tour-total">0</b> — <code class="tour-path"></code></span>
  <button class="tour-btn tour-next" type="button">Next ›</button>
  <button class="tour-btn tour-exit" type="button" aria-label="Exit guided review">✕</button>
</div>`;

/** Static, dependency-free progressive enhancement: persist "seen" files,
 *  keep the topbar counter in sync, and highlight the active file in the index.
 *  Storage key is deterministic (title@base) so it stays per-change. */
function viewedScript(model: ReviewModel): string {
  const KEY = `review-intent:viewed:${model.title}@${model.base}`;
  return `<script>
  (function () {
    var KEY = ${JSON.stringify(KEY).replace(/<\//g, "<\\/")};
    var store;
    try { store = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { store = {}; }
    var files = Array.prototype.slice.call(document.querySelectorAll("details.file"));
    var prog = document.querySelector(".tb-progress");
    // The file rail (spine) links by anchor — reused for both the active-file
    // highlight and to dim a row once its file is marked reviewed.
    var links = {};
    document.querySelectorAll(".rail a[href^='#']").forEach(function (a) {
      links[a.getAttribute("href").slice(1)] = a;
    });
    function dim(id, on) { var a = links[id]; if (a) a.classList.toggle("viewed", on); }
    function update() {
      if (!prog) return;
      var done = files.filter(function (f) { return f.classList.contains("viewed"); }).length;
      prog.textContent = done + " / " + files.length + " reviewed";
    }
    files.forEach(function (f) {
      var cb = f.querySelector(".viewed-cb");
      var toggle = f.querySelector(".viewed-toggle");
      if (!cb) return;
      if (store[f.id]) { cb.checked = true; f.classList.add("viewed"); f.open = false; dim(f.id, true); }
      // Don't let the control toggle the <details> it lives in.
      if (toggle) toggle.addEventListener("click", function (e) { e.stopPropagation(); });
      cb.addEventListener("change", function () {
        if (cb.checked) { f.classList.add("viewed"); f.open = false; store[f.id] = 1; dim(f.id, true); }
        else { f.classList.remove("viewed"); delete store[f.id]; f.open = true; dim(f.id, false); }
        try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
        update();
      });
    });
    update();

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

/** Static enhancement: persist reviewer annotations (comments + questions,
 *  per-change like viewed state), keep the gathered-prompt textarea + summary in
 *  sync, and copy. Questions are emitted first — they're the blocking decisions.
 *  Each kind is bucketed by the textarea's data-akind; within a kind, items are
 *  grouped by file then hunk in DOM order (= review order). */
function commentScript(model: ReviewModel, submit = false): string {
  const KEY = `review-intent:comments:${model.title}@${model.base}`;
  const META = JSON.stringify({ title: model.title, base: model.base }).replace(/<\//g, "<\\/");
  return `<script>
  (function () {
    var KEY = ${JSON.stringify(KEY).replace(/<\//g, "<\\/")};
    var META = ${META};
    var store;
    try { store = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { store = {}; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

    var inputs = Array.prototype.slice.call(document.querySelectorAll(".cinput"));
    var out = document.querySelector(".fb-output");
    var summary = document.querySelector(".fb-summary");
    function clean(s) { return s.replace(/\\r/g, "").trim(); }
    function indent(s) { return clean(s).replace(/\\n/g, "\\n  "); }
    function mark(t) {
      var b = t.closest(".cbox"); if (!b) return;
      var cls = t.getAttribute("data-akind") === "question" ? "has-question" : "has-comment";
      b.classList.toggle(cls, !!clean(t.value));
    }
    function reveal(t) { var b = t.closest(".cbox"); if (b) b.classList.add("open"); }

    // Gather one kind ("comment" | "question") grouped by file -> hunk, plus its
    // page-level box. Returns { lines: [...], count: n }.
    function collect(akind, files) {
      var lines = [], count = 0;
      function live(el) { var b = el.closest(".cbox"); return !(akind === "question" && b && b.classList.contains("q-resolved")); }
      files.forEach(function (f) {
        var code = f.querySelector(".path");
        var path = code ? code.textContent : f.id;
        var section = [];
        var fc = f.querySelector('.cbox-group[data-ckind="file"] .cinput[data-akind="' + akind + '"]');
        if (fc && clean(fc.value) && live(fc)) { section.push("- " + indent(fc.value)); count++; }
        f.querySelectorAll('.cbox-group[data-ckind="hunk"] .cinput[data-akind="' + akind + '"]').forEach(function (hc) {
          if (clean(hc.value) && live(hc)) {
            var ref = hc.getAttribute("data-ref"), hdr = hc.getAttribute("data-hdr");
            section.push("### " + ref + (hdr ? "  (" + hdr + ")" : ""));
            section.push("- " + indent(hc.value));
            count++;
          }
        });
        if (section.length) { lines.push("## " + path); lines.push.apply(lines, section); lines.push(""); }
      });
      var pgCid = akind === "question" ? "q:__page__" : "__page__";
      var pg = document.querySelector('.cinput[data-cid="' + pgCid + '"]');
      if (pg && clean(pg.value) && live(pg)) { lines.push("## General"); lines.push("- " + indent(pg.value)); lines.push(""); count++; }
      return { lines: lines, count: count };
    }

    function assemble() {
      var files = Array.prototype.slice.call(document.querySelectorAll("details.file"));
      var done = files.filter(function (f) { return f.classList.contains("viewed"); }).length;
      var q = collect("question", files);
      var c = collect("comment", files);
      if (out) {
        if (q.count === 0 && c.count === 0) { out.value = ""; }
        else {
          var head = 'Review feedback on "' + META.title + '" (' + META.base + "...HEAD).\\n" +
            "Sign-off: " + done + " / " + files.length + " files reviewed. " +
            q.count + " question" + (q.count === 1 ? "" : "s") + ", " +
            c.count + " comment" + (c.count === 1 ? "" : "s") + " below.\\n";
          var blocks = [];
          if (q.count) { blocks.push("# Questions (please answer)"); blocks = blocks.concat(q.lines); }
          if (c.count) { blocks.push("# Comments"); blocks = blocks.concat(c.lines); }
          out.value = head + "\\n" + blocks.join("\\n").replace(/\\n+$/, "") + "\\n";
        }
      }
      if (summary) {
        summary.textContent = done + " / " + files.length + " files reviewed · " +
          q.count + " question" + (q.count === 1 ? "" : "s") + " · " +
          c.count + " comment" + (c.count === 1 ? "" : "s");
      }
    }

    inputs.forEach(function (t) {
      var cid = t.getAttribute("data-cid");
      if (store[cid]) { t.value = store[cid]; reveal(t); }
      mark(t);
      t.addEventListener("input", function () {
        if (clean(t.value)) store[cid] = t.value; else delete store[cid];
        save(); mark(t); assemble();
      });
    });

    document.querySelectorAll(".cbtn").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        var box = b.closest(".cbox"); if (!box) return;
        box.classList.toggle("open");
        if (box.classList.contains("open")) { var ta = box.querySelector(".cinput"); if (ta) ta.focus(); }
      });
    });

    var copyBtn = document.querySelector(".fb-copy"), copied = document.querySelector(".fb-copied");
    if (copyBtn && out) {
      copyBtn.addEventListener("click", function () {
        assemble();
        var text = out.value; if (!text) return;
        function flash() { if (copied) { copied.hidden = false; setTimeout(function () { copied.hidden = true; }, 1600); } }
        out.select();
        var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(flash, function () { if (ok) flash(); });
        } else if (ok) { flash(); }
      });
    }
${submit ? `
    var approveBtn = document.querySelector(".fb-approve");
    var requestBtn = document.querySelector(".fb-request");
    var sent = document.querySelector(".fb-sent");
    var done = false;
    // Heartbeat while the page is open so the server can tell a slow review
    // (tab still open) from an abandoned one (tab closed). Stops once submitted.
    var beat = setInterval(function () {
      if (!done) fetch("/heartbeat", { method: "POST" }).catch(function () {});
    }, 4000);
    // Fast-path abandonment signal: tell the server immediately on tab close so
    // it need not wait out the heartbeat grace window.
    window.addEventListener("pagehide", function () {
      if (!done && navigator.sendBeacon) navigator.sendBeacon("/cancel");
    });
    function send(decision) {
      assemble();
      var prompt = out ? out.value : "";
      if (approveBtn) approveBtn.disabled = true;
      if (requestBtn) requestBtn.disabled = true;
      fetch("/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: decision, prompt: prompt })
      }).then(function () {
        done = true;
        clearInterval(beat);
        if (sent) { sent.textContent = "Sent — you can close this tab"; sent.hidden = false; }
      }).catch(function () {
        if (approveBtn) approveBtn.disabled = false;
        if (requestBtn) requestBtn.disabled = false;
        if (sent) { sent.textContent = "Submit failed — is the review server still running? Try again."; sent.hidden = false; }
      });
    }
    if (approveBtn) approveBtn.addEventListener("click", function () { send("approve"); });
    if (requestBtn) requestBtn.addEventListener("click", function () { send("request-changes"); });
    // ── Live Q&A: ask the agent about a hunk while the review stays open ──
    var es = null;
    try { es = new EventSource("/events"); } catch (e) {}
    function ansSlot(cbox) {
      var slot = cbox.querySelector(".q-answer");
      if (!slot) { slot = document.createElement("div"); slot.className = "q-answer"; cbox.appendChild(slot); }
      return slot;
    }
    Array.prototype.slice.call(document.querySelectorAll('.cinput[data-akind="question"]')).forEach(function (ta) {
      var cbox = ta.closest(".cbox"); if (!cbox) return;
      var ask = document.createElement("button");
      ask.type = "button"; ask.className = "q-ask"; ask.textContent = "Submit";
      ta.insertAdjacentElement("afterend", ask);
      ask.addEventListener("click", function () {
        var q = clean(ta.value); if (!q) return;
        var qid = ta.getAttribute("data-cid");
        var ref = ta.getAttribute("data-ref") || qid;
        ask.disabled = true; ask.textContent = "Waiting for the agent…";
        var slot = ansSlot(cbox); slot.className = "q-answer pending"; slot.textContent = "Waiting for the agent…";
        fetch("/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: qid, ref: ref, question: q })
        }).then(function (r) {
          if (!r.ok) {
            ask.disabled = false; ask.textContent = "Submit";
            slot.className = "q-answer"; slot.textContent = "Server error (" + r.status + ") — the review session may have expired.";
          }
        }).catch(function () {
          ask.disabled = false; ask.textContent = "Submit";
          slot.className = "q-answer"; slot.textContent = "Could not reach the review server — is it still running?";
        });
      });
    });
    if (es) es.addEventListener("answer", function (ev) {
      var data; try { data = JSON.parse(ev.data); } catch (e) { return; }
      var ta = document.querySelector('.cinput[data-cid="' + data.questionId + '"]');
      if (!ta) return;
      var cbox = ta.closest(".cbox"); if (!cbox) return;
      var slot = ansSlot(cbox); slot.className = "q-answer"; slot.textContent = "";
      var lbl = document.createElement("strong"); lbl.textContent = "Agent: ";
      slot.appendChild(lbl); slot.appendChild(document.createTextNode(data.answer));
      cbox.classList.add("q-resolved");
      var ask = cbox.querySelector(".q-ask");
      if (ask) { ask.disabled = true; ask.textContent = "Answered ✓"; }
      assemble();
    });
` : ""}
    assemble();
  })();
</script>`;
}

/** Static enhancement: a numbered prev/next walkthrough of the changed files in
 *  review-order. Order is injected from reviewOrder so it matches the page. Does
 *  not touch viewed state — navigation and sign-off stay separate. */
function tourScript(model: ReviewModel, ranked: RankedFile[]): string {
  const ORDER = JSON.stringify(ranked.map((r) => ({ slug: r.slug, path: r.path }))).replace(/<\//g, "<\\/");
  return `<script>
  (function () {
    var ORDER = ${ORDER};
    var tour = document.getElementById("tour");
    var startBtn = document.querySelector(".tb-tour");
    if (!tour || !startBtn || !ORDER.length) return;
    var cur = tour.querySelector(".tour-cur"), total = tour.querySelector(".tour-total");
    var pathEl = tour.querySelector(".tour-path");
    var prev = tour.querySelector(".tour-prev"), next = tour.querySelector(".tour-next"), exit = tour.querySelector(".tour-exit");
    var i = 0, flashTimer;
    if (total) total.textContent = ORDER.length;
    function go(n) {
      i = Math.max(0, Math.min(ORDER.length - 1, n));
      var item = ORDER[i], el = document.getElementById(item.slug);
      if (el) {
        if (el.tagName === "DETAILS") el.open = true;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("tour-flash");
        clearTimeout(flashTimer);
        flashTimer = setTimeout(function () { el.classList.remove("tour-flash"); }, 1200);
      }
      if (cur) cur.textContent = i + 1;
      if (pathEl) pathEl.textContent = item.path;
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === ORDER.length - 1;
    }
    function start() { tour.hidden = false; document.body.classList.add("touring"); go(0); }
    function close() { tour.hidden = true; document.body.classList.remove("touring"); }
    startBtn.addEventListener("click", start);
    if (prev) prev.addEventListener("click", function () { go(i - 1); });
    if (next) next.addEventListener("click", function () { go(i + 1); });
    if (exit) exit.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (tour.hidden) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
      else if (e.key === "Escape") { close(); }
    });
  })();
</script>`;
}

/** Static, dependency-free click-to-zoom. Clones the figure live on click, so a
 *  mermaid <pre> that has since rendered to <svg> is captured as drawn. */
const LIGHTBOX_SCRIPT = `<script>
  (function () {
    var box = document.getElementById("lightbox");
    var stage = box.querySelector(".lightbox-stage");
    function close() {
      box.classList.remove("open");
      stage.replaceChildren();
      document.body.style.overflow = "";
    }
    function open(fig) {
      stage.replaceChildren(fig.cloneNode(true));
      box.classList.add("open");
      document.body.style.overflow = "hidden";
    }
    document.querySelectorAll(".zoomable").forEach(function (el) {
      el.addEventListener("click", function (e) {
        if (e.target.closest("a")) return;
        open(el);
      });
    });
    box.addEventListener("click", function (e) {
      if (e.target === box || e.target.classList.contains("lightbox-close")) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && box.classList.contains("open")) close();
    });
  })();
</script>`;
