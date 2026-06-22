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
import { THEMES, themeCss } from "./themes.js";

/** Pure: produce a self-contained HTML document from the review model. */
export function renderHtml(model: ReviewModel): string {
  const ranked = reviewOrder(model);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(model.title)} — intent review</title>
<style>${CSS}</style>
</head>
<body>
${themeScript()}
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
${renderDiffScopeBanner(model)}

<div class="layout">
<aside class="rail" id="rail" aria-label="Pinned blocks"></aside>
<div class="content">
${movable("vitals", renderVitals(model))}

${movable("review-first", renderReviewFirst(ranked))}

${movable("file-index", renderFileIndex(ranked))}

${movable("blast", renderBlastRadius(model))}

${movable("visuals", renderVisuals(model))}

${movable("tests", renderTests(model.tests))}

${movable("diagrams", renderDiagrams(model))}

<main>
  ${
    ranked.length === 0
      ? `<p class="empty">No file changes in this diff.</p>`
      : ranked.map((r) => renderFile(model.files[r.index], r)).join("\n")
  }
</main>

${renderFilesWithoutChanges(model)}
${renderFeedbackPanel(model)}
</div>
</div>

${LIGHTBOX}
${TOUR}

${MERMAID_SCRIPT}
${LIGHTBOX_SCRIPT}
${viewedScript(model)}
${pinScript(model)}
${commentScript(model)}
${tourScript(model, ranked)}
</body>
</html>`;
}

/** Wrap a movable top-level block with a pin control so the reader can move it
 *  into the sticky rail on wide screens. Empty sections (e.g. an unwritten
 *  Tests block) stay empty — no stray wrapper, no orphan pin button. */
function movable(key: string, html: string): string {
  if (!html) return "";
  return `<div class="movable" data-movable="${key}">${pinButton()}${html}</div>`;
}

function pinButton(): string {
  return `<button class="pin-btn" type="button" aria-pressed="false" aria-label="Pin to sidebar" title="Pin to sidebar">📌</button>`;
}

/** Static, dependency-free enhancement: move pinned blocks into the sticky rail
 *  on wide screens and remember the choice (per-change, like the viewed state).
 *  Default is the file index alone — the "bare minimum" spine. Below the wide
 *  breakpoint every block returns to its original place, so narrow layouts are
 *  untouched. Each block keeps a comment anchor marking its home slot so it can
 *  always be restored in the original order. */
function pinScript(model: ReviewModel): string {
  const KEY = `review-intent:pinned:${model.title}@${model.base}`;
  return `<script>
  (function () {
    var rail = document.getElementById("rail");
    if (!rail) return;
    var KEY = ${JSON.stringify(KEY).replace(/<\//g, "<\\/")};
    // Declaration order — the rail stacks pinned blocks in this order regardless
    // of the order the reader pinned them, so the rail stays predictable.
    var ORDER = ["vitals", "review-first", "file-index", "blast", "visuals", "tests", "diagrams"];
    var wide = window.matchMedia("(min-width: 1920px)");
    var nodes = {}, anchors = {};
    document.querySelectorAll(".movable").forEach(function (el) {
      var k = el.getAttribute("data-movable");
      nodes[k] = el;
      var a = document.createComment("m:" + k);
      el.parentNode.insertBefore(a, el);
      anchors[k] = a;
    });
    var pinned;
    try { pinned = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!Array.isArray(pinned)) pinned = ["file-index"];
    pinned = pinned.filter(function (k) { return nodes[k]; });
    function apply() {
      var isWide = wide.matches;
      ORDER.forEach(function (k) {
        var el = nodes[k];
        if (!el) return;
        var on = pinned.indexOf(k) !== -1;
        var btn = el.querySelector(".pin-btn");
        if (btn) {
          btn.setAttribute("aria-pressed", on ? "true" : "false");
          btn.title = on ? "Unpin from sidebar" : "Pin to sidebar";
          btn.setAttribute("aria-label", btn.title);
        }
        if (isWide && on) rail.appendChild(el);
        else anchors[k].parentNode.insertBefore(el, anchors[k]);
      });
      document.body.classList.toggle("has-pins", isWide && pinned.length > 0);
    }
    document.querySelectorAll(".pin-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var el = btn.closest(".movable");
        if (!el) return;
        var k = el.getAttribute("data-movable");
        var i = pinned.indexOf(k);
        if (i === -1) pinned.push(k); else pinned.splice(i, 1);
        try { localStorage.setItem(KEY, JSON.stringify(pinned)); } catch (e) {}
        apply();
      });
    });
    if (wide.addEventListener) wide.addEventListener("change", apply);
    else if (wide.addListener) wide.addListener(apply);
    apply();
  })();
