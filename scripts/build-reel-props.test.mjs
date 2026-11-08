/**
 * Tests for build-reel-props.mjs
 *
 * ElevenLabs network calls are stubbed via a replaceable fetch.
 * File I/O is tested against a temp directory.
 */
import {describe, it, mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, rmSync, existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {groupToPhrases} from './build-reel-props.mjs';
import {withFakeTools} from './lib/fake-tools.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: groupToPhrases (shared caption-cue logic)
// ─────────────────────────────────────────────────────────────────────────────
describe('groupToPhrases', () => {
  const makeAlignment = (text, durationSec = 2) => {
    const chars = text.split('');
    const step = durationSec / chars.length;
    return {
      characters: chars,
      start: chars.map((_, i) => i * step),
      end: chars.map((_, i) => (i + 1) * step),
    };
  };

  it('empty input returns empty array', () => {
    const result = groupToPhrases([], [], [], 32);
    assert.deepEqual(result, []);
  });

  it('short text stays as one phrase', () => {
    const {characters: c, start, end} = makeAlignment('Hi there');
    const phrases = groupToPhrases(c, start, end, 32);
    assert.equal(phrases.length, 1);
    assert.equal(phrases[0].text, 'Hi there');
  });

  it('phrase respects maxChars boundary', () => {
    // "Open the panel now" = 18 chars; "transcribe the sequence" = 23 chars → split at 32
    const text = 'Open the panel now transcribe the sequence again';
    const {characters: c, start, end} = makeAlignment(text, 4);
    const phrases = groupToPhrases(c, start, end, 32);
    for (const p of phrases) {
      assert.ok(p.text.length <= 32, `phrase too long: "${p.text}"`);
    }
    assert.ok(phrases.length > 1, 'expected multiple phrases for long text');
  });

  it('all phrases have fromMs < toMs', () => {
    const text = 'כתוביות לפרמייר פרו בלחיצה אחת';
    const {characters: c, start, end} = makeAlignment(text, 3);
    const phrases = groupToPhrases(c, start, end);
    for (const p of phrases) {
      assert.ok(p.fromMs < p.toMs, `bad timing: ${JSON.stringify(p)}`);
    }
  });

  it('Hebrew + Latin mixed text grouped correctly', () => {
    const text = 'עובד עם Premiere Pro';
    const {characters: c, start, end} = makeAlignment(text, 2);
    const phrases = groupToPhrases(c, start, end, 32);
    const allText = phrases.map((p) => p.text).join(' ');
    assert.ok(allText.includes('Premiere Pro'), 'should preserve Latin in output');
    assert.ok(allText.includes('עובד'), 'should preserve Hebrew in output');
  });

  it('single word longer than maxChars stays as one phrase', () => {
    const {characters: c, start, end} = makeAlignment('supercalifragilistic');
    const phrases = groupToPhrases(c, start, end, 10);
    assert.equal(phrases.length, 1);
  });

  it('ms timing precision: values are integers', () => {
    const {characters: c, start, end} = makeAlignment('test phrase one two', 2);
    const phrases = groupToPhrases(c, start, end, 32);
    for (const p of phrases) {
      assert.ok(Number.isInteger(p.fromMs), 'fromMs should be integer');
      assert.ok(Number.isInteger(p.toMs), 'toMs should be integer');
    }
  });

  it('sentence period causes a break even under maxChars', () => {
    const text = 'הלקוח רוצה תמלול בעברית. בתוך Premiere Pro.';
    const {characters: c, start, end} = makeAlignment(text, 4);
    const phrases = groupToPhrases(c, start, end, 64); // large maxChars
    // Period must split the two sentences
    for (const p of phrases) {
      const crossesPeriod = p.text.includes('בעברית.') && p.text.includes('בתוך');
      assert.ok(!crossesPeriod, `cue crosses sentence boundary: "${p.text}"`);
    }
    // "Premiere Pro." should stay together in a single cue
    const premiereCue = phrases.find((p) => p.text.includes('Premiere'));
    assert.ok(premiereCue?.text.includes('Pro.'), '"Premiere Pro." split across cues');
  });

  it('phrases together cover full narration text', () => {
    const text = 'Open the panel pick settings and transcribe your sequence';
    const {characters: c, start, end} = makeAlignment(text, 4);
    const phrases = groupToPhrases(c, start, end, 32);
    const reconstructed = phrases.map((p) => p.text).join(' ');
    // Every word in original should appear in reconstructed
    for (const word of text.split(' ')) {
      assert.ok(reconstructed.includes(word), `word "${word}" missing from phrases`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration test: buildReelProps with stubbed fetch
// ─────────────────────────────────────────────────────────────────────────────
describe('buildReelProps (stubbed network)', () => {
  // Synthetic ElevenLabs alignment: 3 chars "Hi!" over 1 second
  const stubAlignment = {
    characters: ['H', 'i', '!'],
    character_start_times_seconds: [0.0, 0.3, 0.6],
    character_end_times_seconds: [0.3, 0.6, 0.9],
  };

  // Minimal mp3 buffer (32-byte placeholder — just needs to be non-empty)
  const stubMp3 = Buffer.alloc(32, 0xff);
  const stubAudioB64 = stubMp3.toString('base64');

  const stubFetch = async (url, opts) => {
    if (url.includes('/with-timestamps')) {
      return {
        ok: true,
        json: async () => ({
          audio_base64: stubAudioB64,
          alignment: stubAlignment,
        }),
      };
    }
    return {ok: false, text: async () => 'unexpected url', status: 500};
  };

  let jobCount = 0;
  // `narrations` lists the spoken lines: the first is an image scene, the rest are output scenes.
  // Any other key overrides the job's field of that name.
  const setupTmpJob = (language = 'he', {narrations = [language === 'he' ? 'שלום עולם' : 'Hello world'], ...jobExtra} = {}) => {
    const tmpBase = join(tmpdir(), `reel-test-${Date.now()}-${jobCount++}`);
    mkdirSync(tmpBase, {recursive: true});

    // Create a stub media file
    const mediaPath = join(tmpBase, 'still.png');
    writeFileSync(mediaPath, Buffer.alloc(64, 0));

    const outputDir = join(tmpBase, 'output');
    mkdirSync(outputDir, {recursive: true});

    const job = {
      schema_version: 1,
      id: 'test-reel-001',
      language,
      hook: language === 'he' ? 'כתוביות בלחיצה אחת' : 'Captions in one click',
      scenes: narrations.map((narration, i) =>
        i === 0
          ? {media: mediaPath, kind: 'image', narration}
          : {kind: 'output', lines: ['00:00:01,200 --> 00:00:03,400', narration], narration},
      ),
      cta: 'smartcaptions.co.il',
      ai_disclosure: true,
      output_dir: outputDir,
      ...jobExtra,
    };

    const jobPath = join(tmpBase, 'job.json');
    writeFileSync(jobPath, JSON.stringify(job));

    return {jobPath, outputDir, tmpBase};
  };

  it('builds valid props JSON for Hebrew job (stubbed)', async () => {
    const {jobPath, outputDir, tmpBase} = setupTmpJob('he');

    // Monkey-patch global fetch for this test
    const origFetch = globalThis.fetch;
    globalThis.fetch = stubFetch;

    try {
      const {buildReelProps} = await import('./build-reel-props.mjs');
      const {propsPath, props} = await buildReelProps({
        jobPath,
        apiKeyOverride: 'stub-key-he',
      });

      // Props file must exist
      assert.ok(existsSync(propsPath), 'reel-props.json not written');

      // Required fields
      assert.equal(props.brandId, 'smartcaptions');
      assert.equal(props.language, 'he');
      assert.ok(typeof props.hook === 'string' && props.hook.length > 0);
      assert.ok(Array.isArray(props.scenes) && props.scenes.length === 1);
      assert.ok(props.aiDisclosure === true);

      // Scene shape
      const scene = props.scenes[0];
      assert.equal(scene.kind, 'image');
      assert.ok(scene.audioSrc !== null, 'audioSrc should be set');
      assert.ok(scene.audioDurationMs > 0, 'audioDurationMs should be positive');
      assert.ok(Array.isArray(scene.captions), 'captions should be array');

    } finally {
      globalThis.fetch = origFetch;
      rmSync(tmpBase, {recursive: true, force: true});
    }
  });

  it('builds valid props JSON for English job (stubbed)', async () => {
    const {jobPath, outputDir, tmpBase} = setupTmpJob('en');

    const origFetch = globalThis.fetch;
    globalThis.fetch = stubFetch;

    try {
      const {buildReelProps} = await import('./build-reel-props.mjs');
      const {props} = await buildReelProps({
        jobPath,
        apiKeyOverride: 'stub-key-en',
      });

      assert.equal(props.language, 'en');
      assert.ok(props.scenes.length === 1);
    } finally {
      globalThis.fetch = origFetch;
      rmSync(tmpBase, {recursive: true, force: true});
    }
  });

  it('throws with actionable error when ELEVENLABS_API_KEY is missing', async () => {
    const {jobPath, tmpBase} = setupTmpJob('he');

    try {
      const {buildReelProps} = await import('./build-reel-props.mjs');
      await assert.rejects(
        () => buildReelProps({jobPath, apiKeyOverride: ''}),
        /ELEVENLABS_API_KEY/,
      );
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
    }
  });

  it('throws with actionable error when scene media is missing', async () => {
    const tmpBase = join(tmpdir(), `reel-test-missing-${Date.now()}`);
    mkdirSync(tmpBase, {recursive: true});

    const outputDir = join(tmpBase, 'output');
    mkdirSync(outputDir, {recursive: true});

    const job = {
      schema_version: 1,
      id: 'test-missing',
      language: 'en',
      hook: 'test',
      scenes: [{media: '/nonexistent/path/image.png', kind: 'image', narration: 'test narration'}],
      cta: 'test',
      ai_disclosure: false,
      output_dir: outputDir,
    };

    const jobPath = join(tmpBase, 'job.json');
    writeFileSync(jobPath, JSON.stringify(job));

    try {
      const {buildReelProps} = await import('./build-reel-props.mjs');
      await assert.rejects(
        () => buildReelProps({jobPath, apiKeyOverride: 'test-key'}),
        /not found/i,
      );
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
    }
  });

  it('rejects unknown schema_version', async () => {
    const tmpBase = join(tmpdir(), `reel-test-sv-${Date.now()}`);
    mkdirSync(tmpBase, {recursive: true});

    const outputDir = join(tmpBase, 'output');
    mkdirSync(outputDir);

    const job = {schema_version: 99, id: 'x', language: 'en', hook: 'x', scenes: [], cta: 'x', ai_disclosure: false, output_dir: outputDir};
    const jobPath = join(tmpBase, 'job.json');
    writeFileSync(jobPath, JSON.stringify(job));

    try {
      const {buildReelProps} = await import('./build-reel-props.mjs');
      await assert.rejects(
        () => buildReelProps({jobPath, apiKeyOverride: 'k'}),
        /schema_version/,
      );
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
    }
  });

  // ── The BrAInd contract: which voice speaks, and what result.json reports about it ──
  // Expectations come from the README (job `voice_id`, `voices.<language>`, `ttsSettings.<language>`,
  // `eleven_v4` for every line, result.json `voice_id` / `model` / `narration` [{text, audio}]).
  const brand = JSON.parse(readFileSync(join(ROOT, 'brands', 'smartcaptions.json'), 'utf8'));
  const publicReelDir = (id) => join(ROOT, 'studio', 'public', 'reels', id);

  /** Run buildReelProps against a fetch that records each TTS request. */
  const buildRecording = async (jobPath) => {
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({url, body: JSON.parse(opts.body)});
      return stubFetch(url, opts);
    };
    try {
      const {buildReelProps} = await import('./build-reel-props.mjs');
      const built = await buildReelProps({jobPath, apiKeyOverride: 'stub-key'});
      return {...built, calls};
    } finally {
      globalThis.fetch = origFetch;
    }
  };

  const ttsPath = (voiceId) => `/v1/text-to-speech/${voiceId}/with-timestamps`;

  it('speaks every line with the job voice_id', async () => {
    const id = 'test-contract-job-voice';
    const {jobPath, tmpBase} = setupTmpJob('en', {id, voice_id: 'job-chosen-voice', narrations: ['First line', 'Second line']});
    try {
      const {calls, voiceId} = await buildRecording(jobPath);
      assert.equal(calls.length, 2);
      for (const c of calls) assert.ok(c.url.endsWith(ttsPath('job-chosen-voice')), c.url);
      assert.equal(voiceId, 'job-chosen-voice');
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
      rmSync(publicReelDir(id), {recursive: true, force: true});
    }
  });

  it('speaks with the brand voice for the language when the job has no voice_id', async () => {
    const id = 'test-contract-brand-voice';
    const {jobPath, tmpBase} = setupTmpJob('en', {id});
    try {
      const {calls, voiceId} = await buildRecording(jobPath);
      assert.ok(calls[0].url.endsWith(ttsPath(brand.voices.en)), calls[0].url);
      assert.equal(voiceId, brand.voices.en);
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
      rmSync(publicReelDir(id), {recursive: true, force: true});
    }
  });

  it('accepts language "ar" and asks for the Arabic voice on eleven_v4 with the Arabic delivery', async () => {
    const id = 'test-contract-arabic';
    const narrations = ['مرحبا بالعالم', 'هذا هو الناتج'];
    const {jobPath, tmpBase} = setupTmpJob('ar', {id, narrations});
    try {
      const {props, calls} = await buildRecording(jobPath);
      assert.equal(props.language, 'ar');
      assert.equal(calls.length, 2);
      // ttsSettings.<language> is the only place a language's delivery is set; Arabic's block is optional
      const delivery = brand.ttsSettings?.ar ?? {};
      calls.forEach((c, i) => {
        assert.ok(c.url.endsWith(ttsPath(brand.voices.ar)), c.url);
        assert.equal(c.body.model_id, 'eleven_v4');
        assert.equal(c.body.text, `${delivery.tag ?? ''}${narrations[i]}`);
        assert.deepEqual(c.body.voice_settings, delivery.stability === undefined ? undefined : {stability: delivery.stability});
      });
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
      rmSync(publicReelDir(id), {recursive: true, force: true});
    }
  });

  it('result.json reports the voice_id, model and narration [{text, audio}] of the voice-over', async () => {
    const id = 'test-contract-result';
    const narrations = ['مرحبا بالعالم', 'هذا هو الناتج'];
    const {jobPath, outputDir, tmpBase} = setupTmpJob('ar', {id, voice_id: 'job-chosen-voice', narrations});
    const origFetch = globalThis.fetch;
    globalThis.fetch = stubFetch;
    try {
      const {main} = await import('./render-reel.mjs');
      await withFakeTools(() => main(['--job', jobPath], {apiKeyOverride: 'stub-key'}));

      const result = JSON.parse(readFileSync(join(outputDir, 'result.json'), 'utf8'));
      assert.equal(result.status, 'done');
      assert.equal(result.voice_id, 'job-chosen-voice');
      assert.equal(result.model, 'eleven_v4');
      assert.deepEqual(result.narration.map((n) => n.text), narrations);
      for (const n of result.narration) {
        assert.deepEqual(Object.keys(n).sort(), ['audio', 'text']);
        assert.deepEqual(readFileSync(n.audio), stubMp3, `no voice-over file at ${n.audio}`);
      }
    } finally {
      globalThis.fetch = origFetch;
      rmSync(tmpBase, {recursive: true, force: true});
      rmSync(publicReelDir(id), {recursive: true, force: true});
    }
  });
});
