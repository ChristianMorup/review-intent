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

/** Pure: produce a self-contained HTML document from the review model. */
export function renderHtml(model: ReviewModel): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(model.title)} — intent review</title>
<style>${CSS}</style>
</head>
<body>
<header class="page-head">
  <div class="badge">diff: ${esc(model.base)}…HEAD</div>
  <h1>${esc(model.title)}</h1>
  <div class="tldr">${md(model.tldr)}</div>
  <details class="overall-wrap" open>
    <summary>Full summary</summary>
    <div class="overall">${md(model.overall)}</div>
  </details>
</header>

${renderBlastRadius(model)}

${renderVisuals(model)}

${renderTests(model.tests)}

${renderDiagrams(model)}

<main>
  ${model.files.length === 0 ? `<p class="empty">No file changes in this diff.</p>` : model.files.map(renderFile).join("\n")}
</main>

${renderFilesWithoutChanges(model)}

${LIGHTBOX}

${MERMAID_SCRIPT}
${LIGHTBOX_SCRIPT}
</body>
</html>`;
}

function renderBlastRadius(model: ReviewModel): string {
  return `<section class="blast">
  <h2>Blast radius</h2>
  <div class="blast-grid">
    ${renderScorecard(model)}
    ${renderRisks(model.risks)}
  </div>
  ${renderReach(model.reach)}
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
  const fill = isChanged ? "#1f6feb" : "#21262d";
  const stroke = isChanged ? "#58a6ff" : "#8b949e";
  const ly = isChanged ? p.y - 13 : p.y + 16;
  return `<g class="ripple-node">
  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
  <text x="${p.x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" class="ripple-label">${esc(shortPath(path, 22))}</text>
</g>`;
}

// ── Visual summary: four pure inline-SVG charts driven by the measured model ──

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
  test: "#3fb950",
  code: "#58a6ff",
  noise: "#6e7681",
  other: "#8b949e",
};

const DIR_PALETTE = [
  "#1f6feb", "#3fb950", "#a371f7", "#d29922",
  "#db61a2", "#2ea043", "#f0883e", "#58a6ff",
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
    renderHonestyQuadrant(model),
  ].filter(Boolean);
  if (blocks.length === 0) return "";
  return `<section class="visuals">
  <h2>Visual summary <span class="src">measured</span></h2>
  <div class="viz-grid">
    ${blocks.join("\n    ")}
  </div>
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
        ? `<circle cx="9" cy="${mid}" r="3" fill="#3fb950" />`
        : `<circle cx="9" cy="${mid}" r="3" fill="none" stroke="#f85149" stroke-width="1.5" />`;
      return `${mark}
    <text x="18" y="${mid + 3}" class="viz-label" fill="${CAT_COLOR[f.category]}">${esc(shortPath(f.path, 26))}</text>
    <rect x="${(xc - remW).toFixed(1)}" y="${y + 4}" width="${remW.toFixed(1)}" height="${rowH - 8}" fill="#f85149" fill-opacity="0.85" />
    <rect x="${xc.toFixed(1)}" y="${y + 4}" width="${addW.toFixed(1)}" height="${rowH - 8}" fill="#3fb950" fill-opacity="0.85" />
    <text x="${plotR + 6}" y="${mid + 3}" class="viz-num">+${f.added} −${f.removed}</text>`;
    })
    .join("\n    ");

  const axis = `<line x1="${xc}" y1="${pad}" x2="${xc}" y2="${H - pad}" class="viz-axis" />`;
  const more =
    hidden > 0
      ? `<p class="viz-cap">+${hidden} more file(s) not charted (showing the ${cap} largest).</p>`
      : "";

  return `<div class="card viz viz-span zoomable">
  <h3>Diff mass <span class="src">± lines per file</span></h3>
  <svg class="viz-diffmass" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    ${axis}
    ${body}
  </svg>
  ${more}
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
      const stroke = r.hasIntent ? "#30363d" : "#f85149";
      const sw = r.hasIntent ? 1 : 2;
      const label =
        r.w > 54 && r.h > 18
          ? `<text x="${(r.x + 5).toFixed(1)}" y="${(r.y + 15).toFixed(1)}" class="viz-cell-label">${esc(shortPath(basename(r.path), Math.max(3, Math.floor(r.w / 7))))}</text>`
          : "";
      return `<g><rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="${dirColor(r.path)}" fill-opacity="0.82" stroke="${stroke}" stroke-width="${sw}" />${label}</g>`;
    })
    .join("\n    ");

  return `<div class="card viz viz-span zoomable">
  <h3>Change treemap <span class="src">area = churn</span></h3>
  <svg class="viz-treemap" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
    ${cells}
  </svg>
  <p class="viz-cap">Rectangle area ∝ ± lines · colour = top-level directory · red outline = no intent written.</p>
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
    ${coverageRing("files", ic.filesCovered, ic.filesTotal)}
    ${coverageRing("hunks", ic.hunksCovered, ic.hunksTotal)}
  </div>
</div>`;
}

