import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ReachModel, ReachEdge } from "./types.js";

export interface RepoFile {
  /** Posix-style path relative to the repo root. */
  path: string;
  content: string;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".git",
  "bin",
  "obj",
  ".vs",
  ".idea",
  "coverage",
  ".next",
]);

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_FILE_BYTES = 300 * 1024;
const DEFAULT_MAX_EDGES_PER_NODE = 8;

export interface ScanResult {
  files: RepoFile[];
  truncated: boolean;
}

/** Walk the repo collecting code files (bounded). I/O — not pure. */
export function scanRepo(
  cwd: string,
  opts: { maxFiles?: number; maxFileBytes?: number } = {},
): ScanResult {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const files: RepoFile[] = [];
  let truncated = false;

  const walk = (dir: string): void => {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (entry.isFile() && CODE_EXT.test(entry.name)) {
        try {
          if (statSync(full).size > maxBytes) continue;
          const content = readFileSync(full, "utf8");
          files.push({ path: toPosix(relative(cwd, full)), content });
        } catch {
          // unreadable file — skip
        }
      }
    }
  };

  walk(cwd);
  return { files, truncated };
}

const SPEC_RE =
  /(?:\bfrom\s+|\bimport\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

/**
 * Pure: build the file-level reach graph. An edge `from → to` means the
 * dependent file `from` imports/references the changed file `to`.
 *
 * Heuristic: matches import/require/from specifiers against each changed file's
 * path-without-extension or basename. False positives (shared basenames) and
 * misses (non-path imports like C# `using`) are possible by design — the
 * renderer labels the graph as heuristic.
 */
export function buildReachGraph(
  files: RepoFile[],
  changedPaths: string[],
  opts: { maxEdgesPerNode?: number; scanTruncated?: boolean } = {},
): ReachModel {
  const maxEdges = opts.maxEdgesPerNode ?? DEFAULT_MAX_EDGES_PER_NODE;
  const changed = changedPaths.map(toPosix);
  const changedSet = new Set(changed);

  // Precompute match keys per changed file.
  const keys = changed.map((p) => ({
    path: p,
    noExt: stripExt(p),
    base: stripExt(p.split("/").pop() ?? p),
  }));

  const edges: ReachEdge[] = [];
  const perNode = new Map<string, number>();
  let overflow = 0;

  for (const file of files) {
    if (changedSet.has(file.path)) continue; // don't link a changed file to itself
    const specs = extractSpecifiers(file.content);
    if (specs.length === 0) continue;
    const specKeys = specs.map((s) => ({ noExt: stripExt(normalize(s)), spec: s }));

    for (const k of keys) {
      const hit = specKeys.some(
        (sk) =>
          sk.noExt === k.noExt ||
          sk.noExt.endsWith("/" + k.base) ||
          sk.noExt === k.base,
      );
      if (!hit) continue;
      const count = perNode.get(k.path) ?? 0;
      if (count >= maxEdges) {
        overflow++;
        continue;
      }
      perNode.set(k.path, count + 1);
      edges.push({ from: file.path, to: k.path });
    }
  }

  const notes: string[] = [];
  if (opts.scanTruncated) {
    notes.push("repo scan hit the file cap — some dependents may be missing");
  }
  if (overflow > 0) {
    notes.push(`${overflow} additional edge(s) hidden (per-node cap)`);
  }

  return {
    changed,
    edges,
    truncatedNote: notes.length ? notes.join("; ") : undefined,
  };
}

function extractSpecifiers(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(SPEC_RE)) out.push(m[1]);
  return out;
}

function normalize(spec: string): string {
  // strip leading ./ and ../ segments
  return spec.replace(/^(?:\.\.?\/)+/, "");
}

function stripExt(p: string): string {
  return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i, "");
}

function toPosix(p: string): string {
  return sep === "\\" ? p.split(sep).join("/") : p;
}
