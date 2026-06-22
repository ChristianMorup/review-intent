import { execFileSync } from "node:child_process";
import type { DiffScope } from "./types.js";

export class GitError extends Error {}

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new GitError((e.stderr || e.message).trim());
  }
}

/** Like git(), but for `git diff --no-index`, which returns exit 1 when the
 *  files differ — that is success here, not an error. Exit ≥ 2 still throws. */
function gitDiffNoIndex(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message: string };
    if (e.status === 1 && typeof e.stdout === "string") return e.stdout;
    throw new GitError((e.stderr || e.message).trim());
  }
}

/**
 * Parse `git status --porcelain` (v1) into the files that carry uncommitted work.
 * Pure and unit-tested. Untracked = `??` lines; everything else with a status is
 * a tracked change (rename → new path). Paths are dequoted for the common case;
 * exotic C-escapes in non-ASCII paths are a known limitation.
 */
export function parseGitStatus(porcelain: string): {
  uncommittedFiles: string[];
  untrackedFiles: string[];
} {
  const uncommittedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue; // need "XY <path>"
    const status = line.slice(0, 2);
    let rest = line.slice(3);
    if (status === "??") {
      untrackedFiles.push(dequote(rest));
      continue;
    }
    const arrow = rest.indexOf(" -> ");
    if (arrow !== -1) rest = rest.slice(arrow + 4); // rename: take the new path
    uncommittedFiles.push(dequote(rest));
  }
  return { uncommittedFiles, untrackedFiles };
}

function dequote(p: string): string {
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) return p.slice(1, -1);
  return p;
}

function branchExists(ref: string, cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** Resolve the base branch to diff against: explicit override, else main, else master. */
export function resolveBase(cwd: string, override?: string): string {
  if (override) {
    if (!branchExists(override, cwd)) {
      throw new GitError(`Base ref "${override}" does not exist in this repo.`);
    }
    return override;
  }
  for (const candidate of ["main", "master"]) {
    if (branchExists(candidate, cwd)) return candidate;
  }
  throw new GitError(
    `Could not find a base branch (tried "main" and "master"). Pass --base <ref>.`,
  );
}

/**
 * Produce the diff: changes on the current branch since it diverged from base,
 * plus uncommitted tracked and untracked working-tree changes when the tree is dirty.
 * Returns the raw unified diff text and a populated DiffScope descriptor.
 */
export function getDiff(cwd: string, base: string): { text: string; scope: DiffScope } {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "ignore" });
  } catch {
    throw new GitError(`Not a git repository: ${cwd}`);
  }

  const mergeBase = git(["merge-base", base, "HEAD"], cwd).trim();
  // `--untracked-files=all` lists each untracked file individually; without it
  // git collapses an untracked directory to a single `dir/` entry, which would
  // both break the per-file `--no-index` call below (it looks for `dir/null`)
  // and silently drop every file inside that directory.
  const { uncommittedFiles, untrackedFiles } = parseGitStatus(
    git(["status", "--porcelain", "--untracked-files=all"], cwd),
  );
  const dirty = uncommittedFiles.length > 0 || untrackedFiles.length > 0;

  if (!dirty) {
    // Identical to the previous `base...HEAD` (merge-base..HEAD), committed-only.
    return {
      text: git(["diff", mergeBase, "HEAD"], cwd),
      scope: { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] },
    };
  }

  // Fork point → current working tree: committed + uncommitted tracked changes.
  let text = git(["diff", mergeBase], cwd);
  // Untracked files are invisible to `git diff`; fold each in via --no-index.
  for (const f of untrackedFiles) {
    text += gitDiffNoIndex(["diff", "--no-index", "--", "/dev/null", f], cwd);
  }
  return { text, scope: { includesUncommitted: true, uncommittedFiles, untrackedFiles } };
}
