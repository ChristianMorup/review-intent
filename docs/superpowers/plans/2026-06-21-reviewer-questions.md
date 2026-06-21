# Reviewer Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewer-side **question** annotation kind alongside comments on the rendered `review.html`, with both kinds assembling into the copy-to-agent prompt (questions first), and make the comment affordance more visible.

**Architecture:** Generalize the existing single-kind comment system in `src/render.ts` into a two-kind "reviewer annotation" system. Each hunk/file/page exposes both a 💬 comment and a ❓ question control; they reuse the same `.cbox`/`.cbtn`/`.cinput` markup, localStorage store, and copy machinery, distinguished by a new `data-akind="comment|question"` attribute. The renderer stays pure and deterministic (markup + CSS + one script string), so the existing markup-assertion tests still apply.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest. All changes live in `src/render.ts`; tests in `test/render.test.ts`. No new dependencies. Build gate: `npm run build` (tsc strict). Test gate: `npx vitest run test/render.test.ts`.

**Design source:** `docs/superpowers/specs/2026-06-21-reviewer-questions-design.md`

**Key invariants (do not break):**
- `render.ts` is pure/deterministic — no `Date`, no random.
- Comment cids stay unchanged (`file-0`, `file-0-hunk-0`, `__page__`) so saved comments load; question cids carry a `q:` prefix.
- Nothing is silently dropped — every non-empty box appears in the assembled prompt.

---

### Task 1: Generalize the annotation box markup (comment + question)

Replace the single-kind `commentBox` with `annotateBox`, which emits a `.cbox-group` wrapping two independent `.cbox` units: a comment box (unchanged cid) and a question box (`q:`-prefixed cid). Each textarea carries `data-akind`. `data-ckind` moves from the box to the group wrapper.

**Files:**
- Modify: `src/render.ts` (the `commentBox` function at lines 1169-1178, and its two call sites at line 1151 and line 1202)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the main `describe("renderHtml", ...)` block in `test/render.test.ts`, right after the existing `"emits a file-level comment box keyed on the file slug"` test (currently ends at line 327):

```typescript
  it("emits a hunk question box with a q-prefixed id and precise line ref", () => {
    expect(html).toContain('data-akind="question"');
    expect(html).toContain('data-cid="q:file-0-hunk-0"');
    expect(html).toContain('<button class="cbtn cbtn-q"');
  });

  it("emits a file-level question box keyed on the q-prefixed file slug", () => {
    expect(html).toContain('<textarea class="cinput" data-cid="q:file-0" data-ref="src/a.ts"');
  });

  it("tags every comment textarea with data-akind=comment", () => {
    expect(html).toContain('data-cid="file-0-hunk-0" data-ref="src/a.ts:1-3"');
    // a comment textarea still carries the unprefixed cid plus the new akind
    expect(html).toMatch(/data-cid="file-0"[^>]*data-akind="comment"/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/render.test.ts -t "question box"`
Expected: FAIL — `data-cid="q:file-0-hunk-0"` and `cbtn-q` are not in the output yet.

- [ ] **Step 3: Replace `commentBox` with `annotateBox`**

In `src/render.ts`, replace the entire `commentBox` function (lines 1169-1178):

```typescript
/** A reviewer comment affordance: a 💬 toggle + a hidden textarea the comment
 *  script persists. Pure markup; the textarea carries the data the assembled
 *  prompt is built from. `cid` is the localStorage key, `ref` the human-readable
 *  location shown in the prompt. */
function commentBox(cid: string, ref: string, kind: "hunk" | "file", hdr?: string): string {
  const hdrAttr = hdr ? ` data-hdr="${esc(hdr)}"` : "";
  const ph = kind === "hunk"
    ? "Note to the agent about this hunk…"
    : "Note to the agent about this file…";
  return `<div class="cbox" data-ckind="${kind}">
    <button class="cbtn" type="button" aria-label="Add a comment" title="Add a comment">💬</button>
    <textarea class="cinput" data-cid="${esc(cid)}" data-ref="${esc(ref)}"${hdrAttr} placeholder="${ph}"></textarea>
  </div>`;
}
```

with:

