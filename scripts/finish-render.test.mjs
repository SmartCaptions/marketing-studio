// node --test scripts/finish-render.test.mjs — which declared cues finish-render reports as playing
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {audibleCues} from './lib/finish-sound.mjs';

const CUES = [
  {kind: 'intro', frame: 0},
  {kind: 'swipe', frame: 95},
  {kind: 'riser', frame: 730},
  {kind: 'closing', frame: 1031},
];

const withSfx = (kinds, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'finish-render-sfx-'));
  try {
    const sfx = join(dir, 'public', 'sfx');
    mkdirSync(sfx, {recursive: true});
    for (const k of kinds) writeFileSync(join(sfx, `${k}.mp3`), k);
    fn(sfx);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
};

describe('audibleCues', () => {
  it('counts only the cues whose file is staged', () => {
    withSfx(['intro', 'swipe'], (sfx) => {
      const {sfxCues, sfxAbsentReason} = audibleCues(sfx, {sfxCues: CUES, sfxEnabled: true});
      assert.deepEqual(sfxCues.map((c) => c.kind), ['intro', 'swipe']);
      assert.equal(sfxAbsentReason, null);
    });
  });

  it('reports the library as not staged when cues were declared but none can play', () => {
    withSfx([], (sfx) => {
      assert.deepEqual(audibleCues(sfx, {sfxCues: CUES, sfxEnabled: true}), {sfxCues: [], sfxAbsentReason: 'sfx library not staged'});
    });
  });

  it('reports the library as not staged when prepare found none, even without cues', () => {
    withSfx([], (sfx) => {
      assert.equal(audibleCues(sfx, {sfxEnabled: false}).sfxAbsentReason, 'sfx library not staged');
    });
  });

  it('says no cues were declared when the library is there but the session placed none', () => {
    withSfx(['intro'], (sfx) => {
      assert.equal(audibleCues(sfx, {sfxEnabled: true}).sfxAbsentReason, 'no cues declared');
    });
  });
});
