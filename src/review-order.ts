import type { ReviewModel, AnnotatedFile } from "./types.js";
import { isNoisePath } from "./scorecard.js";

/** Per-file signals derived from the measured model — no I/O, deterministic. */
export interface FileSignals {
  path: string;
  /** Position in `model.files` (original diff order). The content lookup keys
   *  on this, not on `path`, so duplicate paths can never collapse together. */
  index: number;
  /** Stable, unique anchor id for the file's detail section. */
  slug: string;
  status: AnnotatedFile["status"];
  added: number;
  removed: number;
  churn: number;
  hunks: number;
  /** Repo files importing this one (reach fan-in). */
  fanIn: number;
  /** Carries a measured complexity hotspot. */
  hotspot: boolean;
  /** Highest CCN among this file's hotspots, or null. */
  maxCcn: number | null;
  /** File-level what/why absent, or any hunk lacks intent. */
  missingIntent: boolean;
  isNoise: boolean;
}

export interface RankedFile extends FileSignals {
  /** 1-based final review position (1 = review first). Equals `measuredRank`
   *  unless the agent supplied a `reviewOrder` override. */
  rank: number;
  /** 1-based measured priority, before any agent override — kept so a reordered
   *  (e.g. sunk) file stays auditable next to its measured rank. */
  measuredRank: number;
  score: number;
}

const norm = (p: string): string => p.replace(/\\/g, "/");

/** Stable, unique, deterministic anchor id for a file section. */
export function fileSlug(index: number): string {
  return `file-${index}`;
}

/** Highest CCN of a measured hotspot matching this file, or null. Matches
 *  lizard's (possibly differently-rooted) path by suffix/basename — same
 *  heuristic the change-map uses. */
function hotspotCcn(model: ReviewModel, path: string): number | null {
  const cx = model.complexity;
  if (!cx.available || cx.hotspots.length === 0) return null;
  const p = norm(path);
  const base = p.split("/").pop() ?? p;
  let max: number | null = null;
  for (const h of cx.hotspots) {
    const hp = norm(h.file);
    const hit =
      hp === p ||
      hp.endsWith("/" + p) ||
      p.endsWith("/" + hp) ||
      (hp.split("/").pop() ?? hp) === base;
    if (hit) max = max === null ? h.ccn : Math.max(max, h.ccn);
  }
  return max;
}

/** Pure: one signal record per changed file, in original diff order. */
export function collectSignals(model: ReviewModel): FileSignals[] {
  return model.files.map((f, i): FileSignals => {
    let added = 0;
    let removed = 0;
    for (const h of f.hunks)
      for (const l of h.lines) {
        if (l.type === "add") added++;
        else if (l.type === "del") removed++;
      }
    const fanIn = model.reach.edges.reduce(
      (n, e) => (norm(e.to) === norm(f.path) ? n + 1 : n),
      0,
    );
    const maxCcn = hotspotCcn(model, f.path);
    const missingIntent = !f.why || f.hunks.some((h) => h.intents.length === 0);
    return {
      path: f.path,
      index: i,
      slug: fileSlug(i),
      status: f.status,
      added,
      removed,
      churn: added + removed,
      hunks: f.hunks.length,
      fanIn,
      hotspot: maxCcn !== null,
      maxCcn,
      missingIntent,
      isNoise: isNoisePath(f.path),
    };
  });
}

/** Pure: files ranked by review priority (most attention-worthy first). Score
 *  blends normalized churn + reach with flat bonuses for a complexity hotspot
 *  and for unexplained changes, then demotes noise. Ties break by churn, then
 *  original diff order — fully deterministic.
 *
 *  This measured ranking is the un-gameable backbone. If the agent supplied a
 *  `reviewOrder` override, the listed files lead in that order and the rest
 *  follow by measured rank — but every file keeps its `measuredRank`, so a file
 *  the agent sank stays auditable next to where measurement put it. */
export function reviewOrder(model: ReviewModel): RankedFile[] {
  const sig = collectSignals(model);
  const maxChurn = Math.max(1, ...sig.map((s) => s.churn));
  const maxFan = Math.max(1, ...sig.map((s) => s.fanIn));
  const sq = (v: number, max: number) => Math.sqrt(v) / Math.sqrt(max);

  const scored = sig.map((s, i) => {
    const base =
      sq(s.churn, maxChurn) +
      sq(s.fanIn, maxFan) +
      (s.hotspot ? 0.6 : 0) +
      (s.missingIntent ? 0.5 : 0);
    return { sig: s, i, score: s.isNoise ? base * 0.25 : base };
  });

  scored.sort(
    (a, b) => b.score - a.score || b.sig.churn - a.sig.churn || a.i - b.i,
  );

  const measured = scored.map((x, idx) => ({
    ...x.sig,
    score: x.score,
    measuredRank: idx + 1,
  }));

  const override = model.reviewOrderOverride ?? [];
  if (override.length === 0) {
    return measured.map((m): RankedFile => ({ ...m, rank: m.measuredRank }));
  }

  // Agent override: listed files first (in the agent's order), then the rest in
  // measured order. Match by normalized path; unknown paths are ignored here and
  // surfaced separately by `unmatchedOrderPaths`.
  const byPath = new Map(measured.map((m) => [norm(m.path), m]));
  const used = new Set<number>();
  const ordered: typeof measured = [];
  for (const p of override) {
    const m = byPath.get(norm(p));
    if (m && !used.has(m.index)) {
      ordered.push(m);
      used.add(m.index);
    }
  }
  for (const m of measured) if (!used.has(m.index)) ordered.push(m);

  return ordered.map((m, idx): RankedFile => ({ ...m, rank: idx + 1 }));
}

/** Pure: override paths the agent listed that match no changed file — surfaced
 *  rather than silently ignored (a likely typo or stale path). */
export function unmatchedOrderPaths(model: ReviewModel): string[] {
  const override = model.reviewOrderOverride ?? [];
  if (override.length === 0) return [];
  const have = new Set(model.files.map((f) => norm(f.path)));
  return override.filter((p) => !have.has(norm(p)));
}
