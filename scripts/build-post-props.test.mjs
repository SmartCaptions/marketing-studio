/**
 * Tests for build-post-props.mjs
 *
 * ElevenLabs TTS calls are mocked; file I/O uses a temp directory.
 */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, rmSync, existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {alignmentToWords, groupToPhrases} from './lib/tts.mjs';
import {withFakeTools} from './lib/fake-tools.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: groupToPhrases from shared tts.mjs
// ─────────────────────────────────────────────────────────────────────────────
describe('alignmentToWords (tts.mjs)', () => {
  it('rebuilds each spoken word with its start and end, for motion timed to the voice', () => {
    const chars = 'שש פעולות'.split('');
    const start = chars.map((_, i) => i * 0.1);
    const end = chars.map((_, i) => (i + 1) * 0.1);
    assert.deepEqual(alignmentToWords(chars, start, end), [
      {text: 'שש', startMs: 0, endMs: 200},
      {text: 'פעולות', startMs: 300, endMs: 900},
    ]);
  });
});

describe('groupToPhrases (tts.mjs)', () => {
  const makeAlignment = (text, durationSec = 2) => {
    const chars = text.split('');
    const step = durationSec / chars.length;
    return {
      characters: chars,
      start: chars.map((_, i) => i * step),
      end: chars.map((_, i) => (i + 1) * step),
    };
  };

  it('keeps a phrase whose last word the alignment gives no time on screen until the next one starts', () => {
    // "One two, three four." then "Five." — "three four." has zero length, as ElevenLabs v3 sometimes returns
    const text = 'One two, three four. Five.';
    const chars = text.split('');
    const start = chars.map((_, i) => (i < 9 ? i * 0.1 : i < 20 ? 0.9 : 1.4 + (i - 20) * 0.1));
    const end = chars.map((_, i) => (i < 9 ? (i + 1) * 0.1 : i < 20 ? 0.9 : 1.4 + (i - 19) * 0.1));
    const phrases = groupToPhrases(chars, start, end, 12);
    const zero = phrases.find((p) => p.text === 'three four.');
    assert.ok(zero, JSON.stringify(phrases));
    assert.equal(zero.toMs, 1400);
    const last = groupToPhrases('Hi.'.split(''), [0.2, 0.2, 0.2], [0.2, 0.2, 0.2]);
    assert.deepEqual(last, [{text: 'Hi.', fromMs: 200, toMs: 700}]);
  });

  it('empty input returns empty array', () => {
    assert.deepEqual(groupToPhrases([], [], [], 32), []);
  });

  it('short text stays as one phrase', () => {
    const {characters: c, start, end} = makeAlignment('Hi there');
    const phrases = groupToPhrases(c, start, end, 32);
    assert.equal(phrases.length, 1);
    assert.equal(phrases[0].text, 'Hi there');
  });

  it('respects maxChars boundary', () => {
    const text = 'Open the panel now transcribe the sequence again';
    const {characters: c, start, end} = makeAlignment(text, 4);
    const phrases = groupToPhrases(c, start, end, 32);
    for (const p of phrases) {
      assert.ok(p.text.length <= 32, `phrase too long: "${p.text}"`);
    }
    assert.ok(phrases.length > 1);
  });

  it('all phrases have fromMs < toMs', () => {
    const text = 'כתוביות לפרמייר פרו בלחיצה אחת';
    const {characters: c, start, end} = makeAlignment(text, 3);
    const phrases = groupToPhrases(c, start, end);
    for (const p of phrases) {
      assert.ok(p.fromMs < p.toMs, `bad timing: ${JSON.stringify(p)}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: job validation (via buildPostProps with a mocked TTS)
// ─────────────────────────────────────────────────────────────────────────────
describe('buildPostProps job validation', () => {
  const tmpDir = join(tmpdir(), `test-post-${Date.now()}`);
  mkdirSync(tmpDir, {recursive: true});

  // Minimal valid job
  const validJob = (overrides = {}) => ({
    schema_version: 1,
    id: 'test-job',
    language: 'he',
    look: 'studio',
    ai_disclosure: false,
    output_dir: tmpDir,
    attribution: null,
    shots: [
      {
        kind: 'title',
        narration: 'שלום עולם',
        heading: 'בדיקה',
      },
      {
        kind: 'end',
        narration: 'SmartCaptions',
      },
    ],
    ...overrides,
  });

  // Import dynamically so we can intercept; we test validation only (not TTS)
  it('rejects wrong schema_version', async () => {
    const {buildPostProps} = await import('./build-post-props.mjs');
    const jobPath = join(tmpDir, 'bad-schema.json');
    writeFileSync(jobPath, JSON.stringify({...validJob(), schema_version: 99}));
    await assert.rejects(
      () => buildPostProps({jobPath, apiKeyOverride: 'fake'}),
      /schema_version/i,
    );
  });

  it('rejects invalid language', async () => {
    const {buildPostProps} = await import('./build-post-props.mjs');
    const jobPath = join(tmpDir, 'bad-lang.json');
    writeFileSync(jobPath, JSON.stringify({...validJob(), language: 'fr'}));
    await assert.rejects(
      () => buildPostProps({jobPath, apiKeyOverride: 'fake'}),
      /language/i,
    );
  });

  it('rejects invalid look', async () => {
    const {buildPostProps} = await import('./build-post-props.mjs');
    const jobPath = join(tmpDir, 'bad-look.json');
    writeFileSync(jobPath, JSON.stringify({...validJob(), look: 'retro'}));
    await assert.rejects(
      () => buildPostProps({jobPath, apiKeyOverride: 'fake'}),
      /look/i,
    );
  });

  it('rejects recording shot with missing media', async () => {
    const {buildPostProps} = await import('./build-post-props.mjs');
    const jobPath = join(tmpDir, 'missing-media.json');
    const job = validJob();
    job.shots.push({kind: 'recording', narration: 'test', media: '/nonexistent/file.mp4'});
    writeFileSync(jobPath, JSON.stringify(job));
    await assert.rejects(
      () => buildPostProps({jobPath, apiKeyOverride: 'fake'}),
      /not found|media/i,
    );
  });

  it('rejects empty narration', async () => {
    const {buildPostProps} = await import('./build-post-props.mjs');
    const jobPath = join(tmpDir, 'empty-narration.json');
    const job = validJob();
    job.shots[0].narration = '';
    writeFileSync(jobPath, JSON.stringify(job));
    await assert.rejects(
      () => buildPostProps({jobPath, apiKeyOverride: 'fake'}),
      /narration/i,
    );
  });

  it('rejects missing ELEVENLABS_API_KEY when explicitly overridden to empty', async () => {
    // We set apiKeyOverride to an empty string to simulate "no key configured"
    // without having to remove the real .env file. The validator checks for a
    // falsy apiKey value.
    const {buildPostProps} = await import('./build-post-props.mjs');
    const jobPath = join(tmpDir, 'no-key.json');
    writeFileSync(jobPath, JSON.stringify(validJob()));
    await assert.rejects(
      () => buildPostProps({jobPath, apiKeyOverride: ''}),
      /ELEVENLABS_API_KEY/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: SRT builder (timing correctness)
// ─────────────────────────────────────────────────────────────────────────────
describe('SRT timing', () => {
  // Mirror the msToSrtTime helper from render-post.mjs inline
  const msToSrtTime = (ms) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const ms3 = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms3).padStart(3, '0')}`;
  };

  it('formats zero as 00:00:00,000', () => {
    assert.equal(msToSrtTime(0), '00:00:00,000');
  });

  it('formats 1 hour 2 min 3.4 sec', () => {
    const ms = (1 * 3600 + 2 * 60 + 3) * 1000 + 400;
    assert.equal(msToSrtTime(ms), '01:02:03,400');
  });
});

describe('stageMedia', () => {
  it('crops a screenshot to a real PNG (not a video in a .png name)', async () => {
    const {stageMedia} = await import('./build-post-props.mjs');
    const {spawnSync} = await import('node:child_process');
    const dir = join(tmpdir(), `stage-${Date.now()}`);
    mkdirSync(dir, {recursive: true});
    const src = join(dir, 'panel.png');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x223344:s=1360x800', '-frames:v', '1', src]);
    const out = join(dir, 'public');
    mkdirSync(out, {recursive: true});
    stageMedia(src, 1, 'png', out, {crop: [460, 292, 900, 778]});
    const staged = readFileSync(join(out, 'shot-1-media.png'));
    // PNG signature
    assert.deepEqual([...staged.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    rmSync(dir, {recursive: true, force: true});
  });

  it('cuts a recording beat to its range and crop as H.264 video', async () => {
    const {stageMedia} = await import('./build-post-props.mjs');
    const {spawnSync} = await import('node:child_process');
    const dir = join(tmpdir(), `stage-video-${Date.now()}`);
    mkdirSync(dir, {recursive: true});
    const src = join(dir, 'rec.mp4');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=1920x1080:r=30', '-t', '8', '-pix_fmt', 'yuv420p', src]);
    const out = join(dir, 'public');
    mkdirSync(out, {recursive: true});
    const staged = stageMedia(src, 2, 'mp4', out, {crop: [1160, 200, 1740, 1060], startS: 3.5, endS: 6});
    assert.equal(staged.mediaCropped, true);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', join(out, 'shot-2-media.mp4')], {encoding: 'utf8'});
    const info = JSON.parse(probe.stdout);
    assert.deepEqual([info.streams[0].codec_name, info.streams[0].width, info.streams[0].height], ['h264', 580, 860]);
    assert.ok(Math.abs(Number(info.format.duration) - 2.5) < 0.2, `duration ${info.format.duration}`);
    rmSync(dir, {recursive: true, force: true});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The BrAInd contract: which voice speaks, and what result.json reports about it
// (expectations from the README: job `voice_id`, `voices.<language>`, `ttsSettings.<language>`,
// `eleven_v4` for every line, result.json `voice_id` / `model` / `narration` [{text, audio}])
// ─────────────────────────────────────────────────────────────────────────────
describe('HybridPost voice contract (stubbed network)', () => {
  const brand = JSON.parse(readFileSync(join(ROOT, 'brands', 'smartcaptions.json'), 'utf8'));
  const stubMp3 = Buffer.alloc(32, 0xff);
  const stubFetch = async (url) => {
    if (url.includes('/with-timestamps')) {
      return {
        ok: true,
        json: async () => ({
          audio_base64: stubMp3.toString('base64'),
          alignment: {
            characters: ['H', 'i', '!'],
            character_start_times_seconds: [0.0, 0.3, 0.6],
            character_end_times_seconds: [0.3, 0.6, 0.9],
          },
        }),
      };
    }
    return {ok: false, text: async () => 'unexpected url', status: 500};
  };
  const ttsPath = (voiceId) => `/v1/text-to-speech/${voiceId}/with-timestamps`;

  let jobCount = 0;
  const setupJob = (language, narrations, jobExtra = {}) => {
    const tmpBase = join(tmpdir(), `post-contract-${Date.now()}-${jobCount++}`);
    const outputDir = join(tmpBase, 'output');
    mkdirSync(outputDir, {recursive: true});
    const id = `test-post-contract-${jobCount}`;
    const job = {
      schema_version: 1,
      id,
      language,
      look: 'studio',
      ai_disclosure: false,
      output_dir: outputDir,
      attribution: null,
      shots: [
        {kind: 'title', narration: narrations[0], heading: 'x'},
        {kind: 'end', narration: narrations[1]},
      ],
      ...jobExtra,
    };
    const jobPath = join(tmpBase, 'job.json');
    writeFileSync(jobPath, JSON.stringify(job));
    // render-post stages under studio/public/posts/<id>--<output dir name>
    const publicDir = join(ROOT, 'studio', 'public', 'posts', `${id}--output`);
    return {jobPath, outputDir, tmpBase, publicDir};
  };

  /** Run buildPostProps against a fetch that records each TTS request. */
  const buildRecording = async (jobPath, publicRoot) => {
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({url, body: JSON.parse(opts.body)});
      return stubFetch(url, opts);
    };
    try {
      const {buildPostProps} = await import('./build-post-props.mjs');
      // The music feeder is spawned as `node feeders/audio/client.mjs`; the fake tools keep it off the network
      const built = await withFakeTools(() => buildPostProps({jobPath, apiKeyOverride: 'stub-key', publicRoot}));
      return {...built, calls};
    } finally {
      globalThis.fetch = origFetch;
    }
  };

  it('speaks every shot with the job voice_id', async () => {
    const {jobPath, tmpBase} = setupJob('en', ['First line', 'Second line'], {voice_id: 'job-chosen-voice'});
    try {
      const {calls, voiceId} = await buildRecording(jobPath, join(tmpBase, 'public'));
      assert.equal(calls.length, 2);
      for (const c of calls) assert.ok(c.url.endsWith(ttsPath('job-chosen-voice')), c.url);
      assert.equal(voiceId, 'job-chosen-voice');
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
    }
  });

  it('speaks with the brand voice for the language when the job has no voice_id', async () => {
    const {jobPath, tmpBase} = setupJob('en', ['First line', 'Second line']);
    try {
      const {calls, voiceId} = await buildRecording(jobPath, join(tmpBase, 'public'));
      assert.ok(calls[0].url.endsWith(ttsPath(brand.voices.en)), calls[0].url);
      assert.equal(voiceId, brand.voices.en);
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
    }
  });

  it('accepts language "ar" and asks for the Arabic voice on eleven_v4 with the Arabic delivery', async () => {
    const narrations = ['مرحبا بالعالم', 'هذا هو الناتج'];
    const {jobPath, tmpBase} = setupJob('ar', narrations);
    try {
      const {props, calls, modelId} = await buildRecording(jobPath, join(tmpBase, 'public'));
      assert.equal(props.language, 'ar');
      assert.equal(modelId, 'eleven_v4');
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
    }
  });

  it('result.json reports the voice_id, model and narration [{text, audio}] of the voice-over', async () => {
    const narrations = ['مرحبا بالعالم', 'هذا هو الناتج'];
    const {jobPath, outputDir, tmpBase, publicDir} = setupJob('ar', narrations, {voice_id: 'job-chosen-voice'});
    const origFetch = globalThis.fetch;
    globalThis.fetch = stubFetch;
    try {
      const {main} = await import('./render-post.mjs');
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
      rmSync(publicDir, {recursive: true, force: true});
    }
  });
});
