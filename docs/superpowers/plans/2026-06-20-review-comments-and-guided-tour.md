# Review Comments + Guided Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reviewer comments (hunk/file/page) that assemble into a copyable agent prompt, plus a guided tour that walks changed files in review-order — both as pure client-side additions to the rendered `review.html`.

**Architecture:** All work is in `src/render.ts`, which stays a pure `ReviewModel -> string` function. New markup carries stable comment ids and location refs; three concerns (comment persistence + prompt assembly + copy, and tour navigation) live in new inline `<script>` blocks that mirror the existing `viewedScript`/`pinScript` pattern. Comment text persists in `localStorage` keyed `review-intent:comments:${title}@${base}`; tour position is in-memory. Tests assert on the emitted markup string, as the codebase already does for its other client-side enhancements.

**Tech Stack:** ESM TypeScript (NodeNext, `.js` import extensions), vitest. No new dependencies.

See the design: `docs/superpowers/specs/2026-06-20-review-comments-and-guided-tour-design.md`.

---

## File Structure

- `src/render.ts` — all production changes (markup helpers, two inline scripts, CSS).
- `src/review-order.ts` — reused unchanged (`reviewOrder` provides the tour order; `RankedFile.slug`/`.path` are the per-file identity).
- `test/render.test.ts` — new assertions against the existing single `model` fixture (1 file `src/a.ts` at index 0, 1 hunk at index 0, `newStart:1`/`newEnd:3`).

---

### Task 1: Hunk-level comment boxes

**Files:**
- Modify: `src/render.ts` (`renderHunk`, its call site in `renderFile`; add `commentBox` helper)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing tests**

Add inside the `describe("renderHtml", ...)` block in `test/render.test.ts`:

```ts
it("emits a hunk comment box with a stable id and precise line ref", () => {
  expect(html).toContain('data-ckind="hunk"');
  expect(html).toContain('data-cid="file-0-hunk-0"');
  expect(html).toContain('data-ref="src/a.ts:1-3"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -t "hunk comment box"`
Expected: FAIL (markup absent).

- [ ] **Step 3: Add the `commentBox` helper**

Add near `whatWhy` in `src/render.ts`:

```ts
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

- [ ] **Step 4: Thread identity into `renderHunk` and emit the box**

Replace `renderHunk` in `src/render.ts` with:

```ts
function renderHunk(hunk: AnnotatedHunk, fileIndex: number, hunkIndex: number, path: string): string {
  const cid = `file-${fileIndex}-hunk-${hunkIndex}`;
  const ref = `${path}:${hunk.newStart}${hunk.newEnd !== hunk.newStart ? `-${hunk.newEnd}` : ""}`;
  return `<div class="hunk-row">
  <div class="hunk-diff">
    <div class="hunk-header">${esc(hunk.header)}</div>
    <table class="diff">${hunk.lines.map(renderLine).join("")}</table>
  </div>
  <aside class="hunk-notes">
    ${
      hunk.intents.length
        ? hunk.intents.map((i) => `<div class="note">${whatWhy(i.what, i.why)}</div>`).join("")
        : `<div class="note missing">⚠ No intent for this hunk.</div>`
    }
    ${commentBox(cid, ref, "hunk", hunk.header)}
  </aside>
</div>`;
}
```

Update the call site inside `renderFile` — replace `${file.hunks.map(renderHunk).join("\n")}` with:

```ts
  ${file.hunks.map((h, j) => renderHunk(h, r.index, j, file.path)).join("\n")}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run -t "hunk comment box"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: per-hunk reviewer comment boxes"
```

---

### Task 2: File-level comment box

**Files:**
- Modify: `src/render.ts` (`renderFile`)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("emits a file-level comment box keyed on the file slug", () => {
  expect(html).toContain('data-ckind="file"');
  // the file-level box uses the slug as its id and the path as its ref
  expect(html).toContain('<textarea class="cinput" data-cid="file-0" data-ref="src/a.ts"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -t "file-level comment box"`
Expected: FAIL.

- [ ] **Step 3: Emit the file-level box in `renderFile`**

In `renderFile`, immediately after the `file.why ? ... : ...` file-intent block and before the hunks line, insert:

```ts
  ${commentBox(r.slug, file.path, "file")}
```

So that region reads:

```ts
  ${
    file.why
      ? `<div class="file-intent">${whatWhy(file.what, file.why)}</div>`
      : `<div class="file-intent missing">⚠ No rationale (what/why) written for this changed file.</div>`
  }
  ${commentBox(r.slug, file.path, "file")}
  ${file.hunks.map((h, j) => renderHunk(h, r.index, j, file.path)).join("\n")}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -t "file-level comment box"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: per-file reviewer comment box"
```

---

### Task 3: Feedback panel (page comment + assembled prompt + copy)

