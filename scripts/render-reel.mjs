#!/usr/bin/env node
/**
 * render-reel.mjs — contract entry point for the Studio Reel boundary (contracts.md §2).
 *
 * Usage (from marketing-studio root):
 *   node scripts/render-reel.mjs --job <abs-path/job.json>
 *
 * Orchestration:
 *   1. Validate job schema
 *   2. Run build-reel-props.mjs → reel-props.json
 *   3. npx remotion render StoryReel → reel.mp4
 *   4. Write SRT sidecar (reel.srt)
 *   5. ffprobe duration check (±1 s of voice-over total)
 *   6. Write result.json (schema_version 1)
 *
 * Exit 0 → result.json status "done"
 * Exit non-zero → result.json status "failed", error field set
 */
import {execSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReelProps} from './build-reel-props.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_DIR = join(ROOT, 'studio');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const parseFfprobeDuration = (text) => {
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d{2})/);
  if (!m) return null;
  const [, h, min, s, cs] = m.map(Number);
  return (h * 3600 + min * 60 + s) * 1000 + cs * 10;
};

const measureMs = (file) => {
  const proc = spawnSync('npx', ['remotion', 'ffprobe', `"${resolve(file)}"`], {
    cwd: STUDIO_DIR,
    shell: true,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return parseFfprobeDuration(`${proc.stdout}\n${proc.stderr}`);
};

/**
 * Measure the integrated loudness (LUFS) of an audio/video file using ffmpeg's
 * loudnorm filter in analysis mode. Returns null when ffmpeg is unavailable or
 * the output cannot be parsed.
 */
const measureLufs = (file) => {
  const proc = spawnSync('ffmpeg', [
    '-i', resolve(file),
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
    '-f', 'null', '-',
  ], {encoding: 'utf8', timeout: 120_000});
  const combined = `${proc.stdout ?? ''}\n${proc.stderr ?? ''}`;
  const match = combined.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const j = JSON.parse(match[0]);
    const v = parseFloat(j.input_i);
    return isFinite(v) ? v : null;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SRT sidecar writer
// ─────────────────────────────────────────────────────────────────────────────
const msToSrtTime = (ms) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs * 10).padStart(3, '0')}`;
};

const buildSrt = (props) => {
  const fps = 30;
  const hookFrames = Math.ceil((props.hookDurationMs / 1000) * fps);
  let cursor = hookFrames;
  const cueLines = [];
  let cueIndex = 1;

  for (const scene of props.scenes) {
    const sceneStartMs = Math.round((cursor / fps) * 1000);
    for (const cap of scene.captions) {
      const fromMs = sceneStartMs + cap.fromMs;
      const toMs = sceneStartMs + cap.toMs;
      cueLines.push(`${cueIndex}\n${msToSrtTime(fromMs)} --> ${msToSrtTime(toMs)}\n${cap.text}\n`);
      cueIndex++;
    }
    cursor += Math.ceil((scene.audioDurationMs / 1000) * fps);
  }

  return cueLines.join('\n');
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
const main = async () => {
  const args = process.argv.slice(2);
  const jobIdx = args.indexOf('--job');
  const jobPath = jobIdx >= 0 ? args[jobIdx + 1] : null;

  if (!jobPath) {
    console.error('Usage: node scripts/render-reel.mjs --job <abs-path/job.json>');
    process.exit(1);
  }

  const jobAbs = resolve(jobPath);
  let job;
  try {
    job = JSON.parse(readFileSync(jobAbs, 'utf8'));
  } catch (err) {
    console.error(`render-reel: cannot read job: ${err.message}`);
    process.exit(1);
  }

  const outputDir = resolve(job.output_dir);
  mkdirSync(outputDir, {recursive: true});

  const resultPath = join(outputDir, 'result.json');

  const writeResult = (status, extra = {}) => {
    const r = {schema_version: 1, status, video: null, duration_ms: null, captions: null, error: null, ...extra};
    writeFileSync(resultPath, JSON.stringify(r, null, 2));
  };

  // ─── Step 1: Build props ──────────────────────────────────────────────────
  let propsPath, props;
  try {
    console.log('[render-reel] building props…');
    ({propsPath, props} = await buildReelProps({jobPath: jobAbs}));
  } catch (err) {
    const msg = err.message ?? String(err);
    console.error(`[render-reel] props build failed: ${msg}`);
    writeResult('failed', {error: `Props build failed: ${msg}`});
    process.exit(1);
  }

  // ─── Step 2: Render ───────────────────────────────────────────────────────
  const reelMp4 = join(outputDir, 'reel.mp4');
  try {
    console.log('[render-reel] rendering StoryReel…');
    execSync(
      `npx remotion render StoryReel "${reelMp4}" --props="${propsPath}" --overwrite`,
      {cwd: STUDIO_DIR, stdio: 'inherit', timeout: 600_000},
    );
  } catch (err) {
    const msg = err.message ?? String(err);
    console.error(`[render-reel] render failed: ${msg}`);
    writeResult('failed', {error: `Remotion render failed: ${msg.slice(0, 200)}`});
    process.exit(1);
  }

  if (!existsSync(reelMp4)) {
    writeResult('failed', {error: 'Remotion exited 0 but reel.mp4 was not produced.'});
    process.exit(1);
  }

  // ─── Step 2.5: Loudness normalisation (EBU R128 −14 LUFS / −1.5 dBTP) ───
  const LUFS_TARGET = -14;
  const LUFS_TP_TARGET = -1.5;
  const LUFS_TOLERANCE = 1.5; // ±1.5 LU
  try {
    console.log('[render-reel] loudnorm pass 1: measuring…');
    const p1 = spawnSync('ffmpeg', [
      '-i', reelMp4,
      '-af', `loudnorm=I=${LUFS_TARGET}:TP=${LUFS_TP_TARGET}:LRA=11:print_format=json`,
      '-f', 'null', '-',
    ], {encoding: 'utf8', timeout: 120_000});
    const combined1 = `${p1.stdout ?? ''}\n${p1.stderr ?? ''}`;
    const match1 = combined1.match(/\{[\s\S]*?\}/);
    if (!match1) throw new Error('loudnorm pass 1: no JSON in output');
    const ln = JSON.parse(match1[0]);
    console.log(`[render-reel] measured I=${ln.input_i} LUFS, TP=${ln.input_tp} dBTP, LRA=${ln.input_lra}`);

    console.log('[render-reel] loudnorm pass 2: applying…');
    const normMp4 = join(outputDir, 'reel-norm.mp4');
    const filter = [
      `loudnorm=I=${LUFS_TARGET}:TP=${LUFS_TP_TARGET}:LRA=11`,
      `measured_I=${ln.input_i}:measured_TP=${ln.input_tp}`,
      `measured_LRA=${ln.input_lra}:measured_thresh=${ln.input_thresh}`,
      `offset=${ln.target_offset}:linear=true:print_format=summary`,
    ].join(':');
    const p2 = spawnSync('ffmpeg', [
      '-i', reelMp4,
      '-af', filter,
      '-c:v', 'copy',
      '-y', normMp4,
    ], {encoding: 'utf8', timeout: 120_000});
    if (p2.status !== 0) throw new Error(`ffmpeg pass 2 exited ${p2.status}: ${(p2.stderr ?? '').slice(0, 300)}`);

    renameSync(normMp4, reelMp4);

    // Verify: measure again and assert within tolerance.
    const postLufs = measureLufs(reelMp4);
    if (postLufs !== null) {
      const delta = Math.abs(postLufs - LUFS_TARGET);
      if (delta > LUFS_TOLERANCE) {
        console.warn(`[render-reel] loudness check WARNING: integrated=${postLufs.toFixed(1)} LUFS, target=${LUFS_TARGET}, delta=${delta.toFixed(1)} LU > ±${LUFS_TOLERANCE} LU`);
      } else {
        console.log(`[render-reel] loudness OK: integrated=${postLufs.toFixed(1)} LUFS (target=${LUFS_TARGET}, delta=${delta.toFixed(1)} LU ≤ ±${LUFS_TOLERANCE} LU)`);
      }
    }
  } catch (err) {
    console.warn(`[render-reel] loudness normalisation failed (non-fatal): ${err.message}`);
  }

  // ─── Step 3: SRT sidecar ─────────────────────────────────────────────────
  const reelSrt = join(outputDir, 'reel.srt');
  try {
    writeFileSync(reelSrt, buildSrt(props));
    console.log(`[render-reel] wrote ${reelSrt}`);
  } catch (err) {
    console.warn(`[render-reel] SRT write failed (non-fatal): ${err.message}`);
  }

  // ─── Step 4: Duration check ───────────────────────────────────────────────
  const renderedMs = measureMs(reelMp4);
  const voTotalMs =
    props.hookDurationMs +
    props.scenes.reduce((acc, s) => acc + s.audioDurationMs, 0) +
    props.endCardDurationMs;

  if (renderedMs === null) {
    console.warn('[render-reel] could not measure rendered duration (ffprobe unavailable)');
  } else {
    const delta = Math.abs(renderedMs - voTotalMs);
    if (delta > 1000) {
      const msg = `Rendered duration ${renderedMs}ms differs from voice-over total ${voTotalMs}ms by ${delta}ms (limit 1000ms).`;
      console.error(`[render-reel] duration check FAILED: ${msg}`);
      writeResult('failed', {
        video: reelMp4,
        duration_ms: renderedMs,
        captions: reelSrt,
        error: msg,
      });
      process.exit(1);
    }
    console.log(`[render-reel] duration check OK: rendered=${renderedMs}ms, voTotal=${voTotalMs}ms, delta=${delta}ms`);
  }

  // ─── Step 5: Write result ─────────────────────────────────────────────────
  writeResult('done', {
    video: reelMp4,
    duration_ms: renderedMs ?? voTotalMs,
    captions: reelSrt,
  });
  console.log(`[render-reel] done → ${resultPath}`);
};

main().catch((err) => {
  console.error('[render-reel] unexpected error:', err);
  process.exit(1);
});
