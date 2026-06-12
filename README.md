# review-intent

A CLI that renders the diff between your current branch and `main` as an
**intent-annotated** HTML review page — opened in your browser — with mermaid
class & sequence diagrams.

It exists to fix shallow PR review: a diff shows *what* changed but erases *why*.
`review-intent` puts the agent's stated intent **side-by-side** with each change,
so a reviewer adjudicates decisions instead of skimming lines.

## How it works

The CLI is a **pure renderer**. It does two things:

1. Runs `git diff <base>...HEAD` itself (PR-style, merge-base diff).
2. Reads an **agent-authored artifact** (`./.review/intent.json`) for the intent
   prose and the mermaid diagram sources.

It joins them and emits one self-contained `review.html`, then opens it. No LLM
call, no API key, no token cost per run. The agent that *made* the changes is
responsible for writing the artifact.

## Usage

Run it without installing:

```sh
npx @christianmorup/review-intent    # diff HEAD vs main, read ./.review/intent.json, open browser
```

Or install it globally:

```sh
npm install -g @christianmorup/review-intent
review-intent
```

From a clone (development):

```sh
npm install
npm run build
node dist/cli.js              # diff HEAD vs main, read ./.review/intent.json, open browser
```

Options:

| Flag | Default | Meaning |
|------|---------|---------|
| `--base <ref>` | `main`, else `master` | Base branch to diff against |
| `--artifact <path>` | `.review/intent.json` | Intent artifact location |
| `--out <path>` | OS temp file | Where to write the HTML |
| `--no-open` | (opens) | Write the file but don't launch the browser |
| `--allow-gaps` | (off) | Render a draft even if intent is incomplete; gaps render as red markers |

## Blast-radius summary

The top of the page carries a **blast-radius** block — the part that earns the
tool its keep — with three parts that deliberately pit *claimed* against
*measured*:

1. **Surface-area scorecard** *(measured, CLI-computed from the diff)* — files/
   hunks/±lines, test-vs-code file *and line* counts, net line delta,
   hunks-per-file concentration, new-file count, file-level reach fan-in, intent
   coverage (files & hunks annotated), diagram coverage, the single most-churned
   file, a count of debt/debug markers introduced (`TODO`/`FIXME`/`console.log`/
   `debugger`), a noise-file count (lockfiles, generated, build output,
   binaries), a **red badge when code changed but no tests did**, sensitive-path
   flags (`auth`, `*.bicep`, ADO pipelines, app config, secrets/Key Vault,
   `Dockerfile`, dependency manifests), and a churn flag. Objective and
   un-gameable.
2. **Risk ledger** *(claimed, agent-authored)* — `assumption → if false → how
   you'd know`. If absent, an honesty nudge appears instead of a blank.
3. **Reach graph** *(measured, CLI-computed)* — a mermaid flowchart of repo files
   that import the changed files. Heuristic (import/require/from scan), labelled
   as such; bounded, and any truncation is shown, never silent.

The scorecard sitting next to the ledger is the point: if the agent claims "low
risk" while the scorecard flags `touches auth/, 0 tests`, the contradiction is
visible at a glance.

## Visual summary

Below the blast radius is a **visual summary** — five charts rendered as pure,
self-contained inline SVG (no charting dependency, deterministic output):

1. **Diff mass** — diverging add/remove bars per file, sorted by churn, coloured
   by category (test/code/noise) with a green/red dot for intent present/missing.
2. **Change treemap** — rectangles sized by ± lines, coloured by top-level
   directory; files with no intent get a red outline.
3. **Intent-coverage rings** — donut gauges for the share of files and hunks
   that carry agent rationale (the completeness contract, visualized).
4. **Reach ripple** — the reach graph as concentric rings: changed files at the
   centre, importers rippling outward.
5. **Honesty quadrant** — the signature view: measured *blast radius* (churn +
   reach) on the x-axis against claimed *candor* (intent coverage + declared
   risks) on the y-axis. A dot landing in the shaded red corner is a high-impact
   change that declared little risk — the contradiction made into a picture.

`npm run sample` builds and writes a representative `sample-output.html` you can
open to see the whole page.

### Code complexity (optional, via `lizard`)

