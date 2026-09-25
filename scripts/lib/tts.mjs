#!/usr/bin/env node
/**
 * scripts/lib/tts.mjs — shared ElevenLabs TTS helpers.
 *
 * Extracted from build-reel-props.mjs so build-post-props.mjs can reuse them
 * without copying. All callers import from this module.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
export const ELEVENLABS_API = 'https://api.elevenlabs.io';
export const TTS_TIMEOUT = 90_000;

/** Model to use per language (verified 2026-09). */
export const MODEL_FOR_LANG = {he: 'eleven_v3', en: 'eleven_multilingual_v2'};

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
// ElevenLabs TTS with-timestamps call
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Call ElevenLabs /v1/text-to-speech/{voice}/with-timestamps and return the
 * audio buffer, word-level alignment data, and computed duration in ms.
 *
 * @param {string} text
 * @param {string} voiceId
 * @param {string} modelId
 * @param {string} apiKey
 * @returns {Promise<{audioBuffer: Buffer, alignment: object, durationMs: number}>}
 */
export const callTtsWithTimestamps = async (text, voiceId, modelId, apiKey) => {
  const url = `${ELEVENLABS_API}/v1/text-to-speech/${voiceId}/with-timestamps`;
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

  const audioBuffer = Buffer.from(json.audio_base64, 'base64');
  const alignment = json.alignment; // {characters, character_start_times_seconds, character_end_times_seconds}

  // Measure duration from the last end time in the alignment; add 200 ms tail pad.
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
 * Group ElevenLabs character-level alignment into display phrases.
 *
 * @param {string[]} characters
 * @param {number[]} startSecs
 * @param {number[]} endSecs
 * @param {number} [maxChars=32]
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

  // ElevenLabs can give a phrase's last word no time (its end equals its start). Such a phrase
  // stays up until the next phrase starts, or for MIN_PHRASE_MS when it is the last one.
  for (const [i, p] of phrases.entries()) {
    if (p.toMs - p.fromMs >= MIN_PHRASE_MS) continue;
    const next = phrases[i + 1]?.fromMs ?? Infinity;
    p.toMs = Math.max(p.toMs, Math.min(next, p.fromMs + MIN_PHRASE_MS));
  }

  return phrases;
};
