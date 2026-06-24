import { resolveBase, getDiff } from "./git.js";
import { loadArtifact, DEFAULT_ARTIFACT_PATH } from "./artifact.js";
import { loadConfig } from "./config.js";
import { parseDiffText } from "./diff-parser.js";
import { buildScorecard, isCodePath } from "./scorecard.js";
import { scanRepo, buildReachGraph } from "./reach.js";
import { analyzeComplexity } from "./complexity.js";
import { buildReviewModel } from "./match.js";
import { findGaps } from "./completeness.js";
import type { ReviewModel, Gap, DiffFile, DiffScope } from "./types.js";

const normPath = (p: string): string => p.replace(/\\/g, "/");

/**
 * Pure: drop review-intent's own input files from the diff and the scope counts,
 * so the artifact never reviews itself. Matches the whole `.review/` namespace
 * (artifact + config) plus the resolved artifact path, in case `--artifact`
 * points outside `.review/`. Recomputes `includesUncommitted` from what survives,
 * so a tree dirty only with the artifact shows no uncommitted banner.
 */
export function stripToolInputs(
  diff: DiffFile[],
  scope: DiffScope,
  artifactPath: string,
): { diff: DiffFile[]; scope: DiffScope } {
  const artifactRel = normPath(artifactPath);
  const isInput = (p: string): boolean => {
    const n = normPath(p);
    return n === artifactRel || n.startsWith(".review/");
  };
  const uncommittedFiles = scope.uncommittedFiles.filter((p) => !isInput(p));
  const untrackedFiles = scope.untrackedFiles.filter((p) => !isInput(p));
  return {
    diff: diff.filter((f) => !isInput(f.path)),
    scope: {
      includesUncommitted: uncommittedFiles.length > 0 || untrackedFiles.length > 0,
      uncommittedFiles,
      untrackedFiles,
    },
  };
}

export interface BuildReviewOptions {
  cwd: string;
  base?: string;
  artifact?: string;
}

export interface ReviewBuild {
  model: ReviewModel;
  gaps: Gap[];
}

/**
 * Side-effecting orchestration shared by the CLI and the MCP tool. Runs the
 * whole render pipeline — it shells out via getDiff/scanRepo/analyzeComplexity —
 * and returns the joined model plus the completeness gaps. The diff scope
 * (clean vs. uncommitted/untracked) is threaded into the model by buildReviewModel.
 *
 * It deliberately does NOT apply the completeness gate, render, write files, or
 * touch process.stdout/stderr. Gaps are returned so each caller decides how to
 * surface them (the CLI prints to stderr + exits; the MCP tool returns an
 * is_error result without opening a browser). GitError/ArtifactError/ConfigError
 * propagate so callers choose how to report them.
 */
export function buildReview(opts: BuildReviewOptions): ReviewBuild {
  const base = resolveBase(opts.cwd, opts.base);
  const { text: rawDiff, scope: diffScope } = getDiff(opts.cwd, base);
  const artifact = loadArtifact(opts.cwd, opts.artifact);
  const config = loadConfig(opts.cwd);
  // Exclude review-intent's own inputs (the .review/ artifact + config) so the
  // artifact never shows up in the diff it annotates.
  const { diff, scope } = stripToolInputs(
    parseDiffText(rawDiff),
    diffScope,
    opts.artifact ?? DEFAULT_ARTIFACT_PATH,
  );

  // Part 1: objective scorecard, computed from the diff.
  const scorecard = buildScorecard(diff, config);

  // Part 3: file-level reach, computed by scanning the repo for importers of
  // the changed code files.
  const changedCodePaths = diff
    .filter((f) => f.status !== "deleted" && isCodePath(f.path))
    .map((f) => f.path);
  const { files: repoFiles, truncated } = scanRepo(opts.cwd);
  const reach = buildReachGraph(repoFiles, changedCodePaths, {
    scanTruncated: truncated,
  });

  // Part 1 (cont.): measured cyclomatic complexity of the changed code, via the
  // external lizard analyzer. Degrades gracefully if lizard isn't installed.
  const complexity = analyzeComplexity(
    opts.cwd,
    changedCodePaths,
    config.complexityThreshold,
  );

  const model = buildReviewModel(
    artifact,
    diff,
    base,
    scorecard,
    reach,
    complexity,
    scope,
  );
  const gaps = findGaps(model);

  return { model, gaps };
}
