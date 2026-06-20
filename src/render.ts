import type {
  ReviewModel,
  AnnotatedFile,
  AnnotatedHunk,
  DiffLine,
  ReachModel,
  IntentCoverage,
  ComplexityModel,
  Risk,
  TestCase,
} from "./types.js";
import { isTestPath, isCodePath, isNoisePath } from "./scorecard.js";
import { reviewOrder, type RankedFile } from "./review-order.js";

/** Pure: produce a self-contained HTML document from the review model. */
export function renderHtml(model: ReviewModel): string {
  const ranked = reviewOrder(model);
  const byPath = new Map(model.files.map((f) => [f.path, f]));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(model.title)} — intent review</title>
<style>${CSS}</style>
</head>
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

${LIGHTBOX}

${MERMAID_SCRIPT}
${LIGHTBOX_SCRIPT}
</body>
</html>`;
}

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

function renderScorecard(model: ReviewModel): string {
  const s = model.scorecard;
  const statusBits = Object.entries(s.byStatus)
    .map(([k, v]) => `${v} ${esc(k)}`)
    .join(", ");
  const badges = s.badges.length
    ? s.badges
        .map((b) => `<span class="badge tone-${b.tone}">${esc(b.label)}</span>`)
        .join("")
    : `<span class="badge tone-ok">no flags</span>`;

  // Derived, measured signals — pure arithmetic over the counts above.
  const net = s.added - s.removed;
  const netStr = `net ${net >= 0 ? "+" : "−"}${Math.abs(net)}`;
  const concentration = s.filesChanged
    ? (s.hunks / s.filesChanged).toFixed(1)
    : "0.0";
  const newFiles = s.byStatus.added ?? 0;
  const fanIn = model.reach.edges.length;
  const ic = model.intentCoverage;
  const diagramNames = [
    model.diagrams.class ? "class" : null,
    model.diagrams.sequence ? "sequence" : null,
  ].filter(Boolean);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // Extra signals; the ones that are themselves smells get a danger tint.
  const extra: string[] = [
    `<span>${netStr} lines</span>`,
    `<span>${s.testLines} test / ${s.codeLines} code lines</span>`,
    `<span>${concentration} hunks/file</span>`,
    `<span>${plural(newFiles, "new file")}</span>`,
    `<span>${plural(fanIn, "dependent")} <span class="muted">(reach)</span></span>`,
    `<span>intent: ${ic.filesCovered}/${ic.filesTotal} files · ${ic.hunksCovered}/${ic.hunksTotal} hunks</span>`,
    `<span>diagrams: ${diagramNames.length ? diagramNames.join(", ") : "none"}</span>`,
  ];
  if (s.debtMarkers > 0) {
    extra.push(`<span class="flag">${plural(s.debtMarkers, "debt/debug marker")} added</span>`);
  }
  if (s.noiseFiles > 0) {
    extra.push(`<span class="flag">${plural(s.noiseFiles, "noise file")}</span>`);
  }
  if (s.largestFile) {
    extra.push(
      `<span>largest: <code>${esc(s.largestFile.path)}</code> ±${s.largestFile.churn}</span>`,
    );
  }
  const cx = model.complexity;
  if (cx.available) {
    const hs = cx.hotspots.length;
    extra.push(
      `<span${hs ? ' class="flag"' : ""}>max CCN ${cx.maxCcn}${hs ? ` · ${plural(hs, "hotspot")} ≥ ${cx.threshold}` : ""}</span>`,
    );
  } else {
    extra.push(`<span class="muted">complexity: ${esc(cx.note ?? "n/a")}</span>`);
  }

  return `<div class="card scorecard">
  <h3>Surface area <span class="src">measured</span></h3>
  <div class="metrics">
    <span><b>${s.filesChanged}</b> files${statusBits ? ` <span class="muted">(${statusBits})</span>` : ""}</span>
    <span><b>${s.hunks}</b> hunks</span>
    <span class="add">+${s.added}</span>
    <span class="del">−${s.removed}</span>
    <span><b>${s.testFiles}</b> test / <b>${s.codeFiles}</b> code files</span>
  </div>
  <div class="metrics metrics-extra">${extra.join("")}</div>
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

