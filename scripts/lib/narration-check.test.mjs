import {strict as assert} from 'node:assert';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {charSim, checkLines, normalise, scribeTranscriber, wordMatch} from './narration-check.mjs';

describe('normalise', () => {
  test('removes Arabic diacritics, tatweel and punctuation', () => {
    assert.equal(normalise('مَرحَباً، بالعـــالم!'), 'مرحبا بالعالم');
  });

  test('lower-cases Latin words and collapses whitespace', () => {
    assert.equal(normalise('  Premiere   Pro. '), 'premiere pro');
  });
});

describe('charSim and wordMatch', () => {
  test('identical words are 1, unrelated words are low', () => {
    assert.equal(charSim('الترجمة', 'الترجمة'), 1);
    assert.ok(charSim('الترجمة', 'العميل') < 0.5);
  });

  test('a one-letter spelling variant still counts as the same word', () => {
    assert.ok(charSim('الترجمة', 'الترجمه') >= 0.8);
  });

  test('counts how many script words the transcript holds', () => {
    assert.deepEqual(wordMatch('قبل التصدير شاهد المقطع', 'قبل التصدير شاهد'), {matched: 3, total: 4});
  });

  test('ignores diacritics and punctuation when comparing', () => {
    assert.deepEqual(wordMatch('كَتَبَ، الاسمَ.', 'كتب الاسم'), {matched: 2, total: 2});
  });
});

describe('checkLines', () => {
  const transcriptsByAudio = (map) => async (audio) => map[audio];

  test('passes when the transcript says what the script says', async () => {
    const result = await checkLines({
      lines: [{text: 'قبل التصدير شاهد المقطع', audio: 'a.mp3'}],
      transcribe: transcriptsByAudio({'a.mp3': 'قبل التصدير شاهد المقطع'}),
      minMatch: 0.9,
    });
    assert.equal(result.passed, true);
    assert.equal(result.match, 1);
  });

  test('fails when the voice-over says something else', async () => {
    const result = await checkLines({
      lines: [{text: 'قبل التصدير شاهد المقطع', audio: 'a.mp3'}],
      transcribe: transcriptsByAudio({'a.mp3': 'اشتر الآن بنصف السعر'}),
      minMatch: 0.9,
    });
    assert.equal(result.passed, false);
    assert.ok(result.lines[0].match < 0.5);
  });

  test('the threshold is over the whole script, not each line on its own', async () => {
    // Line 1: 6 of 7 words heard (0.857). Line 2: 14 of 14. Whole script: 20 of 21 (0.952).
    const seven = 'واحد اثنان ثلاثة اربعة خمسة ستة سبعة';
    const fourteen = 'ثمانية تسعة عشرة حادي ثاني ثالث رابع خامس سادس سابع ثامن تاسع عاشر اخير';
    const result = await checkLines({
      lines: [
        {text: seven, audio: 'a.mp3'},
        {text: fourteen, audio: 'b.mp3'},
      ],
      transcribe: transcriptsByAudio({'a.mp3': 'واحد اثنان ثلاثة اربعة خمسة ستة', 'b.mp3': fourteen}),
      minMatch: 0.9,
    });
    assert.ok(result.lines[0].match < 0.9);
    assert.equal(result.passed, true);
    assert.ok(Math.abs(result.match - 20 / 21) < 1e-9);
  });
});

describe('scribeTranscriber', () => {
  const audio = join(mkdtempSync(join(tmpdir(), 'narration-check-')), 'line.mp3');
  writeFileSync(audio, 'not really audio');

  const response = (status, body = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const fetchReturning = (...statuses) => {
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({url, init});
      const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
      return response(status, status === 200 ? {text: 'مرحبا بالعالم'} : {error: 'busy'});
    };
    return {fetchFn, calls};
  };
  const noWait = () => {
    const waits = [];
    return {sleep: async (ms) => waits.push(ms), waits};
  };

  test('asks Scribe for the language and returns the transcript', async () => {
    const {fetchFn, calls} = fetchReturning(200);
    const transcribe = scribeTranscriber({apiKey: 'k', language: 'ar', fetchFn});
    assert.equal(await transcribe(audio), 'مرحبا بالعالم');
    assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/speech-to-text');
    assert.equal(calls[0].init.body.get('model_id'), 'scribe_v2');
    assert.equal(calls[0].init.body.get('language_code'), 'ara');
  });

  test('retries a 429 after the listed delays and then succeeds', async () => {
    const {fetchFn, calls} = fetchReturning(429, 503, 200);
    const {sleep, waits} = noWait();
    const transcribe = scribeTranscriber({apiKey: 'k', language: 'he', fetchFn, sleep, retryDelays: [10, 20]});
    assert.equal(await transcribe(audio), 'مرحبا بالعالم');
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [10, 20]);
  });

  test('gives up when the delays run out, and says which status it got', async () => {
    const {fetchFn, calls} = fetchReturning(429);
    const {sleep} = noWait();
    const transcribe = scribeTranscriber({apiKey: 'k', language: 'ar', fetchFn, sleep, retryDelays: [1, 1]});
    await assert.rejects(() => transcribe(audio), /Scribe returned 429/);
    assert.equal(calls.length, 3);
  });

  test('does not retry an error a retry cannot fix', async () => {
    const {fetchFn, calls} = fetchReturning(401);
    const transcribe = scribeTranscriber({apiKey: 'k', language: 'ar', fetchFn, sleep: async () => {}});
    await assert.rejects(() => transcribe(audio), /Scribe returned 401/);
    assert.equal(calls.length, 1);
  });
});