</script>`;
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
  return `<style>.diff-scope-banner{margin:0 auto 18px;max-width:var(--maxw);padding:10px 14px;border-radius:8px;background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn);font-size:14px;}</style>
<div class="diff-scope-banner" role="note">⚠ This review includes ${parts.join(
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
const C_ADD = "var(--viz-add)";
const C_ADD_INK = "var(--viz-add-ink)";
const C_DEL = "var(--viz-del)";
const C_DEL_INK = "var(--viz-del-ink)";
const C_WARN = "var(--viz-warn)";
const C_ACCENT = "var(--viz-accent)";
const C_LINE = "var(--viz-line)";

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

/** A reviewer annotation affordance: a 💬 Comment box and a ❓ Ask box, side by
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
      <button class="cbtn" type="button" aria-label="Add a comment" title="Add a comment">💬 Comment</button>
      <textarea class="cinput" data-cid="${esc(cid)}" data-ref="${esc(ref)}"${hdrAttr} data-akind="comment" placeholder="Note to the agent about ${where}…"></textarea>
    </div>
    <div class="cbox cbox-q" data-akind="question">
      <button class="cbtn cbtn-q" type="button" aria-label="Ask a question" title="Ask a question">❓ Ask</button>
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
function renderFeedbackPanel(model: ReviewModel): string {
  if (model.files.length === 0) return "";
  return `<section class="review-feedback" id="feedback">
  <h2>Review feedback</h2>
  <p class="rf-hint">Comment (💬) or ask a question (❓) on any hunk or file, add overall notes here, then copy the assembled prompt back to the agent. Questions are listed first — they're the decisions the agent must resolve.</p>
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
  </div>
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

/* Every top-level band shares one centred measure with hairline separators. */
.page-head, .vitals, .blast, .visuals, .tests, .diagrams, main, .orphans {
  max-width: var(--maxw); margin: 0 auto; padding: 36px 40px;
}
.blast, .visuals, .tests, .diagrams, .vitals { border-top: 1px solid var(--line); }

/* Section eyebrows — small, lettered, quiet. The recurring section-head idiom. */
.band-head h2 {
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
  display: grid; grid-template-columns: repeat(auto-fit, minmax(124px, 1fr));
  gap: 1px; background: var(--line); background-clip: content-box;
  padding-top: 26px; padding-bottom: 26px;
}
/* Cells sit on the paper; the 1px grid gap reveals the container's line colour
   as a hairline between every cell — clean dividers at any column count, no
   stray edge borders when the grid wraps (the old flex-wrap left those). */
.vital {
  min-width: 0; padding: 6px 22px; background: var(--paper);
  display: flex; flex-direction: column; gap: 6px;
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
.viz-cell-label { fill: var(--viz-cell-label); font-family: var(--mono); font-size: 10px; font-weight: 600; }
.viz-rings { display: flex; gap: 8px; justify-content: space-around; }
.viz-ring-svg { max-width: 150px; }
.viz-ring-pct { fill: var(--ink); font-size: 22px; font-weight: 700; font-family: var(--sans); }
.viz-ring-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
.viz-danger { fill: var(--viz-zone); }
.viz-danger-label { fill: var(--del); }
.viz-axis-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
.viz-dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2.5; }
.viz-dot-hot { fill: var(--del); }
.viz-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 12px; }
.viz-lg { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-soft); }
.viz-lg-muted { color: var(--muted); }
.viz-lg-dot { flex: none; }
.zoomable .viz-lg-dot { max-height: none; }
.viz-lg-zone { width: 13px; height: 13px; border-radius: 3px; background: var(--viz-zone); border: 1px solid var(--del-border); }
.ripple-ring { fill: none; stroke: var(--line-2); stroke-dasharray: 3 5; }
.ripple-edge { stroke: var(--accent); stroke-width: 1; opacity: 0.32; }
.ripple-label { fill: var(--muted); font-family: var(--mono); font-size: 10px; }
@media (max-width: 820px) { .viz-grid { grid-template-columns: 1fr; } }

