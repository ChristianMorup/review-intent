import type { ReviewModel, Gap } from "./types.js";

/**
 * Pure: find missing-rationale gaps in the joined model. The contract is strict
 * — every changed file needs a why, and every diff hunk needs at least one
 * intent. This needs the model (not just the artifact) because hunk coverage is
 * only knowable after the artifact's anchors are matched against git's hunks.
 */
export function findGaps(model: ReviewModel): Gap[] {
  const gaps: Gap[] = [];
  for (const file of model.files) {
    if (!file.why) {
      gaps.push({
        kind: "file",
        path: file.path,
        detail: "no what/why written for this changed file",
      });
    }
    for (const hunk of file.hunks) {
      if (hunk.intents.length === 0) {
        gaps.push({
          kind: "hunk",
          path: file.path,
          detail: `hunk ${hunk.header} has no intent`,
        });
      }
    }
  }
  return gaps;
}

/** Render a gap list as a human-readable, copy-pasteable error body. */
export function formatGaps(gaps: Gap[]): string {
  const lines = gaps.map((g) => `  - ${g.path}: ${g.detail}`);
  return (
    `Intent is incomplete — ${gaps.length} gap(s) found:\n` +
    lines.join("\n") +
    `\n\nEvery changed file needs a what/why, and every hunk needs an intent.\n` +
    `Fix .review/intent.json, or pass --allow-gaps to render a draft with the gaps flagged.`
  );
}
