#!/usr/bin/env node
/**
 * record-smartcaptions-demo.mjs - films the SmartCaptions CEP panel (browser mode)
 * for the ProductDemo template.
 *
 * Prereq: the smartcaptions harness running (see TranscribeProX/CLAUDE.md "E2E
 * Panel Testing"): firebase emulators (auth/firestore/storage/functions), seeded
 * users, and `yarn dev:emulator` serving http://localhost:8834/main/.
 *
 * The panel's dev shim ([data-testid="dev-file-transcribe"]) uploads a real audio
 * file and runs the actual transcription pipeline; window.__devSrt carries the
 * result (see the repo's cep-panel-testing skill). STT takes 30-120s of wall
 * clock, so the recording is post-trimmed: the wait is cut to a beat and all
 * telemetry timestamps after the cut are shifted left to match.
 *
 * Output (English): ../../studio/public/smartcaptions/demo.webm + ../../props/smartcaptions-demo.json
 * Output (Hebrew):  ../../studio/public/smartcaptions/demo-he.webm + ../../props/smartcaptions-demo-he.json
 *
 * Usage:
 *   node record-smartcaptions-demo.mjs               # English (default)
 *   node record-smartcaptions-demo.mjs --locale he   # Hebrew
 *   node record-smartcaptions-demo.mjs --fix-dwell [--locale he]
 */
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SC_ROOT = process.env.SMARTCAPTIONS_ROOT ?? '/mnt/d/smartcaptions';
const PANEL_URL = process.env.SC_PANEL_URL ?? 'http://localhost:8834/main/';
const VIEWPORT = {width: 1440, height: 900};
const HOLD_MS = 3200;
const STT_TIMEOUT_MS = 300_000;
/** Seconds of spinner kept on each side of the STT-wait cut. */
const WAIT_LEAD_S = 2.5;
const WAIT_TAIL_S = 0.8;

// --- Locale configuration ---
const argv = process.argv.slice(2);
const LOCALE = (() => {
  const idx = argv.indexOf('--locale');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return 'en';
})();
const IS_HE = LOCALE === 'he';

// Locale-specific audio file
const AUDIO_EN = join(SC_ROOT, 'test_assets', 'fill-timeline', 'english_pauses_aesop.mp3');
const AUDIO_HE = join(SC_ROOT, 'test_assets', 'fill-timeline', 'hebrew_chess.ogg');
const AUDIO = IS_HE ? AUDIO_HE : AUDIO_EN;

// Hebrew demo captions — read from brief.json so the source of truth is one place.
function loadHeDemoSteps() {
  const briefPath = join(ROOT, 'out', 'smartcaptions', 'marketing', 'brief.json');
  try {
    const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
    const steps = brief?.he?.demoSteps;
    if (!Array.isArray(steps) || steps.length < 5) {
      throw new Error(`he.demoSteps missing or < 5 entries in ${briefPath}`);
    }
    return steps;
  } catch (e) {
    throw new Error(`Could not load Hebrew demo steps from brief.json: ${e.message}`);
  }
}

// Caption strings — [intro, panel, fill-timeline, upload, captions]
const CAPTIONS_EN = [
  'SmartCaptions: AI captions inside Premiere Pro',
  'The panel: languages, styling, one-click transcribe',
  'Fill Timeline: gapless captions with one switch',
  'Drop in your audio - real speech-to-text starts',
  'Captions, timed to the word',
];
const CAPTIONS_HE = IS_HE ? loadHeDemoSteps() : null;
const CAPTIONS = IS_HE ? CAPTIONS_HE : CAPTIONS_EN;
const [
  CAP_INTRO,
  CAP_PANEL,
  CAP_FILL,
  CAP_UPLOAD,
  CAP_RESULT,
] = CAPTIONS;

// Output paths
const videoSuffix = IS_HE ? 'demo-he.webm' : 'demo.webm';
const propsSuffix = IS_HE ? 'smartcaptions-demo-he.json' : 'smartcaptions-demo.json';
const srtSuffix = IS_HE ? 'demo-he-capture.srt' : 'demo-capture.srt';

const CONFIG = {
  viewport: VIEWPORT,
  holdMs: HOLD_MS,
  audio: IS_HE ? 'hebrew_chess.ogg' : 'english_pauses_aesop.mp3',
  locale: LOCALE,
  cut: [WAIT_LEAD_S, WAIT_TAIL_S],
};

