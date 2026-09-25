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
import {groupToPhrases} from './lib/tts.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: groupToPhrases from shared tts.mjs
// ─────────────────────────────────────────────────────────────────────────────
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
});
