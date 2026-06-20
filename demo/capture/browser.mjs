import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(resolve(here, "../widget-api/review.html")).href;
const outDir = resolve(here, "../out/raw");
mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: outDir, size: VIEWPORT },
});
const page = await context.newPage();

const beat = (ms = 1200) => page.waitForTimeout(ms);
// Smooth-scroll a selector into view (CSS smooth scroll reads well on camera).
// Non-critical: if the selector is absent, log a warning and continue instead of crashing.
async function reveal(selector, pause = 1400) {
  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, selector);
  } catch (err) {
    console.warn(`reveal(${selector}) skipped:`, err.message);
  }
  await beat(pause);
}

await page.goto(pageUrl, { waitUntil: "load" });
await beat(1800); // title + tl;dr + vitals

// 1. Blast-radius scorecard (sensitive-path + complexity signals)
// The scorecard element has class="card scorecard" so .scorecard matches.
await reveal(".scorecard", 2200);

// 2. Visual summary charts
await reveal("svg", 2000);

// 3. Diagrams (class + sequence mermaid)
// Actual classes in review.html: .diagram (per diagram) and .mermaid (mermaid source blocks).
await reveal(".diagram", 2200);

// 4. Guided tour — step through a few files
await page.click(".tb-tour");
await beat(1200);
for (let i = 0; i < 4; i++) {
  await page.click(".tour-next");
  await beat(1300); // each step flashes the target file
}
await page.click(".tour-exit");
await beat(900);

// 5. Add a review comment and show it assemble into the agent prompt
const firstComment = page.locator(".cbtn").first();
await firstComment.scrollIntoViewIfNeeded();
await firstComment.click();
await beat(500);
const input = page.locator(".cinput").first();
await input.fill("Confirm the NUL separator can't appear in a user id from the IdP.");
await beat(900);
await reveal(".fb-output", 2200); // assembled prompt textarea

// 6. Theme switcher — flip through a few palettes
for (const theme of ["github", "dark", "synthwave", "paper"]) {
  await page.click(".tb-gear");
  await beat(500);
  await page.click(`.theme-opt[data-theme-id="${theme}"]`);
  await beat(1500);
}

// Back to the top to close on the title
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await beat(1800);

await context.close(); // finalizes and writes the .webm
await browser.close();
console.log("wrote browser segment to", outDir);
