#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../out"

WEBM="$(ls raw/*.webm | head -n1)"
NORM="-vf scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=black,fps=30 -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -an"

ffmpeg -y -i cli.mp4   $NORM cli_norm.mp4
ffmpeg -y -i "$WEBM"   $NORM browser_norm.mp4

printf "file 'cli_norm.mp4'\nfile 'browser_norm.mp4'\n" > concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy review-intent-demo.mp4

rm -f cli_norm.mp4 browser_norm.mp4 concat.txt
echo "wrote demo/out/review-intent-demo.mp4"
