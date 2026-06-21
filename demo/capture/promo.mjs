import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const stageUrl = pathToFileURL(resolve(here, "promo.html")).href;
const outDir = resolve(here, "../out/promo-raw");
mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 1920, height: 1080 };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  recordVideo: { dir: outDir, size: VIEWPORT },
});
const page = await context.newPage();

const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const tool = () => page.frameLocator("#tool");
const frame = () => page.frame({ url: /review\.html/ });

// run an optional step; never let one missing selector abort the take
async function step(label, fn) {
  try { await fn(); }
  catch (e) { console.warn("[step:" + label + "] skipped:", e.message); }
}

// Click an element INSIDE the live iframe by dispatching a real DOM click.
// Coordinate-based Playwright clicks miss because the parent #device is
// CSS-transformed; a direct .click() on the resolved node is reliable and the
// camera still sees the resulting UI change. We add a brief CSS press highlight.
async function clickInTool(label, selector) {
  await step(label, async () => {
    const ok = await frame().evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.classList.add("__promo-press");
      el.click();
      setTimeout(() => el.classList && el.classList.remove("__promo-press"), 260);
      return true;
    }, selector);
    if (!ok) console.warn("[step:" + label + "] selector not found:", selector);
  });
}

console.log("goto", stageUrl);
await page.goto(stageUrl, { waitUntil: "load" });
// wait for stage hooks
await page.waitForFunction(() => window.__promoReady === true, null, { timeout: 15000 });
// wait for the live tool iframe to render its toolbar
await step("iframe-ready", async () => {
  await tool().locator(".tb-gear").waitFor({ state: "visible", timeout: 20000 });
  console.log("iframe tool ready");
});
// pre-scroll the iframe to top
await step("iframe-top", () => page.frame({ url: /review\.html/ })?.evaluate(() => window.scrollTo(0, 0)));

// fade in from black handled by ffmpeg; small black hold at very start
await wait(300);

// ============================================================
// SCENE 1 — 0:00  "Your agent wrote the code. In seconds." (4s)
// ============================================================
await step("s1", async () => {
  await ev(() => {
    setBg("radial-gradient(1200px 900px at 50% 40%, rgba(255,255,255,0.04), transparent 60%), #07090d");
    showTitle(
      '<div class="big mono dim">Your agent wrote the code.</div>' +
      '<div class="big mono line2">In seconds.<span class="blink on accent">_</span></div>'
    );
  });
});
await wait(3700);

// ============================================================
// SCENE 2 — 0:04  "You have 90 seconds to approve it." (3.5s)
// ============================================================
await step("s2", async () => {
  await ev(() => {
    hideText();
  });
  await wait(420);
  await ev(() => {
    showTitle(
      '<div class="big">Now you\'re</div>' +
      '<div class="big line2">the <span class="accent">bottleneck</span>.</div>'
    );
    showApprove();
    showCursor(940, 540);
  });
  // cursor creeps toward the approve button
  await wait(500);
  await ev(() => moveCursor(1560, 880, 2400));
});
await wait(3000);

// ============================================================
// SCENE 3 — 0:07.5  "LGTM" — click, stamp, glitch (3s)
// ============================================================
await step("s3", async () => {
  await ev(() => { hideText(); showDiffBg(false); });
  await wait(180);
  await ev(() => { moveCursor(1620, 900, 260); });
  await wait(260);
  await ev(() => { pressApprove(); });
  await wait(160);
  await ev(() => {
    hideApprove(); hideCursor();
  });
  await wait(120);
  await ev(() => { showStamp(); shake(); });
  await wait(700);
  await ev(() => { glitch(); });
});
await wait(1700);

// ============================================================
// SCENE 4 — 0:10.5  "The diff shows WHAT changed..." (3.5s)
// ============================================================
await step("s4", async () => {
  await ev(() => {
    hideStamp(); hideText();
    showDiffBg(true); // drift
  });
  await wait(420);
  await ev(() => {
    showTitle(
      '<div class="mid">The diff shows <span class="accent">WHAT</span> changed.</div>' +
      '<div class="mid line2 dim">Not whether the reasoning was sound.</div>'
    );
  });
});
await wait(3050);