```typescript
/** A reviewer annotation affordance: a 💬 Comment box and a ❓ Ask box, side by
 *  side, each a hidden textarea the script persists. Pure markup; the textareas
 *  carry the data the assembled prompt is built from. `cid` is the comment's
 *  localStorage key (the question reuses it with a `q:` prefix); `ref` is the
 *  human-readable location shown in the prompt. `data-akind` lets the script tell
 *  comments from questions; `data-ckind` (on the group) tells hunk from file. */
function annotateBox(cid: string, ref: string, kind: "hunk" | "file", hdr?: string): string {
  const hdrAttr = hdr ? ` data-hdr="${esc(hdr)}"` : "";
  const where = kind === "hunk" ? "this hunk" : "this file";
  return `<div class="cbox-group" data-ckind="${kind}">
    <div class="cbox" data-akind="comment">
      <button class="cbtn" type="button" aria-label="Add a comment" title="Add a comment">💬 Comment</button>
      <textarea class="cinput" data-cid="${esc(cid)}" data-ref="${esc(ref)}"${hdrAttr} data-akind="comment" placeholder="Note to the agent about ${where}…"></textarea>
    </div>
    <div class="cbox cbox-q" data-akind="question">
      <button class="cbtn cbtn-q" type="button" aria-label="Ask a question" title="Ask a question">❓ Ask</button>
      <textarea class="cinput" data-cid="q:${esc(cid)}" data-ref="${esc(ref)}"${hdrAttr} data-akind="question" placeholder="Question for the agent about ${where}…"></textarea>
    </div>
  </div>`;
}
```

- [ ] **Step 4: Update the two call sites**

In `src/render.ts` line 1151, change:

```typescript
  ${commentBox(r.slug, file.path, "file")}
```

to:

```typescript
  ${annotateBox(r.slug, file.path, "file")}
```

In `src/render.ts` line 1202, change:

```typescript
    ${commentBox(cid, ref, "hunk", hunk.header)}
```

to:

```typescript
    ${annotateBox(cid, ref, "hunk", hunk.header)}
```

- [ ] **Step 5: Run the build and the render tests**

Run: `npm run build && npx vitest run test/render.test.ts`
Expected: PASS — the new question-box tests pass AND the pre-existing comment tests (`data-ckind="hunk"`, `data-cid="file-0-hunk-0"`, `data-ref="src/a.ts:1-3"`, `data-ckind="file"`, `<textarea class="cinput" data-cid="file-0" data-ref="src/a.ts"`) still pass because comment cids and attribute order are preserved.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: emit a question annotation box beside every comment box

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add the page-level "Overall question" box

Give the feedback panel an "Overall question" textarea beside the existing "Overall comment", and update the hint text.

**Files:**
- Modify: `src/render.ts` (`renderFeedbackPanel`, lines 1233-1250)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the main `describe("renderHtml", ...)` block, after the existing `"renders the feedback panel with page comment, output, and copy button"` test:

```typescript
  it("renders a page-level overall question box", () => {
    expect(html).toContain('data-cid="q:__page__"');
    expect(html).toMatch(/data-cid="q:__page__"[^>]*data-akind="question"/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render.test.ts -t "overall question"`
Expected: FAIL — `q:__page__` not present.

- [ ] **Step 3: Update `renderFeedbackPanel`**

In `src/render.ts`, replace the hint + general-comment block (lines 1237-1241):

```typescript
  <p class="rf-hint">Comment on any hunk or file with the 💬 buttons, add overall notes here, then copy the assembled prompt back to the agent.</p>
  <label class="fb-general">
    <span class="fb-general-lbl">Overall comment</span>
    <textarea class="cinput fb-general-input" data-cid="__page__" data-ref="__general__" placeholder="Overall feedback on the change set…"></textarea>
  </label>
```

with:

