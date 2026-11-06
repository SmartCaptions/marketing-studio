#!/usr/bin/env node
/**
 * check-narration.mjs — verify that an ElevenLabs voice-over matches its script.
 *
 * Usage:
 *   node scripts/check-narration.mjs \
 *     --input '{"language":"ar","lines":[{"text":"…","audio":"/abs/path.mp3"}]}' \
 *     --min-match 0.9
 *
 * Transcribes each line's audio with ElevenLabs Scribe and prints one JSON line:
 *   {"passed":bool,"min_match":number,"match":number,"lines":[{"text":"…","transcript":"…","match":number}]}
 *
 * Exits 0 whether passed or not; exits 1 on a configuration or usage error, or when a
 * transcription fails (the caller treats that as "could not check").
 *
 * ElevenLabs key: ELEVENLABS_API_KEY env var, or the .env file in the repo root.
 */
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkLines, scribeTranscriber} from './lib/narration-check.mjs';
import {readEnv} from './lib/tts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => {
  console.error(`check-narration: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const inputStr = getArg('--input');
if (!inputStr) fail('--input is required');
let input;
try {
  input = JSON.parse(inputStr);
} catch {
  fail('--input must be valid JSON');
}
const {language, lines} = input;
if (!language || !Array.isArray(lines) || lines.length === 0) {
  fail('input must have language and a non-empty lines array');
}
const minMatch = Number(getArg('--min-match') ?? '0.9');
if (!Number.isFinite(minMatch) || minMatch < 0 || minMatch > 1) {
  fail('--min-match must be a number between 0 and 1');
}

const apiKey = process.env.ELEVENLABS_API_KEY || readEnv(ROOT).ELEVENLABS_API_KEY;
if (!apiKey) fail('ELEVENLABS_API_KEY not set');

try {
  const result = await checkLines({lines, transcribe: scribeTranscriber({apiKey, language}), minMatch});
  console.log(JSON.stringify(result));
} catch (err) {
  fail(err.message);
}
