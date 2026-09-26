// node --test scripts/lib/postMusic.test.mjs
import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildMusicPrompt, effectGains, generatePostMusic, levelToVoice, measureLufs} from './postMusic.mjs';

// ─── buildMusicPrompt ────────────────────────────────────────────────────────

describe('buildMusicPrompt', () => {
  test('collage look yields warm acoustic descriptor', () => {
    const p = buildMusicPrompt('en', 'collage', undefined);
    assert.ok(p.includes('acoustic'), `expected "acoustic" in "${p}"`);
  });

  test('studio look yields electronic descriptor', () => {
    const p = buildMusicPrompt('en', 'studio', undefined);
    assert.ok(p.includes('electronic'), `expected "electronic" in "${p}"`);
  });

  test('Hebrew language adds upbeat/energetic descriptor', () => {
    const p = buildMusicPrompt('he', 'studio', undefined);
    assert.ok(p.includes('upbeat') || p.includes('energetic'), `expected energetic feel in "${p}"`);
  });

  test('tip postType adds informative/dynamic descriptor', () => {
    const p = buildMusicPrompt('en', 'studio', 'quick_tip');
    assert.ok(p.includes('informative') || p.includes('dynamic'), `expected informative in "${p}"`);
  });

  test('demo postType adds engaging/clear descriptor', () => {
    const p = buildMusicPrompt('en', 'studio', 'product_demo');
    assert.ok(p.includes('engaging') || p.includes('clear'), `expected engaging in "${p}"`);
  });

  test('always ends with no-lyrics/no-vocals qualifier', () => {
    const p = buildMusicPrompt('en', 'studio', undefined);
    assert.ok(p.includes('no lyrics') || p.includes('no vocals'), `expected no-lyrics in "${p}"`);
  });
});

// ─── generatePostMusic: cache hit ────────────────────────────────────────────

describe('generatePostMusic cache hit', () => {
  test('reuses cached track when duration/look/language match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'postMusic-test-'));
    try {
      const musicPath = join(dir, 'music.mp3');
      const metaPath = join(dir, 'music-meta.json');
      writeFileSync(musicPath, 'fake-mp3');
      writeFileSync(metaPath, JSON.stringify({
        durationMs: 10_000,
        look: 'studio',
        language: 'en',
        generatedAt: new Date().toISOString(),
      }));

      const result = await generatePostMusic({
        postPublicDir: dir,
        publicRoot: dir,
        totalDurationMs: 10_000,
        language: 'en',
        look: 'studio',
        postType: undefined,
        root: dir, // feeder won't be called
      });

      assert.ok(result.music !== null, 'expected cached music to be returned');
      assert.equal(result.musicAbsentReason, null);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('invalidates cache when look changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'postMusic-test-'));
    try {
      const musicPath = join(dir, 'music.mp3');
      const metaPath = join(dir, 'music-meta.json');
      writeFileSync(musicPath, 'fake-mp3');
      writeFileSync(metaPath, JSON.stringify({
        durationMs: 10_000,
        look: 'collage',  // different from request
        language: 'en',
        generatedAt: new Date().toISOString(),
      }));

      const result = await generatePostMusic({
        postPublicDir: dir,
        publicRoot: dir,
        totalDurationMs: 10_000,
        language: 'en',
        look: 'studio',  // request is 'studio'
        postType: undefined,
        root: '/nonexistent-root-will-fail-feeder',
      });

      // Cache miss → tries to generate → feeder fails → absent reason
      assert.equal(result.music, null);
      assert.ok(typeof result.musicAbsentReason === 'string' && result.musicAbsentReason.length > 0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ─── generatePostMusic: feeder failure ───────────────────────────────────────

describe('generatePostMusic feeder failure', () => {
  test('returns music:null with absent reason when feeder exits non-zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'postMusic-test-'));
    try {
      // No cache files present; feeder will fail (no such cwd)
      const result = await generatePostMusic({
        postPublicDir: dir,
        publicRoot: dir,
        totalDurationMs: 8_000,
        language: 'en',
        look: 'studio',
        postType: undefined,
        root: '/definitely-nonexistent-root-xyz-12345',
      });
      assert.equal(result.music, null);
      assert.ok(typeof result.musicAbsentReason === 'string' && result.musicAbsentReason.length > 0,
        `expected absent reason, got: ${result.musicAbsentReason}`);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ─── levelToVoice ────────────────────────────────────────────────────────────

describe('levelToVoice', () => {
  const tone = (path, db) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
      'sine=frequency=440:duration=4', '-af', `volume=${db}dB`, path]);
    assert.equal(r.status, 0);
  };

  test('brings a hot track to the voice loudness (±1 LU)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postMusic-level-'));
    try {
      const voice = join(dir, 'voice.mp3');
      const raw = join(dir, 'raw.mp3');
      const out = join(dir, 'music.mp3');
      tone(voice, -20);
      tone(raw, -4);
      const gain = levelToVoice({rawPath: raw, outPath: out, voiceFiles: [voice]});
      assert.ok(gain !== null && gain < -10, `expected a large cut, got ${gain}`);
      assert.ok(Math.abs(measureLufs([out]) - measureLufs([voice])) <= 1);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('leaves an unreadable track unlevelled rather than failing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postMusic-level-'));
    try {
      const raw = join(dir, 'raw.mp3');
      writeFileSync(raw, 'not audio');
      assert.equal(levelToVoice({rawPath: raw, outPath: join(dir, 'music.mp3'), voiceFiles: [raw]}), null);
      assert.ok(existsSync(join(dir, 'music.mp3')));
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ─── effectGains ─────────────────────────────────────────────────────────────

describe('effectGains', () => {
  test('sets each staged effect under the voice by its offset, and skips missing ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postMusic-fx-'));
    try {
      const make = (path, db) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
        'sine=frequency=660:duration=2', '-af', `volume=${db}dB`, path]);
      const voice = join(dir, 'voice.mp3');
      make(voice, -20);
      make(join(dir, 'intro.mp3'), -6);
      const gains = effectGains({sfxDir: dir, voiceFiles: [voice]});
      assert.deepEqual(Object.keys(gains), ['intro']);
      // intro sits 4 dB under the voice: gain ≈ 10^((-20 - 4 - -6)/20) ≈ 0.126
      assert.ok(Math.abs(gains.intro - 0.126) < 0.02, `got ${gains.intro}`);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
