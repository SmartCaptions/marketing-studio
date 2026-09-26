// node --test scripts/lib/tts.test.mjs
import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {
  HEBREW_TAG,
  HEBREW_STABILITY,
  HEBREW_TEMPO,
  MODEL_FOR_LANG,
  stripLeadingTag,
  stretchAudio,
  callTtsWithTimestamps,
} from './tts.mjs';

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

// ─── callTtsWithTimestamps: Hebrew request shape ────────────────────────────

describe('callTtsWithTimestamps Hebrew request', () => {
  test('sends stability 0 and [cheerfully] prefix for Hebrew', async () => {
    let captured;
    // Minimal alignment with one real character to pass alignment stripping.
    const fakeAlignment = {
      characters: '[cheerfully] ט'.split(''),
      character_start_times_seconds: '[cheerfully] ט'.split('').map((_, i) => i * 0.05),
      character_end_times_seconds: '[cheerfully] ט'.split('').map((_, i) => i * 0.05 + 0.04),
    };
    const fakeAudio = Buffer.alloc(100);
    const fakeFetch = async (url, opts) => {
      captured = {url, body: JSON.parse(opts.body)};
      return {
        ok: true,
        json: async () => ({
          audio_base64: fakeAudio.toString('base64'),
          alignment: fakeAlignment,
        }),
      };
    };

    // Patch global fetch for this test
    const origFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      await callTtsWithTimestamps('טוב', 'voice-he', 'eleven_v3', 'fake-key', 'he');
    } finally {
      globalThis.fetch = origFetch;
    }

    assert.ok(captured, 'fetch was called');
    assert.ok(captured.url.endsWith('/with-timestamps'), 'calls with-timestamps endpoint');
    assert.equal(captured.body.text, `${HEBREW_TAG}טוב`);
    assert.equal(captured.body.model_id, 'eleven_v3');
    assert.deepEqual(captured.body.voice_settings, {stability: HEBREW_STABILITY});
  });

  test('sends no voice_settings and no prefix for English', async () => {
    let captured;
    const fakeAlignment = {
      characters: 'hi'.split(''),
      character_start_times_seconds: [0, 0.1],
      character_end_times_seconds: [0.09, 0.19],
    };
    const fakeFetch = async (url, opts) => {
      captured = {body: JSON.parse(opts.body)};
      return {
        ok: true,
        json: async () => ({
          audio_base64: Buffer.alloc(100).toString('base64'),
          alignment: fakeAlignment,
        }),
      };
    };
    const origFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      await callTtsWithTimestamps('hi', 'voice-en', 'eleven_multilingual_v2', 'fake-key', 'en');
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.equal(captured.body.text, 'hi', 'no prefix added for English');
    assert.equal(captured.body.voice_settings, undefined, 'no voice_settings for English');
  });

  test('MODEL_FOR_LANG maps he to eleven_v3 and en to multilingual', () => {
    assert.equal(MODEL_FOR_LANG.he, 'eleven_v3');
    assert.match(MODEL_FOR_LANG.en, /multilingual/);
  });

  test('Hebrew TEMPO constant is 1.15', () => {
    assert.equal(HEBREW_TEMPO, 1.15);
  });

  test('Hebrew STABILITY constant is 0', () => {
    assert.equal(HEBREW_STABILITY, 0);
  });

  test('Hebrew timestamps are divided by HEBREW_TEMPO', async () => {
    const rawStart = 0.115; // after tag strip, first real char
    const tagPlusSpace = '[cheerfully] '.split('');
    const realChar = 'ט';
    const allChars = [...tagPlusSpace, realChar];
    const allStarts = allChars.map((_, i) => i * 0.1);
    const allEnds = allChars.map((_, i) => i * 0.1 + 0.09);
    const fakeAlignment = {
      characters: allChars,
      character_start_times_seconds: allStarts,
      character_end_times_seconds: allEnds,
    };

    let resultAlignment;
    const fakeFetch = async (_url, opts) => {
      return {
        ok: true,
        json: async () => ({
          audio_base64: Buffer.alloc(100).toString('base64'),
          alignment: fakeAlignment,
        }),
      };
    };
    const origFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      const result = await callTtsWithTimestamps('ט', 'voice-he', 'eleven_v3', 'fake-key', 'he');
      resultAlignment = result.alignment;
    } finally {
      globalThis.fetch = origFetch;
    }
    // After tag strip (13 chars stripped), only 'ט' remains.
    assert.equal(resultAlignment.characters.length, 1);
    // Timestamps should be divided by HEBREW_TEMPO
    const expectedStart = allStarts[tagPlusSpace.length] / HEBREW_TEMPO;
    assert.ok(
      Math.abs(resultAlignment.character_start_times_seconds[0] - expectedStart) < 0.001,
      `start ${resultAlignment.character_start_times_seconds[0]} ≈ ${expectedStart}`,
    );
  });
});
