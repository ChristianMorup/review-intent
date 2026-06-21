# Demo capture tooling

External binaries (install once):

- **VHS** — terminal recorder (intended path for a real TTY). Windows: `winget install charmbracelet.vhs` (or `scoop install vhs`). macOS/Linux: `brew install vhs`. VHS needs `ttyd` and `ffmpeg` on PATH.
- **ffmpeg** — Windows: `winget install Gyan.FFmpeg`. macOS: `brew install ffmpeg`.
- **Playwright Chromium** — installed by `npm install` + `npx playwright install chromium` in this folder.

## Segments

The final demo movie is two segments concatenated:

1. **Terminal segment** — shows the CLI workflow: `git switch`, `git diff --stat`, then `npx @christianmorup/review-intent` running and writing `review.html`.
2. **Browser segment** — shows the rendered review page: scorecard, charts, diagrams, guided tour, review comments, and theme switcher.

## Build order

### With a real TTY (intended path)

```sh
# 1. Pre-run the CLI so review.html and .review/intent.json exist for the browser segment
#    (run from demo/widget-api/)
npx @christianmorup/review-intent --no-open --out review.html

# 2. Record the terminal segment via VHS (real TTY required)
vhs cli.tape            # writes demo/out/cli.mp4

# 3. Record the browser segment via Playwright
node browser.mjs        # writes demo/out/raw/*.webm

# 4. Transcode + stitch
bash stitch.sh          # or: pwsh ./stitch.ps1
```

### Without a TTY (headless fallback)

When no real pty is available (e.g. a sandbox/CI environment), VHS cannot run.
Use `terminal.html` + `terminal.mjs` instead — they produce the same terminal
segment entirely via Playwright and animated HTML:

```sh
# 1. Record the terminal segment headlessly
node terminal.mjs       # writes demo/out/raw-term/*.webm

# 2. Record the browser segment (unchanged)
node browser.mjs        # writes demo/out/raw/*.webm

# 3. Transcode & stitch manually with ffmpeg:
#    Normalize each webm to a common h264/yuv420p/1440x900/30fps MP4:
ffmpeg -y -i demo/out/raw-term/<hash>.webm \
  -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=black,fps=30" \
  -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -an demo/out/terminal.mp4

ffmpeg -y -i demo/out/raw/<hash>.webm \
  -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=black,fps=30" \
  -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -an demo/out/browser.mp4

#    Concat (terminal first, browser second):
echo "file 'terminal.mp4'" >  demo/out/list.txt
echo "file 'browser.mp4'"  >> demo/out/list.txt
ffmpeg -y -f concat -safe 0 -i demo/out/list.txt -c copy demo/out/review-intent-demo.mp4
```

The produced `.mp4` / `.webm` files live under `demo/out/` which is gitignored — they are build outputs, not committed.

## Promotional trailer (with sound)

A separate, designed launch trailer (kinetic captions + live tool footage composited
in one Playwright take, plus a procedural ffmpeg soundtrack). Reproducible build:

```sh
# 1. Record the 1920x1080 stage; writes the webm AND demo/out/promo-marks.json
#    (real beat timestamps captured during the same run, so audio can't drift)
node promo.mjs

# 2. Synthesize the synced soundtrack, transcode with fades, and mux a/v
node soundtrack.mjs     # writes demo/out/review-intent-trailer.mp4 (with audio)
```

`promo.html` is the motion-graphics stage; `promo.mjs` the Playwright director;
`trailer-storyboard.json` the panel-designed storyboard; `soundtrack.mjs` the
ffmpeg-synthesized audio (drone bed + impacts/risers/ticks, peaks limited to -1 dBFS).
The trailer is silent without step 2.

**Credits / licensing:** the music is synthesized in `soundtrack.mjs` (original, no
license). The Approve click is `assets/click-cc0.ogg` — "Computer mouse single click"
from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Computer_mouse_single_click.ogg),
licensed **CC0** (public domain): no attribution or royalties required.
