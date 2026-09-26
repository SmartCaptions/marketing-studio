#!/usr/bin/env node
/**
 * finish-prepare.mjs — sets up a finishing work directory for one directed video.
 *
 * Usage (from marketing-studio root):
 *   node scripts/finish-prepare.mjs --job <abs job.json> --work <abs dir>
 *   node scripts/finish-prepare.mjs --work <abs dir> --add <abs media.json>
 *
 * The job is the HybridPost job (docs/content-factory/contracts.md §5), optionally with
 * `extra_media` the session may also use. This voices every line (ElevenLabs, with word timings),
 * stages the media into <work>/public, and writes <work>/props.json for the Finish composition.
 * The session then writes <work>/src/Visuals.tsx and <work>/words.json and renders with
 * finish-render.mjs. --add stages more media (the night's clips, as `[{key, path, kind, ai, label,
 * shows}]`) into an existing work directory and adds them to its props.json.
 *
 * Prints one JSON line: {"status": "ready"|"failed", "props": path|null, "error": string|null}
 */
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPostProps, stageMedia} from './build-post-props.mjs';
import {effectGains, generatePostMusic} from './lib/postMusic.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Pixel size and length of staged media; a still has no length */
const probe = (file) => {
  const proc = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json', file,
  ], {encoding: 'utf8', timeout: 60_000});
  if (proc.status !== 0) throw new Error(`ffprobe could not read ${file}`);
  const info = JSON.parse(proc.stdout);
  const stream = info.streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error(`${file} has no picture`);
  const duration = Number(info.format?.duration);
  const still = /\.(png|jpe?g|webp)$/i.test(file);
  return {width: stream.width, height: stream.height, durationS: still || !isFinite(duration) ? null : duration};
};

const mediaKind = (kind) => (kind === 'screenshot' ? 'screenshot' : kind === 'clip' ? 'clip' : 'recording');

/** Stage media beyond the director's picks into public/<folder>, keyed as given */
const stageExtra = (entries, publicRoot, folder) => {
  const stagedDir = join(publicRoot, folder);
  mkdirSync(stagedDir, {recursive: true});
  const media = {};
  entries.forEach((extra, n) => {
    if (!existsSync(extra.path)) throw new Error(`media not found: ${extra.path}`);
    const ext = extra.path.split('.').pop() ?? 'mp4';
    const {mediaRelative} = stageMedia(extra.path, `${folder}${n + 1}`, ext, stagedDir, {
      crop: extra.crop ?? undefined,
      startS: extra.start_s ?? undefined,
      endS: extra.end_s ?? undefined,
    }, publicRoot);
    media[extra.key ?? `${folder}${n + 1}`] = {
      src: mediaRelative,
      kind: mediaKind(extra.kind),
      ai: extra.ai === true,
      label: extra.label ?? null,
      ...probe(join(publicRoot, mediaRelative)),
      shows: extra.shows ?? extra.label ?? extra.kind,
    };
  });
  return media;
};

/** Add media (the night's clips) to a prepared work directory */
export const addMedia = ({workDir, mediaPath}) => {
  const propsPath = join(workDir, 'props.json');
  const props = JSON.parse(readFileSync(propsPath, 'utf8'));
  props.media = {...props.media, ...stageExtra(JSON.parse(readFileSync(mediaPath, 'utf8')), join(workDir, 'public'), 'night')};
  writeFileSync(propsPath, JSON.stringify(props, null, 2));
  return propsPath;
};

