#!/usr/bin/env node
/**
 * smoke-shots.mjs — verify every HybridPost shot kind renders with visible content.
 *
 * Phase 1 (per-shot stills): constructs minimal HybridPost props with a single
 * shot of each kind × look, renders frame 10 via `npx remotion still`, and checks
 * pixel stddev ≥ MIN_VARIANCE.
 *
 * Phase 2 (full-video scan): when video paths are passed as CLI args, samples
 * every 0.5 s and fails if any frame's stddev is below MIN_VARIANCE. This catches
 * blank frames caused by shot-transition bugs.
 *
 * Usage:
 *   node scripts/smoke-shots.mjs                        # phase 1 only
 *   node scripts/smoke-shots.mjs video1.mp4 video2.mp4  # phase 1 + 2
 *
 * Exit 0 if all cases pass; exit 1 on first failure (prints which case failed).
 */

import {execSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(ROOT, 'studio');
const TMP = join(ROOT, '.smoke-tmp');

const MIN_VARIANCE = 8; // pixel stddev floor; blank frames ≈ 0, content with any visible element ≥ 8

// ─── Sample shot payloads ────────────────────────────────────────────────────
// audioDurationMs drives durationFrames; we render frame 10 (well past fade-in).
// audioSrc is unused by renderStill but must be a string.

const SAMPLE_SHOTS = {
  title: {
    kind: 'title',
    narration: 'Sample title narration.',
    heading: 'Sample Title',
    lines: ['Line one', 'Line two'],
    media: null,
    mediaCropped: false,
    audioSrc: 'smoke-dummy.mp3',
    audioDurationMs: 1500,
    captions: [],
  },
  chat: {
    kind: 'chat',
    narration: 'Sample chat narration.',
    lines: ['Hello, can you help me with this?'],
    sender: 'User',
    media: null,
    mediaCropped: false,
    audioSrc: 'smoke-dummy.mp3',
    audioDurationMs: 1500,
    captions: [],
  },
  steps: {
    kind: 'steps',
    narration: 'Sample steps narration.',
    heading: 'Three Steps',
    lines: ['First step', 'Second step', 'Third step'],
    media: null,
    mediaCropped: false,
    audioSrc: 'smoke-dummy.mp3',
    audioDurationMs: 1500,
    captions: [],
  },
  compare: {
    kind: 'compare',
    narration: 'Sample compare narration.',
    heading: 'Before vs After',
    left: {label: 'Before', items: ['Item A', 'Item B']},
    right: {label: 'After', items: ['Item X', 'Item Y']},
    media: null,
    mediaCropped: false,
    audioSrc: 'smoke-dummy.mp3',
    audioDurationMs: 1500,
    captions: [],
  },
  question: {
    kind: 'question',
    narration: 'Sample question narration.',
    heading: 'What happens next?',
    lines: ['Option one?', 'Option two?'],
    media: null,
    mediaCropped: false,
    audioSrc: 'smoke-dummy.mp3',
    audioDurationMs: 1500,
    captions: [],
  },
  recording: {
    kind: 'recording',
    narration: 'Sample recording narration.',
    heading: 'Screen Recording',
    label: 'Demo App · Screen capture',
    media: null, // no media → placeholder card (still has border + tape)
    mediaCropped: false,
    audioSrc: 'smoke-dummy.mp3',
    audioDurationMs: 1500,
    captions: [],
  },
  end: {
    kind: 'end',
    narration: 'Sample end narration.',
    heading: 'Try It Free',
    lines: ['5 minutes trial', 'Once per account'],
    media: null,
    mediaCropped: false,
    audioSrc: 'smoke-dummy.mp3',
    audioDurationMs: 1500,
    captions: [],
  },
};

const LOOKS = ['studio', 'collage'];
const KINDS = Object.keys(SAMPLE_SHOTS);

// ─── Pixel stddev helper ─────────────────────────────────────────────────────
const pixelStddev = (pngPath) => {
  const proc = spawnSync('python3', ['-c', `
import subprocess, math, sys
raw = subprocess.run(['ffmpeg','-i','${pngPath}','-vf','format=gray,scale=256:256','-vframes','1','-f','rawvideo','pipe:'],capture_output=True)
px = list(raw.stdout)
if not px: print(0); sys.exit()
mean = sum(px)/len(px)
var = sum((x-mean)**2 for x in px)/len(px)
print(f'{math.sqrt(var):.2f}')
`], {encoding: 'utf8', timeout: 15_000});
  const v = parseFloat(proc.stdout?.trim() ?? '0');
  return isFinite(v) ? v : 0;
};

// ─── Recording label zone check ───────────────────────────────────────────────
// Crops the band y=[1498, 1528] from a 1080×1920 PNG and checks low stddev.
// This strip sits between the label tail (~y 1490 worst-case portrait collage)
// and the caption pill's rotation bleed (~y 1533 for a collage -1° rotation).
// Background-only: stddev < LABEL_ZONE_MAX_STDDEV.
const LABEL_ZONE_MAX_STDDEV = 15;
const labelZoneStddev = (pngPath) => {
  // crop=w:h:x:y — full width (1080), 30px tall, starting at y=1498
  const proc = spawnSync('python3', ['-c', `
import subprocess, math, sys
raw = subprocess.run(['ffmpeg','-i','${pngPath}','-vf','crop=1080:30:0:1498,format=gray','-vframes','1','-f','rawvideo','pipe:'],capture_output=True)
px = list(raw.stdout)
if not px: print(-1); sys.exit()
mean = sum(px)/len(px)
var = sum((x-mean)**2 for x in px)/len(px)
print(f'{math.sqrt(var):.2f}')
`], {encoding: 'utf8', timeout: 15_000});
  const v = parseFloat(proc.stdout?.trim() ?? '-1');
  return isFinite(v) ? v : -1;
};

// ─── Main ────────────────────────────────────────────────────────────────────
mkdirSync(TMP, {recursive: true});

let passed = 0;
let failed = 0;
const failures = [];

for (const look of LOOKS) {
  for (const kind of KINDS) {
    const label = `${kind}/${look}`;
    const shot = {...SAMPLE_SHOTS[kind]};

    const props = {
      brandId: 'smartcaptions',
      language: look === 'studio' ? 'he' : 'en',
      look,
      aiDisclosure: false,
      wordmarkSrc: 'smartcaptions/wordmark.png',
      attribution: null,
      shots: [shot],
    };

    const propsPath = join(TMP, `${kind}-${look}.json`);
    const outPath = join(TMP, `${kind}-${look}.png`);
    writeFileSync(propsPath, JSON.stringify(props));

    // Render frame 10 — past the 8-frame fade-in.
    const cmd = `npx remotion still HybridPost "${outPath}" --props="${propsPath}" --frame=10 --overwrite --log=quiet`;
    const result = spawnSync('npx', [
      'remotion', 'still', 'HybridPost', outPath,
      `--props=${propsPath}`, '--frame=10', '--overwrite', '--log=warn',
    ], {cwd: STUDIO, encoding: 'utf8', timeout: 120_000});

    if (result.status !== 0) {
      console.error(`[FAIL] ${label}: render exit ${result.status}`);
      if (result.stderr) console.error(result.stderr.slice(0, 400));
      failures.push(`${label}: render failed (exit ${result.status})`);
      failed++;
      continue;
    }

    if (!existsSync(outPath)) {
      console.error(`[FAIL] ${label}: output PNG missing`);
      failures.push(`${label}: output PNG missing`);
      failed++;
      continue;
    }

    const stddev = pixelStddev(outPath);
    if (stddev < MIN_VARIANCE) {
      console.error(`[FAIL] ${label}: blank frame — stddev=${stddev.toFixed(2)} < ${MIN_VARIANCE}`);
      failures.push(`${label}: blank frame (stddev=${stddev.toFixed(2)})`);
      failed++;
    } else {
      console.log(`[PASS] ${label}: stddev=${stddev.toFixed(2)}`);
      passed++;
    }

    // Extra check for recording shots: the strip y=[1490,1540] (just above the
    // caption zone) must be background-only — no card or label pixels bleeding past
    // CAPTION_TOP.  stddev > LABEL_ZONE_MAX_STDDEV means a card/label is there.
    if (kind === 'recording' && existsSync(outPath)) {
      const lz = labelZoneStddev(outPath);
      if (lz < 0) {
        console.warn(`[WARN] ${label}: label-zone check skipped (ffmpeg returned no data)`);
      } else if (lz > LABEL_ZONE_MAX_STDDEV) {
        const msg = `${label}: card/label bleeds into caption zone — label-zone stddev=${lz.toFixed(2)} > ${LABEL_ZONE_MAX_STDDEV}`;
        console.error(`[FAIL] ${msg}`);
        failures.push(msg);
        failed++;
        passed--; // undo the earlier pass count
      } else {
        console.log(`[PASS] ${label}: label-zone stddev=${lz.toFixed(2)} (no bleed into caption zone)`);
        passed++;
      }
    }

    // Clean up the PNG (keep props for debugging if failed)
    if (!failures.some(f => f.startsWith(label))) {
      try { unlinkSync(outPath); } catch {}
    }
  }
}

console.log(`\nSmoke phase 1: ${passed} passed, ${failed} failed`);

// ─── Phase 2: full-video scan ─────────────────────────────────────────────────
// Accept video file paths as CLI args. Sample every 0.5 s, check pixel stddev.
const videoPaths = process.argv.slice(2).filter(p => existsSync(p));
if (videoPaths.length > 0) {
  console.log(`\nPhase 2: scanning ${videoPaths.length} video(s) at 0.5 s intervals...`);

  const scanTmp = join(TMP, 'scan-frames');
  mkdirSync(scanTmp, {recursive: true});

  // Scan a video: extract one frame per 0.5 s in one ffmpeg pass using the
  // select filter (every 15th frame at 30fps = every 0.5 s). This decodes
  // frames accurately (not fast-seek) so inter-frames are correct.
  // Returns {totalFrames, blankFrames: [{t, stddev}]}.
  const scanVideo = (videoPath) => {
    // 'not(mod(n,15))' selects frames 0, 15, 30, … = 0.0 s, 0.5 s, 1.0 s, …
    // -vsync vfr ensures we get exactly the selected frames, no duplicates.
    const ffmpeg = spawnSync('ffmpeg', [
      '-i', videoPath,
      '-vf', 'select=not(mod(n\\,15)),setpts=PTS-STARTPTS,format=gray,scale=256:256',
      '-vsync', 'vfr',
      '-f', 'rawvideo', 'pipe:',
    ], {maxBuffer: 50 * 1024 * 1024, timeout: 120_000});

    if (!ffmpeg.stdout || ffmpeg.stdout.length === 0) return [];

    const frameBytes = 256 * 256;
    const totalFrames = Math.floor(ffmpeg.stdout.length / frameBytes);
    const blankFrames = [];

    for (let i = 1; i < totalFrames; i++) { // skip i=0 (t=0.0 s): global composition fade-in is designed black
      const frame = ffmpeg.stdout.subarray(i * frameBytes, (i + 1) * frameBytes);
      let sum = 0, sum2 = 0;
      for (let j = 0; j < frame.length; j++) {
        const v = frame[j];
        sum += v;
        sum2 += v * v;
      }
      const mean = sum / frame.length;
      const stddev = Math.sqrt(sum2 / frame.length - mean * mean);
      const t = i * 0.5;
      if (stddev < MIN_VARIANCE) {
        blankFrames.push({t, stddev});
      }
    }
    return {totalFrames, blankFrames};
  };

  for (const videoPath of videoPaths) {
    const label = videoPath.replace(/.*\//, '');
    const result = scanVideo(videoPath);
    if (!result || result.totalFrames === 0) {
      console.error(`[SKIP] ${label}: could not read video frames`);
      continue;
    }

    if (result.blankFrames.length === 0) {
      console.log(`[PASS] ${label}: no blank frames in ${result.totalFrames} samples (every 0.5 s)`);
      passed++;
    } else {
      for (const {t, stddev} of result.blankFrames) {
        const msg = `${label} @ ${t.toFixed(1)}s: blank frame — stddev=${stddev.toFixed(2)} < ${MIN_VARIANCE}`;
        console.error(`[FAIL] ${msg}`);
        failures.push(msg);
      }
      failed++;
    }
  }
}

rmSync(TMP, {recursive: true, force: true});

console.log(`\nSmoke total: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error('Failures:');
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}