/* ── Tests (claimed) ── */
.tests .test-count { font-size: 12px; font-weight: 400; font-family: var(--sans); text-transform: none; letter-spacing: 0; color: var(--muted); }
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

/* ── Sticky utility bar ── */
html { scroll-behavior: smooth; scroll-padding-top: 48px; }
.topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: 16px;
  /* Align the bar's content with the page measure on wide screens; floor to a
     small inset on narrow ones. */
  padding: 9px max(18px, calc((100% - var(--maxw)) / 2 + 40px));
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

/* ── Review-first callout ── */
.review-first { max-width: var(--maxw); margin: 0 auto; padding: 22px 40px; border-top: 1px solid var(--line); }
.review-first > h2 {
  margin: 0 0 14px; font-size: 12px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .14em;
}
.rf-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.rf-card {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px; border: 1px solid var(--line-2); border-radius: 9px;
  background: var(--surface); text-decoration: none; color: var(--ink);
  transition: border-color .15s, box-shadow .15s;
}
.rf-card:hover { border-color: var(--accent); box-shadow: 0 2px 14px var(--accent-shadow); }
.rf-rank { font: 700 13px/1 var(--mono); color: var(--accent); }
.rf-path { font-size: 12.5px; min-width: 0; overflow-wrap: anywhere; }
.rf-reasons { display: flex; flex-wrap: wrap; gap: 4px 8px; width: 100%; }
.rf-reasons span {
  font: 600 10px/1.5 var(--mono); color: var(--ink-soft);
  background: var(--surface-2); border-radius: 4px; padding: 2px 6px;
}

/* ── File index (spine) ── */
.file-index { max-width: var(--maxw); margin: 0 auto; padding: 28px 40px; border-top: 1px solid var(--line); }
.file-index > h2 {
  margin: 0 0 14px; font-size: 12px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .14em;
}
.fi-count { font-weight: 400; text-transform: none; letter-spacing: 0; font-family: var(--sans); font-size: 12px; }
.fi-list { list-style: none; margin: 0; padding: 0; }
.fi-row { border-bottom: 1px solid var(--line); }
.fi-row:last-child { border-bottom: 0; }
.fi-link {
  display: flex; align-items: center; gap: 12px; padding: 8px 6px;
  text-decoration: none; color: var(--ink); border-radius: 6px;
}
.fi-link:hover { background: var(--surface-2); }
.fi-link.active { background: var(--accent-soft); }
.fi-rank { font: 700 12px/1 var(--mono); color: var(--accent); width: 2.4em; flex: none; }
.fi-path { font-size: 12.5px; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; background: none; padding: 0; }
.fi-sig { display: flex; gap: 4px 10px; flex: none; font: 11px/1.4 var(--mono); color: var(--muted); }
.fi-sig .fi-hot { color: var(--del); font-weight: 700; }
.fi-sig .fi-gap { color: var(--warn); font-weight: 700; }

/* ── Collapsible analytics bands ── */
.band { border: 0; }
.band-head { cursor: pointer; list-style: none; }
.band-head::-webkit-details-marker { display: none; }
.band-head h2::before {
  content: "›"; font-size: 15px; color: var(--muted); transition: transform .15s; display: inline-block;
}
.band[open] > .band-head h2::before { transform: rotate(90deg); }
.band-body { padding-top: 22px; }

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
.viewed-toggle {
  margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
  font: 600 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
  cursor: pointer; user-select: none;
}
.file.viewed { opacity: .55; }
.file.viewed:hover { opacity: 1; }

@media (max-width: 820px) {
  .review-first, .file-index { padding: 22px; }
  .fi-sig { width: 100%; }
}

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

/* ── Pin-to-rail: movable blocks + a sticky sidebar on wide screens ── */
.movable { position: relative; }
.rail:empty { display: none; }
/* The pin affordance only exists where there's a rail to pin to (wide screens). */
.pin-btn { display: none; }