// --- Post-process: fix caption dwell without re-filming ---
// Usage: node record-smartcaptions-demo.mjs [--locale he] --fix-dwell
//
// Loads the existing props JSON and merges any consecutive step-type events
// that are <700ms apart by DROPPING the earlier step (the click event and all
// timing stay intact; only the caption label is removed so the next caption
// receives the full dwell window). Rewrites the props file in place and prints
// what changed. Does NOT re-run the capture or touch the video file.
const MIN_CAPTION_DWELL_MS = 700;

// --- Post-process: trim the head of an existing capture without re-filming ---
// Usage: node record-smartcaptions-demo.mjs [--locale he] --trim-head <seconds>
//
// Re-encodes the existing webm starting at <seconds>, drops telemetry events
// that fall before the cut, and shifts the remaining timestamps left. Use to
// cut a bad opening (e.g. dev chrome that raced the cosmetic hide) while
// keeping the rest of the footage and its caption timing intact.
if (argv.includes('--trim-head')) {
  const secs = parseFloat(argv[argv.indexOf('--trim-head') + 1]);
  if (!Number.isFinite(secs) || secs <= 0) {
    throw new Error('trim-head: pass a positive number of seconds, e.g. --trim-head 6.9');
  }
  const propsPath = join(ROOT, 'props', propsSuffix);
  const videoPath = join(ROOT, 'studio', 'public', 'smartcaptions', videoSuffix);
  const data = JSON.parse(readFileSync(propsPath, 'utf8'));
  if (!Array.isArray(data.telemetry?.events)) {
    throw new Error(`trim-head: ${propsPath} has no telemetry.events array`);
  }
  const cutMs = Math.round(secs * 1000);
  if (cutMs >= data.telemetry.durationMs) {
    throw new Error(
      `trim-head: ${secs}s (${cutMs}ms) meets or exceeds video duration ${data.telemetry.durationMs}ms`,
    );
  }
  const before = data.telemetry.events.length;
  data.telemetry.events = data.telemetry.events
    .filter((e) => e.t >= cutMs)
    .map((e) => ({...e, t: e.t - cutMs}));
  data.telemetry.durationMs -= cutMs;
  const tmpOut = videoPath.replace(/\.webm$/, '.trim.webm');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-ss', String(secs), '-i', videoPath,
    '-c:v', 'libvpx-vp9', '-b:v', '4M', '-an', tmpOut,
  ], {stdio: ['ignore', 'ignore', 'inherit']});
  copyFileSync(tmpOut, videoPath);
  execFileSync('rm', ['-f', tmpOut]);
  writeFileSync(propsPath, JSON.stringify(data, null, 2) + '\n');
  console.log(
    `trim-head: cut first ${secs}s; dropped ${before - data.telemetry.events.length} event(s); ` +
    `new duration ${data.telemetry.durationMs}ms; rewrote ${videoPath} and ${propsPath}`,
  );
  process.exit(0);
}

if (argv.includes('--fix-dwell')) {
  const propsPath = join(ROOT, 'props', propsSuffix);
  const data = JSON.parse(readFileSync(propsPath, 'utf8'));
  if (!Array.isArray(data.telemetry?.events)) {
    throw new Error(`fix-dwell: ${propsPath} has no telemetry.events array; re-run the capture to regenerate it`);
  }
  const events = data.telemetry.events;

  // Collect indices of step events in time order.
  const stepIndices = events
    .map((e, i) => ({e, i}))
    .filter(({e}) => e.type === 'step')
    .sort((a, b) => a.e.t - b.e.t);

  const dropped = [];
  const toDrop = new Set();
  for (let k = 1; k < stepIndices.length; k++) {
    const prev = stepIndices[k - 1];
    const curr = stepIndices[k];
    const gap = curr.e.t - prev.e.t;
    if (gap < MIN_CAPTION_DWELL_MS && !toDrop.has(prev.i)) {
      // Drop the earlier step so the next caption gets the full dwell.
      toDrop.add(prev.i);
      dropped.push({dropped: prev.e.label, keptNext: curr.e.label, gapMs: gap});
    }
  }

  if (dropped.length === 0) {
    console.log('fix-dwell: no caption steps found below the 700ms threshold — props unchanged.');
    process.exit(0);
  }

  data.telemetry.events = events.filter((_, i) => !toDrop.has(i));
  writeFileSync(propsPath, JSON.stringify(data, null, 2) + '\n');
  for (const d of dropped) {
    console.log(
      `fix-dwell: dropped step "${d.dropped}" (${d.gapMs}ms before "${d.keptNext}"); click event preserved.`,
    );
  }
  console.log(`fix-dwell: rewrote ${propsPath}`);
  process.exit(0);
}