```typescript
  <p class="rf-hint">Comment (💬) or ask a question (❓) on any hunk or file, add overall notes here, then copy the assembled prompt back to the agent. Questions are listed first — they're the decisions the agent must resolve.</p>
  <label class="fb-general">
    <span class="fb-general-lbl">Overall comment</span>
    <textarea class="cinput fb-general-input" data-cid="__page__" data-ref="__general__" data-akind="comment" placeholder="Overall feedback on the change set…"></textarea>
  </label>
  <label class="fb-general">
    <span class="fb-general-lbl">Overall question</span>
    <textarea class="cinput fb-general-input" data-cid="q:__page__" data-ref="__general__" data-akind="question" placeholder="An overall question for the agent…"></textarea>
  </label>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/render.test.ts -t "overall question"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: add an overall-question box to the feedback panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Assemble both kinds into the prompt — questions first

Rewrite the script's `assemble()` so it buckets every non-empty textarea by `data-akind` into two top-level sections (`# Questions (please answer)` then `# Comments`), updates the header count line and the summary line, and marks boxes with `has-comment` / `has-question` per kind. The `.cbtn` toggle handler is unchanged (each `.cbox` still has exactly one button + one textarea).

**Files:**
- Modify: `src/render.ts` (`commentScript`, lines 1984-2073)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing tests**

Add inside the main `describe("renderHtml", ...)` block, after the existing `"embeds the comment script with the per-change storage key"` test:

```typescript
  it("assembles questions and comments into two labelled sections", () => {
    expect(html).toContain("# Questions (please answer)");
    expect(html).toContain("# Comments");
    // buckets textareas by their annotation kind
    expect(html).toContain('data-akind="question"');
    // questions are emitted before comments in the assembled prompt
    const qi = html.indexOf("# Questions (please answer)");
    const ci = html.indexOf("# Comments");
    expect(qi).toBeGreaterThan(-1);
    expect(ci).toBeGreaterThan(qi);
  });

  it("reads back the q-prefixed page question key from the store", () => {
    expect(html).toContain('"q:__page__"');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/render.test.ts -t "two labelled sections"`
Expected: FAIL — the script still emits a single comment stream with no `# Questions` header.

- [ ] **Step 3: Rewrite `commentScript`**

In `src/render.ts`, replace the entire `commentScript` function (lines 1984-2073) with:

```typescript
/** Static enhancement: persist reviewer annotations (comments + questions,
 *  per-change like viewed state), keep the gathered-prompt textarea + summary in
 *  sync, and copy. Questions are emitted first — they're the blocking decisions.
 *  Each kind is bucketed by the textarea's data-akind; within a kind, items are
 *  grouped by file then hunk in DOM order (= review order). */
function commentScript(model: ReviewModel): string {
  const KEY = `review-intent:comments:${model.title}@${model.base}`;
  const META = JSON.stringify({ title: model.title, base: model.base }).replace(/<\//g, "<\\/");
  return `<script>
  (function () {
    var KEY = ${JSON.stringify(KEY).replace(/<\//g, "<\\/")};
    var META = ${META};
    var store;
    try { store = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { store = {}; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

    var inputs = Array.prototype.slice.call(document.querySelectorAll(".cinput"));
    var out = document.querySelector(".fb-output");
    var summary = document.querySelector(".fb-summary");
    function clean(s) { return s.replace(/\\r/g, "").trim(); }
    function indent(s) { return clean(s).replace(/\\n/g, "\\n  "); }
    function mark(t) {
      var b = t.closest(".cbox"); if (!b) return;
      var cls = t.getAttribute("data-akind") === "question" ? "has-question" : "has-comment";
      b.classList.toggle(cls, !!clean(t.value));
    }
    function reveal(t) { var b = t.closest(".cbox"); if (b) b.classList.add("open"); }

    // Gather one kind ("comment" | "question") grouped by file -> hunk, plus its
    // page-level box. Returns { lines: [...], count: n }.
    function collect(akind, files) {
      var lines = [], count = 0;
      files.forEach(function (f) {
        var code = f.querySelector(".path");
        var path = code ? code.textContent : f.id;
        var section = [];
        var fc = f.querySelector('.cbox-group[data-ckind="file"] .cinput[data-akind="' + akind + '"]');
        if (fc && clean(fc.value)) { section.push("- " + indent(fc.value)); count++; }
        f.querySelectorAll('.cbox-group[data-ckind="hunk"] .cinput[data-akind="' + akind + '"]').forEach(function (hc) {
          if (clean(hc.value)) {
            var ref = hc.getAttribute("data-ref"), hdr = hc.getAttribute("data-hdr");
            section.push("### " + ref + (hdr ? "  (" + hdr + ")" : ""));
            section.push("- " + indent(hc.value));
            count++;
          }
        });
        if (section.length) { lines.push("## " + path); lines.push.apply(lines, section); lines.push(""); }
      });
      var pgCid = akind === "question" ? "q:__page__" : "__page__";
      var pg = document.querySelector('.cinput[data-cid="' + pgCid + '"]');
      if (pg && clean(pg.value)) { lines.push("## General"); lines.push("- " + indent(pg.value)); lines.push(""); count++; }
      return { lines: lines, count: count };
    }

    function assemble() {
      var files = Array.prototype.slice.call(document.querySelectorAll("details.file"));
      var done = files.filter(function (f) { return f.classList.contains("viewed"); }).length;
      var q = collect("question", files);
      var c = collect("comment", files);
      if (out) {
        if (q.count === 0 && c.count === 0) { out.value = ""; }
        else {
          var head = 'Review feedback on "' + META.title + '" (' + META.base + "...HEAD).\\n" +
            "Sign-off: " + done + " / " + files.length + " files reviewed. " +
            q.count + " question" + (q.count === 1 ? "" : "s") + ", " +
            c.count + " comment" + (c.count === 1 ? "" : "s") + " below.\\n";
          var blocks = [];
          if (q.count) { blocks.push("# Questions (please answer)"); blocks = blocks.concat(q.lines); }
          if (c.count) { blocks.push("# Comments"); blocks = blocks.concat(c.lines); }
          out.value = head + "\\n" + blocks.join("\\n").replace(/\\n+$/, "") + "\\n";
        }
      }
      if (summary) {
        summary.textContent = done + " / " + files.length + " files reviewed · " +
          q.count + " question" + (q.count === 1 ? "" : "s") + " · " +
          c.count + " comment" + (c.count === 1 ? "" : "s");
      }
    }

    inputs.forEach(function (t) {
      var cid = t.getAttribute("data-cid");
      if (store[cid]) { t.value = store[cid]; reveal(t); }
      mark(t);
      t.addEventListener("input", function () {
        if (clean(t.value)) store[cid] = t.value; else delete store[cid];
        save(); mark(t); assemble();
      });
    });

    document.querySelectorAll(".cbtn").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        var box = b.closest(".cbox"); if (!box) return;
        box.classList.toggle("open");
        if (box.classList.contains("open")) { var ta = box.querySelector(".cinput"); if (ta) ta.focus(); }
      });
    });

    var copyBtn = document.querySelector(".fb-copy"), copied = document.querySelector(".fb-copied");
    if (copyBtn && out) {
      copyBtn.addEventListener("click", function () {
        assemble();
        var text = out.value; if (!text) return;
        function flash() { if (copied) { copied.hidden = false; setTimeout(function () { copied.hidden = true; }, 1600); } }
        out.select();
        var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(flash, function () { if (ok) flash(); });
        } else if (ok) { flash(); }
      });
    }

    assemble();
  })();
</script>`;
}
```

- [ ] **Step 4: Run the build and the render tests**