function renderReach(reach: ReachModel): string {
  const note = reach.truncatedNote
    ? `<div class="reach-note">⚠ ${esc(reach.truncatedNote)}</div>`
    : "";
  if (reach.changed.length === 0) {
    return `<div class="card reach">
  <h3>Reach <span class="src">measured · heuristic</span></h3>
  <div class="muted">No code files in this change set to trace.</div>
</div>`;
  }
  if (reach.edges.length === 0) {
    return `<div class="card reach">
  <h3>Reach <span class="src">measured · heuristic</span></h3>
  <div class="muted">No file-level dependents found for the changed files (heuristic import scan).</div>
  ${note}
</div>`;
  }
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
  const fill = isChanged ? C_ACCENT : "#ffffff";
  const stroke = isChanged ? "#21456f" : "#b8b1a4";
  const ly = isChanged ? p.y - 13 : p.y + 16;
  const tip = isChanged ? `${path} — changed file` : `${path} — imports a changed file`;
  return `<g class="ripple-node">
  <title>${esc(tip)}</title>
  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
  <text x="${p.x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" class="ripple-label">${esc(shortPath(path, 22))}</text>
</g>`;
}

// ── Visual summary: five pure inline-SVG charts driven by the measured model ──

type FileCategory = "test" | "code" | "noise" | "other";

interface FileStat {
  path: string;
  added: number;
  removed: number;
  churn: number;
  category: FileCategory;
  hasIntent: boolean;
}

// Light-canvas palette. Semantic fills (add/del/warn) and a categorical set for
// the treemap, all tuned to read on the warm-paper background.
const C_ADD = "#1f9d4d";
const C_ADD_INK = "#137a36";
const C_DEL = "#dd574d";
const C_DEL_INK = "#c0362c";
const C_WARN = "#c79100";
const C_ACCENT = "#2f5d9c";
const C_LINE = "#e3ded3";

const CAT_COLOR: Record<FileCategory, string> = {
  test: C_ADD_INK,
  code: C_ACCENT,
  noise: "#9b958a",
  other: "#7e776c",
};

const DIR_PALETTE = [
  "#5b7db1", "#5fa389", "#b08a5a", "#a07ba6",
  "#c47d72", "#7fa86a", "#d0a85a", "#7a93b8",
];

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

function renderVisuals(model: ReviewModel): string {
  const stats = fileStats(model).filter((s) => s.churn > 0);
  const blocks = [
    renderDiffMass(stats),
    renderTreemap(stats),
    renderComplexityHotspots(model.complexity),
    renderCoverageRings(model.intentCoverage),
    renderChangeScatter(model),
  ].filter(Boolean);
  if (blocks.length === 0) return "";
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
}

/** #1 Diff mass — diverging add/remove bars per file, sorted by churn. */
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

/** #2 Change treemap — squarified, area ∝ churn, colour = directory. */
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
      const stroke = r.hasIntent ? "#ffffff" : C_DEL_INK;
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

/** #3 Intent coverage — donut rings for files & hunks annotated. */
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

/** #4 reach ripple lives with the blast radius (reachRipple above). */

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

function dirColor(p: string): string {
  const dir = p.includes("/") ? p.slice(0, p.indexOf("/")) : "·";
  let h = 0;
  for (const ch of dir) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DIR_PALETTE[h % DIR_PALETTE.length];
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
  e2e: "#7a4fa0",
  manual: C_WARN,
};
const kindColor = (key: string): string => KIND_COLOR[key] ?? "#7e776c";

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
  return `<section class="tests">
  <details class="band">
    <summary class="band-head"><h2>Tests <span class="src">claimed</span> <span class="muted test-count">${n} case${n === 1 ? "" : "s"} described</span></h2></summary>
    <div class="band-body">
      ${blocks}
    </div>
  </details>
</section>`;
}

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

/** Render a what/why pair (the structured per-change intent). */
function whatWhy(what: string | undefined, why: string): string {
  const whatBlock = what
    ? `<div class="what"><span class="lbl">What</span> ${md(what)}</div>`
    : "";
  return `<div class="ww">${whatBlock}<div class="why"><span class="lbl">Why</span> ${md(why)}</div></div>`;
}

function renderHunk(hunk: AnnotatedHunk): string {
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
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font: 15px/1.6 var(--sans);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}

/* Every top-level band shares one centred measure with hairline separators. */
.page-head, .vitals, .blast, .visuals, .tests, .diagrams, main, .orphans {
  max-width: var(--maxw); margin: 0 auto; padding: 36px 40px;
}
.blast, .visuals, .tests, .diagrams, .vitals { border-top: 1px solid var(--line); }

/* Section eyebrows — small, lettered, quiet. The recurring section-head idiom. */
.blast > h2, .visuals > h2, .tests > h2, .diagrams > h2 {
  margin: 0 0 22px; font-size: 12px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .14em;
  display: flex; align-items: baseline; gap: 12px;
}