**Files:**
- Modify: `src/render.ts` (add `renderFeedbackPanel`, wire into `renderHtml`)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("renders the feedback panel with page comment, output, and copy button", () => {
  expect(html).toContain('class="review-feedback"');
  expect(html).toContain('data-cid="__page__"');
  expect(html).toContain('class="fb-output"');
  expect(html).toContain('class="fb-copy"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -t "feedback panel"`
Expected: FAIL.

- [ ] **Step 3: Add `renderFeedbackPanel` and wire it in**

Add to `src/render.ts`:

```ts
/** Gathered review feedback: page-level comment + a live, readonly prompt the
 *  reviewer copies back to the agent. Assembly happens client-side in
 *  commentScript; this is the pure markup shell. */
function renderFeedbackPanel(model: ReviewModel): string {
  if (model.files.length === 0) return "";
  return `<section class="review-feedback" id="feedback">
  <h2>Review feedback</h2>
  <p class="rf-hint">Comment on any hunk or file with the 💬 buttons, add overall notes here, then copy the assembled prompt back to the agent.</p>
  <label class="fb-general">
    <span class="fb-general-lbl">Overall comment</span>
    <textarea class="cinput fb-general-input" data-cid="__page__" data-ref="__general__" placeholder="Overall feedback on the change set…"></textarea>
  </label>
  <div class="fb-summary"></div>
  <h3 class="fb-out-head">Prompt for the agent</h3>
  <textarea class="fb-output" readonly placeholder="Comments you add are gathered here as a prompt for the agent."></textarea>
  <div class="fb-actions">
    <button class="fb-copy" type="button">Copy as prompt</button>
    <span class="fb-copied" hidden>Copied ✓</span>
  </div>
</section>`;
}
```

In `renderHtml`, after `${renderFilesWithoutChanges(model)}` and before the closing `</div>` of `.content`, add:

```ts
${renderFeedbackPanel(model)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -t "feedback panel"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: review feedback panel shell"
```

---

### Task 4: Comment script (persist, assemble, copy)

**Files:**
- Modify: `src/render.ts` (add `commentScript`, wire into `renderHtml`)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("embeds the comment script with the per-change storage key", () => {
  expect(html).toContain("review-intent:comments:My change@main");
  // the assembler addresses the agent and reports sign-off
  expect(html).toContain("Review feedback on");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -t "comment script"`
Expected: FAIL.

- [ ] **Step 3: Add `commentScript` and wire it in**

Add to `src/render.ts` (near `viewedScript`):

```ts
/** Static enhancement: persist reviewer comments (per-change, like viewed
 *  state), keep the gathered-prompt textarea + summary in sync, and copy. The
 *  prompt is assembled from the live textareas in DOM order (= review order). */
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
    function mark(t) { var b = t.closest(".cbox"); if (b) b.classList.toggle("has-comment", !!clean(t.value)); }
    function reveal(t) { var b = t.closest(".cbox"); if (b) b.classList.add("open"); }

    function assemble() {
      var lines = [], count = 0;
      var files = Array.prototype.slice.call(document.querySelectorAll("details.file"));
      var done = files.filter(function (f) { return f.classList.contains("viewed"); }).length;
      files.forEach(function (f) {
        var code = f.querySelector(".path");
        var path = code ? code.textContent : f.id;
        var section = [];
        var fc = f.querySelector('.cbox[data-ckind="file"] .cinput');
        if (fc && clean(fc.value)) { section.push("- " + clean(fc.value).replace(/\\n/g, "\\n  ")); count++; }
        f.querySelectorAll('.cbox[data-ckind="hunk"] .cinput').forEach(function (hc) {
          if (clean(hc.value)) {
            var ref = hc.getAttribute("data-ref"), hdr = hc.getAttribute("data-hdr");
            section.push("### " + ref + (hdr ? "  (" + hdr + ")" : ""));
            section.push("- " + clean(hc.value).replace(/\\n/g, "\\n  "));
            count++;
          }
        });
        if (section.length) { lines.push("## " + path); lines.push.apply(lines, section); lines.push(""); }
      });
      var pg = document.querySelector('.cinput[data-cid="__page__"]');
      if (pg && clean(pg.value)) { lines.push("## General"); lines.push("- " + clean(pg.value).replace(/\\n/g, "\\n  ")); lines.push(""); count++; }
      if (out) {
        if (count === 0) { out.value = ""; }
        else {
          var head = 'Review feedback on "' + META.title + '" (' + META.base + "...HEAD).\\n" +
            "Sign-off: " + done + " / " + files.length + " files reviewed. Address each item below.\\n";
          out.value = head + "\\n" + lines.join("\\n").replace(/\\n+$/, "") + "\\n";
        }
      }
      if (summary) {
        summary.textContent = done + " / " + files.length + " files reviewed · " + count + " comment" + (count === 1 ? "" : "s");
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

In `renderHtml`, after `${pinScript(model)}` add:

```ts
${commentScript(model)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -t "comment script"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: comment persistence + agent-prompt assembly + copy"
```

---

### Task 5: Guided tour (control, topbar button, navigation script)

**Files:**
- Modify: `src/render.ts` (`renderTopbar`, add `TOUR` constant + `tourScript`, wire into `renderHtml`)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("renders the guided-tour control and start button", () => {
  expect(html).toContain('id="tour"');
  expect(html).toContain('class="tb-tour"');
});

it("injects the tour order from the review ranking", () => {
  // single-file model → one ranked entry
  expect(html).toContain('[{"slug":"file-0","path":"src/a.ts"}]');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -t "guided-tour"`
Expected: FAIL.

- [ ] **Step 3: Add the start button to the topbar**

Replace `renderTopbar` in `src/render.ts` with:

```ts
function renderTopbar(model: ReviewModel): string {
  const n = model.files.length;
  return `<div class="topbar">
  <span class="tb-title">${esc(model.title)}</span>
  <span class="tb-progress" data-total="${n}">0 / ${n} reviewed</span>
  ${n > 0 ? `<button class="tb-tour" type="button">▶ Guided review</button>` : ""}
  <a class="tb-top" href="#top">↑ Top</a>
</div>`;
}
```

- [ ] **Step 4: Add the tour control markup and script**

Add a `TOUR` constant near `LIGHTBOX` in `src/render.ts`:

```ts
/** Fixed guided-review control, hidden until the tour starts. */
const TOUR = `<div class="tour" id="tour" hidden role="region" aria-label="Guided review">
  <button class="tour-btn tour-prev" type="button">‹ Prev</button>
  <span class="tour-status">Reviewing <b class="tour-cur">1</b> of <b class="tour-total">0</b> — <code class="tour-path"></code></span>
  <button class="tour-btn tour-next" type="button">Next ›</button>
  <button class="tour-btn tour-exit" type="button" aria-label="Exit guided review">✕</button>
</div>`;
```

Add `tourScript` near `viewedScript`:

```ts
/** Static enhancement: a numbered prev/next walkthrough of the changed files in
 *  review-order. Order is injected from reviewOrder so it matches the page. Does
 *  not touch viewed state — navigation and sign-off stay separate. */
function tourScript(model: ReviewModel, ranked: RankedFile[]): string {
  const ORDER = JSON.stringify(ranked.map((r) => ({ slug: r.slug, path: r.path }))).replace(/<\//g, "<\\/");
  return `<script>
  (function () {
    var ORDER = ${ORDER};
    var tour = document.getElementById("tour");
    var startBtn = document.querySelector(".tb-tour");
    if (!tour || !startBtn || !ORDER.length) return;
    var cur = tour.querySelector(".tour-cur"), total = tour.querySelector(".tour-total");
    var pathEl = tour.querySelector(".tour-path");
    var prev = tour.querySelector(".tour-prev"), next = tour.querySelector(".tour-next"), exit = tour.querySelector(".tour-exit");
    var i = 0, flashTimer;
    if (total) total.textContent = ORDER.length;
    function go(n) {
      i = Math.max(0, Math.min(ORDER.length - 1, n));
      var item = ORDER[i], el = document.getElementById(item.slug);
      if (el) {
        if (el.tagName === "DETAILS") el.open = true;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("tour-flash");
        clearTimeout(flashTimer);
        flashTimer = setTimeout(function () { el.classList.remove("tour-flash"); }, 1200);
      }
      if (cur) cur.textContent = i + 1;
      if (pathEl) pathEl.textContent = item.path;
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === ORDER.length - 1;
    }
    function start() { tour.hidden = false; document.body.classList.add("touring"); go(0); }
    function close() { tour.hidden = true; document.body.classList.remove("touring"); }
    startBtn.addEventListener("click", start);
    if (prev) prev.addEventListener("click", function () { go(i - 1); });
    if (next) next.addEventListener("click", function () { go(i + 1); });
    if (exit) exit.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (tour.hidden) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
      else if (e.key === "Escape") { close(); }
    });
  })();
</script>`;
}
```

Wire into `renderHtml`: add `${TOUR}` next to `${LIGHTBOX}`, and add the script after `${commentScript(model)}`:

```ts
${LIGHTBOX}
${TOUR}

${MERMAID_SCRIPT}
${LIGHTBOX_SCRIPT}
${viewedScript(model)}
${pinScript(model)}
${commentScript(model)}
${tourScript(model, ranked)}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run -t "guided-tour"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: guided review tour over files in review-order"
```

---

### Task 6: Styling

**Files:**
- Modify: `src/render.ts` (append to the `CSS` template string, before its closing backtick)

- [ ] **Step 1: Append the CSS block**

Insert before the closing `` ` `` of the `CSS` constant in `src/render.ts`:

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

/* ── Review feedback panel ── */
.review-feedback { max-width: var(--maxw); margin: 0 auto; padding: 36px 40px; border-top: 1px solid var(--line); }
.review-feedback > h2 {
  margin: 0 0 8px; font-size: 12px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .14em;
}
.rf-hint { color: var(--muted); font-size: 13px; margin: 0 0 18px; max-width: 72ch; }
.fb-general { display: block; margin-bottom: 14px; }
.fb-general-lbl { display: block; font: 600 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 6px; }
.fb-general-input {
  display: block; width: 100%; resize: vertical; min-height: 60px;
  font: 13px/1.5 var(--sans); color: var(--ink);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 8px; padding: 8px 10px;
}
.fb-summary { font: 12px/1 var(--mono); color: var(--muted); margin-bottom: 14px; }
.fb-out-head { margin: 0 0 8px; font-size: 13px; font-weight: 680; color: var(--ink-soft); }
.fb-output {
  display: block; width: 100%; min-height: 160px; resize: vertical;
  font: 12.5px/1.55 var(--mono); color: var(--ink);
  background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 8px; padding: 12px 14px;
}
.fb-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.fb-copy {
  font: 600 12px/1 var(--mono); cursor: pointer; color: #fff;
  background: var(--accent); border: 1px solid var(--accent); border-radius: 8px; padding: 9px 16px;
}
.fb-copy:hover { filter: brightness(1.06); }
.fb-copied { color: var(--add); font: 600 12px/1 var(--mono); }

/* ── Guided tour ── */
.tb-tour {
  flex: none; font: 600 11px/1 var(--mono); cursor: pointer; color: var(--accent);
  background: var(--accent-soft); border: 1px solid #cfdcef; border-radius: 6px; padding: 5px 9px;
}
.tb-tour:hover { border-color: var(--accent); }
.tour {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 80;
  display: flex; align-items: center; gap: 12px;
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 12px;
  padding: 10px 14px; box-shadow: 0 10px 30px rgba(33,31,27,.18);
  font: 12px/1.2 var(--mono); max-width: calc(100vw - 32px);
}
.tour[hidden] { display: none; }
.tour-status { color: var(--ink-soft); }
.tour-status b { color: var(--ink); }
.tour-path { font-size: 11.5px; background: none; padding: 0; color: var(--accent); overflow-wrap: anywhere; }
.tour-btn {
  flex: none; font: 600 12px/1 var(--mono); cursor: pointer; color: var(--ink-soft);
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 7px; padding: 6px 10px;
}
.tour-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.tour-btn:disabled { opacity: .4; cursor: default; }
.tour-flash { animation: tour-flash 1.2s ease-out; }
@keyframes tour-flash {
  0% { box-shadow: 0 0 0 3px var(--accent); }
  100% { box-shadow: 0 0 0 3px transparent; }
}
@media (max-width: 560px) {
  .tour { flex-wrap: wrap; justify-content: center; bottom: 10px; }
}
```

- [ ] **Step 2: Type-check and run the full suite**

Run: `npm run build && npm test`
Expected: build succeeds (no tsc errors), all tests pass.

- [ ] **Step 3: Regenerate the sample for eyeballing**

Run: `npm run sample`
Expected: `sample-output.html` rewritten with comment boxes, feedback panel, and tour control.

- [ ] **Step 4: Commit**

```bash
git add src/render.ts sample-output.html
git commit -m "style: comment boxes, feedback panel, and tour control"
```

---

## Self-Review

**Spec coverage:**
- A. Comments (hunk/file/page anchoring + persistence) → Tasks 1, 2, 3, 4.
- B. Feedback panel (page comment, live readonly output, summary, copy w/ fallback) → Tasks 3, 4.
- C. Guided tour (injected order, pill control, prev/next/exit, keyboard, no viewed coupling) → Task 5.
- D. Code changes (renderHunk threading, renderFile, panel, scripts, topbar, CSS) → Tasks 1–6.
- E. Testing (hunk/file boxes, panel, tour order, storage key) → Tasks 1–5.
- Invariants: purity (render stays string-only; state in browser), never-drop (all comments assembled), no untrusted HTML (text only into `.value`) — preserved by construction.

**Placeholder scan:** none — every step carries full code and exact commands.

**Type consistency:** `commentBox(cid, ref, kind, hdr?)`, `renderHunk(hunk, fileIndex, hunkIndex, path)`, `renderFeedbackPanel(model)`, `commentScript(model)`, `tourScript(model, ranked)` are used consistently across tasks. `RankedFile.slug`/`.path` exist (`src/review-order.ts`). `DiffHunk.newStart`/`newEnd` exist (`src/types.ts`). Storage key matches the existing `review-intent:<kind>:${title}@${base}` convention.