Run: `npm run build && npx vitest run test/render.test.ts`
Expected: PASS — the new section tests pass and the existing `"embeds the comment script with the per-change storage key"` test still passes (the head still starts `Review feedback on` and the key is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: assemble questions and comments into the agent prompt, questions first

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Style — visible labelled pills + a distinct question control

Make the comment button a visible labelled pill, lay the two boxes out as a row that expands to full width when a textarea opens, give the question control a distinct accent, and add the `has-question` marker dot.

**Files:**
- Modify: `src/render.ts` (the `/* ── Review comments ── */` CSS block, lines 1832-1847)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the main `describe("renderHtml", ...)` block, after the theme-switcher test:

```typescript
  it("styles the question control distinctly and marks unsent questions", () => {
    expect(html).toContain(".cbtn-q");
    expect(html).toContain(".cbox.has-question");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render.test.ts -t "question control distinctly"`
Expected: FAIL — no `.cbtn-q` / `.has-question` rules in the stylesheet yet.

- [ ] **Step 3: Replace the comment CSS block**

In `src/render.ts`, replace the comment CSS block (lines 1832-1847):

```css
/* ── Review comments ── */
.cbox { margin-top: 10px; }
.hunk-notes .cbox { margin-top: 12px; border-top: 1px dashed var(--line-2); padding-top: 10px; }
.cbtn {
  font-size: 12px; line-height: 1; cursor: pointer; color: var(--ink-soft);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 6px; padding: 3px 7px;
}
.cbtn:hover { border-color: var(--accent); }
.cbox.has-comment .cbtn { border-color: var(--accent); background: var(--accent-soft); }
.cbox.has-comment .cbtn::after { content: " •"; color: var(--accent); }
.cinput {
  display: none; width: 100%; margin-top: 8px; resize: vertical; min-height: 54px;
  font: 13px/1.5 var(--sans); color: var(--ink);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 8px; padding: 8px 10px;
}
.cbox.open .cinput { display: block; }
```

with:

```css
/* ── Review annotations (comments + questions) ── */
.cbox-group { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.hunk-notes .cbox-group { margin-top: 12px; border-top: 1px dashed var(--line-2); padding-top: 10px; }
.cbox { display: inline-flex; }
.cbox.open { flex-basis: 100%; flex-direction: column; }
.cbtn {
  font: 600 12px/1 var(--mono); cursor: pointer; color: var(--ink-soft);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 7px; padding: 6px 11px;
}
.cbtn:hover { border-color: var(--accent); color: var(--accent); }
.cbox.has-comment .cbtn { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.cbox.has-comment .cbtn::after { content: " •"; }
.cbtn-q { color: var(--add); }
.cbtn-q:hover { border-color: var(--add); color: var(--add); }
.cbox.has-question .cbtn-q { border-color: var(--add); background: var(--add-soft, var(--accent-soft)); color: var(--add); }
.cbox.has-question .cbtn-q::after { content: " •"; }
.cinput {
  display: none; width: 100%; margin-top: 8px; resize: vertical; min-height: 54px;
  font: 13px/1.5 var(--sans); color: var(--ink);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 8px; padding: 8px 10px;
}
.cbox.open .cinput { display: block; }
```

Note: `var(--add)` is the existing green "addition" colour used elsewhere in the stylesheet; `--add-soft` falls back to `--accent-soft` if a theme has not defined it, so no theme needs editing.

- [ ] **Step 4: Run the test and a full check**

Run: `npx vitest run test/render.test.ts -t "question control distinctly"`
Expected: PASS.

Then run the full suite and build:

Run: `npm run build && npm test`
Expected: PASS — all tests across the suite.

- [ ] **Step 5: Eyeball the rendered sample**

Run: `npm run sample`
Then open `sample-output.html` in a browser. Confirm: each hunk/file shows a `💬 Comment` and `❓ Ask` pill side by side; clicking either opens its textarea full-width; typing a question then a comment and clicking "Copy as prompt" produces a prompt with a `# Questions (please answer)` section above a `# Comments` section. (Manual check; not automated.)

- [ ] **Step 6: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: visible comment/question pills with a distinct question accent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Update the README

Document the two annotation kinds. Note: the protocol-restructured README lives on the `docs/review-protocol` branch; on this feature branch the README is `main`'s version, whose relevant section is "Comment straight back to the agent".

**Files:**
- Modify: `README.md` (the "### Comment straight back to the agent" section)

- [ ] **Step 1: Update the section**

In `README.md`, replace:

```markdown
### Comment straight back to the agent

Leave notes on any hunk or file. They assemble into a single copy-paste prompt
addressed to the agent that made the change — close the review loop without ever
leaving the page.
```

with:

```markdown
### Comment and question, straight back to the agent

Leave a **comment** (💬) or raise a **question** (❓) on any hunk or file. Both
assemble into a single copy-paste prompt addressed to the agent that made the
change — questions listed first, since they're the decisions the agent must
resolve — so you close the review loop without ever leaving the page.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document reviewer questions alongside comments

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run `npm run build && npm test` — full suite green, no type errors.
- [ ] Run `npm run sample` and confirm the manual checks in Task 4 Step 5.
- [ ] `git log --oneline` shows five focused commits on `feat/reviewer-questions`.
