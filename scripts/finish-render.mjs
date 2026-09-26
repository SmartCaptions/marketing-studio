#!/usr/bin/env node
/**
 * finish-render.mjs — renders a finishing work directory with the Finish composition.
 *
 * Usage (from anywhere):
 *   node <marketing-studio>/scripts/finish-render.mjs --work <abs dir> --frames 0,45,300
 *   node <marketing-studio>/scripts/finish-render.mjs --work <abs dir> --frames every:30
 *   node <marketing-studio>/scripts/finish-render.mjs --work <abs dir> --final
 *   node <marketing-studio>/scripts/finish-render.mjs --work <abs dir> --media
 *
 * The work directory holds props.json (finish-prepare.mjs), words.json and src/Visuals.tsx
 * (written by the finishing session). --frames writes PNG stills to <work>/frames/ to look at;
 * --final writes <work>/out/video.mp4 (loudness-normalised) with video.srt and
 * <work>/out/result.json in the contracts.md §2 shape, plus `ai_media`, `uses` and `words`;
 * --media writes one still of each staged recording, screenshot or clip to <work>/media-frames/,
 * so the session can see its footage.
 */
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findLiteralText} from './lib/finish-lint.mjs';
import {buildSrt, measureMs, normaliseLoudness} from './lib/post-output.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_DIR = join(ROOT, 'studio');
const studioRequire = createRequire(join(STUDIO_DIR, 'package.json'));

class FinishError extends Error {}

const readJson = (file, what) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new FinishError(`${what} (${file}) is missing or not valid JSON: ${err.message}`);
  }
};

const VALID_SFX_KINDS = new Set(['whoosh', 'tick', 'riser', 'intro', 'swipe', 'closing']);

/**
 * Read and validate cues.json from the work directory when present.
 * Returns the validated cue array (possibly empty). Invalid cues are skipped with a warning.
 */
const loadCues = (work) => {
  const cuePath = join(work, 'cues.json');
  if (!existsSync(cuePath)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(cuePath, 'utf8'));
  } catch {
    console.warn('[finish-render] cues.json is not valid JSON — ignoring');
    return [];
  }
  if (!Array.isArray(raw)) {
    console.warn('[finish-render] cues.json must be an array — ignoring');
    return [];
  }
  const valid = [];
  for (const c of raw) {
    if (typeof c.kind !== 'string' || !VALID_SFX_KINDS.has(c.kind) || typeof c.frame !== 'number' || c.frame < 0) {
      console.warn(`[finish-render] cues.json: skipping invalid cue ${JSON.stringify(c)}`);
      continue;
    }
    valid.push({kind: c.kind, frame: Math.round(c.frame)});
  }
  return valid;
};

/** Loads the work directory and refuses one the Finish composition cannot render truthfully */
const loadWork = (work) => {
  const props = readJson(join(work, 'props.json'), 'props.json');
  const words = readJson(join(work, 'words.json'), 'words.json');
  if (typeof words !== 'object' || Array.isArray(words) || Object.values(words).some((v) => typeof v !== 'string')) {
    throw new FinishError('words.json must be one object of key → text');
  }
  if (!existsSync(join(work, 'src', 'Visuals.tsx'))) throw new FinishError('src/Visuals.tsx is missing');
  const literals = findLiteralText(join(work, 'src'), STUDIO_DIR);
  if (literals.length) {
    throw new FinishError(`Shown text must come from words.json through <T k="…"/> or useWord():\n${literals.join('\n')}`);
  }
  // Merge session-declared cues: these override the empty default from prepare.
  const cues = loadCues(work);
  if (cues.length) {
    console.log(`[finish-render] loaded ${cues.length} sfx cue(s) from cues.json`);
    props.sfxCues = cues;
    props.sfxEnabled = props.sfxEnabled && cues.length > 0;
  }
  return {...props, words};
};

const bundleWork = async (work) => {
  const {bundle} = studioRequire('@remotion/bundler');
  const outDir = join(work, '.bundle');
  rmSync(outDir, {recursive: true, force: true});
  return bundle({
    entryPoint: join(STUDIO_DIR, 'src', 'finish', 'index.tsx'),
    outDir,
    publicDir: join(work, 'public'),
    // Each work directory brings its own code under the same import name, so no shared cache
    enableCaching: false,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...(config.resolve?.alias ?? {}),
          '@work': join(work, 'src'),
          '@kit': join(STUDIO_DIR, 'src', 'finish', 'kit.tsx'),
        },
        modules: [...(config.resolve?.modules ?? ['node_modules']), join(STUDIO_DIR, 'node_modules')],
      },
    }),
  });
};

const frameList = (spec, total) => {
  if (spec.startsWith('every:')) {
    const step = Number(spec.slice('every:'.length));
    if (!Number.isInteger(step) || step < 1) throw new FinishError('--frames every:<n> needs a whole number of frames');
    const frames = [];
    for (let f = 0; f < total; f += step) frames.push(f);
    return frames;
  }
  const frames = spec.split(',').map((f) => Number(f.trim()));
  if (frames.some((f) => !Number.isInteger(f) || f < 0 || f >= total)) {
    throw new FinishError(`--frames takes whole frame numbers from 0 to ${total - 1}`);
  }
  return frames;
};