// ============================================================
// SCENE 5 — 0:14  Wordmark "review-intent" (3s)
// ============================================================
await step("s5", async () => {
  await ev(() => { hideText(); hideDiffBg(); });
  await wait(420);
  await ev(() => {
    setBg("radial-gradient(1100px 800px at 50% 38%, rgba(94,230,168,0.12), transparent 62%), #06080c");
    showTitle(
      '<div class="huge"><span class="dim">review</span><span class="accent">-intent</span></div>' +
      '<div class="sub">See the change. Judge the intent.</div>'
    );
  });
});
await wait(2900);

// ============================================================
// SCENE 6 — 0:17  LIVE tool, hero + vitals, gentle auto-scroll (4s)
// ============================================================
await step("s6", async () => {
  await ev(() => { hideText(); });
  // ensure iframe at top
  await step("s6-top", () => page.frame({ url: /review\.html/ })?.evaluate(() => window.scrollTo(0, 0)));
  await ev(() => {
    setBg("radial-gradient(1200px 900px at 78% 12%, rgba(94,230,168,0.08), transparent 60%), #07090d");
    showTool({ scale: 1, tx: 0, ty: 0 });
  });
  await wait(900);
  await ev(() => {
    showTitle(
      '<div class="mid mono">git diff <span class="accent">→</span> one interactive review page.</div>' +
      '<div class="sub">No LLM. No API key. No token cost.</div>',
      { bottom: true }
    );
  });
  await wait(1100);
  await ev(() => hideText());
  // gentle auto-scroll of the real page
  await step("s6-scroll", () =>
    page.frame({ url: /review\.html/ })?.evaluate(() => window.scrollTo({ top: 360, behavior: "smooth" }))
  );
});
await wait(1900);

// ============================================================
// SCENE 7 — 0:21  scorecard.png MEASURED, ken-burns to badges (4s)
// ============================================================
await step("s7", async () => {
  await ev(() => { hideTool(); });
  await wait(120);
  // scorecard-crop is 982x545 (content only, no empty bottom). Scale ~1.55 => ~1522x845,
  // filling the horizontal frame with comfortable margins, no top clipping, no side voids.
  // Gentle ken-burns push-in; caption lives in a bottom scrim band clear of the card.
  await ev(() => {
    showShot("assets/scorecard-crop.png", {
      fromScale: 1.42, fromTx: 0, fromTy: -120,
      scale: 1.50, tx: 0, ty: -120, duration: 5200
    });
    showTitle(
      '<div class="mid"><span class="chip measured">MEASURED</span> straight from the diff.</div>' +
      '<div class="sub">Un-gameable. <span class="accent">Touches auth · Touches dependencies.</span></div>',
      { bottom: true, scrim: true }
    );
  });
});
await wait(3900);

// ============================================================
// SCENE 8 — 0:25  risk-ledger.png CLAIMED, slide-in split feel (4s)
// ============================================================
await step("s8", async () => {
  await ev(() => { hideText(); });
  await wait(150);
  await ev(() => {
    // measured (landscape crop) settles upper-left; claimed ledger slides in from the
    // right and fills the rest — a genuine split-screen, both cards legible.
    showShot("assets/scorecard-crop.png", { fromScale: 1.58, fromTx: 0, fromTy: -40,
      scale: 0.95, tx: -560, ty: -260, duration: 900 });
    showShot("risk-ledger.png", {
      fromScale: 0.78, fromTx: 1300, fromTy: 40,
      scale: 0.80, tx: 470, ty: 40, duration: 1000
    });
  });
  await wait(1100);
  await ev(() => {
    showTitle(
      '<div class="mid"><span class="chip claimed">CLAIMED</span> right beside it.</div>' +
      '<div class="sub">When they disagree, you see it.</div>',
      { top: true, scrim: true }
    );
  });
});
await wait(2750);

// ============================================================
// SCENE 9 — 0:29  visual-summary.png 5 charts, beat-cut push (3s)
// ============================================================
await step("s9", async () => {
  await ev(() => { hideText(); hideShot("assets/scorecard-crop.png"); hideShot("risk-ledger.png"); });
  await wait(150);
  // visual-summary-crop is 2040x1980 (all five charts, trimmed margins). Scale ~0.50 =>
  // ~1020x990 — fills the frame height, centered, no corner-drop. Gentle push-in.
  // Caption is parked in a TOP scrim band so it NEVER sits over the red change-map dot
  // (which lives in the lower half of the grid).
  await ev(() => {
    showShot("assets/visual-summary-crop.png", {
      fromScale: 0.47, fromTx: 0, fromTy: 90,
      scale: 0.51, tx: 0, ty: 90, duration: 2900
    });
    showTitle(
      '<div class="mid" style="font-size:46px">Five charts. Hand-drawn SVG. Zero deps.</div>' +
      '<div class="sub"><span class="accent">Code changed, tests didn\'t? Red flag, raised.</span></div>',
      { top: true, scrim: true }
    );
  });
});
await wait(2850);

