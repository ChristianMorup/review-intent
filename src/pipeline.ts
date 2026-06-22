import { resolveBase, getDiff } from "./git.js";
import { loadArtifact } from "./artifact.js";
import { loadConfig } from "./config.js";
import { parseDiffText } from "./diff-parser.js";
import { buildScorecard, isCodePath } from "./scorecard.js";
import { scanRepo, buildReachGraph } from "./reach.js";
import { analyzeComplexity } from "./complexity.js";
import { buildReviewModel } from "./match.js";
import { findGaps } from "./completeness.js";
import type { ReviewModel, Gap } from "./types.js";

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
  const diff = parseDiffText(rawDiff);

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
    diffScope,
  );
  const gaps = findGaps(model);

  return { model, gaps };
}
