$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "../out")

$webm = (Get-ChildItem raw/*.webm | Select-Object -First 1).FullName
$norm = "-vf scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=black,fps=30 -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -an"

$normArgs = $norm -split ' '
& ffmpeg -y -i cli.mp4 @normArgs cli_norm.mp4
& ffmpeg -y -i $webm   @normArgs browser_norm.mp4

"file 'cli_norm.mp4'`nfile 'browser_norm.mp4'" | Set-Content concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy review-intent-demo.mp4

Remove-Item cli_norm.mp4, browser_norm.mp4, concat.txt
Write-Host "wrote demo/out/review-intent-demo.mp4"
