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
try {
  const el = page.locator("section.visuals");
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  // Ensure the details is open
  const isOpen = await el.locator("details.band").getAttribute("open");
  if (isOpen === null) {
    await el.locator("summary.band-head").click();
    await page.waitForTimeout(400);
  }
  await el.screenshot({ path: resolve(outDir, "visual-summary.png") });
  log("visual-summary.png", "ok");
} catch (err) {
  log("visual-summary.png", "fail", err.message);
}

// ── Shot 5: diagrams.png ──────────────────────────────────────────────────────
try {
  const el = page.locator("section.diagrams");
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  // Ensure the details is open
  const isOpen = await el.locator("details.band").getAttribute("open");
  if (isOpen === null) {
    await el.locator("summary.band-head").click();
    await page.waitForTimeout(400);
  }
  // Wait for mermaid SVG
  await page.waitForSelector("section.diagram svg", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
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

await browser.close();

console.log("\n── Summary ──");
for (const r of results) {
  const sym = r.status === "ok" ? "✓" : "✗";
  console.log(`  ${sym} ${r.shot}${r.note ? " — " + r.note : ""}`);
}
const failed = results.filter((r) => r.status !== "ok");
console.log(`\n${results.length - failed.length}/${results.length} succeeded`);
if (failed.length > 0) process.exit(1);
