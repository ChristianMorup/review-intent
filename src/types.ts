import { z } from "zod";

/**
 * The agent-authored artifact contract. The agent that made the changes writes
 * this file (default `./.review/intent.json`); the CLI only ever reads it.
 */
export const HunkIntentSchema = z.object({
  /** A line number in the NEW version of the file. The CLI attaches this note
   *  to whichever diff hunk's new-line range contains the anchor. */
  anchor: z.number().int().positive(),
  /** What this specific change does. */
  what: z.string().min(1),
  /** Why it was made — the decision, not a restatement of the what. */
  why: z.string().min(1),
});

export const FileIntentSchema = z.object({
  path: z.string().min(1),
  /** What changed in this file. */
  what: z.string().min(1),
  /** Why this file changed — the decision behind it (markdown). */
  why: z.string().min(1),
  hunks: z.array(HunkIntentSchema).optional().default([]),
});

export const DiagramsSchema = z
  .object({
    /** Mermaid `classDiagram` source, authored by the agent. */
    class: z.string().optional(),
    /** Mermaid `sequenceDiagram` source; changed steps highlighted by the agent. */
    sequence: z.string().optional(),
  })
  .optional()
  .default({});

/** One row of the agent-authored risk ledger (the "blast radius"). */
export const RiskSchema = z.object({
  /** Something the change rests on; if false, the change is wrong. */
  assumption: z.string().min(1),
  /** What breaks if the assumption does not hold. */
  ifFalse: z.string().min(1),
  /** How a reviewer could find out whether it holds. Optional. */
  howYoudKnow: z.string().optional(),
});

/** One agent-described test case. Pure prose — the renderer never parses or
 *  measures it; it sits on the "claimed" side, next to the measured test count. */
export const TestCaseSchema = z.object({
  /** A short, human-readable sentence: what the test proves. The only required
   *  field — the point is a reviewer reading it instead of a cryptic test name. */
  describes: z.string().min(1),
  /** The real test identifier, for cross-reference (e.g. `CacheMiss_ReturnsNull`). */
  name: z.string().optional(),
  /** Free-form kind (e.g. `unit`, `integration`, `e2e`, `manual`). Known kinds
   *  get a coloured tag and drive grouping; anything else is shown as-is. Kept a
   *  free string so an unusual kind never rejects the artifact. */
  kind: z.string().optional(),
});

export const ArtifactSchema = z.object({
  title: z.string().min(1),
  /** One- or two-sentence executive summary, shown as a lede above `overall`. */
  tldr: z.string().min(1),
  /** Why this change set exists, what was rejected, what it rests on (markdown). */
  overall: z.string().min(1),
  diagrams: DiagramsSchema,
  risks: z.array(RiskSchema).optional().default([]),
  /** Human-readable descriptions of the test cases covering the change (claimed). */
  tests: z.array(TestCaseSchema).optional().default([]),
  files: z.array(FileIntentSchema).optional().default([]),
});

export type HunkIntent = z.infer<typeof HunkIntentSchema>;
export type FileIntent = z.infer<typeof FileIntentSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;

/** A single line of a parsed diff hunk. */
export interface DiffLine {
  type: "add" | "del" | "normal";
  content: string;
  oldNumber?: number;
  newNumber?: number;
}

/** One hunk of changes within a file. */
export interface DiffHunk {
  header: string;
  newStart: number;
  newEnd: number;
  lines: DiffLine[];
}

/** A single changed file in the diff. */
export interface DiffFile {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
  hunks: DiffHunk[];
}

/** A diff hunk joined with any per-hunk intent that anchored into it. */
export interface AnnotatedHunk extends DiffHunk {
  intents: HunkIntent[];
}

/** A diff file joined with its file-level and per-hunk intent. */
export interface AnnotatedFile {
  path: string;
  status: DiffFile["status"];
  /** True when this file carries uncommitted (staged/unstaged) changes vs HEAD. */
  uncommitted?: boolean;
  /** True when this file is untracked (new, never committed). */
  untracked?: boolean;
  /** undefined when the agent wrote no entry for this changed file (a gap). */
  what?: string;
  why?: string;
  /** Per-hunk intents whose anchor did not land in any hunk of this file. */
  unmatchedIntents: HunkIntent[];
  hunks: AnnotatedHunk[];
}

