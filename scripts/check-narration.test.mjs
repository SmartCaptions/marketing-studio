/**
 * Tests for check-narration.mjs logic.
 *
 * Tests the normalise and wordMatch functions in isolation using a fake fetch.
 * No real ElevenLabs calls are made.
 */
import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// ─── Unit tests for word-match logic (inlined from the script) ────────────────

function normalise(text) {
  return text
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function charSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s[i] + s[i + 1]; m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const ba = bigrams(a), bb = bigrams(b);
  let shared = 0;
  for (const [k, v] of ba) shared += Math.min(v, bb.get(k) ?? 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

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

describe('normalise', () => {
  it('strips Arabic diacritics', () => {
    assert.equal(normalise('كَتَبَ'), 'كتب');
  });
  it('strips tatweel U+0640', () => {
    assert.equal(normalise('كـتـب'), 'كتب');
  });
  it('strips punctuation', () => {
    assert.equal(normalise('hello, world!'), 'hello world');
  });
  it('lowercases', () => {
    assert.equal(normalise('Hello World'), 'hello world');
  });
});

describe('wordMatch', () => {
  it('exact match returns 1', () => {
    assert.equal(wordMatch('hello world', 'hello world'), 1);
  });
  it('zero matches returns 0', () => {
    assert.equal(wordMatch('abc', 'xyz'), 0);
  });
  it('partial match', () => {
    const m = wordMatch('hello world foo', 'hello world');
    assert(m > 0.5 && m < 1, `expected ~0.667 got ${m}`);
  });
  it('Arabic with diacritics strips match', () => {
    // كَتَبَ (with diacritics) vs كتب (without) — same after normalise
    const m = wordMatch('كَتَبَ شيء', 'كتب شيء');
    assert.equal(m, 1);
  });
  it('fuzzy: one character difference still matches at ≥ 0.8 sim', () => {
    // "hello" vs "helo" — charSim should be high
    const m = wordMatch('hello', 'helo');
    assert.equal(m, 1); // close enough
  });
  it('empty transcript returns 0', () => {
    assert.equal(wordMatch('hello', ''), 0);
  });
  it('empty script returns 1', () => {
    assert.equal(wordMatch('', 'anything'), 1);
  });
});

// ─── Integration test with fake fetch ────────────────────────────────────────

describe('check-narration with fake fetch', () => {
  let tmpDir;
  let audioFile;

  before(() => {
    tmpDir = join(tmpdir(), `check-narration-test-${Date.now()}`);
    mkdirSync(tmpDir, {recursive: true});
    audioFile = join(tmpDir, 'test.mp3');
    // Write a minimal valid MP3 header stub (3 bytes, enough to open as a file)
    writeFileSync(audioFile, Buffer.from([0xFF, 0xFB, 0x90]));
  });

  after(() => { try { rmSync(tmpDir, {recursive: true}); } catch {} });

  it('passes when transcript matches script', () => {
    const input = JSON.stringify({
      language: 'ar',
      lines: [{text: 'مرحبا بالعالم', audio: audioFile}],
    });
    // Run with a wrapper that injects a fake fetch returning the script text
    const wrapper = `
      globalThis.fetch = async () => ({ok:true, status:200, json: async ()=>({text:'مرحبا بالعالم'})});
      const url = new URL('${import.meta.url.replace(/\/[^/]+$/, '/check-narration.mjs')}');
      process.argv = ['node', 'check-narration.mjs', '--input', ${JSON.stringify(JSON.stringify(input))}, '--min-match', '0.9'];
      await import(url);
    `;
    // Use a simpler approach: run as a subprocess with custom env
    const script = join(tmpDir, 'runner.mjs');
    writeFileSync(script, `
import {readFileSync} from 'node:fs';
// Patch fetch before importing the script
globalThis.fetch = async (url, opts) => {
  return {ok:true, status:200, json: async ()=>({text:'مرحبا بالعالم'})};
};
// Redirect argv
process.argv = ['node', 'check-narration.mjs', '--input',
  JSON.stringify({language:'ar',lines:[{text:'مرحبا بالعالم',audio:${JSON.stringify(audioFile)}}]}),
  '--min-match', '0.9'];
// Also set a fake key
process.env.ELEVENLABS_API_KEY = 'fake-key';
await import(${JSON.stringify(new URL('../scripts/check-narration.mjs', import.meta.url).href)});
`);
    const result = spawnSync(process.execPath, [script], {encoding: 'utf8', cwd: tmpDir});
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.passed, true);
    assert.equal(out.lines.length, 1);
    assert(out.lines[0].match >= 0.9);
  });

  it('fails when transcript does not match script', () => {
    const script = join(tmpDir, 'runner-fail.mjs');
    writeFileSync(script, `
globalThis.fetch = async () => ({ok:true, status:200, json: async ()=>({text:'شيء مختلف تماما'})});
process.argv = ['node', 'check-narration.mjs', '--input',
  JSON.stringify({language:'ar',lines:[{text:'مرحبا بالعالم',audio:${JSON.stringify(audioFile)}}]}),
  '--min-match', '0.9'];
process.env.ELEVENLABS_API_KEY = 'fake-key';
await import(${JSON.stringify(new URL('../scripts/check-narration.mjs', import.meta.url).href)});
`);
    const result = spawnSync(process.execPath, [script], {encoding: 'utf8', cwd: tmpDir});
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.passed, false);
  });

  it('retries on 429', () => {
    const script = join(tmpDir, 'runner-retry.mjs');
    writeFileSync(script, `
let calls = 0;
// Patch setTimeout to be instant so the retry delay doesn't slow the test
globalThis.setTimeout = (fn) => { fn(); return 0; };
globalThis.fetch = async () => {
  calls++;
  if (calls < 2) return {ok:false, status:429, text: async()=>''};
  return {ok:true, status:200, json: async ()=>({text:'مرحبا بالعالم'})};
};
process.argv = ['node', 'check-narration.mjs', '--input',
  JSON.stringify({language:'ar',lines:[{text:'مرحبا بالعالم',audio:${JSON.stringify(audioFile)}}]}),
  '--min-match', '0.5'];
process.env.ELEVENLABS_API_KEY = 'fake-key';
await import(${JSON.stringify(new URL('../scripts/check-narration.mjs', import.meta.url).href)});
`);
    const result = spawnSync(process.execPath, [script], {encoding: 'utf8', cwd: tmpDir, timeout: 10000});
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.passed, true);
  });
});
