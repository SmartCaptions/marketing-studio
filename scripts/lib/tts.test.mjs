// node --test scripts/lib/tts.test.mjs
import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {
  HEBREW_TAG,
  HEBREW_STABILITY,
  HEBREW_TEMPO,
  MODEL_FOR_LANG,
  getLangSettings,
  stripLeadingTag,
  stretchAudio,
  callTtsWithTimestamps,
} from './tts.mjs';

// ─── MODEL_FOR_LANG ──────────────────────────────────────────────────────────

describe('MODEL_FOR_LANG', () => {
  test('he, en and ar all use eleven_v4', () => {
    assert.equal(MODEL_FOR_LANG.he, 'eleven_v4');
    assert.equal(MODEL_FOR_LANG.en, 'eleven_v4');
    assert.equal(MODEL_FOR_LANG.ar, 'eleven_v4');
  });
});

// ─── getLangSettings ─────────────────────────────────────────────────────────

describe('getLangSettings', () => {
  test('Hebrew falls back to built-in defaults when ttsSettings absent', () => {
    const brand = {voices: {he: 'v1'}};
    const s = getLangSettings(brand, 'he');
    assert.equal(s.tag, HEBREW_TAG);
    assert.equal(s.stability, HEBREW_STABILITY);
    assert.equal(s.tempo, HEBREW_TEMPO);
  });

  test('Hebrew reads overrides from brand JSON', () => {
    const brand = {voices: {he: 'v1'}, ttsSettings: {he: {tag: '[happy] ', stability: 0.3, tempo: 1.0}}};
    const s = getLangSettings(brand, 'he');
    assert.equal(s.tag, '[happy] ');
    assert.equal(s.stability, 0.3);
    assert.equal(s.tempo, 1.0);
  });

  test('Hebrew stability=0 reads correctly (not treated as falsy)', () => {
    const brand = {voices: {he: 'v1'}, ttsSettings: {he: {stability: 0}}};
    const s = getLangSettings(brand, 'he');
    assert.equal(s.stability, 0);
  });

  test('English returns null settings when ttsSettings absent', () => {
    const brand = {voices: {en: 'v2'}};
    const s = getLangSettings(brand, 'en');
    assert.equal(s.tag, null);
    assert.equal(s.stability, null);
    assert.equal(s.tempo, null);
  });

  test('Arabic returns null settings when ttsSettings absent', () => {
    const brand = {voices: {ar: 'v3'}};
    const s = getLangSettings(brand, 'ar');
    assert.equal(s.tag, null);
    assert.equal(s.stability, null);
    assert.equal(s.tempo, null);
  });
});

// ─── stripLeadingTag ────────────────────────────────────────────────────────

describe('stripLeadingTag', () => {
  test('strips [cheerfully] prefix and the following space', () => {
    const chars = '[cheerfully] שלום'.split('');
    const n = chars.length;
    const starts = chars.map((_, i) => i * 0.05);
    const ends = chars.map((_, i) => i * 0.05 + 0.04);
    const result = stripLeadingTag(chars, starts, ends);
    // Tag is "[cheerfully] " = 13 chars including trailing space
    assert.equal(result.characters[0], 'ש');
    assert.equal(result.characters.length, n - 13);
    assert.equal(result.startSecs.length, result.characters.length);
    assert.equal(result.endSecs.length, result.characters.length);
  });

  test('returns arrays unchanged when no leading [ bracket', () => {
    const chars = 'hello'.split('');
    const starts = [0, 0.1, 0.2, 0.3, 0.4];
    const ends =   [0.09, 0.19, 0.29, 0.39, 0.49];
    const result = stripLeadingTag(chars, starts, ends);
    assert.deepEqual(result.characters, chars);
    assert.deepEqual(result.startSecs, starts);
    assert.deepEqual(result.endSecs, ends);
  });

  test('returns unchanged when array is empty', () => {
    const result = stripLeadingTag([], [], []);
    assert.deepEqual(result.characters, []);
  });

  test('returns unchanged when there is no closing ]', () => {
    const chars = '[no close'.split('');
    const starts = chars.map((_, i) => i * 0.05);
    const ends = chars.map((_, i) => i * 0.05 + 0.04);
    const result = stripLeadingTag(chars, starts, ends);
    assert.deepEqual(result.characters, chars);
  });
});

// ─── stretchAudio fallback ──────────────────────────────────────────────────

