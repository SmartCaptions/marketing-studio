/**
 * Narration check: does a voice-over say what its script says?
 *
 * A word of the script counts as heard when the transcript holds a word at least 0.8 similar
 * (bigram Dice), after diacritics, tatweel and punctuation are removed. The score is heard words
 * over script words across all lines.
 */
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';

export const SCRIBE_MODEL = 'scribe_v2';
export const SCRIBE_LANGUAGE_CODE = {ar: 'ara', he: 'heb', en: 'eng'};
/** Waits before each retry of a rate-limited or failing transcription. */
export const SCRIBE_RETRY_DELAYS_MS = [2000, 8000];
export const WORD_SIMILARITY = 0.8;

/** Remove Arabic diacritics, tatweel and punctuation, then lower-case. */
export const normalise = (text) =>
  text
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const bigrams = (s) => {
  const counts = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const key = s[i] + s[i + 1];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/** Letter similarity of two words, 0..1 (Dice coefficient on bigrams). */
export const charSim = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = bigrams(a);
  const right = bigrams(b);
  let shared = 0;
  for (const [key, n] of left) shared += Math.min(n, right.get(key) ?? 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
};

/** How many of the script's words the transcript holds: `{matched, total}`. */
export const wordMatch = (script, transcript) => {
  const scriptWords = normalise(script).split(/\s+/).filter(Boolean);
  const heard = normalise(transcript).split(/\s+/).filter(Boolean);
  const matched = scriptWords.filter((word) => heard.some((h) => charSim(word, h) >= WORD_SIMILARITY)).length;
  return {matched, total: scriptWords.length};
};

/**
 * Check every line with `transcribe(audioPath)`; passes when the share of script words heard,
 * over all lines, is at least `minMatch`.
 *
 * @returns {Promise<{passed: boolean, min_match: number, match: number, lines: Array<{text: string, transcript: string, match: number}>}>}
 */
export const checkLines = async ({lines, transcribe, minMatch}) => {
  let matched = 0;
  let total = 0;
  const results = [];
  for (const line of lines) {
    const transcript = await transcribe(line.audio);
    const m = wordMatch(line.text, transcript);
    matched += m.matched;
    total += m.total;
    results.push({text: line.text, transcript, match: m.total === 0 ? 1 : m.matched / m.total});
  }
  const match = total === 0 ? 1 : matched / total;
  return {passed: match >= minMatch, min_match: minMatch, match, lines: results};
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A `transcribe(audioPath)` that calls ElevenLabs speech-to-text, retrying a 429 or 5xx after each
 * delay in `retryDelays`.
 */
export const scribeTranscriber = ({
  apiKey,
  language,
  apiBase = 'https://api.elevenlabs.io',
  fetchFn = globalThis.fetch,
  sleep = wait,
  retryDelays = SCRIBE_RETRY_DELAYS_MS,
}) => async (audioPath) => {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(audioPath)]), basename(audioPath));
    form.append('model_id', SCRIBE_MODEL);
    form.append('language_code', SCRIBE_LANGUAGE_CODE[language] ?? language);
    const res = await fetchFn(`${apiBase}/v1/speech-to-text`, {
      method: 'POST',
      headers: {'xi-api-key': apiKey},
      body: form,
    });
    if (res.ok) return (await res.json()).text ?? '';
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retryDelays.length) {
      throw new Error(`Scribe returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    await sleep(retryDelays[attempt]);
  }
};