function coverageRing(label: string, num: number, den: number): string {
  const f = den ? num / den : 0;
  const pct = Math.round(f * 100);
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = (f * c).toFixed(1);
  const color = f >= 0.8 ? "#3fb950" : f >= 0.5 ? "#d29922" : "#f85149";
  return `<svg viewBox="0 0 120 150" class="viz-ring-svg" role="img">
  <circle cx="60" cy="60" r="${r}" fill="none" stroke="#30363d" stroke-width="12" />
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
      const color = r.ccn >= cx.threshold * 2 ? "#f85149" : "#d29922";
      const label = `${r.name} · ${basename(r.file)}:${r.line}`;
      return `<text x="6" y="${mid + 3}" class="viz-label">${esc(shortPath(label, 44))}</text>
    <rect x="${barL}" y="${y + 4}" width="${w.toFixed(1)}" height="${rowH - 8}" fill="${color}" fill-opacity="0.85" />
    <text x="${(barL + w + 6).toFixed(1)}" y="${mid + 3}" class="viz-num">${r.ccn}</text>`;
    })
    .join("\n    ");

  return `<div class="card viz viz-span zoomable">
  <h3>Complexity hotspots <span class="src">lizard · CCN</span></h3>
  <svg class="viz-complexity" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    ${body}
  </svg>
  <p class="viz-cap">Cyclomatic complexity of changed functions at or above the threshold (${cx.threshold}); bars at ≥ 2× threshold are red.</p>
</div>`;
}

/** #5 Honesty quadrant — claimed candor vs measured blast radius. */
function renderHonestyQuadrant(model: ReviewModel): string {
  if (model.files.length === 0) return "";
  const sc = model.scorecard;
  const ic = model.intentCoverage;
  const sat = (v: number, k: number) => (v <= 0 ? 0 : 1 - 1 / (1 + v / k));
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  const churn = sc.added + sc.removed;
  const fanIn = model.reach.edges.length;
  const blast = clamp01(0.6 * sat(churn, 400) + 0.4 * sat(fanIn, 8));
  const hunkCov = ic.hunksTotal ? ic.hunksCovered / ic.hunksTotal : 0;
  const candor = clamp01(0.6 * hunkCov + 0.4 * sat(model.risks.length, 3));

  const S = 360;
  const m = 44;
  const plot = S - 2 * m;
  const px = m + blast * plot;
  const py = m + (1 - candor) * plot;
  const mid = m + plot / 2;

  return `<div class="card viz zoomable">
  <h3>Honesty quadrant <span class="src">claimed vs measured</span></h3>
  <svg class="viz-quadrant" viewBox="0 0 ${S} ${S}" preserveAspectRatio="xMidYMid meet" role="img">
    <rect x="${mid}" y="${mid}" width="${plot / 2}" height="${plot / 2}" class="viz-danger" />
    <line x1="${m}" y1="${mid}" x2="${S - m}" y2="${mid}" class="viz-axis" />
    <line x1="${mid}" y1="${m}" x2="${mid}" y2="${S - m}" class="viz-axis" />
    <rect x="${m}" y="${m}" width="${plot}" height="${plot}" fill="none" stroke="#30363d" />
    <text x="${S - m}" y="${S - m + 20}" text-anchor="end" class="viz-axis-label">blast radius →</text>
    <text x="${m - 8}" y="${m - 14}" class="viz-axis-label">↑ candor</text>
    <text x="${mid + 8}" y="${S - m - 10}" class="viz-axis-label viz-danger-label">high blast · low candor</text>
    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7" class="viz-dot" />
  </svg>
  <p class="viz-cap">blast = churn (${churn}±) + reach (${fanIn}); candor = hunk intent (${Math.round(hunkCov * 100)}%) + ${model.risks.length} declared risk(s). A dot in the red corner is a confident change that hid its risk.</p>
</div>`;
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
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
  unit: "#3fb950",
  integration: "#58a6ff",
  e2e: "#a371f7",
  manual: "#d29922",
};
const kindColor = (key: string): string => KIND_COLOR[key] ?? "#8b949e";

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
  <h2>Tests <span class="src">claimed</span> <span class="muted test-count">${n} case${n === 1 ? "" : "s"} described</span></h2>
  ${blocks}
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
  <div class="diagram-grid">
${block("Class diagram", cls)}
${block("Sequence diagram (changed steps highlighted)", sequence)}
  </div>
</section>`;
}

