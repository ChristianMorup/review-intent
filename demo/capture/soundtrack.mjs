/**
 * soundtrack.mjs — Synthesize audio for the review-intent promo trailer.
 *
 * Reads demo/out/promo-marks.json (beat timestamps from promo.mjs),
 * synthesizes all audio layers with ffmpeg, transcodes the raw webm to mp4
 * with fades, then muxes audio+video into demo/out/review-intent-trailer.mp4.
 *
 * Usage:
 *   node soundtrack.mjs [--webm <path>] [--marks <path>]
 *   node soundtrack.mjs   # uses paths from promo-marks.json
 *
 * Idempotent: safe to re-run; overwrites outputs.
 */

import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../out");
mkdirSync(outDir, { recursive: true });

// ── Load marks ───────────────────────────────────────────────────────────────
const marksPath = resolve(outDir, "promo-marks.json");
const marksData = JSON.parse(readFileSync(marksPath, "utf8"));

// Build a map of label → seconds (t=0 is webm start)
const B = {};
for (const { label, ms } of marksData.beats) {
  B[label] = ms / 1000;
}

const webmPath = marksData.videoPath;
const totalDur = B["end"] ?? 47.0;

console.log("Beat map (seconds):");
for (const [k, v] of Object.entries(B)) console.log(`  ${k}: ${v.toFixed(3)}s`);
console.log(`  Total: ${totalDur.toFixed(3)}s`);

// ── Probe video duration ─────────────────────────────────────────────────────
function ffprobeDuration(path) {
  const out = execFileSync("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", path
  ]).toString();
  return parseFloat(JSON.parse(out).format.duration);
}

const rawDur = ffprobeDuration(webmPath);
console.log(`\nWebm duration: ${rawDur.toFixed(3)}s`);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * adelay value: delay a stream by `sec` seconds across all channels.
 * ffmpeg adelay takes ms per-channel pipe-separated, or a single value with `all=1`.
 */
const adelay = (sec) => `adelay=${Math.round(sec * 1000)}|${Math.round(sec * 1000)}`;

/**
 * Build a short envelope (attack/decay/sustain) on a stream using volume expr.
 * Returns an ffmpeg filter fragment (input assumed as [in]).
 */

