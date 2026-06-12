import { execFileSync } from "node:child_process";
import type { ComplexityFunction, ComplexityModel } from "./types.js";

/** Languages in the Immeo stack that `lizard` parses reliably from source. */
const ANALYZABLE_RE = /\.(cs|ts|tsx|js|jsx|mjs|cjs|py)$/i;

/** Max hotspots to keep, so a pathological change set can't flood the report. */
const MAX_HOTSPOTS = 12;

export function isAnalyzablePath(path: string): boolean {
  return ANALYZABLE_RE.test(path);
}

/**
 * Pure: split one `lizard --csv` line into fields. lizard quotes the location,
 * file, name and long-name columns with the Python csv writer, and the long-name
 * column contains commas (parameter lists) — so a naive split is wrong.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/** Pure: parse the full `lizard --csv` output into per-function records.
 *  Columns: nloc, ccn, token, params, length, location, file, name, long_name, start, end. */
export function parseLizardCsv(csv: string): ComplexityFunction[] {
  const out: ComplexityFunction[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    const f = parseCsvLine(raw);
    if (f.length < 11) continue; // malformed row — skip rather than mis-read
    out.push({
      nloc: Number(f[0]),
      ccn: Number(f[1]),
      params: Number(f[3]),
      file: f[6],
      name: f[7],
      line: Number(f[9]),
    });
  }
  return out;
}

/** Pure: aggregate per-function records into the measured complexity model. */
export function buildComplexityModel(
  funcs: ComplexityFunction[],
  threshold: number,
): ComplexityModel {
  const sorted = [...funcs].sort((a, b) => b.ccn - a.ccn);
  return {
    available: true,
    threshold,
    functionsAnalyzed: funcs.length,
    maxCcn: funcs.reduce((m, f) => Math.max(m, f.ccn), 0),
    worst: sorted[0] ?? null,
    hotspots: sorted.filter((f) => f.ccn >= threshold).slice(0, MAX_HOTSPOTS),
  };
}

/** A complexity model standing in for analysis that could not run — the note is
 *  rendered so the absence is visible, never a silent skip. */
export function unavailableComplexity(note: string): ComplexityModel {
  return {
    available: false,
    threshold: 0,
    functionsAnalyzed: 0,
    maxCcn: 0,
    worst: null,
    hotspots: [],
    note,
  };
}

/** Candidate ways to invoke lizard: the console script if on PATH, else the
 *  Python module (covers `pip install --user` where the script isn't on PATH). */
const INVOCATIONS: { cmd: string; pre: string[] }[] = [
  { cmd: "lizard", pre: [] },
  { cmd: "python", pre: ["-m", "lizard"] },
  { cmd: "python3", pre: ["-m", "lizard"] },
  { cmd: "py", pre: ["-m", "lizard"] },
];

function runLizard(cwd: string, files: string[]): string | null {
  for (const inv of INVOCATIONS) {
    try {
      return execFileSync(inv.cmd, [...inv.pre, "--csv", ...files], {
        cwd,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (err) {
      const e = err as { code?: string; stdout?: string };
      if (e.code === "ENOENT") continue; // this invocation isn't available — try the next
      // lizard ran but exited non-zero (e.g. threshold warnings); keep its output.
      if (typeof e.stdout === "string" && e.stdout.trim() !== "") return e.stdout;
      return null;
    }
  }
  return null; // no working lizard invocation
}

/**
 * Side-effecting: measure complexity of the analyzable changed files via lizard.
 * Degrades gracefully — a missing lizard yields an `available: false` model with
 * a note rather than an error or a silent gap.
 */
export function analyzeComplexity(
  cwd: string,
  changedPaths: string[],
  threshold: number,
): ComplexityModel {
  const files = changedPaths.filter(isAnalyzablePath);
  if (files.length === 0) {
    return { ...buildComplexityModel([], threshold), note: "no analyzable source files in this change set" };
  }
  const csv = runLizard(cwd, files);
  if (csv === null) {
    return unavailableComplexity(
      "lizard not found — run `pip install lizard` to enable complexity metrics",
    );
  }
  return buildComplexityModel(parseLizardCsv(csv), threshold);
}