/* ── Masthead ── */
.page-head { padding-top: 48px; padding-bottom: 40px; }
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

/* ── Vitals: the at-a-glance overview spine ── */
.vitals {
  display: flex; flex-wrap: wrap; gap: 0; padding-top: 26px; padding-bottom: 26px;
}
.vital {
  flex: 1 1 auto; min-width: 120px; padding: 4px 26px;
  border-left: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px;
}
.vital:first-child { border-left: 0; padding-left: 0; }
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
.tone-danger { background: var(--del-soft); color: var(--del); border-color: #eccac4; }
.tone-warn { background: var(--warn-soft); color: var(--warn); border-color: #e6d8a8; }
.tone-info { background: var(--accent-soft); color: var(--accent); border-color: #cfdcef; }
.tone-ok { background: var(--add-soft); color: var(--add); border-color: #c7e2cd; }

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
.reach { margin-top: 18px; }
.reach .mermaid { margin-top: 8px; }
.reach-note { color: var(--warn); font-size: 12px; margin-top: 10px; }
@media (max-width: 820px) { .blast-grid { grid-template-columns: 1fr; } }

/* ── Visual summary ── */
.viz-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px; align-items: start;
}
.viz.viz-span { grid-column: auto; }
.viz svg { width: 100%; height: auto; display: block; }
.viz-diffmass, .viz-treemap, .viz-complexity, .viz-scatter { max-width: 720px; }
.viz-ripple { max-width: 720px; margin: 0 auto; }
/* Thumbnail clamp for the overview grid; lifted inside the lightbox. */
.zoomable svg { max-height: 168px; }
.zoomable .mermaid { max-height: 200px; overflow: hidden; }
.zoomable { cursor: zoom-in; position: relative; transition: border-color .15s, box-shadow .15s; }
.zoomable:hover { border-color: var(--accent); box-shadow: 0 2px 14px rgba(47,93,156,.1); }
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
.viz-cell-label { fill: #23211d; font-family: var(--mono); font-size: 10px; font-weight: 600; }
.viz-rings { display: flex; gap: 8px; justify-content: space-around; }
.viz-ring-svg { max-width: 150px; }
.viz-ring-pct { fill: var(--ink); font-size: 22px; font-weight: 700; font-family: var(--sans); }
.viz-ring-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
.viz-danger { fill: rgba(189, 58, 46, 0.09); }
.viz-danger-label { fill: var(--del); }
.viz-axis-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
.viz-dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2.5; }
.viz-dot-hot { fill: var(--del); }
.viz-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 12px; }
.viz-lg { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-soft); }
.viz-lg-muted { color: var(--muted); }
.viz-lg-dot { flex: none; }
.zoomable .viz-lg-dot { max-height: none; }
.viz-lg-zone { width: 13px; height: 13px; border-radius: 3px; background: rgba(189, 58, 46, 0.09); border: 1px solid #eccac4; }
.ripple-ring { fill: none; stroke: var(--line-2); stroke-dasharray: 3 5; }
.ripple-edge { stroke: var(--accent); stroke-width: 1; opacity: 0.32; }
.ripple-label { fill: var(--muted); font-family: var(--mono); font-size: 10px; }
@media (max-width: 820px) { .viz-grid { grid-template-columns: 1fr; } }

/* ── Tests (claimed) ── */
.tests > h2 .test-count { font-size: 12px; font-weight: 400; font-family: var(--sans); text-transform: none; letter-spacing: 0; color: var(--muted); }
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
  display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 18px; align-items: start;
}
.diagram { margin: 0; }
.diagram h2 { font-size: 13px; color: var(--ink-soft); margin: 0 0 10px; font-weight: 680; }
.diagram.zoomable { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; }
.mermaid {
  background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
  padding: 16px; overflow: auto;
}

/* ── File diffs ── */
main { display: flex; flex-direction: column; gap: 26px; }
.file {
  border: 1px solid var(--line); border-radius: 10px;
  overflow: hidden; background: var(--surface);
}
.file-head {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-bottom: 1px solid var(--line); background: var(--surface-2);
}
.path { font-family: var(--mono); font-size: 13px; color: var(--ink); }
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
.hunk-diff { overflow: auto; }
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
.ln-add .code { color: #115c2c; }
.ln-add .sign { color: var(--add); }
.ln-del { background: var(--del-soft); }
.ln-del .code { color: #952c22; }
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
  background: var(--del-soft); border: 1px solid #eccac4; border-radius: 8px;
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
  .page-head, .vitals, .blast, .visuals, .tests, .diagrams, main, .orphans { padding: 28px 22px; }
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
