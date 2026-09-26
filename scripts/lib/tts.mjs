#!/usr/bin/env node
/**
 * scripts/lib/tts.mjs — shared ElevenLabs TTS helpers.
 *
 * Extracted from build-reel-props.mjs so build-post-props.mjs can reuse them
 * without copying. All callers import from this module.
 */
import {readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
export const ELEVENLABS_API = 'https://api.elevenlabs.io';
export const TTS_TIMEOUT = 90_000;

/** Model to use per language (verified 2026-09). */
export const MODEL_FOR_LANG = {he: 'eleven_v3', en: 'eleven_multilingual_v2'};

/**
 * Hebrew voice F settings (owner pick, 2026-09-25):
 *   - stability 0 for a lighter, more expressive delivery
 *   - [cheerfully] prefix tag for the required tone
 *   - 1.15× time-stretch post-TTS (atempo=1.15 => 1/1.15 of original length)
 */
export const HEBREW_TAG = '[cheerfully] ';
export const HEBREW_STABILITY = 0;
export const HEBREW_TEMPO = 1.15;

// ─────────────────────────────────────────────────────────────────────────────
// .env reader
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Parse key=value lines from the repo root .env file.
 * Returns an empty object when the file is missing; never throws.
 */
export const readEnv = (root) => {
  const out = {};
  let raw;
  try {
    raw = readFileSync(join(root, '.env'), 'utf8');
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
// Voice resolver
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Return the ElevenLabs voice ID for the given language from a brand JSON object.
 * Throws a clear error when the voices block is missing or the language is absent.
 *
 * @param {object} brandJson - parsed brand JSON (brands/<id>.json)
 * @param {'he'|'en'} language
 * @returns {string} voice ID
 */
export const getVoiceId = (brandJson, language) => {
  const voices = brandJson.voices;
  if (!voices)
    throw new Error(
      `Brand JSON is missing a "voices" block. Add { "voices": { "he": "<voice-id>", "en": "<voice-id>" } }.`,
    );
  const id = voices[language];
  if (!id)
    throw new Error(
      `Brand JSON voices block has no entry for language "${language}". Add it.`,
    );
  return id;
};

// ─────────────────────────────────────────────────────────────────────────────
// Hebrew helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip a leading prose-style tag (`[…] `) from character-level alignment arrays.
 * Called after a Hebrew TTS response to remove the `[cheerfully] ` prefix characters
 * that eleven_v3 returns in its alignment.
 *
 * Returns the trimmed arrays with tag characters removed. When no tag is present the
 * original arrays are returned unchanged.
 *
 * @param {string[]} characters
 * @param {number[]} startSecs
 * @param {number[]} endSecs
 * @returns {{characters: string[], startSecs: number[], endSecs: number[]}}
 */
export const stripLeadingTag = (characters, startSecs, endSecs) => {
  if (!characters.length || characters[0] !== '[') return {characters, startSecs, endSecs};
  const closeIdx = characters.indexOf(']');
  if (closeIdx < 0) return {characters, startSecs, endSecs};
  // Skip the closing bracket and any trailing spaces
  let from = closeIdx + 1;
  while (from < characters.length && characters[from] === ' ') from++;
  return {
    characters: characters.slice(from),
    startSecs: startSecs.slice(from),
    endSecs: endSecs.slice(from),
  };
};

/**
 * Time-stretch an MP3 buffer with ffmpeg `atempo`.
 * `tempo > 1` speeds up (shorter output); `tempo < 1` slows down.
 *
 * Uses a temp-file round-trip. Falls back to the original buffer if ffmpeg is
 * unavailable or fails — callers treat audio-stretch failure as non-fatal.
 *
 * @param {Buffer} audioBuffer
 * @param {number} tempo - e.g. 1.15 to get 1/1.15 of original length
 * @returns {Buffer}
 */
export const stretchAudio = (audioBuffer, tempo) => {
  const tag = `tts-stretch-${process.pid}-${Date.now()}`;
  const tmpIn = join(tmpdir(), `${tag}-in.mp3`);
  const tmpOut = join(tmpdir(), `${tag}-out.mp3`);
  try {
    writeFileSync(tmpIn, audioBuffer);
    const result = spawnSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', tmpIn, '-af', `atempo=${tempo}`, tmpOut],
      {timeout: 60_000, encoding: 'utf8'},
    );
    if (result.status !== 0) {
      console.warn(`[tts] ffmpeg atempo=${tempo} exited ${result.status}; using original audio`);
      return audioBuffer;
    }
    return readFileSync(tmpOut);
  } catch (err) {
    console.warn(`[tts] stretchAudio failed (${err.message}); using original audio`);
    return audioBuffer;
  } finally {
    try { unlinkSync(tmpIn); } catch {}
    try { unlinkSync(tmpOut); } catch {}
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs TTS with-timestamps call
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Call ElevenLabs /v1/text-to-speech/{voice}/with-timestamps and return the
 * audio buffer, word-level alignment data, and computed duration in ms.
 *
 * For Hebrew (`language === 'he'`):
 *   - prefixes text with HEBREW_TAG so ElevenLabs delivers a lighter tone;
 *   - sets voice_settings.stability to HEBREW_STABILITY;
 *   - strips the tag characters from the returned alignment;
 *   - stretches the audio to 1/HEBREW_TEMPO of its original length with ffmpeg;
 *   - divides all character timestamps by HEBREW_TEMPO so captions track the
 *     faster speech exactly.
 *
 * English requests are byte-identical to the pre-Hebrew version.
 *
 * @param {string} text
 * @param {string} voiceId
 * @param {string} modelId
 * @param {string} apiKey
 * @param {'he'|'en'} [language='en']
 * @returns {Promise<{audioBuffer: Buffer, alignment: object, durationMs: number}>}
 */
export const callTtsWithTimestamps = async (text, voiceId, modelId, apiKey, language = 'en') => {
  const isHebrew = language === 'he';

  const requestText = isHebrew ? `${HEBREW_TAG}${text}` : text;
  const body = {
    text: requestText,
    model_id: modelId,
    output_format: 'mp3_44100_128',
  };
  if (isHebrew) {
    body.voice_settings = {stability: HEBREW_STABILITY};
  }

  const url = `${ELEVENLABS_API}/v1/text-to-speech/${voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TTS_TIMEOUT),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();

  let audioBuffer = Buffer.from(json.audio_base64, 'base64');
  let alignment = json.alignment; // {characters, character_start_times_seconds, character_end_times_seconds}

  if (isHebrew && alignment) {
    // Strip the [cheerfully] tag characters returned by ElevenLabs from the alignment.
    const stripped = stripLeadingTag(
      alignment.characters ?? [],
      alignment.character_start_times_seconds ?? [],
      alignment.character_end_times_seconds ?? [],
    );
    // Divide all timestamps by HEBREW_TEMPO to match the stretched (faster) audio.
    alignment = {
      characters: stripped.characters,
      character_start_times_seconds: stripped.startSecs.map((t) => t / HEBREW_TEMPO),
      character_end_times_seconds: stripped.endSecs.map((t) => t / HEBREW_TEMPO),
    };
    // Stretch the audio to 1/HEBREW_TEMPO of its length (faster, lighter delivery).
    audioBuffer = stretchAudio(audioBuffer, HEBREW_TEMPO);
  }

  // Measure duration from the last end time in the (possibly stripped/scaled) alignment.
  const endTimes = alignment?.character_end_times_seconds ?? [];
  const durationMs =
    endTimes.length > 0
      ? Math.ceil(endTimes[endTimes.length - 1] * 1000) + 200
      : Math.ceil((audioBuffer.length / (44100 * 2)) * 1000); // rough fallback

  return {audioBuffer, alignment, durationMs};
};

// ─────────────────────────────────────────────────────────────────────────────
// Caption grouping (plain-JS mirror of studio/src/lib/wordCaptions.ts)
// ─────────────────────────────────────────────────────────────────────────────
const SENTENCE_END = /[.?!…]$/;
const COMMA_END = /[,،]$/;
const COMMA_MIN_LEN = 16;
const MIN_PHRASE_MS = 500;

/**
 * Rebuild spoken words, with their start and end in ms, from ElevenLabs character timings.
 *
 * @param {string[]} characters
 * @param {number[]} startSecs
 * @param {number[]} endSecs
 * @returns {Array<{text: string, startMs: number, endMs: number}>}
 */
export const alignmentToWords = (characters, startSecs, endSecs) => {
  const words = [];
  let buf = '';
  let wordStart = -1;
  let wordEnd = -1;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      if (buf.trim()) {
        words.push({
          text: buf.trim(),
          startMs: Math.round(wordStart * 1000),
          endMs: Math.round(wordEnd * 1000),
        });
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
    words.push({
      text: buf.trim(),
      startMs: Math.round(wordStart * 1000),
      endMs: Math.round(wordEnd * 1000),
    });
  }

  return words;
};

/**
 * Group ElevenLabs character-level alignment into display phrases.
 *
 * @param {string[]} characters
 * @param {number[]} startSecs
 * @param {number[]} endSecs
 * @param {number} [maxChars=32]
 * @returns {Array<{text: string, fromMs: number, toMs: number}>}
 */
export const groupToPhrases = (characters, startSecs, endSecs, maxChars = 32) => {
  const words = alignmentToWords(characters, startSecs, endSecs);

  // Group into phrases
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

  // ElevenLabs can give a phrase's last word no time (its end equals its start). Such a phrase
  // stays up until the next phrase starts, or for MIN_PHRASE_MS when it is the last one.
  for (const [i, p] of phrases.entries()) {
    if (p.toMs - p.fromMs >= MIN_PHRASE_MS) continue;
    const next = phrases[i + 1]?.fromMs ?? Infinity;
    p.toMs = Math.max(p.toMs, Math.min(next, p.fromMs + MIN_PHRASE_MS));
  }

  return phrases;
};
