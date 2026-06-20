# Demo capture tooling

External binaries (install once):

- **VHS** — terminal recorder. Windows: `winget install charmbracelet.vhs` (or `scoop install vhs`). macOS/Linux: `brew install vhs`. VHS needs `ttyd` and `ffmpeg` on PATH.
- **ffmpeg** — Windows: `winget install Gyan.FFmpeg`. macOS: `brew install ffmpeg`.
- **Playwright Chromium** — installed by `npm install` + `npx playwright install chromium` in this folder.

Build order: render `review.html` (see the plan, Task 4) → `vhs cli.tape` → `node browser.mjs` → `bash stitch.sh` (or `pwsh ./stitch.ps1`).
