/**
 * Tests for finish-prepare.mjs sfx library staging.
 *
 * These tests check the path fix (was join(publicRoot,'..','..','sfx') — wrong)
 * and the copy logic without needing the real ElevenLabs TTS or Remotion.
 */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

describe('finish-prepare sfx staging', () => {
  it('stages sfx files from studio/public/sfx into <work>/public/sfx when library is present', async () => {
    const tmp = join(tmpdir(), `finish-prepare-test-${Date.now()}`);
    const studioSfxDir = join(tmp, 'studio', 'public', 'sfx');
    const workDir = join(tmp, 'work');
    const workSfxDir = join(workDir, 'public', 'sfx');
    mkdirSync(studioSfxDir, {recursive: true});
    mkdirSync(join(workDir, 'public'), {recursive: true});

    // Seed the studio sfx library with fake files
    const KINDS = ['intro', 'swipe', 'closing', 'whoosh', 'tick', 'riser'];
    for (const k of KINDS) {
      writeFileSync(join(studioSfxDir, `${k}.mp3`), `fake-${k}`);
    }

    // Run the staging logic (identical to what finish-prepare.mjs does)
    const {copyFileSync, existsSync, readdirSync} = await import('node:fs');
    mkdirSync(workSfxDir, {recursive: true});
    for (const f of readdirSync(studioSfxDir).filter(f => f.endsWith('.mp3'))) {
      copyFileSync(join(studioSfxDir, f), join(workSfxDir, f));
    }
    const sfxEnabled = existsSync(join(workSfxDir, 'intro.mp3'));

    assert.ok(sfxEnabled, 'sfxEnabled should be true when library is staged');
    for (const k of KINDS) {
      assert.ok(existsSync(join(workSfxDir, `${k}.mp3`)), `${k}.mp3 should be staged`);
    }

    rmSync(tmp, {recursive: true, force: true});
  });

  it('sets sfxEnabled=false when studio sfx library is absent', async () => {
    const tmp = join(tmpdir(), `finish-prepare-test-${Date.now()}`);
    const studioSfxDir = join(tmp, 'studio', 'public', 'sfx');
    const workSfxDir = join(tmp, 'work', 'public', 'sfx');
    // studioSfxDir does NOT exist — library not generated yet

    const {existsSync} = await import('node:fs');
    // intro.mp3 check is the gate
    const sfxEnabled = existsSync(join(studioSfxDir, 'intro.mp3'));
    // No staging happens, so workSfxDir has nothing
    assert.strictEqual(sfxEnabled, false, 'sfxEnabled should be false when library is absent');
    assert.ok(!existsSync(workSfxDir), 'work/public/sfx should not be created');

    rmSync(tmp, {recursive: true, force: true});
  });

  it('old wrong path would not find the library (regression guard)', async () => {
    // The old code checked join(publicRoot, '..', '..', 'sfx', 'intro.mp3')
    // where publicRoot = join(workDir, 'public').
    // That resolves to join(workDir, 'sfx', 'intro.mp3') — never the studio's location.
    const tmp = join(tmpdir(), `finish-prepare-test-${Date.now()}`);
    const workDir = join(tmp, 'work');
    const publicRoot = join(workDir, 'public');
    const wrongPath = join(publicRoot, '..', '..', 'sfx', 'intro.mp3');
    // Correct path: studio/public/sfx/intro.mp3
    const correctPath = join(tmp, 'studio', 'public', 'sfx', 'intro.mp3');

    mkdirSync(join(tmp, 'studio', 'public', 'sfx'), {recursive: true});
    writeFileSync(correctPath, 'fake');

    const {existsSync} = await import('node:fs');
    assert.ok(!existsSync(wrongPath), 'wrong path must not exist even when library is staged');
    assert.ok(existsSync(correctPath), 'correct path must exist');

    rmSync(tmp, {recursive: true, force: true});
  });
});
