import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(resolve(here, "../widget-api/review.html")).href;
const outDir = resolve(here, "../../docs/media");
mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

const results = [];

function log(shot, status, note = "") {
  const entry = { shot, status, note };
  results.push(entry);
  const prefix = status === "ok" ? "✓" : "✗";
  console.log(`${prefix} ${shot}${note ? " — " + note : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto(pageUrl, { waitUntil: "load" });
// Wait for mermaid to render
await page.waitForTimeout(2500);

// Helper: scroll to top
async function scrollTop() {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(300);
}

// Helper: set theme
async function setTheme(themeId) {
  await page.click(".tb-gear");
  await page.waitForTimeout(400);
  await page.click(`.theme-opt[data-theme-id="${themeId}"]`);
  await page.waitForTimeout(600);
}

// ── Shot 1: hero.png ──────────────────────────────────────────────────────────
try {
  await scrollTop();
  await page.screenshot({ path: resolve(outDir, "hero.png"), fullPage: false });
  log("hero.png", "ok");
} catch (err) {
  log("hero.png", "fail", err.message);
}

// ── Shot 2: scorecard.png ─────────────────────────────────────────────────────
try {
  const el = page.locator(".card.scorecard");
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await el.screenshot({ path: resolve(outDir, "scorecard.png") });
  log("scorecard.png", "ok");
} catch (err) {
  log("scorecard.png", "fail", err.message);
}

// ── Shot 3: risk-ledger.png ───────────────────────────────────────────────────
try {
  const el = page.locator(".card.risks");
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await el.screenshot({ path: resolve(outDir, "risk-ledger.png") });
  log("risk-ledger.png", "ok");
} catch (err) {
  log("risk-ledger.png", "fail", err.message);
}

// ── Shot 4: visual-summary.png ────────────────────────────────────────────────
// Two-pane rework: charts now live in the "Deeper analysis" <details class="deeper">
// (ships open). The container is .deeper-grid; the old section.visuals / details.band
// / summary.band-head are gone.
try {
  // Make sure the details is open (it ships open, but be defensive).
  await page.evaluate(() => {
    const d = document.querySelector("details.deeper");
    if (d) d.open = true;
  });
  await page.waitForTimeout(300);
  const el = page.locator(".deeper-grid");
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await el.screenshot({ path: resolve(outDir, "visual-summary.png") });
  log("visual-summary.png", "ok");
} catch (err) {
  log("visual-summary.png", "fail", err.message);
}

// ── Shot 5: diagrams.png ──────────────────────────────────────────────────────
// Two-pane rework: diagrams render as inline mermaid SVG inside .diagram-grid;
// the old section.diagrams wrapper is gone.
try {
  // Wait for mermaid to have rendered the diagram SVGs.
  await page.waitForSelector("section.diagram.zoomable svg", { timeout: 6000 }).catch(() => {});
  const el = page.locator(".diagram-grid");
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await el.screenshot({ path: resolve(outDir, "diagrams.png") });
  log("diagrams.png", "ok");
} catch (err) {
  log("diagrams.png", "fail", err.message);
}

// ── Shot 6: guided-tour.png ───────────────────────────────────────────────────
try {
  await scrollTop();
  await page.click(".tb-tour");
  await page.waitForTimeout(800);
  // Step through twice
  await page.click(".tour-next");
  await page.waitForTimeout(700);
  await page.click(".tour-next");
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(outDir, "guided-tour.png"), fullPage: false });
  log("guided-tour.png", "ok");
  // Exit tour
  await page.click(".tour-exit");
  await page.waitForTimeout(400);
} catch (err) {
  log("guided-tour.png", "fail", err.message);
  // Try to exit tour if it started
  await page.click(".tour-exit").catch(() => {});
}

// ── Shot 7: theme-synthwave.png ───────────────────────────────────────────────
try {
  await scrollTop();
  await setTheme("synthwave");
  await scrollTop();
  await page.screenshot({ path: resolve(outDir, "theme-synthwave.png"), fullPage: false });
  log("theme-synthwave.png", "ok");
} catch (err) {
  log("theme-synthwave.png", "fail", err.message);
}

// ── Shot 8: theme-dark.png ────────────────────────────────────────────────────
try {
  await scrollTop();
  await setTheme("dark");
  await scrollTop();
  await page.screenshot({ path: resolve(outDir, "theme-dark.png"), fullPage: false });
  log("theme-dark.png", "ok");
} catch (err) {
  log("theme-dark.png", "fail", err.message);
}

// ── Shot 9: review-comment.png ────────────────────────────────────────────────
try {
  // Reset to paper theme
  await setTheme("paper");
  await page.waitForTimeout(300);

  // Scroll to first .cbtn and click it
  const cbtn = page.locator(".cbtn").first();
  await cbtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await cbtn.click();
  await page.waitForTimeout(500);

  // Fill the cinput
  const cinput = page.locator(".cinput").first();
  await cinput.fill("Confirm the namespace separator can't appear in a user id from the IdP.");
  await page.waitForTimeout(600);

  // Scroll the review-feedback panel into view and screenshot it
  const feedbackEl = page.locator("section.review-feedback");
  await feedbackEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await feedbackEl.screenshot({ path: resolve(outDir, "review-comment.png") });
  log("review-comment.png", "ok");
} catch (err) {
  log("review-comment.png", "fail", err.message);
}

// ── Shot 10: review-order.png ─────────────────────────────────────────────────
// The author-set review order override: the file list runs in the order the author
// chose ("in author-set order · measured ranks shown") while each file head still
// carries its measured rank ("measured #N") so the override stays auditable.
try {
  // Reset to paper theme for legibility.
  await setTheme("paper").catch(() => {});
  await page.waitForTimeout(200);

  // Collapse the file <details> and clear any leftover comment text so the heads
  // stack tightly — the author-set order across multiple rows (each with its
  // contradicting "measured #N" badge) is the whole point of this shot.
  await page.evaluate(() => {
    document.querySelectorAll("section.diffs details.file").forEach((d) => {
      d.open = false;
    });
    document.querySelectorAll("section.diffs .cinput").forEach((t) => {
      t.value = "";
    });
  });
  await page.waitForTimeout(300);

  // Frame the top of the diffs section: the override eyebrow + the first file heads
  // (each with its #N review rank and dashed "measured #N" badge).
  const eyebrow = page.locator("section.diffs .section-eyebrow").first();
  await eyebrow.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  // Nudge so the eyebrow isn't pinned under the sticky toolbar.
  await page.evaluate(() => window.scrollBy({ top: -90, behavior: "instant" }));
  await page.waitForTimeout(300);

  // Capture a region: the eyebrow line plus the first several file heads, clipped to
  // the main content column so the override + measured badges are legible.
  const box = await page.evaluate(() => {
    const eb = document.querySelector("section.diffs .section-eyebrow");
    const heads = document.querySelectorAll("section.diffs summary.file-head");
    if (!eb || heads.length < 5) return null;
    const top = eb.getBoundingClientRect();
    const last = heads[4].getBoundingClientRect();
    const left = Math.min(top.left, last.left) - 12;
    const right = Math.max(top.right, last.right) + 12;
    return {
      x: Math.max(0, left),
      y: Math.max(0, top.top - 10),
      width: right - left,
      height: last.bottom - top.top + 22,
    };
  });
  if (box && box.width > 0 && box.height > 0) {
    await page.screenshot({ path: resolve(outDir, "review-order.png"), clip: box });
  } else {
    // Fallback: screenshot the diffs section itself.
    await page.locator("section.diffs").screenshot({ path: resolve(outDir, "review-order.png") });
  }
  log("review-order.png", "ok");
} catch (err) {
  log("review-order.png", "fail", err.message);
}

// ── Shot 11: live-qa.png ──────────────────────────────────────────────────────
// The ask-the-agent / reviewer Q&A panel: type a representative overall question,
// which assembles into the copy-paste prompt for the agent.
try {
  const feedbackEl = page.locator("section.review-feedback");
  await feedbackEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  // The "Overall question" box is the second .fb-general-input (data-akind="question").
  const qInput = page.locator('.fb-general-input[data-akind="question"]').first();
  await qInput.scrollIntoViewIfNeeded();
  await qInput.click();
  await qInput.fill(
    "Why namespace cache keys by tenant id rather than scoping a separate store per tenant?"
  );
  await page.waitForTimeout(700);

  await feedbackEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await feedbackEl.screenshot({ path: resolve(outDir, "live-qa.png") });
  log("live-qa.png", "ok");
} catch (err) {
  log("live-qa.png", "fail", err.message);
}

// ── Shot 12: two-pane.png ─────────────────────────────────────────────────────
// Establishing shot of the new diff-centric two-pane shell (file rail + main column).
try {
  // Reset to paper theme and scroll to the very top.
  await setTheme("paper").catch(() => {});
  await page.waitForTimeout(200);
  await scrollTop();
  await page.waitForSelector(".shell", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, "two-pane.png"), fullPage: false });
  log("two-pane.png", "ok");
} catch (err) {
  log("two-pane.png", "fail", err.message);
}

await browser.close();

console.log("\n── Summary ──");
for (const r of results) {
  const sym = r.status === "ok" ? "✓" : "✗";
  console.log(`  ${sym} ${r.shot}${r.note ? " — " + r.note : ""}`);
}
const failed = results.filter((r) => r.status !== "ok");
console.log(`\n${results.length - failed.length}/${results.length} succeeded`);
if (failed.length > 0) process.exit(1);
