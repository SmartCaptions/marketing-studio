#!/usr/bin/env node
/**
 * build-post-props.mjs — props builder for HybridPost.
 *
 * Reads a job.json (schema_version 1, HybridPost contract), calls ElevenLabs
 * /v1/text-to-speech/{voice}/with-timestamps for each shot's narration, saves
 * audio to the job's output_dir, derives phrase-level caption cues and step-pop
 * frames, then writes post-props.json.
 *
 * Usage:
 *   node scripts/build-post-props.mjs --job <abs-path/job.json> [--out-dir <dir>]
 *
 * Exports buildPostProps() for use by render-post.mjs.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {dirname, basename, join, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {readEnv, getVoiceId, callTtsWithTimestamps, groupToPhrases, MODEL_FOR_LANG} from './lib/tts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_PUBLIC = join(ROOT, 'studio', 'public');

const SCHEMA_VERSION = 1;

// Gap added to every shot (ms) so adjacent shots don't cut
const GAP_MS = 250;
// Extra hold on the end shot
const END_HOLD_MS = 2000;

// ─────────────────────────────────────────────────────────────────────────────
// Job validation
// ─────────────────────────────────────────────────────────────────────────────

/** @param {object} job — parsed JSON */
const validateJob = (job) => {
  if (job.schema_version !== SCHEMA_VERSION)
    throw new Error(`schema_version must be ${SCHEMA_VERSION}, got ${job.schema_version}`);
  if (!job.id || typeof job.id !== 'string')
    throw new Error('job.id is required (string)');
  if (job.language !== 'he' && job.language !== 'en')
    throw new Error(`job.language must be "he" or "en", got "${job.language}"`);
  if (job.look !== 'studio' && job.look !== 'collage')
    throw new Error(`job.look must be "studio" or "collage", got "${job.look}"`);
  if (!Array.isArray(job.shots) || job.shots.length < 1 || job.shots.length > 10)
    throw new Error('job.shots must be an array with 1–10 entries');
  if (!job.output_dir || typeof job.output_dir !== 'string')
    throw new Error('job.output_dir is required (absolute path)');

  const VALID_KINDS = new Set([
    'title', 'chat', 'steps', 'compare', 'question',
    'recording', 'screenshot', 'clip', 'end',
  ]);

  for (let i = 0; i < job.shots.length; i++) {
    const s = job.shots[i];
    if (!VALID_KINDS.has(s.kind))
      throw new Error(`shots[${i}].kind "${s.kind}" is not a valid kind`);
    if (!s.narration || typeof s.narration !== 'string' || s.narration.trim() === '')
      throw new Error(`shots[${i}].narration is required and must be non-empty`);
    if (['recording', 'screenshot', 'clip'].includes(s.kind) && !s.media)
      throw new Error(`shots[${i}] (kind="${s.kind}") requires .media (absolute path)`);
    if (['recording', 'screenshot', 'clip'].includes(s.kind) && s.media) {
      if (!existsSync(s.media))
        throw new Error(`shots[${i}].media not found: ${s.media}`);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Step-pop frame calculator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For a steps shot: map each item to the frame where its first word is spoken,
 * using the caption phrase cues. Falls back to an evenly-spaced schedule.
 *
 * @param {string[]} items
 * @param {Array<{text: string, fromMs: number, toMs: number}>} captions
 * @param {number} durationMs
 * @param {number} fps
 * @returns {number[]}
 */
const calcStepPopFrames = (items, captions, durationMs, fps) => {
  if (!items || items.length === 0) return [];
  if (!captions || captions.length === 0) {
    // Even spacing over 70% of the shot
    return items.map((_, i) =>
      Math.round((i / Math.max(1, items.length - 1)) * (durationMs * 0.7) * fps / 1000),
    );
  }

  return items.map((item, idx) => {
    // Find the first word of this item in the caption stream
    const firstWord = item.trim().split(/\s+/)[0].replace(/[.,;:!?]/g, '');
    const match = captions.find(
      (c) => c.text.includes(firstWord) || c.text.startsWith(item.slice(0, 4)),
    );
    if (match) return Math.floor((match.fromMs / 1000) * fps);
    // Fall back: spread evenly
    return Math.round((idx / Math.max(1, items.length - 1)) * (durationMs * 0.7) * fps / 1000);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Narration helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{narration: string, shotIndex: number, voiceId: string, modelId: string,
 *           apiKey: string, postPublicDir: string}} opts
 * @returns {Promise<{audioRelative: string, durationMs: number, captions: Array}>}
 */
const processNarration = async ({narration, shotIndex, voiceId, modelId, apiKey, postPublicDir}) => {
  console.log(`[build-post-props] shot ${shotIndex}: TTS "${narration.slice(0, 60)}…"`);

  const {audioBuffer, alignment, durationMs} = await callTtsWithTimestamps(
    narration, voiceId, modelId, apiKey,
  );

  const audioAbs = join(postPublicDir, `shot-${shotIndex}.mp3`);
  writeFileSync(audioAbs, audioBuffer);
  const audioRelative = relative(STUDIO_PUBLIC, audioAbs);

  const captions = alignment
    ? groupToPhrases(
        alignment.characters,
        alignment.character_start_times_seconds,
        alignment.character_end_times_seconds,
      )
    : [];

  console.log(`[build-post-props] shot ${shotIndex}: ${durationMs}ms, ${captions.length} phrases`);
  return {audioRelative, durationMs, captions};
};

// ─────────────────────────────────────────────────────────────────────────────
// Media helper
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Stage a media file for a shot.
 *
 * When `crop` and timing params are provided, uses ffmpeg to extract just the
 * needed segment and apply the crop filter, producing a smaller file that
 * contains exactly the pixels the component needs. The component then renders
 * it at `objectFit: cover` with no CSS transforms required.
 *
 * When no crop/trim is needed, falls back to a plain file copy.
 *
 * Returns { mediaRelative, mediaCropped }:
 *   mediaCropped — true when the staged file is already cropped/trimmed so the
 *                  component should render it full-frame (start_s=0, no crop).
 */
const stageMedia = (absPath, shotIndex, ext, postPublicDir, {crop, startS, endS} = {}) => {
  const destName = `shot-${shotIndex}-media.${ext}`;
  const destAbs = join(postPublicDir, destName);

  if (crop && Array.isArray(crop) && crop.length === 4) {
    const [x0, y0, x1, y1] = crop;
    const cw = x1 - x0;
    const ch = y1 - y0;
    const ffArgs = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (startS !== undefined && startS > 0) ffArgs.push('-ss', String(startS));
    ffArgs.push('-i', absPath);
    if (endS !== undefined && startS !== undefined) {
      ffArgs.push('-t', String(endS - startS));
    } else if (endS !== undefined) {
      ffArgs.push('-t', String(endS));
    }
    ffArgs.push(
      '-filter:v', `crop=${cw}:${ch}:${x0}:${y0}`,
      '-an',
      '-c:v', 'libx264', '-preset', 'ultrafast',
      destAbs,
    );
    const result = spawnSync('ffmpeg', ffArgs, {timeout: 120_000, encoding: 'utf8'});
    if (result.status === 0 && existsSync(destAbs)) {
      console.log(`[build-post-props] shot ${shotIndex}: pre-cropped media (${cw}×${ch}) → ${destName}`);
      return {mediaRelative: relative(STUDIO_PUBLIC, destAbs), mediaCropped: true};
    }
    console.warn(`[build-post-props] shot ${shotIndex}: ffmpeg crop failed, falling back to copy`);
    console.warn(result.stderr?.slice(0, 400));
  }

  copyFileSync(absPath, destAbs);
  return {mediaRelative: relative(STUDIO_PUBLIC, destAbs), mediaCropped: false};
};

// ─────────────────────────────────────────────────────────────────────────────
// Wordmark staging
// ─────────────────────────────────────────────────────────────────────────────
const WORDMARK_SOURCE = '/home/moc/video-factory/brand-packs/smartcaptions/assets/smartcaptions-wordmark.png';
const WORDMARK_DEST_REL = 'smartcaptions/wordmark.png';

const stageWordmark = (postPublicDir) => {
  const destAbs = join(STUDIO_PUBLIC, WORDMARK_DEST_REL);
  if (!existsSync(destAbs)) {
    if (existsSync(WORDMARK_SOURCE)) {
      mkdirSync(join(STUDIO_PUBLIC, 'smartcaptions'), {recursive: true});
      copyFileSync(WORDMARK_SOURCE, destAbs);
      console.log('[build-post-props] staged wordmark to', destAbs);
    } else {
      console.warn('[build-post-props] wordmark source not found; end card will omit it');
      return null;
    }
  }
  return WORDMARK_DEST_REL;
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export const buildPostProps = async ({jobPath, outDirOverride, apiKeyOverride} = {}) => {
  // 1. Load and validate job
  const job = JSON.parse(readFileSync(resolve(jobPath), 'utf8'));
  validateJob(job);

  const outputDir = resolve(outDirOverride ?? job.output_dir);
  mkdirSync(outputDir, {recursive: true});

  // 2. API key and voice
  const env = readEnv(ROOT);
  const apiKey = apiKeyOverride ?? env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set in .env');

  const brandJson = JSON.parse(readFileSync(join(ROOT, 'brands', 'smartcaptions.json'), 'utf8'));
  const voiceId = getVoiceId(brandJson, job.language);
  const modelId = MODEL_FOR_LANG[job.language];
  console.log(`[build-post-props] language=${job.language} voice=${voiceId} model=${modelId}`);

  // 3. Public media dir — derive a unique staging directory from job.id AND the
  //    last segment of output_dir so two jobs sharing the same id (but different
  //    output dirs) never overwrite each other's staged files.
  const outDirLeaf = resolve(outputDir).split('/').filter(Boolean).pop() ?? 'out';
  const postId = `${job.id ?? `post-${Date.now()}`}--${outDirLeaf}`;
  const postPublicDir = join(STUDIO_PUBLIC, 'posts', postId);
  mkdirSync(postPublicDir, {recursive: true});

  // 4. Stage wordmark
  const wordmarkSrc = stageWordmark(postPublicDir);

  // 5. Process shots
  const processedShots = [];
  const fps = 30;

  for (let i = 0; i < job.shots.length; i++) {
    const shot = job.shots[i];
    const isEnd = shot.kind === 'end';

    // TTS narration
    const {audioRelative, durationMs: narrationMs, captions} = await processNarration({
      narration: shot.narration,
      shotIndex: i,
      voiceId,
      modelId,
      apiKey,
      postPublicDir,
    });

    // Duration = narration + gap, end shot gets extra hold
    const durationMs = narrationMs + GAP_MS + (isEnd ? END_HOLD_MS : 0);

    // Stage media if present — pre-crop with ffmpeg when crop+timing are given
    let mediaRelative = null;
    let mediaCropped = false;
    if (shot.media) {
      const ext = shot.media.split('.').pop() ?? 'mp4';
      ({mediaRelative, mediaCropped} = stageMedia(shot.media, i, ext, postPublicDir, {
        crop: shot.crop ?? undefined,
        startS: shot.start_s ?? undefined,
        endS: shot.end_s ?? undefined,
      }));
    }

    // Steps: compute pop frames
    const stepPopFrames =
      shot.kind === 'steps' && shot.lines
        ? calcStepPopFrames(shot.lines, captions, durationMs, fps)
        : undefined;

    processedShots.push({
      kind: shot.kind,
      narration: shot.narration,
      heading: shot.heading ?? undefined,
      highlight: shot.highlight ?? undefined,
      lines: shot.lines ?? undefined,
      sender: shot.sender ?? undefined,
      crossed: shot.crossed ?? undefined,
      left: shot.left ?? undefined,
      right: shot.right ?? undefined,
      media: mediaRelative,
      // When media is pre-cropped: the staged file starts at t=0.
      // Set end_s to the staged clip's actual duration (endS - startS) so the
      // component can slow it down to fill the narration if needed.
      start_s: mediaCropped ? 0 : (shot.start_s ?? undefined),
      end_s: mediaCropped
        ? ((shot.end_s ?? 0) - (shot.start_s ?? 0))
        : (shot.end_s ?? undefined),
      crop: mediaCropped ? undefined : (shot.crop ?? undefined),
      mediaCropped,
      label: shot.label ?? undefined,
      note: shot.note ?? undefined,
      audioSrc: audioRelative,
      audioDurationMs: durationMs,
      captions,
      ...(stepPopFrames ? {stepPopFrames} : {}),
    });
  }

  // 6. Assemble props
  const props = {
    brandId: 'smartcaptions',
    language: job.language,
    look: job.look,
    aiDisclosure: job.ai_disclosure ?? false,
    wordmarkSrc,
    attribution: job.attribution ?? null,
    shots: processedShots,
  };

  // 7. Write
  const propsPath = join(outputDir, 'post-props.json');
  writeFileSync(propsPath, JSON.stringify(props, null, 2));
  console.log(`[build-post-props] wrote props to ${propsPath}`);

  return {propsPath, props, voiceId};
};

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const jobIdx = args.indexOf('--job');
  const outDirIdx = args.indexOf('--out-dir');
  const jobPath = jobIdx >= 0 ? args[jobIdx + 1] : null;
  const outDirOverride = outDirIdx >= 0 ? args[outDirIdx + 1] : null;

  if (!jobPath) {
    console.error('Usage: node scripts/build-post-props.mjs --job <abs-path/job.json>');
    process.exit(1);
  }

  buildPostProps({jobPath, outDirOverride}).then(() => process.exit(0)).catch((err) => {
    console.error('[build-post-props] FAILED:', err.message);
    process.exit(1);
  });
}