export const prepareFinish = async ({jobPath, workDir}) => {
  const job = JSON.parse(readFileSync(jobPath, 'utf8'));
  const publicRoot = join(workDir, 'public');
  mkdirSync(publicRoot, {recursive: true});
  mkdirSync(join(workDir, 'src'), {recursive: true});

  const {props: post} = await buildPostProps({jobPath, outDirOverride: workDir, publicRoot});

  const media = {};
  const shots = post.shots.map((shot, i) => {
    const source = job.shots[i];
    let key;
    if (shot.media) {
      key = `line${i + 1}`;
      media[key] = {
        src: shot.media,
        kind: mediaKind(source.kind),
        ai: source.kind === 'clip',
        // A shortened recording says so, beside its real-recording label
        label: [source.label, source.note].filter(Boolean).join(' · ') || null,
        ...probe(join(publicRoot, shot.media)),
        shows: source.shows ?? source.label ?? source.kind,
      };
    }
    return {
      narration: shot.narration,
      audioSrc: shot.audioSrc,
      audioDurationMs: shot.audioDurationMs,
      captions: shot.captions,
      words: shot.words,
      plan: {
        kind: source.kind,
        ...(source.heading ? {heading: source.heading} : {}),
        ...(source.highlight ? {highlight: source.highlight} : {}),
        ...(source.lines ? {lines: source.lines} : {}),
        ...(key ? {media: key} : {}),
      },
    };
  });

  Object.assign(media, stageExtra(job.extra_media ?? [], publicRoot, 'extra'));

  // Stage the sfx library from studio/public/sfx into the work dir's public/sfx so
  // finish-render.mjs can serve it via staticFile().  The studio library is built once
  // by scripts/build-sfx.mjs; when it is absent the video renders without effects.
  const studioSfxDir = join(ROOT, 'studio', 'public', 'sfx');
  const workSfxDir = join(publicRoot, 'sfx');
  if (existsSync(join(studioSfxDir, 'intro.mp3'))) {
    mkdirSync(workSfxDir, {recursive: true});
    for (const f of readdirSync(studioSfxDir).filter((f) => f.endsWith('.mp3'))) {
      copyFileSync(join(studioSfxDir, f), join(workSfxDir, f));
    }
  }

  // Generate music before the session starts (session must not make network calls; INV-G4).
  const totalDurationMs = shots.reduce((acc, s) => acc + s.audioDurationMs, 0);
  const {music, musicAbsentReason} = await generatePostMusic({
    postPublicDir: publicRoot,
    publicRoot,
    totalDurationMs,
    language: post.language,
    look: post.look,
    postType: job.post_type,
    root: ROOT,
    voiceFiles: shots.map((s) => join(publicRoot, s.audioSrc)),
  });
  if (musicAbsentReason) {
    console.warn(`[finish-prepare] music absent: ${musicAbsentReason}`);
  }

  // sfxEnabled: true when the library was successfully staged into this work dir.
  const sfxEnabled = existsSync(join(workSfxDir, 'intro.mp3'));

  const props = {
    brandId: post.brandId,
    language: post.language,
    look: post.look,
    wordmarkSrc: post.wordmarkSrc,
    attribution: post.attribution,
    shots,
    media,
    words: {},
    uses: [],
    aiDisclosure: false,
    music,
    musicAbsentReason: musicAbsentReason ?? null,
    sfxEnabled,
    ...(sfxEnabled ? {sfxGains: effectGains({sfxDir: workSfxDir, voiceFiles: shots.map((s) => join(publicRoot, s.audioSrc))})} : {}),
    sfxCues: [],
  };
  const propsPath = join(workDir, 'props.json');
  writeFileSync(propsPath, JSON.stringify(props, null, 2));
  return propsPath;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : null);
  const jobPath = arg('--job');
  const workDir = arg('--work');
  const addPath = arg('--add');
  if (!workDir || (!jobPath && !addPath)) {
    console.error('Usage: node scripts/finish-prepare.mjs (--job <abs job.json> | --add <abs media.json>) --work <abs dir>');
    process.exit(1);
  }
  const step = addPath
    ? Promise.resolve().then(() => addMedia({workDir: resolve(workDir), mediaPath: resolve(addPath)}))
    : prepareFinish({jobPath: resolve(jobPath), workDir: resolve(workDir)});
  step
    .then((props) => console.log(JSON.stringify({status: 'ready', props, error: null})))
    .catch((err) => {
      console.log(JSON.stringify({status: 'failed', props: null, error: `Preparing the video failed: ${err.message}`}));
      process.exit(1);
    });
}
