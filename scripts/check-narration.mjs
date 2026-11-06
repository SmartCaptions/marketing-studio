#!/usr/bin/env node
/**
 * check-narration.mjs — verify that an ElevenLabs voice-over matches its script.
 *
 * Usage:
 *   node scripts/check-narration.mjs \
 *     --input '{"language":"ar","lines":[{"text":"…","audio":"/abs/path.mp3"}]}' \
 *     --min-match 0.9
 *
 * Calls ElevenLabs Scribe (speech-to-text) for each line's audio file, computes a fuzzy
 * word-match score, and prints one JSON line:
 *   {"passed":bool,"min_match":number,"lines":[{"text":"…","transcript":"…","match":number}]}
 *
 * Exits 0 whether passed or not; exits 1 on a configuration or usage error.
 *
 * ElevenLabs key: ELEVENLABS_API_KEY env var, or the .env file in the repo root.
 */
import {createReadStream, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readEnv, ELEVENLABS_API} from './lib/tts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

const inputStr = getArg('--input');
const minMatchStr = getArg('--min-match') ?? '0.9';

if (!inputStr) { console.error('check-narration: --input is required'); process.exit(1); }

let input;
try { input = JSON.parse(inputStr); } catch { console.error('check-narration: --input must be valid JSON'); process.exit(1); }

const language = input.language;
const lines = input.lines;
const minMatch = Number(minMatchStr);

if (!language || !Array.isArray(lines) || lines.length === 0) {
  console.error('check-narration: input must have language and a non-empty lines array');
  process.exit(1);
}
if (!isFinite(minMatch) || minMatch < 0 || minMatch > 1) {
  console.error('check-narration: --min-match must be a number between 0 and 1');
  process.exit(1);
}

// ─── ElevenLabs API key ───────────────────────────────────────────────────────

const env = readEnv(ROOT);
const apiKey = process.env.ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY;
if (!apiKey) { console.error('check-narration: ELEVENLABS_API_KEY not set'); process.exit(1); }

// ─── Language code map ────────────────────────────────────────────────────────

const LANG_CODE = {ar: 'ara', he: 'heb', en: 'eng'};
const langCode = LANG_CODE[language] ?? language;

// ─── Fuzzy word match ─────────────────────────────────────────────────────────

/**
 * Remove Arabic/Hebrew diacritics, tatweel and punctuation, then lower-case.
 */
function normalise(text) {
  return text
    .replace(/[ً-ْٰـ]/g, '') // diacritics + tatweel
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Character-level similarity between two strings (Dice coefficient on bigrams).
 */
function charSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s[i] + s[i + 1]; m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const ba = bigrams(a), bb = bigrams(b);
  let shared = 0;
  for (const [k, v] of ba) shared += Math.min(v, bb.get(k) ?? 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

/**
 * Match script words against transcript words.
 * A script word is "matched" when the transcript contains a word with ≥ 0.8 letter similarity.
 */
function wordMatch(script, transcript) {
  const sw = normalise(script).split(/\s+/).filter(Boolean);
  const tw = normalise(transcript).split(/\s+/).filter(Boolean);
  if (sw.length === 0) return 1;
  let matched = 0;
  for (const s of sw) {
    if (tw.some((t) => charSim(s, t) >= 0.8)) matched++;
  }
  return matched / sw.length;
}

// ─── Scribe call with 429 backoff ─────────────────────────────────────────────

const SCRIBE_URL = `${ELEVENLABS_API}/v1/speech-to-text`;

async function scribe(audioPath, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, (attempt * attempt) * 2000));
    const form = new FormData();
    const blob = new Blob([readFileSync(audioPath)]);
    form.append('file', blob, audioPath.split('/').pop());
    form.append('model_id', 'scribe_v2');
    form.append('language_code', langCode);
    const res = await fetch(`${SCRIBE_URL}`, {method: 'POST', headers: {'xi-api-key': apiKey}, body: form});
    if (res.status === 429) continue;
    if (!res.ok) throw new Error(`Scribe returned ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.text ?? '';
  }
  throw new Error(`Scribe returned 429 after ${retries} retries`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const results = [];
for (const line of lines) {
  const transcript = await scribe(line.audio);
  const match = wordMatch(line.text, transcript);
  results.push({text: line.text, transcript, match});
}

const allPassed = results.every((r) => r.match >= minMatch);
console.log(JSON.stringify({passed: allPassed, min_match: minMatch, lines: results}));
