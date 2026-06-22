import type {
  Artifact,
  DiffFile,
  AnnotatedFile,
  AnnotatedHunk,
  HunkIntent,
  ReviewModel,
  ScorecardModel,
  ReachModel,
  ComplexityModel,
  DiffScope,
} from "./types.js";

/**
 * Pure join: overlay the artifact's intent onto the parsed diff.
 *
 * - File-level intent is matched by path.
 * - Per-hunk intent is matched by anchor: the note attaches to whichever hunk's
 *   new-line range [newStart, newEnd] contains the anchor line. Notes that match
 *   no hunk in the file surface in `unmatchedIntents` (never silently dropped).
 * - Artifact entries for files absent from the diff surface in
 *   `filesWithoutChanges`.
 */
export function buildReviewModel(
  artifact: Artifact,
  diff: DiffFile[],
  base: string,
  scorecard: ScorecardModel,
  reach: ReachModel,
  complexity: ComplexityModel,
  diffScope: DiffScope,
): ReviewModel {
  const intentByPath = new Map(artifact.files.map((f) => [f.path, f]));
  const diffPaths = new Set(diff.map((f) => f.path));
  const uncommittedSet = new Set(diffScope.uncommittedFiles);
  const untrackedSet = new Set(diffScope.untrackedFiles);

  const files: AnnotatedFile[] = diff.map((file): AnnotatedFile => {
    const fileIntent = intentByPath.get(file.path);
    const hunkIntents = fileIntent?.hunks ?? [];
    const matched = new Set<number>();

    const hunks: AnnotatedHunk[] = file.hunks.map((hunk): AnnotatedHunk => {
      const intents: HunkIntent[] = [];
      hunkIntents.forEach((hi, idx) => {
        if (hi.anchor >= hunk.newStart && hi.anchor <= hunk.newEnd) {
          intents.push(hi);
          matched.add(idx);
        }
      });
      return { ...hunk, intents };
    });

    const unmatchedIntents = hunkIntents.filter((_, idx) => !matched.has(idx));

    return {
      path: file.path,
      status: file.status,
      uncommitted: uncommittedSet.has(file.path) || undefined,
      untracked: untrackedSet.has(file.path) || undefined,
      what: fileIntent?.what,
      why: fileIntent?.why,
      unmatchedIntents,
      hunks,
    };
  });

  const filesWithoutChanges = artifact.files
    .filter((f) => !diffPaths.has(f.path))
    .map((f) => ({ path: f.path, why: f.why }));

  // Coverage mirrors the completeness contract: a file counts as covered when it
  // has a what + why, a hunk when at least one intent anchored into it.
  const intentCoverage = {
    filesCovered: files.filter((f) => f.what && f.why).length,
    filesTotal: files.length,
    hunksCovered: files.reduce(
      (n, f) => n + f.hunks.filter((h) => h.intents.length > 0).length,
      0,
    ),
    hunksTotal: files.reduce((n, f) => n + f.hunks.length, 0),
  };

  return {
    title: artifact.title,
    tldr: artifact.tldr,
    overall: artifact.overall,
    base,
    diffScope,
    diagrams: artifact.diagrams,
    risks: artifact.risks,
    tests: artifact.tests,
    scorecard,
    reach,
    complexity,
    intentCoverage,
    files,
    filesWithoutChanges,
  };
}
