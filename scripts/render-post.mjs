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
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPostProps} from './build-post-props.mjs';
import {buildSrt, measureMs, normaliseLoudness} from './lib/post-output.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_DIR = join(ROOT, 'studio');

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
  let propsPath, props, voiceId, music, musicAbsentReason;
  try {
    console.log('[render-post] building props…');
    ({propsPath, props, voiceId, music, musicAbsentReason} = await buildPostProps({jobPath: jobAbs}));
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
  normaliseLoudness(postMp4, 'render-post');

  // ─── Step 3: SRT sidecar ─────────────────────────────────────────────────
  const postSrt = join(outputDir, 'post.srt');
  try {
    writeFileSync(postSrt, buildSrt(props));
    console.log(`[render-post] wrote ${postSrt}`);
  } catch (err) {
    console.warn(`[render-post] SRT write failed (non-fatal): ${err.message}`);
  }

  // ─── Step 4: Duration check ───────────────────────────────────────────────
  const renderedMs = measureMs(postMp4, STUDIO_DIR);
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
    music: music ? {src: music.src} : null,
    music_absent_reason: music ? null : (musicAbsentReason ?? null),
  });
  console.log(`[render-post] done → ${resultPath}`);
};

main().catch((err) => {
  console.error('[render-post] unexpected error:', err);
  process.exit(1);
});