// Run ffmpeg, throw on error, show stderr on failure
function ffmpeg(args, label) {
  console.log(`\n[ffmpeg:${label}] ${args.slice(0, 6).join(" ")} ...`);
  try {
    execFileSync("ffmpeg", ["-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    console.error(`[ffmpeg:${label}] FAILED:\n`, e.stderr?.toString() ?? e.message);
    throw e;
  }
}

// ── Step 1: Transcode webm → faded mp4 (video only) ─────────────────────────
const fadedVideoPath = resolve(outDir, "review-intent-trailer-video.mp4");
const fadeInDur = 0.6;
const fadeOutStart = rawDur - 0.8;
const fadeOutDur = 0.8;

console.log("\n=== Step 1: Transcode webm → faded video-only mp4 ===");
ffmpeg([
  "-i", webmPath,
  "-vf", [
    `fade=t=in:st=0:d=${fadeInDur}`,
    `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDur}`
  ].join(","),
  "-c:v", "libx264", "-crf", "18", "-preset", "fast",
  "-pix_fmt", "yuv420p",
  "-an",
  fadedVideoPath
], "video-transcode");

// Probe final video duration (after fades)
const vidDur = ffprobeDuration(fadedVideoPath);
console.log(`Faded video duration: ${vidDur.toFixed(3)}s`);

// ── Step 2: Synthesize audio ──────────────────────────────────────────────────
//
// All synthesis is done in a SINGLE ffmpeg invocation with a complex filter
// graph. Each layer is:
//   1. Generated from a source (sine, anoisesrc, aevalsrc)
//   2. Shaped with volume envelopes / afade
//   3. Delayed to the correct beat time with adelay
//   4. Mixed with amix
//   5. Master limiter applied
//
// Conservative levels throughout; no clipping.

console.log("\n=== Step 2: Synthesize audio ===");

const audioPath = resolve(outDir, "review-intent-audio.wav");

// Total audio duration = video duration (pad/trim to match)
const aDur = vidDur;

// Helper: format seconds to 3dp
const s = (v) => v.toFixed(3);

// Beat times (clamped to aDur)
const t = {};
for (const [k, v] of Object.entries(B)) t[k] = Math.min(v, aDur);

// We'll build the filter_complex as a big string.
// Inputs: we use aevalsrc / sine / anoisesrc as generated audio sources (no -i inputs).
// We wrap each generated source in its own filter chain and label it, then amix all.

// ────────────────────────────────────────────────────────────────────────────
// PAD/DRONE BED
// Two chord zones:
//   Zone A (tense):  0s → reveal (t.reveal)   — low dark chord: 55Hz + 82.4Hz + 110Hz
//   Zone B (bright): reveal → end             — warmer chord:   65Hz + 97.5Hz + 130Hz
//
// Each zone: 3 detuned sines, very quiet, crossfade at reveal.
// Level: around -22 LUFS → volume ~0.10 linear
// ────────────────────────────────────────────────────────────────────────────

const revealT = t["reveal"];
const endT = aDur;

// Zone A: tense drone (three sines beating slightly against each other)
// 55Hz + 56Hz + 110Hz + 111Hz — two pairs detuned ±1Hz for subtle beat
const droneA_dur = revealT + 0.5; // slight overlap for crossfade
const droneA = [
  // Each sine at very low volume; combine via volume filter post-amix
  `sine=frequency=55:duration=${s(droneA_dur)}[da1raw]`,
  `sine=frequency=56.2:duration=${s(droneA_dur)}[da2raw]`,
  `sine=frequency=82.5:duration=${s(droneA_dur)}[da3raw]`,
  `[da1raw]volume=0.10[da1]`,
  `[da2raw]volume=0.08[da2]`,
  `[da3raw]volume=0.06[da3]`,
  `[da1][da2][da3]amix=inputs=3:normalize=0[droneA_mix]`,
  // Fade in 0.5s, fade out 0.8s at the reveal crossover
  `[droneA_mix]afade=t=in:st=0:d=0.5,afade=t=out:st=${s(revealT - 0.3)}:d=0.8[droneA]`,
];

// Zone B: brighter/warmer drone starting at reveal
const droneB_start = revealT;
const droneB_dur = endT - droneB_start;
const droneB = [
  `sine=frequency=65:duration=${s(droneB_dur)}[db1raw]`,
  `sine=frequency=97.5:duration=${s(droneB_dur)}[db2raw]`,
  `sine=frequency=130:duration=${s(droneB_dur)}[db3raw]`,
  `[db1raw]volume=0.09[db1]`,
  `[db2raw]volume=0.07[db2]`,
  `[db3raw]volume=0.05[db3]`,
  `[db1][db2][db3]amix=inputs=3:normalize=0[droneB_mix]`,
  `[droneB_mix]afade=t=in:st=0:d=0.8,afade=t=out:st=${s(droneB_dur - 0.8)}:d=0.8[droneB_shaped]`,
  // Delay to reveal time
  `[droneB_shaped]${adelay(droneB_start)}[droneB]`,
];

// ────────────────────────────────────────────────────────────────────────────
// APPROVE CLICK — approve-click beat
// High-passed short noise burst (~60ms) — a soft UI tick
// ────────────────────────────────────────────────────────────────────────────
const clickT = t["approve-click"];
const click = [
  `anoisesrc=r=44100:amplitude=0.15:duration=0.06[click_noise]`,
  `[click_noise]highpass=f=4000,lowpass=f=12000,afade=t=in:st=0:d=0.005,afade=t=out:st=0.035:d=0.025[click_shaped]`,
  `[click_shaped]${adelay(clickT)}[click]`,
];

// ────────────────────────────────────────────────────────────────────────────
// LGTM STAMP — lgtm-stamp beat
// Low boom (70Hz enveloped sine, fast attack ~10ms, ~400ms decay) +
// short broadband noise thud (80ms)
// ────────────────────────────────────────────────────────────────────────────
const stampT = t["lgtm-stamp"];
const stampDur = 0.55;
const stamp = [
  // Boom: 70Hz sine with sharp volume envelope
  `sine=frequency=70:duration=${s(stampDur)}[boom_raw]`,
  // Envelope: full for 0.02s, then exponential decay
  `[boom_raw]volume='if(lt(t,0.02),1.0,1.0*exp(-6*(t-0.02)))':eval=frame[boom_env]`,
  `[boom_env]volume=0.85[boom]`,
  // Thud: short broadband noise
  `anoisesrc=r=44100:amplitude=0.5:duration=0.09[thud_raw]`,
  `[thud_raw]highpass=f=80,lowpass=f=3000,afade=t=in:st=0:d=0.003,afade=t=out:st=0.04:d=0.05[thud]`,
  // Mix boom + thud
  `[boom][thud]amix=inputs=2:normalize=0[stamp_mix]`,
  `[stamp_mix]${adelay(stampT)}[stamp_hit]`,
];

// ────────────────────────────────────────────────────────────────────────────
// GLITCH — glitch beat
// 150ms bitcrushed-feel noise burst with band filtering
// ────────────────────────────────────────────────────────────────────────────
const glitchT = t["glitch"];
const glitch = [
  `anoisesrc=r=44100:amplitude=0.4:duration=0.15[glitch_raw]`,
  // Bandpass around 800-3000 Hz for harsh digital feel
  `[glitch_raw]highpass=f=800,lowpass=f=3200,afade=t=in:st=0:d=0.005,afade=t=out:st=0.1:d=0.05[glitch_shaped]`,
  `[glitch_shaped]volume=0.55[glitch_v]`,
  `[glitch_v]${adelay(glitchT)}[glitch_hit]`,
];

// ────────────────────────────────────────────────────────────────────────────
// REVEAL RISER — starts ~0.7s before reveal, peaks at reveal
// Rising sine sweep 200Hz → 800Hz over 0.8s, then soft whoosh impact
// ────────────────────────────────────────────────────────────────────────────
const riserStart = revealT - 0.75;
const riserDur = 1.2;
// Riser: a high-pass filtered noise sweep (rising sense via volume ramp) +
// a fixed-frequency sine at 400Hz as a tonal anchor.
// aevalsrc doesn't support r= as an option in this ffmpeg build; use sine + noise approach.
const riser = [
  // Tonal sine at 400Hz (midrange) for 1.2s
  `sine=frequency=400:duration=${s(riserDur)}[riser_tone]`,
  `[riser_tone]volume='t/${s(riserDur)}':eval=frame[riser_tone_ramp]`,
  `[riser_tone_ramp]afade=t=out:st=${s(riserDur - 0.15)}:d=0.15[riser_tone_shaped]`,
  // Noise whoosh filtered to upper mids
  `anoisesrc=r=44100:amplitude=0.25:duration=${s(riserDur)}[whoosh_raw]`,
  `[whoosh_raw]highpass=f=800,lowpass=f=6000[whoosh_filt]`,
  // Rising volume on whoosh
  `[whoosh_filt]volume='t/${s(riserDur)}':eval=frame[whoosh_ramp]`,
  `[whoosh_ramp]afade=t=in:st=0:d=0.1,afade=t=out:st=${s(riserDur - 0.2)}:d=0.2[whoosh]`,
  // Mix
  `[riser_tone_shaped][whoosh]amix=inputs=2:normalize=0[riser_mix]`,
  `[riser_mix]volume=0.45[riser_v]`,
  `[riser_v]${adelay(riserStart < 0 ? 0 : riserStart)}[riser_hit]`,
];

// ────────────────────────────────────────────────────────────────────────────
// FEATURE BEATS — tool-in, scorecard, claimed, charts
// Light tick/blip on each scene cut (high sine blip, ~50ms)
// ────────────────────────────────────────────────────────────────────────────
function makeBlip(beatLabel, freq, vol) {
  const bt = t[beatLabel];
  if (bt === undefined) return null;
  const tag = beatLabel.replace(/[^a-z0-9]/g, "_");
  return [
    `sine=frequency=${freq}:duration=0.05[blip_${tag}_raw]`,
    `[blip_${tag}_raw]afade=t=in:st=0:d=0.005,afade=t=out:st=0.025:d=0.025[blip_${tag}_s]`,
    `[blip_${tag}_s]volume=${vol}[blip_${tag}_v]`,
    `[blip_${tag}_v]${adelay(bt)}[blip_${tag}]`,
  ];
}

const blipToolIn = makeBlip("tool-in", 1200, 0.18);
const blipScorecard = makeBlip("scorecard", 1100, 0.16);
const blipClaimed = makeBlip("claimed", 1050, 0.16);
const blipCharts = makeBlip("charts", 1000, 0.14);

// ────────────────────────────────────────────────────────────────────────────
// TOUR TICKS — tour-start, tour-next-1, tour-next-2
// Slightly softer/shorter UI tick per click (1400Hz, 35ms)
// ────────────────────────────────────────────────────────────────────────────
const tourStart = makeBlip("tour-start", 1400, 0.14);
const tourNext1 = makeBlip("tour-next-1", 1350, 0.13);
const tourNext2 = makeBlip("tour-next-2", 1300, 0.12);

// ────────────────────────────────────────────────────────────────────────────
// THEME SHIMMER — theme-synth, theme-dark
// Filtered noise shimmer ~150ms per theme switch
// ────────────────────────────────────────────────────────────────────────────
function makeShimmer(beatLabel, vol) {
  const bt = t[beatLabel];
  if (bt === undefined) return null;
  const tag = beatLabel.replace(/[^a-z0-9]/g, "_");
  return [
    `anoisesrc=r=44100:amplitude=0.3:duration=0.18[shim_${tag}_raw]`,
    `[shim_${tag}_raw]highpass=f=3000,lowpass=f=10000,afade=t=in:st=0:d=0.02,afade=t=out:st=0.1:d=0.08[shim_${tag}_s]`,
    `[shim_${tag}_s]volume=${vol}[shim_${tag}_v]`,
    `[shim_${tag}_v]${adelay(bt)}[shim_${tag}]`,
  ];
}

const shimSynth = makeShimmer("theme-synth", 0.22);
const shimDark = makeShimmer("theme-dark", 0.20);

// ────────────────────────────────────────────────────────────────────────────
// CTA ACCENT — resolving major chord swell (~0.6s)
// Three sines: root C4 (261Hz), E4 (330Hz), G4 (392Hz)
// Gentle swell then fade into the video's end fade
// ────────────────────────────────────────────────────────────────────────────
const ctaT = t["cta"];
const ctaDur = Math.min(aDur - ctaT, 3.5);
const cta = [
  `sine=frequency=261:duration=${s(ctaDur)}[cta_c]`,
  `sine=frequency=330:duration=${s(ctaDur)}[cta_e]`,
  `sine=frequency=392:duration=${s(ctaDur)}[cta_g]`,
  `[cta_c]volume=0.12[cta_cv]`,
  `[cta_e]volume=0.10[cta_ev]`,
  `[cta_g]volume=0.08[cta_gv]`,
  `[cta_cv][cta_ev][cta_gv]amix=inputs=3:normalize=0[cta_chord]`,
  `[cta_chord]afade=t=in:st=0:d=0.4,afade=t=out:st=${s(ctaDur - 1.2)}:d=1.2[cta_shaped]`,
  `[cta_shaped]${adelay(ctaT)}[cta_hit]`,
];

// ────────────────────────────────────────────────────────────────────────────
// Assemble filter_complex
// ────────────────────────────────────────────────────────────────────────────

const allLayers = [
  ...droneA,
  ...droneB,
  ...click,
  ...stamp,
  ...glitch,
  ...riser,
  ...(blipToolIn ?? []),
  ...(blipScorecard ?? []),
  ...(blipClaimed ?? []),
  ...(blipCharts ?? []),
  ...(tourStart ?? []),
  ...(tourNext1 ?? []),
  ...(tourNext2 ?? []),
  ...(shimSynth ?? []),
  ...(shimDark ?? []),
  ...cta,
];

// The labels that feed the final amix (last labeled output of each chain)
const mixInputs = [
  "[droneA]",
  "[droneB]",
  "[click]",
  "[stamp_hit]",
  "[glitch_hit]",
  "[riser_hit]",
  blipToolIn ? "[blip_tool_in]" : null,
  blipScorecard ? "[blip_scorecard]" : null,
  blipClaimed ? "[blip_claimed]" : null,
  blipCharts ? "[blip_charts]" : null,
  tourStart ? "[blip_tour_start]" : null,
  tourNext1 ? "[blip_tour_next_1]" : null,
  tourNext2 ? "[blip_tour_next_2]" : null,
  shimSynth ? "[shim_theme_synth]" : null,
  shimDark ? "[shim_theme_dark]" : null,
  "[cta_hit]",
].filter(Boolean);

const nMix = mixInputs.length;
const filterLines = [
  ...allLayers,
  // Final mix
  `${mixInputs.join("")}amix=inputs=${nMix}:normalize=0:duration=longest[mixed]`,
  // Master fade-in and fade-out matching video
  `[mixed]afade=t=in:st=0:d=0.3,afade=t=out:st=${s(aDur - 0.8)}:d=0.8[faded]`,
  // Ensure exactly aDur length: trim/pad
  `[faded]apad=whole_dur=${s(aDur)}[padded]`,
  // Trim to exact video length
  `[padded]atrim=end=${s(aDur)},asetpts=PTS-STARTPTS[trimmed]`,
  // Boost overall level before limiter (the bed+hits are very quiet; boost ~+10 dB ≈ 3.16x)
  `[trimmed]volume=3.5[boosted]`,
  // Master limiter — true peaks ≤ -1 dBFS (0.891 linear)
  `[boosted]alimiter=level_in=1:level_out=0.891:limit=0.891:attack=5:release=50[limited]`,
];

const filterComplex = filterLines.join(";\n");

// Write filter for inspection/debugging
const filterPath = resolve(outDir, "audio-filter.txt");
writeFileSync(filterPath, filterComplex);
console.log(`Filter written to: ${filterPath}`);

// Synthesize audio
ffmpeg([
  "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo:d=${s(aDur + 1)}`,
  "-filter_complex", filterComplex,
  "-map", "[limited]",
  "-c:a", "pcm_s16le",
  "-ar", "44100",
  "-t", s(aDur),
  audioPath
], "audio-synth");

console.log(`Audio written to: ${audioPath}`);

// Probe audio duration
const audioDur = ffprobeDuration(audioPath);
console.log(`Audio duration: ${audioDur.toFixed(3)}s (video: ${vidDur.toFixed(3)}s)`);

// ── Step 3: Mux video + audio → final mp4 ───────────────────────────────────
console.log("\n=== Step 3: Mux video + audio ===");

const finalPath = resolve(outDir, "review-intent-trailer.mp4");

ffmpeg([
  "-i", fadedVideoPath,
  "-i", audioPath,
  "-c:v", "copy",
  "-c:a", "aac", "-b:a", "192k",
  "-shortest",
  "-map", "0:v:0", "-map", "1:a:0",
  finalPath
], "mux");

console.log(`\nFinal trailer: ${finalPath}`);

// ── Step 4: Verify ───────────────────────────────────────────────────────────
console.log("\n=== Verification ===");

// ffprobe streams
const probeOut = execFileSync("ffprobe", [
  "-v", "quiet", "-print_format", "json", "-show_streams", finalPath
]).toString();
const probeData = JSON.parse(probeOut);
for (const s of probeData.streams) {
  console.log(`  Stream #${s.index}: ${s.codec_type} / ${s.codec_name} / ${s.width ?? ""}x${s.height ?? ""} dur=${s.duration}`);
}

// Volume detection
console.log("\nVolume detection...");
try {
  const volOut = execSync(
    `ffmpeg -i "${finalPath}" -af volumedetect -f null - 2>&1`,
    { encoding: "utf8" }
  );
  const maxLine = volOut.match(/max_volume:\s*[\-\d.]+\s*dB/)?.[0] ?? "not found";
  const meanLine = volOut.match(/mean_volume:\s*[\-\d.]+\s*dB/)?.[0] ?? "not found";
  console.log(`  ${maxLine}`);
  console.log(`  ${meanLine}`);
} catch (e) {
  // volumedetect outputs to stderr; execSync throws if ffmpeg exits non-zero (it does for -f null)
  // capture stderr from the error
  const output = e.stderr?.toString() ?? e.stdout?.toString() ?? "";
  const maxLine = output.match(/max_volume:\s*[\-\d.]+\s*dB/)?.[0] ?? "not found";
  const meanLine = output.match(/mean_volume:\s*[\-\d.]+\s*dB/)?.[0] ?? "not found";
  console.log(`  ${maxLine}`);
  console.log(`  ${meanLine}`);
}

console.log("\nDone.");
