#!/usr/bin/env node
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import open from "open";
import { resolveBase, getDiff, GitError } from "./git.js";
import { loadArtifact, ArtifactError, DEFAULT_ARTIFACT_PATH } from "./artifact.js";
import { parseDiffText } from "./diff-parser.js";
import { buildReviewModel } from "./match.js";
import { renderHtml } from "./render.js";
import { loadConfig, ConfigError } from "./config.js";
import { buildScorecard, isCodePath } from "./scorecard.js";
import { scanRepo, buildReachGraph } from "./reach.js";
import { analyzeComplexity } from "./complexity.js";
import { findGaps, formatGaps } from "./completeness.js";
import {
  installSkill,
  uninstallSkill,
  skillFile,
  type SkillScope,
} from "./skill.js";

const HELP = `review-intent — render an intent-annotated diff review in your browser.

Usage:
  review-intent [options]
  review-intent skill install [--local] [--force]
  review-intent skill uninstall [--local] [--force]

Options:
  --base <ref>        Base branch to diff against (default: main, then master)
  --artifact <path>   Path to the intent artifact (default: ${DEFAULT_ARTIFACT_PATH})
  --out <path>        Where to write the HTML (default: a temp file)
  --no-open           Do not open the browser; just write the file
  --allow-gaps        Render even if intent is incomplete (gaps shown in red)
  -h, --help          Show this help

Commands:
  skill install       Install the review-intent-authoring Claude Code skill
                      (default: ~/.claude/skills; --local: ./.claude/skills)
  skill uninstall     Remove the skill
`;

function localFlag(scope: SkillScope): string {
  return scope === "local" ? " --local" : "";
}

async function runSkill(argv: string[]): Promise<void> {
  const sub = argv[0];
  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      local: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });
  const scope: SkillScope = values.local ? "local" : "user";
  const file = skillFile({ scope });

  if (sub === "install") {
    const result = await installSkill({ scope, force: values.force });
    if (result === "installed") process.stdout.write(`Installed skill: ${file}\n`);
    else if (result === "updated") process.stdout.write(`Updated skill: ${file}\n`);
    else if (result === "already") process.stdout.write(`Skill already up to date: ${file}\n`);
    else {
      process.stderr.write(`A different skill file already exists at ${file}.\n`);
      process.stderr.write(`Run 'review-intent skill install${localFlag(scope)} --force' to overwrite.\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === "uninstall") {
    const result = await uninstallSkill({ scope, force: values.force });
    if (result === "removed") process.stdout.write(`Removed skill from ${file}\n`);
    else if (result === "not-installed") process.stdout.write(`No skill installed at ${file}\n`);
    else {
      process.stderr.write(`The skill file at ${file} has been modified.\n`);
      process.stderr.write(`Run 'review-intent skill uninstall${localFlag(scope)} --force' to remove anyway.\n`);
      process.exitCode = 1;
    }
    return;
  }

  process.stderr.write(`Unknown skill command: ${sub ?? "(none)"}\nTry: review-intent skill install | uninstall\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);
  if (rawArgv[0] === "skill") {
    await runSkill(rawArgv.slice(1));
    return;
  }

  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      artifact: { type: "string" },
      out: { type: "string" },
      open: { type: "boolean", default: true },
      "allow-gaps": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowNegative: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const cwd = process.cwd();
  const base = resolveBase(cwd, values.base);
  const rawDiff = getDiff(cwd, base);
  const artifact = loadArtifact(cwd, values.artifact);
  const config = loadConfig(cwd);
  const diff = parseDiffText(rawDiff);

  // Part 1: objective scorecard, computed from the diff.
  const scorecard = buildScorecard(diff, config);

  // Part 3: file-level reach, computed by scanning the repo for importers of
  // the changed code files.
  const changedCodePaths = diff
    .filter((f) => f.status !== "deleted" && isCodePath(f.path))
    .map((f) => f.path);
  const { files: repoFiles, truncated } = scanRepo(cwd);
  const reach = buildReachGraph(repoFiles, changedCodePaths, {
    scanTruncated: truncated,
  });

  // Part 1 (cont.): measured cyclomatic complexity of the changed code, via the
  // external lizard analyzer. Degrades gracefully if lizard isn't installed.
  const complexity = analyzeComplexity(cwd, changedCodePaths, config.complexityThreshold);

  const model = buildReviewModel(artifact, diff, base, scorecard, reach, complexity);

  // Strict completeness gate: refuse to render incomplete intent unless the
  // author explicitly opts into a draft.
  const gaps = findGaps(model);
  if (gaps.length > 0 && !values["allow-gaps"]) {
    process.stderr.write(`\n${formatGaps(gaps)}\n`);
    process.exitCode = 1;
    return;
  }

  const html = renderHtml(model);

  const outPath = values.out ?? join(tmpdir(), `review-intent-${Date.now()}.html`);
  writeFileSync(outPath, html, "utf8");
  process.stdout.write(`Wrote review to ${outPath}\n`);

  if (values.open) {
    await open(outPath);
  }
}

main().catch((err) => {
  if (
    err instanceof GitError ||
    err instanceof ArtifactError ||
    err instanceof ConfigError
  ) {
    process.stderr.write(`\n${err.message}\n`);
  } else {
    process.stderr.write(`\nUnexpected error: ${(err as Error).message}\n`);
  }
  process.exitCode = 1;
});
