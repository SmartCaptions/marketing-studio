// node --test scripts/finish-prepare.test.mjs — staging the effects library into a work directory
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {stageSfxLibrary} from './lib/finish-sound.mjs';

const inTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'finish-prepare-sfx-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
};

describe('stageSfxLibrary', () => {
  it('copies every effect into the work directory and reports it ready', () => {
    inTmp((dir) => {
      const studio = join(dir, 'studio-sfx');
      const work = join(dir, 'work', 'public', 'sfx');
      mkdirSync(studio, {recursive: true});
      const kinds = ['intro', 'swipe', 'riser', 'closing'];
      for (const k of kinds) writeFileSync(join(studio, `${k}.mp3`), k);
      writeFileSync(join(studio, 'notes.txt'), 'not an effect');
      assert.equal(stageSfxLibrary(studio, work), true);
      for (const k of kinds) assert.ok(existsSync(join(work, `${k}.mp3`)), `${k}.mp3 staged`);
      assert.equal(existsSync(join(work, 'notes.txt')), false);
    });
  });

  it('stages nothing and reports false when the library was never built', () => {
    inTmp((dir) => {
      const work = join(dir, 'work', 'public', 'sfx');
      assert.equal(stageSfxLibrary(join(dir, 'missing'), work), false);
      assert.equal(existsSync(work), false);
    });
  });
});