describe('stretchAudio', () => {
  test('returns original buffer when ffmpeg is not on PATH (graceful fallback)', () => {
    // Override PATH so ffmpeg cannot be found — this tests the catch branch.
    const origPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const input = Buffer.from('fake-mp3-data');
      const output = stretchAudio(input, 1.15);
      assert.deepEqual(output, input);
    } finally {
      process.env.PATH = origPath;
    }
  });
});

// ─── callTtsWithTimestamps: request shape per language ────────────────────────

describe('callTtsWithTimestamps', () => {
  // Helper: minimal fake alignment for a text string.
  const fakeAlignFor = (text) => ({
    characters: text.split(''),
    character_start_times_seconds: text.split('').map((_, i) => i * 0.05),
    character_end_times_seconds: text.split('').map((_, i) => i * 0.05 + 0.04),
  });

  const patchFetch = (body) => {
    const origFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = {url, body: JSON.parse(opts.body)};
      return {
        ok: true,
        json: async () => ({audio_base64: Buffer.alloc(100).toString('base64'), alignment: body}),
      };
    };
    return {
      restore: () => { globalThis.fetch = origFetch; },
      get captured() { return captured; },
    };
  };

  test('Hebrew: sends stability 0 and [cheerfully] prefix via langSettings', async () => {
    const patch = patchFetch(fakeAlignFor('[cheerfully] ט'));
    try {
      await callTtsWithTimestamps('טוב', 'voice-he', 'eleven_v4', 'fake-key', 'he',
        {tag: HEBREW_TAG, stability: HEBREW_STABILITY, tempo: HEBREW_TEMPO});
    } finally { patch.restore(); }
    assert.ok(patch.captured.url.endsWith('/with-timestamps'));
    assert.equal(patch.captured.body.text, `${HEBREW_TAG}טוב`);
    assert.equal(patch.captured.body.model_id, 'eleven_v4');
    assert.deepEqual(patch.captured.body.voice_settings, {stability: 0});
  });

  test('English: no prefix, no voice_settings, eleven_v4', async () => {
    const patch = patchFetch(fakeAlignFor('hi'));
    try {
      await callTtsWithTimestamps('hi', 'voice-en', 'eleven_v4', 'fake-key', 'en', {tag: null, stability: null, tempo: null});
    } finally { patch.restore(); }
    assert.equal(patch.captured.body.text, 'hi');
    assert.equal(patch.captured.body.model_id, 'eleven_v4');
    assert.equal(patch.captured.body.voice_settings, undefined);
  });

  test('Arabic: no prefix, no voice_settings, eleven_v4', async () => {
    const patch = patchFetch(fakeAlignFor('مرحبا'));
    try {
      await callTtsWithTimestamps('مرحبا', 'voice-ar', 'eleven_v4', 'fake-key', 'ar', {tag: null, stability: null, tempo: null});
    } finally { patch.restore(); }
    assert.equal(patch.captured.body.text, 'مرحبا');
    assert.equal(patch.captured.body.model_id, 'eleven_v4');
    assert.equal(patch.captured.body.voice_settings, undefined);
  });

  test('Hebrew timestamps are divided by tempo after tag strip', async () => {
    const tagPlusSpace = '[cheerfully] '.split('');
    const realChar = 'ט';
    const allChars = [...tagPlusSpace, realChar];
    const allStarts = allChars.map((_, i) => i * 0.1);
    const allEnds = allChars.map((_, i) => i * 0.1 + 0.09);
    const patch = patchFetch({
      characters: allChars,
      character_start_times_seconds: allStarts,
      character_end_times_seconds: allEnds,
    });
    let resultAlignment;
    try {
      const result = await callTtsWithTimestamps('ט', 'voice-he', 'eleven_v4', 'fake-key', 'he',
        {tag: HEBREW_TAG, stability: HEBREW_STABILITY, tempo: HEBREW_TEMPO});
      resultAlignment = result.alignment;
    } finally { patch.restore(); }
    assert.equal(resultAlignment.characters.length, 1);
    const expectedStart = allStarts[tagPlusSpace.length] / HEBREW_TEMPO;
    assert.ok(
      Math.abs(resultAlignment.character_start_times_seconds[0] - expectedStart) < 0.001,
      `start ${resultAlignment.character_start_times_seconds[0]} ≈ ${expectedStart}`,
    );
  });

  test('HEBREW_TEMPO constant is 1.15', () => {
    assert.equal(HEBREW_TEMPO, 1.15);
  });

  test('HEBREW_STABILITY constant is 0', () => {
    assert.equal(HEBREW_STABILITY, 0);
  });
});
