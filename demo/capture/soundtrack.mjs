/**
 * soundtrack.mjs — Synthesize DRIVING SYNTHWAVE audio for the review-intent promo trailer.
 *
 * Genre: 1980s synthwave / outrun. Key: A minor. BPM: ~124.9 (drop lands exactly on reveal).
 * Progression: Am - F - C - G (i-VI-III-VII), 4-bar loop.
 *
 * Arc:
 *   HOOK  (0 → ~11.8s)  : moody minor pad + LGTM impact hit
 *   BUILD (~11.8 → 15.3s): riser sweep
 *   DROP  (15.3s)        : full synthwave kit kicks in
 *   FEATURES (15.3 → 43.2s): driving groove
 *   CTA   (43.2s → end)  : tonic resolve, fade out
 *
 * All rhythmic layers use aeval filter (sample-accurate, variable support).
 * One-shot hits use sine/noise + adelay (few nodes, no arg-length problem).
 *
 * Usage: node soundtrack.mjs
 * Idempotent — safe to re-run.
 */

import { execFileSync, execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../out");
mkdirSync(outDir, { recursive: true });

// ── Load marks ───────────────────────────────────────────────────────────────
const marksPath = resolve(outDir, "promo-marks.json");
const marksData = JSON.parse(readFileSync(marksPath, "utf8"));

const B = {};
for (const { label, ms } of marksData.beats) B[label] = ms / 1000;

const webmPath = marksData.videoPath;

console.log("Beat map (seconds):");
for (const [k, v] of Object.entries(B)) console.log(`  ${k}: ${v.toFixed(3)}s`);

// ── Compute synthwave grid ───────────────────────────────────────────────────
const revealSec = B["reveal"] ?? 15.368;
const N_INTRO_BEATS = 32;
const beatSec = revealSec / N_INTRO_BEATS;
const BPM = 60 / beatSec;
const dropT = revealSec;
const barSec = beatSec * 4;
const loopSec = barSec * 4;

console.log(`\nSynthwave grid:`);
console.log(`  Key: A minor | BPM: ${BPM.toFixed(2)} | Beat: ${beatSec.toFixed(4)}s`);
console.log(`  DROP at: ${dropT.toFixed(3)}s == reveal mark | delta: 0.000s`);
console.log(`  Progression: Am-F-C-G (bar=${barSec.toFixed(3)}s, 4-bar loop=${loopSec.toFixed(3)}s)`);

// ── Helpers ──────────────────────────────────────────────────────────────────
function ffprobeDuration(path) {
  const out = execFileSync("ffprobe", ["-v","quiet","-print_format","json","-show_format",path]).toString();
  return parseFloat(JSON.parse(out).format.duration);
}

function ffmpeg(args, label) {
  console.log(`\n[ffmpeg:${label}] ${args.slice(0,6).join(" ")} ...`);
  const r = spawnSync("ffmpeg", ["-y", ...args], { encoding: "buffer", maxBuffer: 64*1024*1024 });
  if (r.status !== 0) {
    console.error(`[ffmpeg:${label}] FAILED:\n`, r.stderr?.toString?.() ?? "");
    throw new Error(`ffmpeg ${label} failed`);
  }
}

const f4 = (v) => Number(v).toFixed(4);
const adelay = (sec) => { const ms = Math.round(Math.max(0,sec)*1000); return `adelay=${ms}|${ms}`; };

// ── Step 1: Transcode webm → faded mp4 (video only) ─────────────────────────
const fadedVideoPath = resolve(outDir, "review-intent-trailer-video.mp4");
const rawDur = ffprobeDuration(webmPath);
console.log(`\nWebm duration: ${rawDur.toFixed(3)}s`);

console.log("\n=== Step 1: Transcode webm → faded video-only mp4 ===");
ffmpeg([
  "-i", webmPath,
  "-vf", `fade=t=in:st=0:d=0.6,fade=t=out:st=${(rawDur-0.8).toFixed(3)}:d=0.8`,
  "-c:v", "libx264", "-crf", "18", "-preset", "fast",
  "-pix_fmt", "yuv420p", "-an",
  fadedVideoPath
], "video-transcode");

const vidDur = ffprobeDuration(fadedVideoPath);
console.log(`Faded video duration: ${vidDur.toFixed(3)}s`);

// ── Step 2: Build synthwave filter_complex ───────────────────────────────────
console.log("\n=== Step 2: Build synthwave filter ===");

const aDur = vidDur;
const t = {};
for (const [k,v] of Object.entries(B)) t[k] = Math.min(v, aDur);

// Music: A minor, Am-F-C-G
// roots: Am=110, F=174.61, C=130.81, G=196 Hz
const roots  = [110.00, 174.61, 130.81, 196.00];
const fifths = [165.00, 261.63, 196.00, 294.00];
const thirds = [130.81, 220.00, 164.81, 246.94];

// chord lookup piecewise: given ci (0..3 float), return freq from array
function cl(arr, ci) {
  const [a0,a1,a2,a3] = arr.map(v=>v.toFixed(4));
  return `if(lt(${ci},1),${a0},if(lt(${ci},2),${a1},if(lt(${ci},3),${a2},${a3})))`;
}

// =============================================================================
// LAYER EXPRESSIONS for aeval filter (supports variable assignments with 'var=expr;...')
// aeval takes 'exprs' — list of channel expressions separated by '|'.
// Within each channel expression, we CAN use 'var=val; var2=val2; output' style
// but actually aeval in recent ffmpeg uses a different syntax.
// SAFE approach: keep expressions purely mathematical (no variable bindings).
// We build deeply nested but valid arithmetic expressions.
// =============================================================================

const D = f4(dropT);     // drop time constant
const BS = f4(beatSec);  // beat period
const LS = f4(loopSec);  // 4-bar loop period
const GS = f4(barSec);   // bar period
const AD = f4(aDur);

// chord index (0..3): floor(mod((t-D)/GS, 4)), valid for t>=D
// We clamp to valid range with abs/min tricks:
const CI = `floor(mod(if(gte(t,${D}),t-${D},0)/${GS},4))`;

// gate: on during [start, end)
const gate = (a, b) => `if(gte(t,${f4(a)}),if(lt(t,${f4(b)}),1.0,0.0),0.0)`;

// ── PAD (lush detuned-saw approximation) ────────────────────────────────────
// Pre-drop: quiet Am pad; post-drop: cycling chord pad with slow volume swell
// 10 voices per chord: root*[0.998,1,1.002], root2*[0.999,1,1.001], fifth, third
function padChordBlock(chordIdx) {
  const r = roots[chordIdx], fi = fifths[chordIdx], th = thirds[chordIdx];
  const r2 = r * 2;
  return [
    `sin(2*PI*${f4(r*0.998)}*t)`,`sin(2*PI*${f4(r)}*t)`,`sin(2*PI*${f4(r*1.002)}*t)`,
    `sin(2*PI*${f4(r2*0.999)}*t)`,`sin(2*PI*${f4(r2)}*t)`,
    `sin(2*PI*${f4(fi*0.998)}*t)`,`sin(2*PI*${f4(fi)}*t)`,
    `sin(2*PI*${f4(th*0.997)}*t)`,`sin(2*PI*${f4(th)}*t)`,`sin(2*PI*${f4(th*1.003)}*t)`,
  ].join("+");
}

// Hook pad (Am only, 0→drop+0.5):
const hookBlock = padChordBlock(0);
// Post-drop: each chord gated by its window
const postPad = (ci) => {
  // c_i_gate * voices_for_chord_i: CI == i means floor(CI)==i → lt(CI,i+1)*gte(CI,i)
  const g = (i) => `(if(lt(${CI},${i+1}),if(gte(${CI},${i}),1.0,0.0),0.0))`;
  return [0,1,2,3].map(i => `${g(i)}*(${padChordBlock(i)})`).join("+");
};

// Full pad expr (L channel, R will get tiny detune):
function buildPadExprFlat(detCents) {
  const d = Math.pow(2, detCents/1200);
  function padChordBlockD(chordIdx) {
    const r = roots[chordIdx]*d, fi = fifths[chordIdx]*d, th = thirds[chordIdx]*d;
    const r2 = r*2;
    return [
      `sin(2*PI*${f4(r*0.998)}*t)`,`sin(2*PI*${f4(r)}*t)`,`sin(2*PI*${f4(r*1.002)}*t)`,
      `sin(2*PI*${f4(r2*0.999)}*t)`,`sin(2*PI*${f4(r2)}*t)`,
      `sin(2*PI*${f4(fi*0.998)}*t)`,`sin(2*PI*${f4(fi)}*t)`,
      `sin(2*PI*${f4(th*0.997)}*t)`,`sin(2*PI*${f4(th)}*t)`,`sin(2*PI*${f4(th*1.003)}*t)`,
    ].join("+");
  }
  const postPadD = [0,1,2,3].map(i => {
    const g = `(if(lt(${CI},${i+1}),if(gte(${CI},${i}),1.0,0.0),0.0))`;
    return `${g}*(${padChordBlockD(i)})`;
  }).join("+");

  // hook voice (Am detuned)
  const hookBlockD = padChordBlockD(0);

  const fadeEnv = `if(lt(t,0.3),t/0.3,if(gt(t,${f4(aDur-0.8)}),(${AD}-t)/0.8,1.0))`;
  const hookAmp = `${gate(0, dropT+0.3)}*0.07*0.11`;
  const postAmp = `${gate(dropT, aDur)}*0.22*0.10*min(1.0,(t-${D})/0.5)`;
  return `${fadeEnv}*(${hookAmp}*(${hookBlockD})+${postAmp}*(${postPadD}))`;
}

const padExprL = buildPadExprFlat(0);
const padExprR = buildPadExprFlat(5);

// ── KICK + SUB (periodic, post-drop) ─────────────────────────────────────────
// Four-on-the-floor: fires every beatSec from drop to ~CTA+barSec
// kick_phase = mod(t-D, BS)
// env = if(ph<0.004, ph/0.004, exp(-18*(ph-0.004))) * step(0.22-ph)
// sub bass (50Hz): exp(-12*(ph-0.005)) * step(0.28-ph) * 0.55
const kickEnd = (t["cta"] ?? 43.2) + barSec;
const kickExprL = (() => {
  const ph = `mod(t-${D},${BS})`;
  const kickEnv = `if(lt(${ph},0.004),${ph}/0.004,exp(-18*(${ph}-0.004)))*if(lt(${ph},0.22),1.0,0.0)`;
  const subEnv = `if(lt(${ph},0.005),${ph}/0.005,exp(-12*(${ph}-0.005)))*if(lt(${ph},0.28),1.0,0.0)*0.60`;
  const g = gate(dropT, kickEnd);
  return `${g}*(${kickEnv}*sin(2*PI*55*t)*0.90+(${subEnv})*sin(2*PI*50*t)*0.60)`;
})();

// ── BASS (eighth-note, post-drop) ─────────────────────────────────────────────
// Detuned two-sine + octave partial bass
// half_beat = BS/2; bass_phase = mod(t-D, BS/2)
// Frequency follows chord progression (ciExpr)
const bassEnd = (t["cta"] ?? 43.2) + barSec;
const bassExprL = (() => {
  const HB = f4(beatSec/2);
  const ph = `mod(t-${D},${HB})`;
  const benv = `if(lt(${ph},0.005),${ph}/0.005,exp(-8*(${ph}-0.005)))*if(lt(${ph},0.18),1.0,0.0)`;
  const fr = cl(roots, CI);
  const fr2 = cl(roots.map(r=>r*1.003), CI);
  const fh = cl(roots.map(r=>r*2), CI);
  const g = gate(dropT, bassEnd);
  return `${g}*(${benv})*(sin(2*PI*(${fr})*t)*0.55+sin(2*PI*(${fr2})*t)*0.30+sin(2*PI*(${fh})*t)*0.15)*0.70`;
})();

// ── ARP (16th-note plucky, post-drop) ─────────────────────────────────────────
// Bright plucky square-ish arp: root2, third2, fifth2, root4 per 16th
// sixteenth = beatSec/4; arp_phase = mod(t-D, beatSec/4)
// arp_step = floor(mod(t-D, beatSec) / (beatSec/4)) → 0..3
// freq = step? chord_lookup(roots2, thirds2, fifths2, roots4)
const arpEnd = (t["cta"] ?? 43.2) + barSec*2;
const arpExprL = (() => {
  const SX = f4(beatSec/4);
  const ph = `mod(t-${D},${SX})`;
  const stepExpr = `floor(mod(t-${D},${BS})/${SX})`;

  const roots2  = roots.map(r=>r*2);
  const thirds2 = thirds.map(f=>f*2);
  const fifths2 = fifths.map(f=>f*2);
  const roots4  = roots.map(r=>r*4);

  // freq lookup per step and chord
  const f0 = cl(roots2, CI);
  const f1 = cl(thirds2, CI);
  const f2 = cl(fifths2, CI);
  const f3 = cl(roots4, CI);
  const freq = `if(lt(${stepExpr},1),${f0},if(lt(${stepExpr},2),${f1},if(lt(${stepExpr},3),${f2},${f3})))`;

  const env = `exp(-28*(${ph}))*if(lt(${ph},0.085),1.0,0.0)`;
  const voice = `sin(2*PI*(${freq})*t)*0.55+sin(2*PI*(${freq})*3*t)*0.18+sin(2*PI*(${freq})*5*t)*0.08`;
  const g = gate(dropT, arpEnd);
  return `${g}*(${env})*(${voice})*0.40`;
})();

// ── HIHAT (offbeat 8ths, post-drop) ──────────────────────────────────────────
// Fires at halfBeat within each beat (offbeat 8th-note position)
// hi_phase = mod(t - D - BS/2, BS)
// Approximated as sum of inharmonic high-freq sines with fast envelope
const hatEnd = t["cta"] ?? 43.2;
const hatExprL = (() => {
  const HB = f4(beatSec/2);
  const ph = `mod(t-${D}-${HB},${BS})`;
  const env = `if(lt(${ph},0.002),${ph}/0.002,exp(-60*(${ph})))*if(lt(${ph},0.045),1.0,0.0)`;
  // Sum inharmonic high-freq sines (approximates noise burst)
  const voices = [8400,8730,9100,9600,10300,11000,12100,14000]
    .map(f=>`sin(2*PI*${f}*t)`).join("+");
  const g = gate(dropT, hatEnd);
  return `${g}*(${env})*(${voices})*0.020`;
})();

// ── CLAP/SNARE (beats 2&4, post-drop) ────────────────────────────────────────
// Fires at beat 2 and beat 4 of each bar
// clap_phase = mod(t - D - BS, GS)  → offset by 1 beat → fires at 0 and 2*BS
// Window: ph < BS/2 OR (ph >= 2*BS AND ph < 2*BS + BS/2)
const clapEnd = t["cta"] ?? 43.2;
const clapExprL = (() => {
  const HB = f4(beatSec/2);
  const ph = `mod(t-${D}-${BS},${GS})`;
  // Which sub-window is it? For the envelope we need phase within the hit:
  // hit1: ph in [0, BS/2)  → local_ph = ph
  // hit2: ph in [2*BS, 2*BS+BS/2) → local_ph = ph - 2*BS
  const lph = `if(lt(${ph},${HB}),${ph},if(lt(${ph},${f4(beatSec*2+beatSec*0.5)}),if(gte(${ph},${f4(beatSec*2)}),${ph}-${f4(beatSec*2)},${HB}),${HB}))`;
  const on = `if(lt(${ph},${HB}),1.0,if(lt(${ph},${f4(beatSec*2+beatSec*0.5)}),if(gte(${ph},${f4(beatSec*2)}),1.0,0.0),0.0))`;
  const env = `${on}*exp(-25*(${lph}))`;
  // Mid-freq inharmonic voices (snare character)
  const voices = [1400,1800,2400,3200,4200,5600,7500,9800,12000]
    .map(f=>`sin(2*PI*${f}*t)`).join("+");
  const g = gate(dropT, clapEnd);
  return `${g}*(${env})*(${voices})*0.032`;
})();

// ── RISER (problem → drop) ────────────────────────────────────────────────────
// Dense inharmonic sines sweeping up in amplitude, problem→drop
const riserStart = t["problem"] ?? 11.886;
const riserExprL = (() => {
  const rph = `(t-${f4(riserStart)})`;
  const rdur = f4(dropT - riserStart + 0.05);
  const g = gate(riserStart, dropT + 0.05);
  // Rising amplitude ramp + dense inharmonic frequencies
  const ramp = `min(1.0,${rph}/${rdur})`;
  const freqs = [200,317,503,800,1270,2010,3185,5050,8000,440,698,1100,1750,2780,880,1400];
  const voices = freqs.map(f=>`sin(2*PI*${f}*t)`).join("+");
  return `${g}*(${ramp})*(${voices})*0.016`;
})();

// ── One-shot nodes (short, use sine/noise + adelay) ───────────────────────────

// LGTM STAMP: 55Hz boom + 90Hz body at lgtm-stamp beat
const stampT2 = t["lgtm-stamp"] ?? 9.459;
const stamp = [
  `sine=frequency=55:duration=0.6500[boom_r]`,
  `[boom_r]volume='if(lt(t,0.005),1.2,1.2*exp(-7*(t-0.005)))':eval=frame[boom_env]`,
  `[boom_env]volume=0.92[boom_v]`,
  `sine=frequency=90:duration=0.5000[boom2_r]`,
  `[boom2_r]volume='if(lt(t,0.004),1.0,exp(-10*(t-0.004)))':eval=frame[boom2_env]`,
  `[boom2_env]volume=0.48[boom2_v]`,
  `[boom_v][boom2_v]amix=inputs=2:normalize=0[stamp_mix]`,
  `[stamp_mix]${adelay(stampT2)}[stamp_hit]`,
];

// GLITCH: short harsh burst
const glitchT2 = t["glitch"] ?? 10.169;
const glitch = [
  `sine=frequency=3200:duration=0.1200[gl_r]`,
  `[gl_r]afade=t=in:st=0:d=0.003,afade=t=out:st=0.07:d=0.05[gl_s]`,
  `[gl_s]volume=0.30[gl_v]`,
  `[gl_v]${adelay(glitchT2)}[glitch_hit]`,
];

// CTA RESOLVE: Am chord swell at CTA
const ctaT2 = t["cta"] ?? 43.2;
const ctaDur = Math.min(aDur - ctaT2, 4.5);
const cta = [
  `sine=frequency=110.0:duration=${f4(ctaDur)}[cta_r]`,
  `sine=frequency=220.0:duration=${f4(ctaDur)}[cta_o]`,
  `sine=frequency=165.0:duration=${f4(ctaDur)}[cta_5]`,
  `sine=frequency=330.0:duration=${f4(ctaDur)}[cta_h]`,
  `[cta_r]volume=0.35[cta_rv]`, `[cta_o]volume=0.22[cta_ov]`,
  `[cta_5]volume=0.18[cta_5v]`, `[cta_h]volume=0.10[cta_hv]`,
  `[cta_rv][cta_ov][cta_5v][cta_hv]amix=inputs=4:normalize=0[cta_chord]`,
  `[cta_chord]afade=t=in:st=0:d=0.3,afade=t=out:st=${f4(ctaDur-1.0)}:d=1.0[cta_shaped]`,
  `[cta_shaped]${adelay(ctaT2)}[cta_hit]`,
];

// APPROVE CLICK: crisp short UI click when the cursor presses the Approve button
const clickT2 = t["approve-click"] ?? 9.0;
const click = [
  `sine=frequency=900:duration=0.06[ck0]`,
  `sine=frequency=1700:duration=0.06[ck1]`,
  `sine=frequency=2600:duration=0.06[ck2]`,
  `sine=frequency=5200:duration=0.06[ck3]`,
  `sine=frequency=7400:duration=0.06[ck4]`,
  `[ck0][ck1][ck2][ck3][ck4]amix=inputs=5:normalize=0[ck_mix]`,
  `[ck_mix]volume='if(lt(t,0.0008),1.0,exp(-85*(t-0.0008)))':eval=frame[ck_env]`,
  `[ck_env]volume=0.50[ck_v]`,
  `[ck_v]${adelay(clickT2)}[click_hit]`,
];

// ── Build aeval filter nodes ──────────────────────────────────────────────────
// aeval filter: takes a continuous stereo stream and applies per-sample expressions.
// We pipe the anullsrc through aeval for each layer, then amix all.
// To avoid needing multiple input streams, we generate each layer from anullsrc separately.
// Each layer: aevalsrc='exprL|exprR':s=44100:c=stereo:d=aDur → layer label

const aLayers = [
  { label: "pad",   exprL: padExprL,   exprR: padExprR },
  { label: "kick",  exprL: kickExprL,  exprR: kickExprL },
  { label: "bass",  exprL: bassExprL,  exprR: bassExprL },
  { label: "arp",   exprL: arpExprL,   exprR: arpExprL },
  { label: "hat",   exprL: hatExprL,   exprR: hatExprL },
  { label: "clap",  exprL: clapExprL,  exprR: clapExprL },
  { label: "riser", exprL: riserExprL, exprR: riserExprL },
];

const filterParts = [];
const mixLabels = [];

for (const { label, exprL, exprR } of aLayers) {
  // Use aevalsrc as a source filter (generates audio from scratch)
  filterParts.push(`aevalsrc='${exprL}|${exprR}':s=44100:c=stereo:d=${f4(aDur)}[${label}]`);
  mixLabels.push(`[${label}]`);
}

// One-shot nodes
filterParts.push(...stamp, ...glitch, ...cta, ...click);
mixLabels.push("[stamp_hit]", "[glitch_hit]", "[cta_hit]", "[click_hit]");

const nMix = mixLabels.length;
filterParts.push(
  `${mixLabels.join("")}amix=inputs=${nMix}:normalize=0:duration=longest[mixed]`,
  `[mixed]afade=t=in:st=0:d=0.3,afade=t=out:st=${f4(aDur-0.8)}:d=0.8[faded]`,
  `[faded]apad=whole_dur=${f4(aDur)}[padded]`,
  `[padded]atrim=end=${f4(aDur)},asetpts=PTS-STARTPTS[trimmed]`,
  // Boost calibrated: 0.60x yields ~-18 dB mean, peaks safely under -1 dBFS after alimiter.
  `[trimmed]volume=0.60[boosted]`,
  `[boosted]alimiter=level_in=1:level_out=0.891:limit=0.891:attack=3:release=40[limited]`
);

const filterComplex = filterParts.join(";\n");

// Write filter for inspection
const filterPath = resolve(outDir, "audio-filter.txt");
writeFileSync(filterPath, filterComplex);
console.log(`Filter written to: ${filterPath}`);
console.log(`Mix layers: ${nMix} (${aLayers.length} aevalsrc + 3 one-shot)`);

// ── Step 2b: Synthesize audio ─────────────────────────────────────────────────
console.log("\n=== Step 2b: Synthesize audio ===");
const audioPath = resolve(outDir, "review-intent-audio.wav");

// Use -/filter_complex (newer syntax) to pass filter from file
ffmpeg([
  "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo:d=${f4(aDur+1)}`,
  "-/filter_complex", filterPath,
  "-map", "[limited]",
  "-c:a", "pcm_s16le", "-ar", "44100",
  "-t", f4(aDur),
  audioPath
], "audio-synth");

console.log(`Audio written to: ${audioPath}`);
const audioDur = ffprobeDuration(audioPath);
console.log(`Audio duration: ${audioDur.toFixed(3)}s (video: ${vidDur.toFixed(3)}s)`);

// ── Step 3: Mux video + audio ────────────────────────────────────────────────
console.log("\n=== Step 3: Mux video + audio ===");
const finalPath = resolve(outDir, "review-intent-trailer.mp4");

ffmpeg([
  "-i", fadedVideoPath, "-i", audioPath,
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
  "-shortest", "-map", "0:v:0", "-map", "1:a:0",
  finalPath
], "mux");

console.log(`\nFinal trailer: ${finalPath}`);

// ── Step 4: Verify ────────────────────────────────────────────────────────────
console.log("\n=== Verification ===");
const probeOut = execFileSync("ffprobe", [
  "-v", "quiet", "-print_format", "json", "-show_streams", finalPath
]).toString();
const probeData = JSON.parse(probeOut);
for (const st of probeData.streams) {
  console.log(`  Stream #${st.index}: ${st.codec_type} / ${st.codec_name} / ${st.width??''}x${st.height??''} dur=${st.duration}`);
}

console.log("\nVolume detection...");
try {
  const volOut = execSync(`ffmpeg -i "${finalPath}" -af volumedetect -f null - 2>&1`, { encoding: "utf8" });
  console.log(`  ${volOut.match(/max_volume:\s*[\-\d.]+\s*dB/)?.[0] ?? "max: not found"}`);
  console.log(`  ${volOut.match(/mean_volume:\s*[\-\d.]+\s*dB/)?.[0] ?? "mean: not found"}`);
} catch (e) {
  const out = e.stderr?.toString() ?? e.stdout?.toString() ?? "";
  console.log(`  ${out.match(/max_volume:\s*[\-\d.]+\s*dB/)?.[0] ?? "max: not found"}`);
  console.log(`  ${out.match(/mean_volume:\s*[\-\d.]+\s*dB/)?.[0] ?? "mean: not found"}`);
}

console.log(`\nSummary:`);
console.log(`  Key: A minor | BPM: ${BPM.toFixed(2)} | Chord: Am-F-C-G`);
console.log(`  DROP at ${dropT.toFixed(3)}s | reveal mark at ${revealSec.toFixed(3)}s | delta: ${Math.abs(dropT-revealSec).toFixed(3)}s`);
console.log("\nDone.");