function renderFile(file: AnnotatedFile): string {
  return `<section class="file">
  <div class="file-head">
    <span class="status status-${file.status}">${file.status}</span>
    <code class="path">${esc(file.path)}</code>
  </div>
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
</section>`;
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
:root {
  --bg: #0d1117; --panel: #161b22; --border: #30363d; --text: #e6edf3;
  --muted: #8b949e; --add-bg: #12261e; --add-bd: #2ea043; --del-bg: #2a1416;
  --del-bd: #f85149; --accent: #58a6ff; --note: #1c2433;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
.page-head { padding: 28px 32px; border-bottom: 1px solid var(--border); }
.page-head h1 { margin: 8px 0 12px; font-size: 24px; }
.badge {
  display: inline-block; font-family: ui-monospace, monospace; font-size: 12px;
  color: var(--muted); border: 1px solid var(--border); border-radius: 999px;
  padding: 2px 10px;
}
.tldr {
  max-width: 80ch; font-size: 17px; line-height: 1.5; color: var(--text);
  border-left: 3px solid var(--accent); padding: 4px 0 4px 14px; margin: 0 0 12px;
}
.tldr p { margin: 0; }
.overall-wrap { max-width: 80ch; }
.overall-wrap > summary {
  cursor: pointer; color: var(--muted); font-size: 12px; text-transform: uppercase;
  letter-spacing: .04em; margin-bottom: 8px;
}
.overall { color: var(--text); }
.overall p { margin: 0 0 10px; }
main, .diagrams, .orphans, .blast { padding: 24px 32px; }
.blast { border-bottom: 1px solid var(--border); }
.blast > h2 { font-size: 16px; color: var(--muted); margin: 0 0 14px; }
.blast-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.card {
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px 16px;
}
.card h3 { margin: 0 0 12px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.card h3 .src {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
  color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px;
}
.metrics { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; font-size: 13px; }
.metrics .add { color: #aff5b4; }
.metrics .del { color: #ffb4b4; }
.metrics-extra {
  font-size: 12px; color: var(--muted); gap: 10px 14px;
  padding-top: 10px; border-top: 1px solid var(--border);
}
.metrics-extra code { font-size: 11px; padding: 0 4px; }
.metrics-extra .flag { color: var(--del-bd); font-weight: 600; }
.muted { color: var(--muted); }
.badges { display: flex; flex-wrap: wrap; gap: 8px; }
.badge {
  font-size: 12px; font-weight: 600; border-radius: 999px; padding: 3px 10px;
  border: 1px solid var(--border);
}
.tone-danger { background: var(--del-bg); color: var(--del-bd); border-color: var(--del-bd); }
.tone-warn { background: #2a2417; color: #d29922; border-color: #d29922; }
.tone-info { background: #1f2730; color: var(--accent); }
.tone-ok { background: var(--add-bg); color: var(--add-bd); border-color: var(--add-bd); }
.risk-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.risk-table th { text-align: left; color: var(--muted); font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--border); }
.risk-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.risk-table td p, .risks .nudge p { margin: 0; }
.nudge { color: #d29922; font-size: 13px; }
.reach { margin-top: 16px; }
.reach .mermaid { margin-top: 8px; }
.reach-note { color: #d29922; font-size: 12px; margin-top: 8px; }
@media (max-width: 900px) { .blast-grid { grid-template-columns: 1fr; } }

/* ── Visual summary ── */
.visuals { padding: 24px 32px; border-bottom: 1px solid var(--border); }
.visuals > h2 { font-size: 16px; color: var(--muted); margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
.visuals > h2 .src {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
  color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px;
}
/* Compact overview: tile every figure as a small thumbnail; click any to
   open it full-size in the lightbox (see .zoomable / #lightbox below). */
.viz-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px; align-items: start;
}
.viz.viz-span { grid-column: auto; }
/* Cap charts at their native viewBox width so they never upscale (which would
   blow up the in-SVG font sizes past the page baseline); they still scale down. */
.viz svg { width: 100%; height: auto; display: block; }
.viz-diffmass, .viz-treemap, .viz-complexity { max-width: 720px; }
.viz-ripple { max-width: 720px; margin: 0 auto; }
/* Thumbnail clamp: scale the figure down to a uniform height for the overview.
   preserveAspectRatio keeps it whole (no clipping) — full detail lives in the
   lightbox. The lightbox stage lifts this clamp (rules further down). */
.zoomable svg { max-height: 168px; }
.zoomable .mermaid { max-height: 200px; overflow: hidden; }
.zoomable {
  cursor: zoom-in; position: relative; transition: border-color .15s;
}
.zoomable:hover { border-color: var(--accent); }
.zoomable::after {
  content: "⤢ expand"; position: absolute; top: 8px; right: 10px;
  font-size: 10px; font-weight: 600; letter-spacing: .04em; color: var(--accent);
  background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
  padding: 1px 6px; opacity: 0; transition: opacity .15s; pointer-events: none;
}
.zoomable:hover::after { opacity: 1; }
.viz-cap { color: var(--muted); font-size: 11px; margin: 8px 0 0; line-height: 1.5; }
.viz-label { font-family: ui-monospace, monospace; font-size: 11px; }
.viz-num { fill: var(--muted); font-family: ui-monospace, monospace; font-size: 10px; }
.viz-axis { stroke: var(--border); stroke-width: 1; }
.viz-cell-label { fill: #0b1020; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 600; }
.viz-rings { display: flex; gap: 8px; justify-content: space-around; }
.viz-ring-svg { max-width: 150px; }
.viz-ring-pct { fill: var(--text); font-size: 22px; font-weight: 700; font-family: -apple-system, sans-serif; }
.viz-ring-label { fill: var(--muted); font-size: 11px; font-family: -apple-system, sans-serif; }
.viz-quadrant { max-width: 360px; margin: 0 auto; }
.viz-danger { fill: rgba(248, 81, 73, 0.13); }
.viz-danger-label { fill: var(--del-bd); }
.viz-axis-label { fill: var(--muted); font-size: 11px; font-family: -apple-system, sans-serif; }
.viz-dot { fill: var(--accent); stroke: #fff; stroke-width: 2; }
.ripple-ring { fill: none; stroke: var(--border); stroke-dasharray: 3 5; }
.ripple-edge { stroke: var(--muted); stroke-width: 1; opacity: 0.4; }
.ripple-label { fill: var(--muted); font-family: ui-monospace, monospace; font-size: 10px; }
@media (max-width: 900px) { .viz-grid { grid-template-columns: 1fr; } }
/* ── Tests (claimed) ── */
.tests { padding: 24px 32px; border-bottom: 1px solid var(--border); }
.tests > h2 { font-size: 16px; color: var(--muted); margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
.tests > h2 .src {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
  color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px;
}
.tests > h2 .test-count { font-size: 12px; font-weight: 400; text-transform: none; letter-spacing: 0; }
.test-group { margin-bottom: 16px; }
.test-group:last-child { margin-bottom: 0; }
.test-kind {
  display: flex; align-items: center; gap: 10px; margin: 0 0 6px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
  color: var(--k, var(--muted));
}
.test-kind::after { content: ""; flex: 1; height: 1px; background: var(--border); }
.test-list { list-style: none; margin: 0; padding: 0; }
.test-case {
  position: relative; padding: 5px 0 5px 20px; border-bottom: 1px solid var(--border);
  max-width: 90ch;
}
.test-group:last-child .test-case:last-child { border-bottom: 0; }
.test-case::before {
  content: "▸"; position: absolute; left: 2px; color: var(--k, var(--muted));
}
.test-case p { display: inline; margin: 0; }
.test-name {
  font-size: 11px; color: var(--muted);
  background: rgba(110,118,129,0.12); margin-left: 6px;
}
.diagrams { border-bottom: 1px solid var(--border); }
.diagram-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px; align-items: start;
}
.diagram { margin: 0; }
.diagram h2, .diagrams > h2 { font-size: 16px; color: var(--muted); margin: 0 0 10px; }
.diagram.zoomable { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.diagram.zoomable h2 { font-size: 13px; }
.mermaid {
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 16px; overflow: auto;
}
.file {
  border: 1px solid var(--border); border-radius: 8px; margin-bottom: 24px;
  overflow: hidden; background: var(--panel);
}
.file-head {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border-bottom: 1px solid var(--border); background: #11161d;
}
.path { font-family: ui-monospace, monospace; font-size: 13px; }
.status {
  font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 8px; border-radius: 4px; font-weight: 600;
}
.status-added { background: var(--add-bg); color: var(--add-bd); }
.status-deleted { background: var(--del-bg); color: var(--del-bd); }
.status-modified { background: #1f2730; color: var(--accent); }
.status-renamed { background: #2a2417; color: #d29922; }
.file-intent {
  padding: 12px 14px; color: var(--text); border-bottom: 1px solid var(--border);
}
.file-intent p { margin: 0 0 8px; }
.hunk-row {
  display: grid; grid-template-columns: 1fr 320px; gap: 0;
  border-top: 1px solid var(--border);
}
.hunk-diff { overflow: auto; }
.hunk-header {
  font-family: ui-monospace, monospace; font-size: 12px; color: var(--accent);
  padding: 6px 12px; background: #11161d;
}
table.diff { width: 100%; border-collapse: collapse; font-family: ui-monospace, monospace; font-size: 12.5px; }
.ln td { padding: 0 8px; white-space: pre; vertical-align: top; }
.num { color: var(--muted); text-align: right; width: 1%; user-select: none; }
.sign { width: 1%; user-select: none; color: var(--muted); }
.code { width: 100%; }
.ln-add { background: var(--add-bg); }
.ln-add .code { color: #aff5b4; }
.ln-del { background: var(--del-bg); }
.ln-del .code { color: #ffb4b4; }
.hunk-notes {
  border-left: 1px solid var(--border); padding: 10px 14px; background: var(--note);
}
.note { margin-bottom: 10px; }
.note p { margin: 0 0 6px; }
.ww .what, .ww .why { margin-bottom: 6px; }
.ww .why { margin-bottom: 0; }
.ww p { margin: 0; display: inline; }
.lbl {
  display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .05em; color: var(--muted); margin-right: 6px;
  border: 1px solid var(--border); border-radius: 3px; padding: 0 4px;
}
.missing {
  color: var(--del-bd); font-weight: 600; font-size: 13px;
  background: var(--del-bg); border: 1px solid var(--del-bd); border-radius: 6px;
  padding: 8px 10px;
}
.file-intent.missing { margin: 0; border-radius: 0; border-left: 0; border-right: 0; }
.anchor {
  display: inline-block; font-family: ui-monospace, monospace; font-size: 11px;
  color: var(--muted); margin-bottom: 4px;
}
.unmatched, .orphans {
  padding: 12px 14px; border-top: 1px solid var(--border); color: var(--muted);
}
.unmatched h4 { margin: 0 0 6px; color: #d29922; }
code {
  font-family: ui-monospace, monospace;
  background: rgba(110,118,129,0.2); padding: 1px 5px; border-radius: 4px;
}
.empty { color: var(--muted); }
a { color: var(--accent); }
@media (max-width: 900px) {
  .hunk-row { grid-template-columns: 1fr; }
  .hunk-notes { border-left: 0; border-top: 1px dashed var(--border); }
}

/* ── Lightbox: click a thumbnail to view a figure full-size ── */
#lightbox {
  position: fixed; inset: 0; z-index: 1000; display: none;
  align-items: center; justify-content: center; padding: 40px;
  background: rgba(1, 4, 9, 0.82);
}
#lightbox.open { display: flex; }
.lightbox-stage {
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  padding: 18px 22px; max-width: 1100px; width: 100%; max-height: 90vh; overflow: auto;
}
/* Lift the thumbnail clamp inside the stage so the figure renders at full size. */
.lightbox-stage .card { background: transparent; border: 0; padding: 0; cursor: auto; }
.lightbox-stage .zoomable::after { content: none; }
.lightbox-stage svg { max-height: none; }
.lightbox-stage .mermaid { max-height: none; overflow: auto; }
.lightbox-stage .diagram.zoomable { border: 0; padding: 0; }
.lightbox-stage .diagram.zoomable h2 { font-size: 16px; }
.lightbox-close {
  position: fixed; top: 14px; right: 20px; z-index: 1001;
  background: var(--panel); color: var(--text); border: 1px solid var(--border);
  border-radius: 8px; font-size: 20px; line-height: 1; cursor: pointer;
  padding: 6px 12px;
}
.lightbox-close:hover { border-color: var(--accent); color: var(--accent); }
`;

const MERMAID_SCRIPT = `<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "dark", securityLevel: "strict" });
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
