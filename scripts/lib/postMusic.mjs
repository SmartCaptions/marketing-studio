/**
 * scripts/lib/postMusic.mjs — music generation for directed-video (HybridPost / Finish) props.
 *
 * One music call per video, cached on disk in the post's public directory. The cache is keyed
 * by duration (±1 s), look, and language. Re-renders with the same look/language/duration reuse
 * the existing file without a second API call.
 *
 * Any failure is non-fatal: the caller records the reason, and the video renders voice-only.
 */
import {copyFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {spawnSync} from 'node:child_process';

// Duration tolerance for the cache check (ms). A change smaller than this reuses the existing track.
const DURATION_TOLERANCE_MS = 1_000;

/** Integrated loudness (LUFS) of the given audio files played back to back; null when unmeasurable */
export const measureLufs = (files) => {
  if (files.length === 0) return null;
  const inputs = files.flatMap((f) => ['-i', f]);
  const joined = files.map((_, i) => `[${i}:a]`).join('') + `concat=n=${files.length}:v=0:a=1,ebur128`;
  const proc = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...inputs, '-filter_complex', joined, '-f', 'null', '-'],
    {encoding: 'utf8', timeout: 120_000});
  const found = [...(proc.stderr ?? '').matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  const value = found.length ? Number(found[found.length - 1][1]) : NaN;
  return Number.isFinite(value) ? value : null;
};

/**
 * Write the music at the voice's loudness, so the duck in audioMix.ts sets the gap between them
 * whatever loudness the generated track came in at. Falls back to the unlevelled track.
 */
export const levelToVoice = ({rawPath, outPath, voiceFiles}) => {
  const voice = measureLufs(voiceFiles);
  const music = measureLufs([rawPath]);
  if (voice === null || music === null) {
    copyFileSync(rawPath, outPath);
    return null;
  }
  const gainDb = Math.round((voice - music) * 10) / 10;
  const proc = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath,
    '-af', `volume=${gainDb}dB,alimiter=limit=0.9`, '-c:a', 'libmp3lame', '-b:a', '192k', outPath],
    {encoding: 'utf8', timeout: 120_000});
  if (proc.status !== 0) {
    copyFileSync(rawPath, outPath);
    return null;
  }
  return gainDb;
};

/**
 * Build a music generation prompt from the idea's language, look and post type.
 * Describes mood, instruments and tempo only — no artist names (PLAYBOOK rule).
 *
 * @param {'he'|'en'} language
 * @param {'studio'|'collage'} look
 * @param {string|undefined} postType
 * @returns {string}
 */
export const buildMusicPrompt = (language, look, postType) => {
  const base =
    look === 'collage'
      ? 'warm acoustic background, light guitar or piano, organic feel, 95 BPM'
      : 'modern electronic background, clean production, 115 BPM';

  const langFeel =
    language === 'he'
      ? 'upbeat and energetic, driving rhythm, positive'
      : 'calm and confident, motivating, professional';

  const typeFeel = (() => {
    if (!postType) return '';
    if (postType.includes('tip') || postType.includes('hook')) return ', informative and dynamic';
    if (postType.includes('demo') || postType.includes('output')) return ', engaging and clear';
    return '';
  })();

  return `${base}, ${langFeel}${typeFeel}, no lyrics, no vocals, continuous loop-ready`;
};

/**
 * Generate (or reuse) the music track for one directed video.
 *
 * @param {{
 *   postPublicDir: string,  absolute path to the post's public directory
 *   publicRoot: string,     absolute path to the Remotion public root
 *   totalDurationMs: number,
 *   language: 'he'|'en',
 *   look: 'studio'|'collage',
 *   postType?: string,
 *   root: string,           marketing-studio repo root (for the audio feeder)
 *   voiceFiles: string[],   absolute paths of the voice-over lines, to level the music to
 * }} opts
 * @returns {Promise<{music: {src: string, durationMs: number}|null, musicAbsentReason: string|null}>}
 */
