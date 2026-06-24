import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const SKILL_NAME = "review-intent-authoring";

// Embedded content for the Claude Code skill that teaches the change-making
// agent to author an honest .review/intent.json before review. Single source
// of truth — the installer writes this byte-for-byte, and uninstall checks
// against it (line-ending-normalized) to decide whether the file is still ours.
export const SKILL_CONTENT = `---
name: review-intent-authoring
description: Use when you have just finished a set of code changes on a branch and the user (or another reviewer) is about to review the diff. Author a .review/intent.json that captures the genuine intent behind the changes — why, what you rejected, what it rests on — keyed to files and hunks, plus mermaid class and sequence diagrams. Then offer to render it with review-intent so the reviewer adjudicates decisions instead of skimming lines.
---

# Authoring an honest intent artifact

A diff records *what* changed and erases *why*. \`review-intent\` renders your
intent side-by-side with the diff so the reviewer adjudicates decisions, not
lines. Your job is to write \`.review/intent.json\` — and to write it **honestly**,
because a fluent rationalization is worse than nothing: it lowers the reviewer's
guard while adding no real signal.

## When to author

After you finish a logical change set on a branch and before you hand it back
for review. One artifact per branch / review.

## When NOT to author

- A trivial or purely mechanical change (rename, formatting, dependency bump)
  where the diff already tells the whole story. Say so in chat; don't manufacture
  intent.
- You are mid-implementation, not at a reviewable stopping point.
- The user has declined review-intent for this change set.

## The honesty contract (read this before writing a word)

These rules exist to keep the artifact from becoming post-hoc theater:

1. **Intent is the reason you chose this, not a description of what it does.**
   "Adds a cache" is not intent. "Chose an in-memory cache over Redis because the
   data is request-scoped and we have one process" is intent.
2. **Name what you rejected — truthfully.** If there was a real alternative, state
   it and why you didn't take it. If there genuinely wasn't one, write "no real
   alternative considered" — do **not** invent a rejected option to look thorough.
3. **State what the change rests on.** The assumptions that, if false, make this
   change wrong. This is the reviewer's highest-value target.
4. **Mark incidental changes as incidental.** If a hunk is a mechanical
   consequence (a signature changed so callers had to), say that plainly instead
   of inventing a decision for it.
5. **If you are uncertain, say you are uncertain.** "I think X but didn't verify
   under concurrency" is more useful than false confidence.

If following these makes a section short or admits a gap, that is a success, not
a failure. The gap is the signal the reviewer needs.

## Completeness is mandatory (this is enforced)

Every changed file needs a \`what\` and a \`why\`, and **every hunk needs a \`what\`
and a \`why\`**. \`review-intent\` runs a completeness gate and **refuses to render**
if any changed file or hunk is missing intent — it prints the exact gaps. Do not
hand back a change set with empty intent; fill it before you offer the review.
(\`--allow-gaps\` exists for an explicit work-in-progress draft, and even then the
gaps render as red markers — it is not a way to skip the work.) review-intent
also renders an **intent-coverage gauge** — the measured share of files and hunks
you annotated — so partial coverage is visible at a glance, draft or not.

\`what\` vs \`why\`: \`what\` is a one-line description of the change (cheap — write it
first). \`why\` is the decision behind it and must not restate the what. "Renamed
\`x\` to \`y\`" is a what; "renamed for consistency with the \`z\` convention so callers
don't guess" is a why. For a mechanical hunk, an honest why is "incidental —
forced by the signature change above"; write that rather than leaving it blank.

## The artifact: \`.review/intent.json\`

Write it at the repo root. \`title\`, \`tldr\`, and \`overall\` are required, and so
are \`what\`/\`why\` on every file and hunk you list (see the completeness gate
above). The \`tldr\` is a five-second read shown as a lede at the top — the single
headline (what + the most important why); \`overall\` is the fuller story beneath
it. Don't make the tldr a copy of the title or just the "what" — it must carry a
why.

\`\`\`jsonc
{
  "title": "Short change-set title",
  "tldr": "One or two sentences a reviewer can read in five seconds: what this does and the single most important why.",
  "overall": "Why this change set exists. What you rejected and why. What it rests on (assumptions that, if false, break it). Markdown.",
  "risks": [
    { "assumption": "What the change rests on",
      "ifFalse": "What breaks if it does not hold",
      "howYoudKnow": "How a reviewer could check (optional)" }
  ],
  "tests": [
    { "describes": "Plain-language sentence: what this test proves.",
      "name": "RealTestIdentifier (optional, for cross-reference)",
      "kind": "unit | integration | e2e | manual (optional)" }
  ],
  "diagrams": {
    "class": "classDiagram\\n  ...",       // structures you added/changed
    "sequence": "sequenceDiagram\\n  ..."   // a flow the change affects; highlight changed steps
  },
  "files": [
    {
      "path": "src/foo.ts",
      "what": "What changed in this file (one line is fine).",
      "why": "Why — the decision behind it. REQUIRED for every changed file.",
      "hunks": [
        { "anchor": 42,
          "what": "What this specific change does.",
          "why": "Why this specific change. REQUIRED. Anchor = a line number in the NEW file." }
      ]
    }
  ],
  "reviewOrder": ["src/the-crux.ts", "src/supporting.ts", "src/trivial-churn.ts"]
}
\`\`\`

### The blast radius (\`risks\`)

The \`risks\` array is the change's blast radius — one row per thing it rests on.
This is the reviewer's highest-value target, so write it to honesty-rule #3:

- Each row is an **assumption** (what must be true), the **ifFalse** consequence
  (what breaks if it isn't), and optionally **howYoudKnow** (how to check).
- If the change genuinely rests on nothing, leave \`risks\` empty — but know that
  review-intent renders an explicit "No risks declared" nudge, because a truly
  assumption-free change is rare. An empty ledger is a claim, not a free pass.
- **review-intent independently measures several signals and renders them next
  to your ledger — you cannot edit them.** A surface-area scorecard (files,
  ±lines, test-vs-code, debt/debug markers), a file-level reach graph, and the
  **cyclomatic complexity of the changed functions** (hotspots above the repo
  threshold are flagged, via \`lizard\`) all sit beside your claims. If you claim
  "low risk" while the scorecard flags \`touches auth/, 0 test files\` or a
  changed function jumps to CCN 30 and you never mention it, the contradiction is
  visible at a glance.
- **There is a "change map"** that plots each changed file by *measured*
  downstream reach (how many files import it) against *measured* churn, flagging
  the ones that also carry a complexity hotspot. The biggest, most depended-on
  files land in the top-right — that's where a reviewer looks first, so those are
  the files whose *why* had better be airtight. If a hunk added real
  branching/complexity, the *why* is the place to justify it.

### The tests section (\`tests\`)

Optional. List the test cases that cover this change, each described in **plain
language** — the value is a reviewer reading "Cache returns null on a miss"
instead of decoding \`CacheMiss_ReturnsNull\`. Each entry needs a \`describes\`
sentence; \`name\` (the real test identifier) and \`kind\` (\`unit\`, \`integration\`,
\`e2e\`, \`manual\`) are optional — known kinds group the list.

Honesty applies here too: describe the tests that **actually exist**, not the
ones you wish you'd written. If a behaviour is untested, don't invent a case —
either leave it out or, if it matters, name the gap in the risk ledger
(\`howYoudKnow\` is often exactly that test). \`describes\` is what the test proves
for a reader, not a restatement of its name. Omit the section entirely for a
change with no meaningful tests rather than padding it.

### Anchors

\`anchor\` is a line number in the **new** version of the file (the right side of
the diff). review-intent attaches the note to whichever hunk's new-line range
contains that anchor. Pick a line inside the change you are explaining. If you
get it wrong, the note still shows — under "Notes not matched to a hunk" — so it
is never lost, but aim to land it in the hunk.

### Diagrams (mermaid, authored by you)

- **Class diagram**: the types/modules you added or reshaped and their relations.
  Keep it to what the change touches, not the whole system.
- **Sequence diagram**: a flow the change participates in. Highlight the steps
  that changed using a \`rect\` block or a \`Note\`, e.g.:

\`\`\`
sequenceDiagram
  Caller->>Service: request()
  rect rgb(40,80,50)
  Note over Service: CHANGED: now validates input first
  end
  Service-->>Caller: result
\`\`\`

Omit a diagram if the change genuinely has no structural or sequential story —
don't draw a trivial two-box diagram to fill the slot.

### Review order (\`reviewOrder\`, optional)

By default \`review-intent\` orders the files by a **measured** priority (churn,
reach, complexity, missing intent). That's the un-gameable backbone — but you
know things measurement can't: which change is the *crux* and which is mechanical.
Use \`reviewOrder\` to set the sequence you'd want a reviewer to read: an array of
changed-file paths (as they appear in the diff), most-important first. Listed
files lead in that order; any file you omit follows by measured rank.

Reach for it when:
- a small change is the whole point but sits next to a large mechanical one
  (lead with the small one);
- the change reads best as a narrative — entry point → callees, or a request
  flow top to bottom;
- genuinely trivial/generated files should sink to the bottom (list them last).

The measured rank stays visible beside every file you move, so the reviewer can
see what you reordered. That means the one thing you must **not** do is use
\`reviewOrder\` to bury a risky, high-churn, or far-reaching change so the diff
reads cleanly — the demotion will be plainly visible and it reads as exactly what
it is. Order for the reviewer's understanding, never to soften scrutiny. Omit the
field entirely to just use the measured order.

### Reviewing from a worktree

If you did the work in a git worktree (common for agent-driven changes), a few
things matter:

- **Run \`review-intent\` from the worktree's own root.** It keys everything off
  the current directory — the diff it produces, the artifact it reads, and the
  repo scans for reach and complexity. Running it from the main checkout reviews
  the wrong tree.
- **You don't need to commit first.** If the working tree is dirty, review-intent
  folds your uncommitted *and* untracked changes into the diff automatically and
  flags those files (a banner up top, an \`uncommitted\`/\`untracked\` badge per
  file). What you ultimately hand off for *merge* is still the committed history —
  the badges make the difference visible so the reviewer is never misled.
- **The base resolves automatically.** \`main\`/\`master\` are shared across linked
  worktrees, so they resolve from inside a worktree with no extra flags. Pass
  \`--base <ref>\` if your worktree forked from a different branch.

## After writing it

Offer to review — never auto-launch:

> I've written the review intent to \`.review/intent.json\`. Want me to open the
> side-by-side review?

**Default to the \`review_changes\` MCP tool whenever it is available.** It opens an
*interactive* review the CLI cannot: the reviewer can ask you questions about a
hunk mid-review and you answer them live. Only fall back to the CLI when the MCP
tool is genuinely not present.

- **If the \`review_changes\` tool is available** (the review-intent MCP server is
  configured), **call it** — do not shell out to the CLI instead. It renders the
  side-by-side page from the \`.review/intent.json\` you just wrote, opens it in the
  reviewer's browser, and **blocks until the next review event**. Pass \`cwd\` if you
  worked in a git worktree (the worktree root) and \`base\` if you forked from
  something other than main/master. The call returns one of:
  - a **question** — the reviewer asked about a hunk. Answer it by calling
    \`answer_review_question\` (with the \`sessionId\` and \`questionId\` from the event);
    your answer appears live on the still-open page. Then you're blocked again on
    the next event. **Keep answering until you get a decision** — a question is not
    the end of the review.
  - a **decision** (approve / request-changes) plus any comments and questions —
    act on it: address requested changes and offer the review again; on approval,
    you're done.
  - an **abandoned** result — the reviewer closed the tab without deciding; re-offer
    or ask how they'd like to proceed.

  The tool runs the same completeness gate — if intent is incomplete it returns the
  gaps instead of opening the page, so fill them rather than reaching for
  \`allowGaps\`.
- **Only as a fallback** (no MCP server configured), run \`review-intent\` via Bash
  from the root of the working tree you made the changes in (the worktree root, if
  you used one). This renders a **static page with no live Q&A** — the reviewer can
  only add comments and copy the assembled prompt back to you manually. Prefer the
  MCP tool above; reach for the CLI only when it is unavailable.

## Why this exists

The friction of hand-writing code used to carry reflection along for free. With
that friction gone, intent has to be chosen on purpose. This artifact is where
you pay for it — deliberately, in the reviewer's currency: why, rejected
alternatives, and assumptions. Render quality is not the hard part; the honesty
of what you write here is.
`;