// --- Footage cache gate ---
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'smartcaptions', videoSuffix);
const propsOut = join(ROOT, 'props', propsSuffix);
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: SC_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: CONFIG,
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null;

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('smartcaptions', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (CACHE_ENABLED && !FORCE) {
  const {hit} = checkCache('smartcaptions', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit — reusing ${videoOut}`);
    process.exit(0);
  }
}

// Test credential: read from the repo's canonical seed script, never hardcoded.
const seedSrc = readFileSync(join(SC_ROOT, 'TranscribeProX', 'tests', 'e2e', 'scripts', 'seed-emulator-users.js'), 'utf8');
const cred = seedSrc.match(/email:\s*'(test-professional@example\.com)'[\s\S]{0,120}?password:\s*'([^']+)'/);
if (!cred) {
  console.error('Could not read the seeded professional test credential from seed-emulator-users.js');
  process.exit(1);
}
const [, EMAIL, PASSWORD] = cred;

try {
  const res = await fetch(PANEL_URL, {signal: AbortSignal.timeout(3000)});
  if (res.status >= 400) throw new Error(`panel responded ${res.status}`);
} catch (e) {
  console.error(`Panel unreachable at ${PANEL_URL} (${e.message}). Start the harness first.`);
  process.exit(1);
}

const videoDir = join(ROOT, 'out', 'capture');
mkdirSync(videoDir, {recursive: true});
let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    recordVideo: {dir: videoDir, size: VIEWPORT},
  });
  const page = await context.newPage();
  const rec = new Recorder();

  rec.start();
  await page.goto(PANEL_URL, {waitUntil: 'domcontentloaded'});
  // Film-only cosmetics: hide dev/test chrome (emulator banner, dev shim button,
  // test account email). The dev file input stays in the DOM (display:none label
  // still accepts setInputFiles); transcription itself is real.
  await page.addStyleTag({
    content: `
      [data-testid="dev-file-transcribe"] { display: none !important; }
    `,
  });
  await page.evaluate(() => {
    const hideByText = (needle) => {
      for (const el of document.querySelectorAll('*')) {
        if (el.childElementCount === 0 && el.textContent?.includes(needle)) {
          let n = el;
          for (let i = 0; i < 2 && n.parentElement && n.parentElement.childElementCount === 1; i++) n = n.parentElement;
          n.style.setProperty('display', 'none', 'important');
        }
      }
    };
    const tick = () => {
      hideByText('Running in emulator mode');
      hideByText('@example.com');
    };
    tick();
    new MutationObserver(tick).observe(document.documentElement, {childList: true, subtree: true});
  });
  await page.locator('input[type="email"]').waitFor({timeout: 30_000});
  rec.step(CAP_INTRO);
  await page.waitForTimeout(1200);

  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  const loginBtn = page.getByText('LOGIN', {exact: true}).first();
  await rec.click(loginBtn, IS_HE ? 'Sign in to your editing seat' : 'Sign in to your editing seat');
  await page.locator('[data-testid="transcribe-sequence-button"]').waitFor({timeout: 45_000});

  // Hebrew locale: switch the panel UI to Hebrew immediately after login.
  if (IS_HE) {
    const heToggle = page.locator('[data-testid="ui-language-he"]');
    await heToggle.waitFor({timeout: 5000});
    const isAlreadyHe = await heToggle.evaluate((el) => el.getAttribute('aria-pressed') === 'true').catch(() => false);
    if (!isAlreadyHe) {
      await heToggle.click();
      // Brief wait for React to re-render with Hebrew strings.
      await page.waitForTimeout(600);
    }
  }

  rec.step(CAP_PANEL);
  await page.waitForTimeout(HOLD_MS);

  // Fill Timeline ON: label span and .toggle-container share an .element-25 parent.
  // The label is translated in Hebrew mode; use the locale-correct text.
  const fillTimelineLabel = IS_HE ? 'מילוי ציר הזמן' : 'Fill Timeline';
  const fillToggle = page
    .locator(`xpath=//span[normalize-space()="${fillTimelineLabel}"]/ancestor::div[1]//div[contains(@class,"toggle-container")]`)
    .first();
  const toggleOn = await fillToggle.evaluate((el) => el.classList.contains('active')).catch(() => null);
  if (toggleOn === false) {
    await rec.click(fillToggle, CAP_FILL);
    await page.waitForTimeout(HOLD_MS);
  }

  // Kick off a real transcription through the dev shim.
  await page.evaluate(() => {
    window.__devSrt = undefined;
  });
  const fileInput = page.locator('[data-testid="dev-file-transcribe"] input[type="file"]');
  await fileInput.setInputFiles(AUDIO);
  rec.step(CAP_UPLOAD);

  // Poll window.__devSrt until the SRT lands.
  const t0 = Date.now();
  let srt = null;
  let waitedMs = 0;
  for (;;) {
    const v = await page.evaluate(() => window.__devSrt);
    if (typeof v === 'string' && v !== '__pending__') {
      if (v === '__cancelled__') throw new Error('transcription cancelled');
      if (v.startsWith('__error__:')) throw new Error(`transcription failed: ${v.slice(10, 300)}`);
      srt = v;
      waitedMs = Date.now() - t0;
      break;
    }
    if (Date.now() - t0 > STT_TIMEOUT_MS) throw new Error('STT timed out');
    await page.waitForTimeout(1500);
  }
  // Reveal the cue editor (collapsed by default) so the captions are on screen.
  const expander = page.getByText('Editor & Timing Adjuster', {exact: false}).first();
  await rec.click(expander, CAP_RESULT);
  await page.waitForTimeout(900);
  // Bring the cue text rows into frame (the editor opens below the fold).
  await expander.evaluate((el) => el.scrollIntoView({behavior: 'smooth', block: 'start'}));
  await page.waitForTimeout(1200);
  rec.focusAt(VIEWPORT.width / 2, VIEWPORT.height * 0.62, {w: 1150, h: 560});
  await page.waitForTimeout(HOLD_MS + 1800);

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close();
  const src = await video.path();

  // --- Post-trim the STT wait ---
  // The wait spans [upload step, result step] in telemetry time. Keep a lead
  // and tail beat, cut the middle, shift later events left.
  const events = telemetry.events;
  const uploadStep = events.find((e) => e.type === 'step' && e.label === CAP_UPLOAD);
  if (!uploadStep) throw new Error(`post-trim: step marker "${CAP_UPLOAD}" not found in telemetry — label may have drifted`);
  const resultStep = events.find((e) => e.type === 'step' && e.label === CAP_RESULT);
  if (!resultStep) throw new Error(`post-trim: step marker "${CAP_RESULT}" not found in telemetry — STT may not have completed or label drifted`);
  const cutFrom = uploadStep.t / 1000 + WAIT_LEAD_S;
  const cutTo = resultStep.t / 1000 - WAIT_TAIL_S;
  const destDir = join(ROOT, 'studio', 'public', 'smartcaptions');
  mkdirSync(destDir, {recursive: true});

  if (cutTo > cutFrom + 0.5) {
    const cutMs = Math.round((cutTo - cutFrom) * 1000);
    execFileSync('ffmpeg', [
      '-y', '-i', src,
      '-filter_complex',
      `[0:v]select='not(between(t,${cutFrom.toFixed(3)},${cutTo.toFixed(3)}))',setpts=N/FRAME_RATE/TB[v]`,
      '-map', '[v]', '-c:v', 'libvpx-vp9', '-b:v', '4M', '-an',
      videoOut,
    ], {stdio: ['ignore', 'ignore', 'inherit']});
    for (const e of events) {
      if (e.t > cutTo * 1000) e.t -= cutMs;
      else if (e.t > cutFrom * 1000) e.t = Math.round(cutFrom * 1000);
    }
    telemetry.durationMs -= cutMs;
    console.log(`trimmed STT wait: cut ${(cutMs / 1000).toFixed(1)}s (real STT took ${(waitedMs / 1000).toFixed(1)}s)`);
  } else {
    copyFileSync(src, videoOut);
  }

  const srtOut = join(ROOT, 'out', 'smartcaptions', srtSuffix);
  mkdirSync(dirname(srtOut), {recursive: true});
  writeFileSync(srtOut, srt);

  const props = {
    brandId: 'smartcaptions',
    video: `smartcaptions/${videoSuffix}`,
    cta: IS_HE ? 'נסיון חינם ב-smartcaptions.co.il' : 'Try free at smartcaptions.co.il',
    locale: IS_HE ? LOCALE : null,
    telemetry,
  };
  writeFileSync(propsOut, JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) storeCache('smartcaptions', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  const cueCount = srt.split('\n\n').filter((s) => s.trim()).length;
  console.log(`capture OK [${LOCALE}]: ${telemetry.durationMs}ms, ${telemetry.events.length} events, ${cueCount} cues`);
  console.log(`wrote studio/public/smartcaptions/${videoSuffix} and props/${propsSuffix}`);
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