export const generatePostMusic = async ({
  postPublicDir,
  publicRoot,
  totalDurationMs,
  language,
  look,
  postType,
  root,
  voiceFiles = [],
}) => {
  const musicPath = join(postPublicDir, 'music.mp3');
  const rawPath = join(postPublicDir, 'music-raw.mp3');
  const metaPath = join(postPublicDir, 'music-meta.json');
  // Tracks cached before levelling existed kept the generated file as music.mp3
  if (!existsSync(rawPath) && existsSync(musicPath) && existsSync(metaPath)) copyFileSync(musicPath, rawPath);
  const levelled = () => {
    const gainDb = levelToVoice({rawPath, outPath: musicPath, voiceFiles});
    console.log(gainDb === null ? '[postMusic] music left unlevelled (loudness unmeasurable)' : `[postMusic] music levelled to the voice (${gainDb} dB)`);
  };

  // Check cache: reuse if the existing track is close enough in duration, look and language.
  if (existsSync(rawPath) && existsSync(metaPath)) {
    let meta = null;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      // Corrupt meta — regenerate
    }
    if (
      meta &&
      Math.abs(meta.durationMs - totalDurationMs) <= DURATION_TOLERANCE_MS &&
      meta.look === look &&
      meta.language === language
    ) {
      console.log('[postMusic] reusing cached music track');
      levelled();
      return {
        music: {src: relative(publicRoot, musicPath), durationMs: meta.durationMs},
        musicAbsentReason: null,
      };
    }
  }

  // Generate a new track via the audio feeder.
  const prompt = buildMusicPrompt(language, look, postType);
  console.log(`[postMusic] generating music (${totalDurationMs}ms): "${prompt.slice(0, 80)}…"`);

  const result = spawnSync(
    'node',
    [
      'feeders/audio/client.mjs',
      'music',
      '--prompt', prompt,
      '--length-ms', String(totalDurationMs),
      '--out', rawPath,
    ],
    {cwd: root, encoding: 'utf8', timeout: 360_000},
  );

  if (result.status === 2) {
    // Documented silent fallback: no key → no music.
    return {music: null, musicAbsentReason: 'ELEVENLABS_API_KEY absent — voice-only render'};
  }
  if (result.status !== 0 || !existsSync(rawPath)) {
    const err = (result.stderr ?? '').slice(0, 200) || `feeder exited ${result.status}`;
    return {music: null, musicAbsentReason: `music generation failed: ${err}`};
  }

  levelled();

  // Write cache metadata.
  const meta = {durationMs: totalDurationMs, look, language, generatedAt: new Date().toISOString()};
  try {
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // Non-fatal: cache write failure just means the next run regenerates.
  }

  return {
    music: {src: relative(publicRoot, musicPath), durationMs: totalDurationMs},
    musicAbsentReason: null,
  };
};

// How far under the voice each effect sits between lines; audioMix.ts voiceDuck takes a
// further ~9 dB off wherever an effect lands under speech.
const EFFECT_OFFSET_DB = {intro: -4, swipe: -6, riser: -4, closing: -8};

/**
 * Each staged effect's volume for this video, levelled to its voice. An effect whose file or
 * loudness can't be read is left out, so the composition's fixed volume applies to it.
 *
 * @param {{sfxDir: string, voiceFiles: string[]}} opts
 * @returns {Record<string, number>}
 */
export const effectGains = ({sfxDir, voiceFiles}) => {
  const voice = measureLufs(voiceFiles);
  if (voice === null) return {};
  const gains = {};
  for (const [kind, offset] of Object.entries(EFFECT_OFFSET_DB)) {
    const file = join(sfxDir, `${kind}.mp3`);
    const effect = existsSync(file) ? measureLufs([file]) : null;
    if (effect === null) continue;
    gains[kind] = Math.min(1, Math.round(10 ** ((voice + offset - effect) / 20) * 1000) / 1000);
  }
  return gains;
};
