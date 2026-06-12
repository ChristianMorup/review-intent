import type {
  DiffFile,
  RepoConfig,
  ScorecardModel,
  ScorecardBadge,
} from "./types.js";

const TEST_RE = /(?:[._-](?:test|spec)\.)|(?:^|\/)(?:tests?|__tests__|spec)\//i;
const CODE_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|cs|go|py|java|rb|rs|cpp|cc|c|h|hpp|php|vue|svelte|kt|swift|scala)$/i;
/** Lockfiles, generated/minified output, build dirs, and binaries — high churn,
 *  low review value. Flagged so a reviewer knows how much of the diff is noise. */
const NOISE_RE =
  /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|packages\.lock\.json)$|\.(?:lock|min\.js|min\.css|map|snap)$|(?:^|\/)(?:dist|build|node_modules|out)\/|\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf)$/i;
/** Debt/debug markers a reviewer should never let through unnoticed. */
const DEBT_RE = /\b(?:TODO|FIXME|HACK|XXX)\b|console\.log|debugger\b/;

export function isTestPath(path: string): boolean {
  return TEST_RE.test(path);
}

export function isCodePath(path: string): boolean {
  return CODE_RE.test(path);
}

export function isNoisePath(path: string): boolean {
  return NOISE_RE.test(path);
}

/** Pure: derive the objective surface-area scorecard from the parsed diff. */
export function buildScorecard(
  diff: DiffFile[],
  config: RepoConfig,
): ScorecardModel {
  const byStatus: Record<string, number> = {};
  let hunks = 0;
  let added = 0;
  let removed = 0;
  let testFiles = 0;
  let codeFiles = 0;
  let testLines = 0;
  let codeLines = 0;
  let debtMarkers = 0;
  let noiseFiles = 0;
  let largestFile: { path: string; churn: number } | null = null;

  for (const file of diff) {
    byStatus[file.status] = (byStatus[file.status] ?? 0) + 1;
    hunks += file.hunks.length;
    let fileChurn = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") {
          added++;
          fileChurn++;
          if (DEBT_RE.test(line.content)) debtMarkers++;
        } else if (line.type === "del") {
          removed++;
          fileChurn++;
        }
      }
    }

    const isTest = isTestPath(file.path);
    if (isTest) {
      testFiles++;
      testLines += fileChurn;
    } else if (isCodePath(file.path)) {
      codeFiles++;
      codeLines += fileChurn;
    }
    if (isNoisePath(file.path)) noiseFiles++;
    if (!largestFile || fileChurn > largestFile.churn) {
      largestFile = { path: file.path, churn: fileChurn };
    }
  }

  const badges: ScorecardBadge[] = [];

  // Code changed but no test files touched — the headline review smell.
  if (codeFiles > 0 && testFiles === 0) {
    badges.push({ label: "no test changes", tone: "danger" });
  }

  // Sensitive paths (repo policy), de-duplicated by label.
  const paths = diff.map((f) => f.path);
  for (const sp of config.sensitivePaths) {
    let re: RegExp;
    try {
      re = new RegExp(sp.pattern, "i");
    } catch {
      continue; // a bad policy regex shouldn't crash the scorecard
    }
    if (paths.some((p) => re.test(p))) {
      badges.push({ label: `touches ${sp.label}`, tone: "danger" });
    }
  }

  // Large change set (churn).
  if (diff.length > config.churnFiles || added + removed > config.churnLines) {
    badges.push({ label: "large change set", tone: "warn" });
  }

  return {
    filesChanged: diff.length,
    byStatus,
    hunks,
    added,
    removed,
    testFiles,
    codeFiles,
    testLines,
    codeLines,
    debtMarkers,
    noiseFiles,
    largestFile,
    badges,
  };
}
