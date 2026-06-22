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
 * Produce the PR-style diff: changes on the current branch since it diverged
 * from base (`git diff base...HEAD`). Returns the raw unified diff text and a
 * clean scope descriptor (real dirty-tree detection lands in Task 2).
 */
export function getDiff(cwd: string, base: string): { text: string; scope: DiffScope } {
  // Fails early with a clear message if cwd is not a git work tree.
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: "ignore",
    });
  } catch {
    throw new GitError(`Not a git repository: ${cwd}`);
  }
  const text = git(["diff", `${base}...HEAD`], cwd);
  const scope: DiffScope = { includesUncommitted: false, uncommittedFiles: [], untrackedFiles: [] };
  return { text, scope };
}
