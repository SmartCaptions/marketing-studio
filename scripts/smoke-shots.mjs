#!/usr/bin/env node
/**
 * smoke-shots.mjs — verify every HybridPost shot kind renders with visible content.
 *
 * For each (kind × look) combination, constructs minimal HybridPost props with
 * a single shot of that kind, renders frame 10 using `npx remotion still`, then
 * checks that the output PNG has pixel stddev > MIN_VARIANCE (blank frames
 * have stddev ≈ 0).
 *
 * Usage:
 *   node scripts/smoke-shots.mjs
 *
 * Exit 0 if all cases pass; exit 1 on first failure (prints which case failed).
 */

import {execSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, unlinkSync, writeFileSync} from 'node:fs';
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

    // Clean up the PNG (keep props for debugging if failed)
    if (!failures.some(f => f.startsWith(label))) {
      try { unlinkSync(outPath); } catch {}
    }
  }
}

console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error('Failures:');
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}
