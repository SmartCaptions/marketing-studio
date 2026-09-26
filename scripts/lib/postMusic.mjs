/**
 * scripts/lib/postMusic.mjs — music generation for directed-video (HybridPost / Finish) props.
 *
 * One music call per video, cached on disk in the post's public directory. The cache is keyed
 * by duration (±1 s), look, and language. Re-renders with the same look/language/duration reuse
 * the existing file without a second API call.
 *
 * Any failure is non-fatal: the caller records the reason, and the video renders voice-only.
 */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {spawnSync} from 'node:child_process';

// Duration tolerance for the cache check (ms). A change smaller than this reuses the existing track.
const DURATION_TOLERANCE_MS = 1_000;

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
}) => {
  const musicPath = join(postPublicDir, 'music.mp3');
  const metaPath = join(postPublicDir, 'music-meta.json');

  // Check cache: reuse if the existing track is close enough in duration, look and language.
  if (existsSync(musicPath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (
        Math.abs(meta.durationMs - totalDurationMs) <= DURATION_TOLERANCE_MS &&
        meta.look === look &&
        meta.language === language
      ) {
        console.log('[postMusic] reusing cached music track');
        return {
          music: {src: relative(publicRoot, musicPath), durationMs: meta.durationMs},
          musicAbsentReason: null,
        };
      }
    } catch {
      // Corrupt meta — regenerate
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
      '--out', musicPath,
    ],
    {cwd: root, encoding: 'utf8', timeout: 360_000},
  );

  if (result.status === 2) {
    // Documented silent fallback: no key → no music.
    return {music: null, musicAbsentReason: 'ELEVENLABS_API_KEY absent — voice-only render'};
  }
  if (result.status !== 0 || !existsSync(musicPath)) {
    const err = (result.stderr ?? '').slice(0, 200) || `feeder exited ${result.status}`;
    return {music: null, musicAbsentReason: `music generation failed: ${err}`};
  }

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