export type SkillScope = "user" | "local";

export interface SkillPathOptions {
  /** 'user' → ~/.claude/skills (default). 'local' → ./.claude/skills (per-repo). */
  scope?: SkillScope;
  /** Override $HOME (used by tests). Defaults to os.homedir(). */
  home?: string;
  /** Override cwd for 'local' scope (used by tests). Defaults to process.cwd(). */
  cwd?: string;
}

export function skillFile(opts: SkillPathOptions = {}): string {
  const scope = opts.scope ?? "user";
  const root =
    scope === "local"
      ? (opts.cwd ?? process.cwd())
      : (opts.home ?? os.homedir());
  return path.join(root, ".claude", "skills", SKILL_NAME, "SKILL.md");
}

export type InstallResult = "installed" | "already" | "updated" | "conflict";

export async function installSkill(
  opts: { force?: boolean } & SkillPathOptions = {},
): Promise<InstallResult> {
  const file = skillFile(opts);
  const existing = await readOrNull(file);
  if (existing !== null && canonical(existing) === canonical(SKILL_CONTENT)) {
    return "already";
  }
  if (existing !== null && !opts.force) {
    return "conflict";
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, SKILL_CONTENT, "utf8");
  return existing === null ? "installed" : "updated";
}

export type UninstallResult = "removed" | "not-installed" | "modified";

export async function uninstallSkill(
  opts: { force?: boolean } & SkillPathOptions = {},
): Promise<UninstallResult> {
  const file = skillFile(opts);
  const existing = await readOrNull(file);
  if (existing === null) return "not-installed";
  if (canonical(existing) !== canonical(SKILL_CONTENT) && !opts.force) {
    return "modified";
  }
  await fs.rm(file);
  // Best-effort cleanup of the now-empty skill directory; leave it alone if the
  // user dropped other files in there. Only swallow the expected codes.
  try {
    await fs.rmdir(path.dirname(file));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOTEMPTY" && code !== "ENOENT" && code !== "EEXIST") throw err;
  }
  return "removed";
}

// Normalize CRLF so an editor that rewrote line endings doesn't flip a clean
// install into a "conflict" / "modified" state.
function canonical(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

async function readOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
