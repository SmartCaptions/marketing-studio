// node --test scripts/lib/postMusic.test.mjs
import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildMusicPrompt, generatePostMusic} from './postMusic.mjs';

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
