#!/usr/bin/env node
/**
 * render-post.mjs — entry point for HybridPost renders.
 *
 * Usage (from marketing-studio root):
 *   node scripts/render-post.mjs --job <abs-path/job.json>
 *
 * Orchestration:
 *   1. Validate job schema
 *   2. Run build-post-props.mjs → post-props.json
 *   3. npx remotion render HybridPost → post.mp4
 *   4. Write SRT sidecar (post.srt)
 *   5. Loudness-normalise to EBU R128 −14 LUFS
 *   6. Write result.json  {schema_version:1, status, video, duration_ms, captions, error}
 *
 * Exit 0  → result.json status "done"
 * Exit 1  → result.json status "failed", error field set
 */
import {execSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPostProps} from './build-post-props.mjs';

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
// SRT builder
// ─────────────────────────────────────────────────────────────────────────────
const msToSrtTime = (ms) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const ms3 = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms3).padStart(3, '0')}`;
};

const buildSrt = (props) => {
  const fps = 30;
  let cursor = 0;
  const lines = [];
  let idx = 1;

  for (const shot of props.shots) {
    const shotStartMs = Math.round((cursor / fps) * 1000);
    for (const cap of shot.captions) {
      const fromMs = shotStartMs + cap.fromMs;
      const toMs = shotStartMs + cap.toMs;
      lines.push(`${idx}\n${msToSrtTime(fromMs)} --> ${msToSrtTime(toMs)}\n${cap.text}\n`);
      idx++;
    }
    cursor += Math.ceil((shot.audioDurationMs / 1000) * fps);
  }

  return lines.join('\n');
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
const main = async () => {
  const args = process.argv.slice(2);
  const jobIdx = args.indexOf('--job');
  const jobPath = jobIdx >= 0 ? args[jobIdx + 1] : null;

  if (!jobPath) {
    console.error('Usage: node scripts/render-post.mjs --job <abs-path/job.json>');
    process.exit(1);
  }

  const jobAbs = resolve(jobPath);
  let job;
  try {
    job = JSON.parse(readFileSync(jobAbs, 'utf8'));
  } catch (err) {
    console.error(`render-post: cannot read job: ${err.message}`);
    process.exit(1);
  }

  const outputDir = resolve(job.output_dir);
  mkdirSync(outputDir, {recursive: true});

  const resultPath = join(outputDir, 'result.json');

  const writeResult = (status, extra = {}) => {
    const r = {
      schema_version: 1,
      status,
      video: null,
      duration_ms: null,
      captions: null,
      error: null,
      ...extra,
    };
    writeFileSync(resultPath, JSON.stringify(r, null, 2));
  };

  // ─── Step 1: Build props ──────────────────────────────────────────────────
  let propsPath, props, voiceId;
  try {
    console.log('[render-post] building props…');
    ({propsPath, props, voiceId} = await buildPostProps({jobPath: jobAbs}));
  } catch (err) {
    const msg = err.message ?? String(err);
    console.error(`[render-post] props build failed: ${msg}`);
    writeResult('failed', {error: `Props build failed: ${msg}`});
    process.exit(1);
  }

  // ─── Step 2: Render ───────────────────────────────────────────────────────
  const postMp4 = join(outputDir, 'post.mp4');
  try {
    console.log('[render-post] rendering HybridPost…');
    execSync(
      `npx remotion render HybridPost "${postMp4}" --props="${propsPath}" --overwrite`,
      {cwd: STUDIO_DIR, stdio: 'inherit', timeout: 600_000},
    );
  } catch (err) {
    const msg = err.message ?? String(err);
    console.error(`[render-post] render failed: ${msg}`);
    writeResult('failed', {error: `Remotion render failed: ${msg.slice(0, 200)}`});
    process.exit(1);
  }

  if (!existsSync(postMp4)) {
    writeResult('failed', {error: 'Remotion exited 0 but post.mp4 was not produced.'});
    process.exit(1);
  }

  // ─── Step 2.5: Loudness normalisation (EBU R128 −14 LUFS / −1.5 dBTP) ───
  const LUFS_TARGET = -14;
  const LUFS_TP_TARGET = -1.5;
  const LUFS_TOLERANCE = 1.5;
  try {
    console.log('[render-post] loudnorm pass 1: measuring…');
    const p1 = spawnSync('ffmpeg', [
      '-i', postMp4,
      '-af', `loudnorm=I=${LUFS_TARGET}:TP=${LUFS_TP_TARGET}:LRA=11:print_format=json`,
      '-f', 'null', '-',
    ], {encoding: 'utf8', timeout: 120_000});
    const combined1 = `${p1.stdout ?? ''}\n${p1.stderr ?? ''}`;
    const match1 = combined1.match(/\{[\s\S]*?\}/);
    if (!match1) throw new Error('loudnorm pass 1: no JSON in output');
    const ln = JSON.parse(match1[0]);
    console.log(`[render-post] measured I=${ln.input_i} LUFS, TP=${ln.input_tp} dBTP`);

    const normMp4 = join(outputDir, 'post-norm.mp4');
    const filter = [
      `loudnorm=I=${LUFS_TARGET}:TP=${LUFS_TP_TARGET}:LRA=11`,
      `measured_I=${ln.input_i}:measured_TP=${ln.input_tp}`,
      `measured_LRA=${ln.input_lra}:measured_thresh=${ln.input_thresh}`,
      `offset=${ln.target_offset}:linear=true:print_format=summary`,
    ].join(':');
    const p2 = spawnSync('ffmpeg', [
      '-i', postMp4,
      '-af', filter,
      '-c:v', 'copy',
      '-y', normMp4,
    ], {encoding: 'utf8', timeout: 120_000});
    if (p2.status !== 0) throw new Error(`ffmpeg pass 2 exited ${p2.status}`);

    renameSync(normMp4, postMp4);

    const postLufs = measureLufs(postMp4);
    if (postLufs !== null) {
      const delta = Math.abs(postLufs - LUFS_TARGET);
      const ok = delta <= LUFS_TOLERANCE;
      console.log(`[render-post] loudness ${ok ? 'OK' : 'WARNING'}: ${postLufs.toFixed(1)} LUFS (Δ${delta.toFixed(1)} LU)`);
    }
  } catch (err) {
    console.warn(`[render-post] loudness normalisation failed (non-fatal): ${err.message}`);
  }

  // ─── Step 3: SRT sidecar ─────────────────────────────────────────────────
  const postSrt = join(outputDir, 'post.srt');
  try {
    writeFileSync(postSrt, buildSrt(props));
    console.log(`[render-post] wrote ${postSrt}`);
  } catch (err) {
    console.warn(`[render-post] SRT write failed (non-fatal): ${err.message}`);
  }

  // ─── Step 4: Duration check ───────────────────────────────────────────────
  const renderedMs = measureMs(postMp4);
  const voTotalMs = props.shots.reduce((acc, s) => acc + s.audioDurationMs, 0);

  if (renderedMs === null) {
    console.warn('[render-post] could not measure rendered duration');
  } else {
    const delta = Math.abs(renderedMs - voTotalMs);
    if (delta > 1000) {
      const msg = `Rendered ${renderedMs}ms differs from VO total ${voTotalMs}ms by ${delta}ms`;
      console.error(`[render-post] duration check FAILED: ${msg}`);
      writeResult('failed', {
        video: postMp4,
        duration_ms: renderedMs,
        captions: postSrt,
        error: msg,
      });
      process.exit(1);
    }
    console.log(`[render-post] duration OK: rendered=${renderedMs}ms VO=${voTotalMs}ms Δ=${delta}ms`);
  }

  // ─── Step 5: Write result ─────────────────────────────────────────────────
  writeResult('done', {
    video: postMp4,
    duration_ms: renderedMs ?? voTotalMs,
    captions: postSrt,
    voice_id: voiceId,
  });
  console.log(`[render-post] done → ${resultPath}`);
};

main().catch((err) => {
  console.error('[render-post] unexpected error:', err);
  process.exit(1);
});
