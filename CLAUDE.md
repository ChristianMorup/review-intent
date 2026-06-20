# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`review-intent` is a CLI that renders the PR-style diff (`git diff <base>...HEAD`)
as an **intent-annotated** HTML review page and opens it in the browser. It is a
**pure renderer**: it makes no LLM/API call. It joins two inputs — the git diff
it runs itself, and an **agent-authored artifact** (`./.review/intent.json`) that
supplies the *why* prose and mermaid diagram sources — and emits one
self-contained `review.html`. The agent that made the code changes is
responsible for writing the artifact; this tool never generates it.

Read `README.md` for the product rationale and the full artifact contract.

## Commands

```sh
npm run build        # tsc -> dist/ (bin is dist/cli.js)
npm run dev          # run the CLI from src without building (node --experimental-strip-types src/cli.ts)
npm test             # vitest run (all unit tests)
npm run test:watch   # vitest watch
```

Run a single test file or pattern:

```sh
npx vitest run test/match.test.ts
npx vitest run -t "matches hunk by anchor"
```

There is no lint step configured. `npm run build` (tsc with `strict`) is the
type-check gate.

## Architecture

ESM TypeScript (`"type": "module"`, `NodeNext` resolution). Imports use `.js`
extensions even though sources are `.ts` — required by NodeNext; keep this when
adding imports.

`cli.ts` is a thin orchestrator that runs the whole pipeline in order:

1. `git.ts` — `resolveBase` (explicit `--base`, else `main`, else `master`) and
   `getDiff` (runs `git diff base...HEAD`). The **only** module that shells out.
2. `artifact.ts` — load + Zod-validate `./.review/intent.json`.
3. `config.ts` — load optional `./.review/config.json` repo policy (sensitive
   paths, churn thresholds); falls back to built-in defaults tuned to the Immeo stack.
4. `diff-parser.ts` — parse raw unified diff (via `parse-diff`) into `DiffFile[]`.
5. `scorecard.ts` — Part 1 of the blast-radius block: objective surface-area
   metrics computed *from the diff* (files/hunks/±lines, test-vs-code file and
   line counts, debt/debug-marker count, noise-file count, largest-file churn,
   sensitive-path + churn badges). Intent-coverage (files/hunks annotated) is the
   one scorecard metric *not* here — it needs the artifact join, so it's computed
   in `match.ts` (`ReviewModel.intentCoverage`). Net delta, hunks-per-file
   concentration, reach fan-in, and diagram coverage are derived in `render.ts`
   from data already on the model.
6. `reach.ts` — Part 3: scan the repo for files that import the changed code
   files and build a mermaid reach graph. Heuristic and bounded.
6b. `complexity.ts` — measured cyclomatic complexity of the changed functions by
   shelling out to the external **lizard** analyzer (`pip install lizard`; covers
   C#/TS/JS/Python). Pure parts (`parseLizardCsv`, `buildComplexityModel`,
   `isAnalyzablePath`) are tested; `analyzeComplexity` is the side-effecting
   runner. Degrades gracefully — a missing lizard yields an `available: false`
   model with a visible note, never an error or a silent gap.
7. `match.ts` — **pure join**. Overlays artifact intent onto the parsed diff,
   producing the `ReviewModel`. Per-hunk notes match by **anchor** (a line number
   in the *new* file) landing within a hunk's `[newStart, newEnd]` range.
8. `completeness.ts` — the **completeness gate**: `findGaps` flags any changed
   file or hunk lacking `what`/`why`. `cli.ts` refuses to render (exit 1) unless
   `--allow-gaps` is set.
9. `render.ts` — **pure** `ReviewModel -> HTML` string. Self-contained page.
   Includes the "visual summary": five charts (diff-mass bars, squarified
   treemap, coverage rings, reach ripple, per-file change map) hand-rolled as inline
   SVG strings — no charting dependency, kept deterministic (no `Date`/random) so
   they stay unit-testable by asserting on the emitted markup. `npm run sample`
   regenerates `sample-output.html` via `scripts/gen-sample.mjs` for eyeballing.

`types.ts` is the central contract for everything: Zod schemas for the artifact
(`ArtifactSchema`, `FileIntentSchema`, `HunkIntentSchema`, `RiskSchema`) and the
plain interfaces for the parsed diff and the `ReviewModel` handed to the renderer.
Change a schema or model shape here and the dependent modules + their tests follow.

### Design invariants to preserve

- **Purity boundary.** `match.ts` and `render.ts` are pure (no I/O, no `Date`,
  deterministic) — that is what makes them unit-testable. Side effects live only
  in `cli.ts`, `git.ts`, `artifact.ts`, `config.ts`, `reach.ts`, `skill.ts`, and
  `analyzeComplexity` in `complexity.ts` (whose parse/aggregate helpers stay pure).
- **Never silently drop or truncate.** Hunk notes that match no hunk, intent for
  files absent from the diff, and any capped repo/reach scan are all surfaced in
  the output (`unmatchedIntents`, `filesWithoutChanges`, `truncatedNote`). Keep
  new features visible rather than silent.
- **Claimed vs. measured.** The scorecard/reach (measured, CLI-computed) sit next
  to the risk ledger/intent (claimed, agent-authored) deliberately so
  contradictions show. Don't let agent-supplied data override measured data.

### Skill subcommand

`skill.ts` implements `review-intent skill install|uninstall [--local] [--force]`,
which writes/removes the `review-intent-authoring` Claude Code skill (user scope
`~/.claude/skills`, or `--local` repo scope `./.claude/skills`). The two scopes
are independent; `--force` overwrites/removes a hand-edited skill file. This skill
is what teaches a change-making agent to author `intent.json` honestly.

## Testing conventions

Tests live in `test/` (excluded from the tsconfig build) and are vitest
pure-module unit tests, one file per source module. The pure modules
(`match`, `render`, `completeness`, `scorecard`, `reach`, `diff-parser`) are
tested by constructing inputs directly — no git or filesystem fixtures beyond
`test/fixtures/`. When adding a module, add a matching `test/<module>.test.ts`.