@media (min-width: 1920px) {
  .pin-btn {
    display: inline-flex; align-items: center; justify-content: center;
    position: absolute; top: 12px; right: 14px; z-index: 3;
    font: 12px/1 var(--mono); cursor: pointer;
    background: var(--surface); border: 1px solid var(--line-2); border-radius: 6px;
    padding: 4px 6px; opacity: 0; transition: opacity .15s, border-color .15s;
  }
  .movable:hover > .pin-btn, .pin-btn:focus-visible { opacity: 1; }
  .pin-btn[aria-pressed="true"] { opacity: 1; border-color: var(--accent); background: var(--accent-soft); }

  /* The two-pane shell engages only once something is pinned; with an empty
     rail the page stays the calm centred column it is below this width. */
  body.has-pins .page-head { max-width: 1840px; }
  body.has-pins .topbar { padding-inline: max(18px, calc((100% - 1840px) / 2 + 40px)); }
  body.has-pins .layout {
    max-width: 1840px; margin: 0 auto; padding: 0 40px;
    display: grid; grid-template-columns: 320px minmax(0, 1fr);
    gap: 36px; align-items: start;
  }
  body.has-pins .rail {
    position: sticky; top: 56px; align-self: start;
    max-height: calc(100vh - 72px); overflow: auto;
    display: flex; flex-direction: column; gap: 18px;
  }
  body.has-pins .content { min-width: 0; }
  /* Inside the shell, blocks fill their column instead of self-centring. */
  body.has-pins .content > .movable > section,
  body.has-pins .content > .movable > nav,
  body.has-pins .content > main,
  body.has-pins .content > .orphans,
  body.has-pins .rail > .movable > section,
  body.has-pins .rail > .movable > nav { max-width: none; margin: 0; }
  /* Rail blocks: trim the band padding, drop the band rule, fit narrow charts
     and let a wide table scroll rather than crush. */
  body.has-pins .rail > .movable > section,
  body.has-pins .rail > .movable > nav { padding: 18px 16px; border-top: 0; }
  body.has-pins .rail .band-body { padding-top: 16px; }
  body.has-pins .rail .blast-grid { grid-template-columns: 1fr; }
  body.has-pins .rail .risks { overflow-x: auto; }
  body.has-pins .rail .viz-grid { grid-template-columns: 1fr; }
}

/* ── Review annotations (comments + questions) ── */
.cbox-group { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
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
    function update() {
      if (!prog) return;
      var done = files.filter(function (f) { return f.classList.contains("viewed"); }).length;
      prog.textContent = done + " / " + files.length + " reviewed";
    }
    files.forEach(function (f) {
      var cb = f.querySelector(".viewed-cb");
      var toggle = f.querySelector(".viewed-toggle");
      if (!cb) return;
      if (store[f.id]) { cb.checked = true; f.classList.add("viewed"); f.open = false; }
      // Don't let the control toggle the <details> it lives in.
      if (toggle) toggle.addEventListener("click", function (e) { e.stopPropagation(); });
      cb.addEventListener("change", function () {
        if (cb.checked) { f.classList.add("viewed"); f.open = false; store[f.id] = 1; }
        else { f.classList.remove("viewed"); delete store[f.id]; f.open = true; }
        try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
        update();
      });
    });
    update();

    var links = {};
    document.querySelectorAll(".file-index a[href^='#']").forEach(function (a) {
      links[a.getAttribute("href").slice(1)] = a;
    });
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
function commentScript(model: ReviewModel): string {
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
      files.forEach(function (f) {
        var code = f.querySelector(".path");
        var path = code ? code.textContent : f.id;
        var section = [];
        var fc = f.querySelector('.cbox-group[data-ckind="file"] .cinput[data-akind="' + akind + '"]');
        if (fc && clean(fc.value)) { section.push("- " + indent(fc.value)); count++; }
        f.querySelectorAll('.cbox-group[data-ckind="hunk"] .cinput[data-akind="' + akind + '"]').forEach(function (hc) {
          if (clean(hc.value)) {
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
      if (pg && clean(pg.value)) { lines.push("## General"); lines.push("- " + indent(pg.value)); lines.push(""); count++; }
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