const renderFrames = async (work, spec) => {
  const inputProps = loadWork(work);
  const {openBrowser, renderStill, selectComposition} = studioRequire('@remotion/renderer');
  const serveUrl = await bundleWork(work);
  const browser = await openBrowser('chrome');
  try {
    const composition = await selectComposition({serveUrl, id: 'Finish', inputProps, puppeteerInstance: browser});
    const frames = frameList(spec, composition.durationInFrames);
    const dir = join(work, 'frames');
    mkdirSync(dir, {recursive: true});
    for (const frame of frames) {
      const output = join(dir, `f${String(frame).padStart(5, '0')}.png`);
      await renderStill({composition, serveUrl, output, frame, inputProps, puppeteerInstance: browser});
      console.log(output);
    }
    console.log(`${frames.length} frame(s) of ${composition.durationInFrames}; media used: ${composition.props.uses.join(', ') || 'none'}; AI label: ${composition.props.aiDisclosure ? 'on' : 'off'}`);
  } finally {
    await browser.close({silent: true});
  }
};

/** One still per staged media: the middle of a recording or clip, a screenshot as it is */
const renderMediaFrames = (work) => {
  const {media} = readJson(join(work, 'props.json'), 'props.json');
  const dir = join(work, 'media-frames');
  mkdirSync(dir, {recursive: true});
  for (const [key, item] of Object.entries(media)) {
    const source = join(work, 'public', item.src);
    const output = join(dir, `${key}.png`);
    if (item.kind === 'screenshot') {
      copyFileSync(source, output);
    } else {
      const at = String((item.durationS ?? 0) / 2);
      const proc = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', at, '-i', source, '-frames:v', '1', output], {timeout: 60_000});
      if (proc.status !== 0) throw new FinishError(`could not take a still of ${key}`);
    }
    console.log(`${output} — ${item.kind}${item.ai ? ', AI' : ''}: ${item.shows}`);
  }
};

const renderFinal = async (work) => {
  const outDir = join(work, 'out');
  mkdirSync(outDir, {recursive: true});
  const resultPath = join(outDir, 'result.json');
  const writeResult = (fields) =>
    writeFileSync(resultPath, JSON.stringify({schema_version: 1, video: null, duration_ms: null, captions: null, error: null, ...fields}, null, 2));
  try {
    const inputProps = loadWork(work);
    const {renderMedia, selectComposition} = studioRequire('@remotion/renderer');
    const serveUrl = await bundleWork(work);
    const composition = await selectComposition({serveUrl, id: 'Finish', inputProps});
    const video = join(outDir, 'video.mp4');
    await renderMedia({composition, serveUrl, codec: 'h264', audioCodec: 'aac', outputLocation: video, inputProps, overwrite: true});
    normaliseLoudness(video, 'finish-render');
    const captions = join(outDir, 'video.srt');
    writeFileSync(captions, buildSrt(inputProps));
    const expectedMs = Math.round((composition.durationInFrames / composition.fps) * 1000);
    const renderedMs = measureMs(video, STUDIO_DIR);
    if (renderedMs === null || Math.abs(renderedMs - expectedMs) > 1000) {
      throw new FinishError(`the rendered video lasts ${renderedMs ?? 'an unknown time'} ms, not the voice-over's ${expectedMs} ms`);
    }
    const musicPresent = Boolean(inputProps.music);
    const musicAbsentReason = inputProps.musicAbsentReason ?? null;
    // Count only cues whose sfx file was actually staged into the work dir's public/sfx.
    // A cue without a matching file is skipped silently by Remotion, so the count must
    // reflect what the video actually plays, not what cues.json declared.
    const sfxPublicDir = join(work, 'public', 'sfx');
    const rawCues = inputProps.sfxCues ?? [];
    const sfxCues = rawCues.filter((c) => existsSync(join(sfxPublicDir, `${c.kind}.mp3`)));
    const sfxAbsentReason = sfxCues.length === 0
      ? (rawCues.length > 0 || inputProps.sfxEnabled === false ? 'sfx library not staged' : 'no cues declared')
      : null;
    writeResult({
      status: 'done',
      video,
      duration_ms: renderedMs,
      captions,
      ai_media: composition.props.aiDisclosure,
      uses: composition.props.uses,
      words: inputProps.words,
      music: musicPresent ? {src: inputProps.music.src} : null,
      music_absent_reason: musicPresent ? null : musicAbsentReason,
      sfx_cues: sfxCues.map((c) => ({kind: c.kind, frame: c.frame})),
      sfx_absent_reason: sfxAbsentReason,
    });
    console.log(
      `done: ${video} (${renderedMs} ms; AI label ${composition.props.aiDisclosure ? 'on' : 'off'}; ` +
      `music ${musicPresent ? 'present' : `absent: ${musicAbsentReason}`}; ` +
      `sfx cues: ${sfxCues.length})`,
    );
  } catch (err) {
    writeResult({status: 'failed', error: `The final render failed: ${err.message.slice(0, 600)}`});
    throw err;
  }
};

const main = async () => {
  // Remotion keeps its headless browser beside the nearest package.json; from a work directory
  // it would download one per video
  process.chdir(STUDIO_DIR);
  const args = process.argv.slice(2);
  const arg = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : null);
  const work = arg('--work');
  const frames = arg('--frames');
  const final = args.includes('--final');
  const media = args.includes('--media');
  if (!work || !isAbsolute(work) || [Boolean(frames), final, media].filter(Boolean).length !== 1) {
    console.error('Usage: finish-render.mjs --work <abs dir> (--frames <n,n,…|every:n> | --final | --media)');
    process.exit(2);
  }
  if (!existsSync(join(work, 'props.json'))) {
    console.error(`${work} is not a finishing work directory (no props.json)`);
    process.exit(2);
  }
  if (final) await renderFinal(work);
  else if (media) renderMediaFrames(work);
  else await renderFrames(work, frames);
};

main().catch((err) => {
  console.error(err instanceof FinishError ? err.message : `finish-render failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
