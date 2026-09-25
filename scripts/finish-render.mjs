#!/usr/bin/env node
/**
 * finish-render.mjs — renders a finishing work directory with the Finish composition.
 *
 * Usage (from anywhere):
 *   node <marketing-studio>/scripts/finish-render.mjs --work <abs dir> --frames 0,45,300
 *   node <marketing-studio>/scripts/finish-render.mjs --work <abs dir> --frames every:30
 *   node <marketing-studio>/scripts/finish-render.mjs --work <abs dir> --final
 *
 * The work directory holds props.json (finish-prepare.mjs), words.json and src/Visuals.tsx
 * (written by the finishing session). --frames writes PNG stills to <work>/frames/ to look at;
 * --final writes <work>/out/video.mp4 (loudness-normalised) with video.srt and
 * <work>/out/result.json in the contracts.md §2 shape, plus `ai_media`, `uses` and `words`.
 */
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
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
    writeResult({
      status: 'done',
      video,
      duration_ms: renderedMs,
      captions,
      ai_media: composition.props.aiDisclosure,
      uses: composition.props.uses,
      words: inputProps.words,
    });
    console.log(`done: ${video} (${renderedMs} ms; AI label ${composition.props.aiDisclosure ? 'on' : 'off'})`);
  } catch (err) {
    writeResult({status: 'failed', error: `The final render failed: ${err.message.slice(0, 600)}`});
    throw err;
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const arg = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : null);
  const work = arg('--work');
  const frames = arg('--frames');
  const final = args.includes('--final');
  if (!work || !isAbsolute(work) || (!frames && !final) || (frames && final)) {
    console.error('Usage: finish-render.mjs --work <abs dir> (--frames <n,n,…|every:n> | --final)');
    process.exit(2);
  }
  if (!existsSync(join(work, 'props.json'))) {
    console.error(`${work} is not a finishing work directory (no props.json)`);
    process.exit(2);
  }
  if (final) await renderFinal(work);
  else await renderFrames(work, frames);
};

main().catch((err) => {
  console.error(err instanceof FinishError ? err.message : `finish-render failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
