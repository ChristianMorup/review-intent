/**
 * terminal.mjs — headless Playwright recorder for terminal.html
 *
 * Records the animated terminal page to a .webm in demo/out/raw-term/.
 * Used as a pty-free fallback when VHS cannot run (no real TTY available).
 *
 * Usage (from demo/capture/):
 *   node terminal.mjs
 *
 * Output: demo/out/raw-term/<hash>.webm
 */

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, readdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(resolve(here, "terminal.html")).href;
const outDir = resolve(here, "../out/raw-term");
mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

// Animation runs ~14-16s; we wait up to 20s for the done flag, then
// add a 1-second tail so the final frame stays visible before cut.
const POLL_INTERVAL = 200;
const MAX_WAIT_MS   = 20_000;
const TAIL_MS       = 1_000;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: outDir, size: VIEWPORT },
});
const page = await context.newPage();

await page.goto(pageUrl, { waitUntil: "load" });

// Poll for the done flag set by terminal.html when animation completes.
let waited = 0;
while (waited < MAX_WAIT_MS) {
  const done = await page.evaluate(
    () => document.body.getAttribute("data-done") === "1"
  );
  if (done) break;
  await page.waitForTimeout(POLL_INTERVAL);
  waited += POLL_INTERVAL;
}

if (waited >= MAX_WAIT_MS) {
  console.warn("WARNING: timed out waiting for data-done=1; recording anyway.");
}

// Tail pause — keeps final frame visible before the cut.
await page.waitForTimeout(TAIL_MS);

await context.close(); // finalizes and writes the .webm
await browser.close();

// Report the output file
const files = readdirSync(outDir);
const webm = files.find((f) => f.endsWith(".webm"));
const outPath = webm ? resolve(outDir, webm) : outDir;
console.log("wrote terminal segment to", outPath);