If the [`lizard`](https://github.com/terryyin/lizard) analyzer is installed
(`pip install lizard`), the scorecard also reports **measured cyclomatic
complexity** of the changed functions — max CCN, a count of hotspots at/above the
threshold, and a "complexity hotspots" bar chart in the visual summary. lizard
covers the whole Immeo stack (C#, TS/JS, Python) from source, no build required.
It's a *measured* signal, so it sits on the same un-gameable side as the
scorecard. If lizard isn't on `PATH`, the page says so rather than hiding the
gap — nothing else changes.

### Optional repo policy — `.review/config.json`

```jsonc
{
  "sensitivePaths": [ { "label": "pii", "pattern": "(^|/)pii" } ],  // regex on posix path; replaces defaults
  "churnFiles": 20,           // flag "large change set" above this many files
  "churnLines": 600,          // ...or this many ± lines
  "complexityThreshold": 15   // cyclomatic complexity at/above which a function is a hotspot
}
```

Absent → built-in defaults (tuned to the Immeo stack). It's repo *policy*, kept
out of the per-change artifact so it can't be gamed per-PR.

## The artifact contract (`.review/intent.json`)

```jsonc
{
  "title": "Short change-set title",
  "tldr": "Five-second headline: what this does + the single most important why.",
  "overall": "Why this change set exists, what was rejected, what it rests on. (markdown)",
  "risks": [
    { "assumption": "Data is request-scoped", "ifFalse": "Cache leaks across users", "howYoudKnow": "Concurrent-session test" }
  ],
  "tests": [
    { "describes": "Cache returns null on a miss instead of throwing.", "name": "CacheMiss_ReturnsNull", "kind": "unit" }
  ],
  "diagrams": {
    "class": "classDiagram\n  ...",       // mermaid source, authored by the agent
    "sequence": "sequenceDiagram\n  ..."   // highlight changed steps with rect / Note
  },
  "files": [
    {
      "path": "src/foo.ts",
      "what": "What changed in this file.",
      "why": "Why — the decision behind it. (markdown)",
      "hunks": [
        { "anchor": 42, "what": "What this change does.", "why": "Why this specific change." }
      ]
    }
  ]
}
```

`title`, `tldr`, `overall`, and every file/hunk's `what` + `why` are required.
`diagrams`, `risks`, `tests`, and `hunks` are optional. The `tldr` renders as a
lede at the top (a five-second read); `overall` is the fuller story in a
collapsible block beneath it.

### Tests section *(claimed, agent-authored)*

`tests` is an optional list of test cases described in plain language — the point
is a reviewer reading "Cache returns null on a miss" instead of decoding a name
like `CacheMiss_ReturnsNull`. Each entry needs a `describes` sentence; `name` (the
real test identifier, for cross-reference) and `kind` (`unit`, `integration`,
`e2e`, `manual`, or anything else) are optional. Known kinds get a coloured tag
and group the list. It renders as a standalone **Tests** section between the
visual summary and the diagrams. It is pure display — review-intent never parses
or runs your tests — so it sits on the *claimed* side, like the risk ledger.

### Completeness is enforced

The original pain point was agents leaving intent blank. So the contract has
teeth: **every changed file needs a `what` + `why`, and every diff hunk needs an
intent.** `review-intent` runs a completeness gate and **refuses to render** if
anything is missing, printing the exact files and hunks that lack rationale:

```
Intent is incomplete — 2 gap(s) found:
  - src/util.js: no what/why written for this changed file
  - src/util.js: hunk @@ -1 +1 @@ has no intent
```

`--allow-gaps` renders a work-in-progress draft anyway, with each gap shown as a
red marker in place — so even a draft can't hide an empty spot. `what` is a cheap
one-line description; `why` is the decision and must not just restate the `what`.

### How per-hunk intent is matched

`anchor` is a **line number in the new version of the file**. The CLI attaches
the note to whichever diff hunk's new-line range contains that anchor. This is
robust to minor hunk-boundary shifts (unlike matching by hunk ordinal).

Notes that match no hunk are surfaced under "Notes not matched to a hunk" —
never silently dropped. Artifact entries for files absent from the diff appear
under "Intent for files not in this diff". (Visibility over silent truncation,
by design.)

## Claude Code integration: authoring the artifact

Nothing *generates* `intent.json` — that's the change-making agent's job, and
whether the intent is genuine reasoning or post-hoc rationalization is the whole
ballgame. `review-intent` ships a Claude Code skill that teaches the agent to
author the artifact **honestly** (real rejected alternatives, stated
assumptions, incidental changes marked as incidental) when it finishes a change
set, then offer to render it.

```sh
review-intent skill install            # ~/.claude/skills/review-intent-authoring (all repos)
review-intent skill install --local    # ./.claude/skills/review-intent-authoring (this repo only)
review-intent skill uninstall          # remove user-scoped skill
review-intent skill uninstall --local  # remove repo-scoped skill
```

The skill never auto-launches anything — it teaches the agent to write the
artifact and then *ask* before opening the review. Add `--force` to overwrite or
remove a hand-edited skill file. User and `--local` scopes are independent.

The honesty contract is the point: a fluent rationalization is worse than
nothing because it lowers the reviewer's guard while adding no signal. The skill
pushes for "why I chose this over X" and "what this rests on" — and explicitly
tells the agent to admit gaps rather than invent thoroughness.

## Development

```sh
npm test          # vitest, pure-module unit tests
npm run test:watch
```

Modules are deliberately small and single-purpose: `git.ts` (diff), `artifact.ts`
(load + validate), `diff-parser.ts` (parse), `match.ts` (pure join), `render.ts`
(pure HTML), `cli.ts` (thin orchestrator).