// ============================================================
// SCENE 10 — 0:32  LIVE guided tour, .tb-tour + .tour-next x2 (4s)
// ============================================================
await step("s10", async () => {
  await ev(() => { hideText(); hideShots(); });
  await wait(150);
  await step("s10-top", () => page.frame({ url: /review\.html/ })?.evaluate(() => window.scrollTo(0, 0)));
  await ev(() => { showTool({ scale: 1 }); });
  await wait(700);
  await ev(() => {
    showTitle('<div class="mid">One click. <span class="accent">Reviewed in priority order.</span></div>', { bottom: true });
  });
  await wait(700);
  await clickInTool("tour-start", ".tb-tour");
  await wait(1100);
  await ev(() => hideText());
  await clickInTool("tour-next-1", ".tour-next");
  await wait(950);
  await clickInTool("tour-next-2", ".tour-next");
  await wait(900);
  await clickInTool("tour-exit", ".tour-exit");
});
await wait(500);

// ============================================================
// SCENE 11 — 0:36  LIVE theme switch synthwave -> dark (3s)
// ============================================================
await step("s11", async () => {
  // scroll the live page onto the diff and zoom the camera in a touch so the recolor
  // is unmistakable and the diff text is readable when the theme morphs.
  await step("s11-scroll", () =>
    page.frame({ url: /review\.html/ })?.evaluate(() => window.scrollTo({ top: 1600, behavior: "instant" }))
  );
  await ev(() => { showTool({ scale: 1.16, ty: 40 }); });
  await wait(300);
  await ev(() => {
    showTitle('<div class="mid">14 themes. Live.</div><div class="sub">Same un-gameable truth.</div>', { bottom: true, scrim: true });
  });
  await wait(600);
  await ev(() => hideText());
  // switch to synthwave and DWELL — this is the strongest recolor, and the long hold
  // guarantees the evenly-spaced frame grab lands on a clearly themed page.
  await clickInTool("gear-1", ".tb-gear");
  await wait(380);
  await clickInTool("theme-synth", '.theme-opt[data-theme-id="synthwave"]');
  await wait(1900);
  // then morph to dark for the second palette beat (and to seed scene 12's dark card)
  await clickInTool("gear-2", ".tb-gear");
  await wait(380);
  await clickInTool("theme-dark", '.theme-opt[data-theme-id="dark"]');
  await wait(900);
});

// ============================================================
// SCENE 12 — 0:39  CTA card (2s)
// ============================================================
await step("s12", async () => {
  await ev(() => { hideTool(); hideShots(); });
  await wait(150);
  await ev(() => {
    setBg("radial-gradient(1100px 800px at 50% 40%, rgba(94,230,168,0.10), transparent 62%), #0a0d12");
    showTitle(
      '<div class="sub" style="font-size:30px;margin-top:0;color:var(--muted)">review-intent</div>' +
      '<div class="cmd mono accent" style="margin-top:14px" id="ctacmd">npx @christianmorup/review-intent</div>' +
      '<div class="sub">MIT · open source</div>' +
      '<div class="sub" style="color:var(--ink);font-weight:700;margin-top:34px">Stop rubber-stamping AI code.<span class="blink on accent">_</span></div>'
    );
  });
  await wait(650);
  // underline wipe under the command
  await ev(() => {
    var el = document.getElementById("ctacmd");
    var r = el.getBoundingClientRect();
    showUnderline(r.left, r.bottom + 14, r.width);
  });
});
await wait(2600);

// final hold (fade-out applied by ffmpeg)
await wait(400);

console.log("closing context to flush video...");
const video = page.video();
await context.close();
await browser.close();
const videoPath = video ? await video.path() : null;
console.log("VIDEO_PATH=" + videoPath);
