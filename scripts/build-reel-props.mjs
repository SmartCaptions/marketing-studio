#!/usr/bin/env node
/**
 * build-reel-props.mjs — props builder for StoryReel.
 *
 * Reads a job.json, calls ElevenLabs /v1/text-to-speech/{voice}/with-timestamps
 * for each scene's narration, saves audio to the job's output_dir, derives
 * phrase-level caption cues, and writes props.json into the output_dir.
 *
 * Usage:
 *   node scripts/build-reel-props.mjs --job <abs-path/job.json> [--out-dir <override>]
 *
 * Exits 0 on success, 1 on error (error is written to result.json by render-reel.mjs).
 * Writes build-reel-props.log and reel-props.json to --out-dir.
 */
import {createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {dirname, basename, join, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_PUBLIC = join(ROOT, 'studio', 'public');

// ─────────────────────────────────────────────────────────────────────────────
// Job schema (mirrors contracts.md §2)
// ─────────────────────────────────────────────────────────────────────────────
const SCHEMA_VERSION = 1;

/**
 * @typedef {{
 *   schema_version: number,
 *   id: string,
 *   language: 'he' | 'en',
 *   hook: string,
 *   scenes: Array<{media: string, kind: 'image'|'video', narration: string}>,
 *   cta: string,
 *   ai_disclosure: boolean,
 *   output_dir: string,
 * }} Job
 */

// ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs constants
// ─────────────────────────────────────────────────────────────────────────────
const API = 'https://api.elevenlabs.io';
const TTS_TIMEOUT = 90_000;

// Model selection per language: eleven_v3 for Hebrew (verified one-call below),
// eleven_multilingual_v2 for English.
const MODEL_FOR_LANG = {he: 'eleven_v3', en: 'eleven_multilingual_v2'};

// ─────────────────────────────────────────────────────────────────────────────
// .env reader (same approach as feeders/audio/client.mjs)
// ─────────────────────────────────────────────────────────────────────────────
const readEnv = () => {
  const out = {};
  let raw;
  try {
    raw = readFileSync(join(ROOT, '.env'), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=');
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// Caption grouping (mirrors studio/src/lib/wordCaptions.ts in plain JS)
// ─────────────────────────────────────────────────────────────────────────────
const SENTENCE_END = /[.?!…]$/;
const COMMA_END = /[,،]$/;
const COMMA_MIN_LEN = 16;

/**
 * @param {string[]} characters
 * @param {number[]} startSecs
 * @param {number[]} endSecs
 * @param {number} maxChars
 * @returns {Array<{text: string, fromMs: number, toMs: number}>}
 */
export const groupToPhrases = (characters, startSecs, endSecs, maxChars = 32) => {
  // 1. Extract words
  const words = [];
  let buf = '';
  let wordStart = -1;
  let wordEnd = -1;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      if (buf.trim()) {
        words.push({text: buf.trim(), startMs: Math.round(wordStart * 1000), endMs: Math.round(wordEnd * 1000)});
      }
      buf = '';
      wordStart = -1;
      wordEnd = -1;
    } else {
      if (wordStart < 0) wordStart = startSecs[i];
      buf += ch;
      wordEnd = endSecs[i];
    }
  }
  if (buf.trim()) {
    words.push({text: buf.trim(), startMs: Math.round(wordStart * 1000), endMs: Math.round(wordEnd * 1000)});
  }

  // 2. Group into phrases
  const phrases = [];
  let group = [];
  let groupLen = 0;

  const flush = () => {
    if (group.length === 0) return;
    phrases.push({
      text: group.map((w) => w.text).join(' '),
      fromMs: group[0].startMs,
      toMs: group[group.length - 1].endMs,
    });
    group = [];
    groupLen = 0;
  };

  for (const word of words) {
    const needed = groupLen === 0 ? word.text.length : groupLen + 1 + word.text.length;
    if (groupLen > 0 && needed > maxChars) flush();
    group.push(word);
    groupLen = groupLen === 0 ? word.text.length : groupLen + 1 + word.text.length;

    if (SENTENCE_END.test(word.text)) {
      flush();
    } else if (COMMA_END.test(word.text) && groupLen >= COMMA_MIN_LEN) {
      flush();
    }
  }
  flush();

  return phrases;
};

// ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs TTS with-timestamps call
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string} text
 * @param {string} voiceId
 * @param {string} modelId
 * @param {string} apiKey
 * @returns {Promise<{audioBuffer: Buffer, alignment: object, durationMs: number}>}
 */
const callTtsWithTimestamps = async (text, voiceId, modelId, apiKey) => {
  const url = `${API}/v1/text-to-speech/${voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      output_format: 'mp3_44100_128',
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();

  // The with-timestamps response carries the audio as base64 and the alignment.
  const audioBuffer = Buffer.from(json.audio_base64, 'base64');
  const alignment = json.alignment; // {characters, character_start_times_seconds, character_end_times_seconds}

  // Measure duration from the last end time
  const endTimes = alignment?.character_end_times_seconds ?? [];
  const durationMs = endTimes.length > 0
    ? Math.ceil(endTimes[endTimes.length - 1] * 1000) + 200  // +200ms tail pad
    : Math.ceil(audioBuffer.length / (44100 * 2) * 1000);    // rough fallback

  return {audioBuffer, alignment, durationMs};
};

// ─────────────────────────────────────────────────────────────────────────────
// Brand voices helper
// ─────────────────────────────────────────────────────────────────────────────
const getVoiceId = (brandJson, language) => {
  const voices = brandJson.voices;
  if (!voices) throw new Error(`brands/smartcaptions.json is missing a "voices" block. Add { "voices": { "he": "<voice-id>", "en": "<voice-id>" } }.`);
  const id = voices[language];
  if (!id) throw new Error(`brands/smartcaptions.json voices block has no entry for language "${language}". Add it.`);
  return id;
};

// ─────────────────────────────────────────────────────────────────────────────
// Narration helper — shared by image, video, and output scene branches
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generate TTS audio for one scene's narration, write it to disk, and derive
 * caption cues from the word-level alignment.
 *
 * @param {{narration: string, sceneIndex: number, label?: string, voiceId: string,
 *          modelId: string, apiKey: string, reelPublicDir: string}} opts
 * @returns {Promise<{audioRelative: string, durationMs: number, captions: Array}>}
 */
const processNarration = async ({narration, sceneIndex, label, voiceId, modelId, apiKey, reelPublicDir}) => {
  const tag = label ? ` (${label})` : '';
  console.log(`[build-reel-props] scene ${sceneIndex}${tag}: TTS "${narration.slice(0, 60)}…"`);

  const {audioBuffer, alignment, durationMs} = await callTtsWithTimestamps(narration, voiceId, modelId, apiKey);

  const audioAbs = join(reelPublicDir, `scene-${sceneIndex}.mp3`);
  writeFileSync(audioAbs, audioBuffer);
  const audioRelative = relative(STUDIO_PUBLIC, audioAbs);

  const captions = alignment
    ? groupToPhrases(
        alignment.characters,
        alignment.character_start_times_seconds,
        alignment.character_end_times_seconds,
      )
    : [];

  console.log(`[build-reel-props] scene ${sceneIndex}: ${durationMs}ms, ${captions.length} caption phrases`);
  return {audioRelative, durationMs, captions};
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export const buildReelProps = async ({jobPath, outDirOverride, apiKeyOverride} = {}) => {
  // 1. Load job
  const jobStr = readFileSync(resolve(jobPath), 'utf8');
  const job = JSON.parse(jobStr);

  if (job.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Job schema_version ${job.schema_version} is not supported. Expected ${SCHEMA_VERSION}.`);
  }

  const lang = job.language ?? 'he';
  if (lang !== 'he' && lang !== 'en') {
    throw new Error(`language must be "he" or "en", got "${lang}".`);
  }

  const outputDir = resolve(outDirOverride ?? job.output_dir);
  mkdirSync(outputDir, {recursive: true});

  // 2. Resolve API key and voice
  const env = readEnv();
  const apiKey = apiKeyOverride ?? env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set in .env. Add it and re-run.');
  }

  const brandJson = JSON.parse(readFileSync(join(ROOT, 'brands', 'smartcaptions.json'), 'utf8'));
  const voiceId = getVoiceId(brandJson, lang);
  const modelId = MODEL_FOR_LANG[lang];

  // 3. Reel media dir under studio/public/reels/<id>/ (gitignored)
  const reelId = job.id ?? `reel-${Date.now()}`;
  const reelPublicDir = join(STUDIO_PUBLIC, 'reels', reelId);
  mkdirSync(reelPublicDir, {recursive: true});

  // 4. Process scenes
  const processedScenes = [];
  for (let i = 0; i < job.scenes.length; i++) {
    const scene = job.scenes[i];

    // Handle output scenes (no media file, just transcript lines)
    if (scene.kind === 'output') {
      if (!scene.lines || scene.lines.length === 0) {
        throw new Error(`Scene ${i} (output kind) has no lines. Provide 1–6 verbatim transcript lines.`);
      }
      if (scene.lines.length > 6) {
        throw new Error(`Scene ${i} (output kind) has ${scene.lines.length} lines; maximum is 6.`);
      }

      // Still needs voice-over narration
      const {audioRelative, durationMs, captions} = await processNarration({
        narration: scene.narration,
        sceneIndex: i,
        label: 'output',
        voiceId,
        modelId,
        apiKey,
        reelPublicDir,
      });

      processedScenes.push({
        kind: 'output',
        media: null,
        audioSrc: audioRelative,
        audioDurationMs: durationMs,
        captions,
        outputLines: scene.lines,
      });
      continue;
    }

    // image / video: require a media file
    const mediaAbs = resolve(scene.media);
    if (!existsSync(mediaAbs)) {
      throw new Error(`Scene ${i} media not found: ${mediaAbs}. Provide an absolute path to an existing file.`);
    }

    // Copy to public dir with a stable name
    const ext = basename(mediaAbs).split('.').pop();
    const destName = `scene-${i}.${ext}`;
    const destAbs = join(reelPublicDir, destName);
    copyFileSync(mediaAbs, destAbs);
    // Path relative to studio/public/ (for staticFile() in the composition)
    const mediaRelative = relative(STUDIO_PUBLIC, destAbs);

    // Generate voice-over for this scene
    const {audioRelative, durationMs, captions} = await processNarration({
      narration: scene.narration,
      sceneIndex: i,
      voiceId,
      modelId,
      apiKey,
      reelPublicDir,
    });

    processedScenes.push({
      kind: scene.kind,
      media: mediaRelative,
      audioSrc: audioRelative,
      audioDurationMs: durationMs,
      captions,
    });
  }

  // 7. Assemble StoryReel props
  const props = {
    brandId: 'smartcaptions',
    language: lang,
    hook: job.hook,
    cta: job.cta ?? 'smartcaptions.co.il',
    aiDisclosure: job.ai_disclosure ?? false,
    hookDurationMs: 1200,
    endCardDurationMs: 2000,
    scenes: processedScenes,
  };

  // 8. Write props.json
  const propsPath = join(outputDir, 'reel-props.json');
  writeFileSync(propsPath, JSON.stringify(props, null, 2));
  console.log(`[build-reel-props] wrote props to ${propsPath}`);

  return {propsPath, props};
};

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const jobIdx = args.indexOf('--job');
  const outDirIdx = args.indexOf('--out-dir');
  const jobPath = jobIdx >= 0 ? args[jobIdx + 1] : null;
  const outDirOverride = outDirIdx >= 0 ? args[outDirIdx + 1] : null;

  if (!jobPath) {
    console.error('Usage: node scripts/build-reel-props.mjs --job <abs-path/job.json> [--out-dir <dir>]');
    process.exit(1);
  }

  buildReelProps({jobPath, outDirOverride}).then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('[build-reel-props] FAILED:', err.message);
    process.exit(1);
  });
}