/** A missing-rationale finding from the completeness check. */
export interface Gap {
  kind: "file" | "hunk";
  path: string;
  detail: string;
}

/** Repo-level policy for the surface-area scorecard. Optional `.review/config.json`. */
export interface SensitivePath {
  label: string;
  /** Regex string, tested against the posix-style changed path. */
  pattern: string;
}

export interface RepoConfig {
  sensitivePaths: SensitivePath[];
  /** Churn thresholds above which the change set is flagged "large". */
  churnFiles: number;
  churnLines: number;
  /** Cyclomatic-complexity number at/above which a function is a "hotspot". */
  complexityThreshold: number;
}

/** One function's measured complexity, from `lizard`. */
export interface ComplexityFunction {
  file: string;
  name: string;
  /** Cyclomatic complexity number (McCabe). */
  ccn: number;
  /** Lines of code excluding comments. */
  nloc: number;
  params: number;
  /** Start line in the new file. */
  line: number;
}

/** Measured complexity of the changed code (Part 1, via the external `lizard`
 *  analyzer). `available: false` when lizard is missing — surfaced, never silent. */
export interface ComplexityModel {
  available: boolean;
  /** Hotspot threshold in effect (repo policy). */
  threshold: number;
  functionsAnalyzed: number;
  maxCcn: number;
  /** The single most complex changed function, or null. */
  worst: ComplexityFunction | null;
  /** Functions at or above the threshold, worst-first (bounded). */
  hotspots: ComplexityFunction[];
  /** Why analysis is unavailable / incomplete, when applicable. */
  note?: string;
}

export type BadgeTone = "info" | "warn" | "danger";

export interface ScorecardBadge {
  label: string;
  tone: BadgeTone;
}

/** Objective, CLI-computed surface area of the change set (Part 1). */
export interface ScorecardModel {
  filesChanged: number;
  byStatus: Record<string, number>;
  hunks: number;
  added: number;
  removed: number;
  testFiles: number;
  codeFiles: number;
  /** Churned (added + removed) lines within test files. */
  testLines: number;
  /** Churned (added + removed) lines within non-test code files. */
  codeLines: number;
  /** Added lines that introduce a debt/debug marker (TODO, console.log, …). */
  debtMarkers: number;
  /** Changed files that are noise — lockfiles, generated, build output, binaries. */
  noiseFiles: number;
  /** The single most-churned file (added + removed), or null for an empty diff. */
  largestFile: { path: string; churn: number } | null;
  badges: ScorecardBadge[];
}

/** A "dependent depends on changed" edge in the reach graph (Part 3). */
export interface ReachEdge {
  from: string;
  to: string;
}

/** CLI-computed, file-level reach of the changed files (Part 3). */
export interface ReachModel {
  changed: string[];
  edges: ReachEdge[];
  /** Set when the scan or render was capped, so truncation is never silent. */
  truncatedNote?: string;
}

/** What the rendered diff covers beyond committed history. Computed by git.ts
 *  from the working-tree state; plain data so match/render stay pure. */
export interface DiffScope {
  /** True when the diff includes uncommitted working-tree changes. */
  includesUncommitted: boolean;
  /** Tracked files with staged/unstaged changes folded in (posix, repo-relative). */
  uncommittedFiles: string[];
  /** Untracked-not-ignored files folded in via --no-index (posix, repo-relative). */
  untrackedFiles: string[];
}

/** How much of the change set carries agent-authored intent (measured against
 *  the completeness contract). Meaningful even under `--allow-gaps`. */
export interface IntentCoverage {
  filesCovered: number;
  filesTotal: number;
  hunksCovered: number;
  hunksTotal: number;
}

/** The complete view model handed to the renderer. */
export interface ReviewModel {
  title: string;
  tldr: string;
  overall: string;
  base: string;
  /** What the rendered diff covers beyond committed history (banner + badges). */
  diffScope: DiffScope;
  diagrams: { class?: string; sequence?: string };
  risks: Risk[];
  /** Agent-described test cases (claimed; pure display, never measured). */
  tests: TestCase[];
  scorecard: ScorecardModel;
  reach: ReachModel;
  complexity: ComplexityModel;
  intentCoverage: IntentCoverage;
  files: AnnotatedFile[];
  /** Intent entries for files that are not present in the diff. */
  filesWithoutChanges: { path: string; why?: string }[];
}
