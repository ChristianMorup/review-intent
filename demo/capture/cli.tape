# review-intent — terminal segment
Output ../out/cli.mp4

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 700
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

Type "cd ../widget-api"
Enter
Sleep 600ms

Type "git switch feature/per-user-cache"
Enter
Sleep 1s

Type "git diff --stat main...HEAD"
Enter
Sleep 2500ms

Type "# review-intent: render the intent-annotated review page"
Enter
Sleep 800ms

Type "npx @christianmorup/review-intent --no-open --out review.html"
Enter
Sleep 4s

Type "# completeness gate passed — opening the page next"
Enter
Sleep 2s
