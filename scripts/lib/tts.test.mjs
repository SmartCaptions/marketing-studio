// node --test scripts/lib/tts.test.mjs
import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  MODEL_FOR_LANG,
  getLangSettings,
  getVoiceId,
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

/** Hebrew delivery as brands/smartcaptions.json sets it, passed explicitly to the call under test. */
const HEBREW = {tag: '[cheerfully] ', stability: 0, tempo: 1.05};

// ─── getLangSettings ─────────────────────────────────────────────────────────

describe('getLangSettings', () => {
  test('Hebrew has no delivery settings of its own: the brand JSON is the only source', () => {
    const brand = {voices: {he: 'v1'}};
    const s = getLangSettings(brand, 'he');
    assert.equal(s.tag, null);
    assert.equal(s.stability, null);
    assert.equal(s.tempo, null);
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

// ─── getVoiceId ──────────────────────────────────────────────────────────────

// README "Voices": brands/smartcaptions.json holds a default voice for he, en and ar under `voices`.
const SMARTCAPTIONS = JSON.parse(readFileSync(new URL('../../brands/smartcaptions.json', import.meta.url), 'utf8'));

describe('getVoiceId', () => {
  test('returns the brand JSON voice for each of he, en and ar', () => {
    for (const language of ['he', 'en', 'ar']) {
      const id = getVoiceId(SMARTCAPTIONS, language);
      assert.equal(id, SMARTCAPTIONS.voices[language]);
      assert.ok(id.length > 0, `${language} voice is empty`);
    }
  });

  test('a brand with no voice for the language throws a clear error naming the language', () => {
    const {ar: _ar, ...withoutAr} = SMARTCAPTIONS.voices;
    const brand = {...SMARTCAPTIONS, voices: withoutAr};
    assert.throws(() => getVoiceId(brand, 'ar'), /no entry for language "ar"/);
    assert.equal(getVoiceId(brand, 'en'), SMARTCAPTIONS.voices.en);
  });

  test('a brand with no voices block throws a clear error', () => {
    const {voices: _voices, ...withoutVoices} = SMARTCAPTIONS;
    assert.throws(() => getVoiceId(withoutVoices, 'en'), /missing a "voices" block/);
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
        HEBREW);
    } finally { patch.restore(); }
    assert.ok(patch.captured.url.endsWith('/with-timestamps'));
    assert.equal(patch.captured.body.text, '[cheerfully] טוב');
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
        HEBREW);
      resultAlignment = result.alignment;
    } finally { patch.restore(); }
    assert.equal(resultAlignment.characters.length, 1);
    const expectedStart = allStarts[tagPlusSpace.length] / HEBREW.tempo;
    assert.ok(
      Math.abs(resultAlignment.character_start_times_seconds[0] - expectedStart) < 0.001,
      `start ${resultAlignment.character_start_times_seconds[0]} ≈ ${expectedStart}`,
    );
  });

  const withStatuses = (...statuses) => {
    const origFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({url, body: JSON.parse(opts.body)});
      const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
      return {
        ok: status === 200,
        status,
        text: async () => 'busy',
        json: async () => ({audio_base64: Buffer.alloc(100).toString('base64'), alignment: fakeAlignFor('ט')}),
      };
    };
    return {calls, restore: () => { globalThis.fetch = origFetch; }};
  };
  const waits = [];
  const options = {retryDelaysMs: [5, 10, 20], sleep: async (ms) => { waits.push(ms); }};

  test('a 429 is retried after each delay and the call then succeeds', async () => {
    waits.length = 0;
    const fetchStub = withStatuses(429, 429, 200);
    try {
      const result = await callTtsWithTimestamps('ט', 'voice', 'eleven_v4', 'fake-key', 'en', {}, options);
      assert.ok(result.audioBuffer.length > 0);
    } finally { fetchStub.restore(); }
    assert.equal(fetchStub.calls.length, 3);
    assert.deepEqual(waits, [5, 10]);
  });

  test('after the last delay a 429 is reported with its status', async () => {
    waits.length = 0;
    const fetchStub = withStatuses(429);
    try {
      await assert.rejects(
        () => callTtsWithTimestamps('ט', 'voice', 'eleven_v4', 'fake-key', 'en', {}, options),
        /ElevenLabs 429/,
      );
    } finally { fetchStub.restore(); }
    assert.equal(fetchStub.calls.length, 4);
    assert.deepEqual(waits, [5, 10, 20]);
  });

  // Billing safety: a 5xx may already have been billed against a fixed character allowance with
  // no overage, so only a 429 is retried (video-factory's rule for text-to-speech).
  for (const status of [500, 503]) {
    test(`a ${status} is not retried: one call, the error is thrown at once`, async () => {
      waits.length = 0;
      const fetchStub = withStatuses(status, 200);
      try {
        await assert.rejects(
          () => callTtsWithTimestamps('ט', 'voice', 'eleven_v4', 'fake-key', 'en', {}, options),
          {message: `ElevenLabs ${status}: busy`},
        );
      } finally { fetchStub.restore(); }
      assert.equal(fetchStub.calls.length, 1);
      assert.deepEqual(waits, []);
    });
  }

  test('a network error or timeout is not retried', async () => {
    waits.length = 0;
    const origFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new TypeError('fetch failed');
    };
    try {
      await assert.rejects(
        () => callTtsWithTimestamps('ט', 'voice', 'eleven_v4', 'fake-key', 'en', {}, options),
        /fetch failed/,
      );
    } finally { globalThis.fetch = origFetch; }
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  });

  test('a voice ElevenLabs refuses (404 voice_not_found) is reported with its body and not retried', async () => {
    waits.length = 0;
    const refusal = '{"detail":{"status":"voice_not_found","message":"A voice with the voice_id missing-voice was not found."}}';
    const origFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return {ok: false, status: 404, text: async () => refusal};
    };
    try {
      await assert.rejects(
        () => callTtsWithTimestamps('ט', 'missing-voice', 'eleven_v4', 'fake-key', 'en', {}, options),
        (err) => {
          assert.ok(err.message.startsWith('ElevenLabs 404'), err.message);
          assert.match(err.message, /voice_not_found/);
          return true;
        },
      );
    } finally { globalThis.fetch = origFetch; }
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  });

  test('an error a retry cannot fix is reported at once', async () => {
    waits.length = 0;
    const fetchStub = withStatuses(401);
    try {
      await assert.rejects(
        () => callTtsWithTimestamps('ט', 'voice', 'eleven_v4', 'fake-key', 'en', {}, options),
        /ElevenLabs 401/,
      );
    } finally { fetchStub.restore(); }
    assert.equal(fetchStub.calls.length, 1);
    assert.deepEqual(waits, []);
  });
});
