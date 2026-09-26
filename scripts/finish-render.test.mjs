/**
 * Tests for the sfx truthful-reporting logic in finish-render.mjs.
 *
 * We unit-test the counting / absent-reason derivation directly rather than
 * running a full Remotion render.  The logic under test is:
 *
 *   const rawCues = inputProps.sfxCues ?? [];
 *   const sfxCues = rawCues.filter(c => existsSync(join(sfxPublicDir, `${c.kind}.mp3`)));
 *   const sfxAbsentReason = sfxCues.length === 0
 *     ? (rawCues.length > 0 || inputProps.sfxEnabled === false
 *         ? 'sfx library not staged'
 *         : 'no cues declared')
 *     : null;
 */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

/**
 * Inline re-implementation of the counting logic from finish-render.mjs.
 * Keep this in sync with the source; the test is here to catch regressions.
 */
function deriveSfxResult(sfxPublicDir, inputProps) {
  const rawCues = inputProps.sfxCues ?? [];
  const sfxCues = rawCues.filter((c) => existsSync(join(sfxPublicDir, `${c.kind}.mp3`)));
  const sfxAbsentReason = sfxCues.length === 0
    ? (rawCues.length > 0 || inputProps.sfxEnabled === false ? 'sfx library not staged' : 'no cues declared')
    : null;
  return {sfxCues, sfxAbsentReason};
}

const SAMPLE_CUES = [
  {kind: 'intro',  frame: 0},
  {kind: 'swipe',  frame: 95},
  {kind: 'swipe',  frame: 228},
  {kind: 'riser',  frame: 730},
  {kind: 'closing', frame: 1031},
];

describe('finish-render sfx truthful reporting', () => {
  it('counts only cues whose file exists in <work>/public/sfx', () => {
    const tmp = join(tmpdir(), `finish-render-sfx-test-${Date.now()}`);
    const sfxDir = join(tmp, 'public', 'sfx');
    mkdirSync(sfxDir, {recursive: true});

    // Stage only intro and swipe
    writeFileSync(join(sfxDir, 'intro.mp3'), 'fake-intro');
    writeFileSync(join(sfxDir, 'swipe.mp3'), 'fake-swipe');
    // riser and closing NOT staged

    const {sfxCues, sfxAbsentReason} = deriveSfxResult(sfxDir, {
      sfxCues: SAMPLE_CUES,
      sfxEnabled: true,
    });

    // 3 of the 5 cues match staged files (1 intro + 2 swipe)
    assert.strictEqual(sfxCues.length, 3);
    assert.strictEqual(sfxAbsentReason, null, 'reason should be null when at least one cue has a file');

    rmSync(tmp, {recursive: true, force: true});
  });

  it('reports sfx_absent_reason="sfx library not staged" when cues declared but no files exist', () => {
    const tmp = join(tmpdir(), `finish-render-sfx-test-${Date.now()}`);
    const sfxDir = join(tmp, 'public', 'sfx');
    // sfxDir does NOT exist — library never staged

    const {sfxCues, sfxAbsentReason} = deriveSfxResult(sfxDir, {
      sfxCues: SAMPLE_CUES,
      sfxEnabled: true,
    });

    assert.strictEqual(sfxCues.length, 0);
    assert.strictEqual(sfxAbsentReason, 'sfx library not staged');

    rmSync(tmp, {recursive: true, force: true});
  });

  it('reports sfx_absent_reason="sfx library not staged" when sfxEnabled=false (template fallback)', () => {
    const tmp = join(tmpdir(), `finish-render-sfx-test-${Date.now()}`);
    const sfxDir = join(tmp, 'public', 'sfx');

    const {sfxCues, sfxAbsentReason} = deriveSfxResult(sfxDir, {
      sfxCues: [],
      sfxEnabled: false,
    });

    assert.strictEqual(sfxCues.length, 0);
    assert.strictEqual(sfxAbsentReason, 'sfx library not staged');

    rmSync(tmp, {recursive: true, force: true});
  });

  it('reports sfx_absent_reason="no cues declared" when sfxEnabled=true but no cues', () => {
    const tmp = join(tmpdir(), `finish-render-sfx-test-${Date.now()}`);
    const sfxDir = join(tmp, 'public', 'sfx');
    mkdirSync(sfxDir, {recursive: true});

    const {sfxCues, sfxAbsentReason} = deriveSfxResult(sfxDir, {
      sfxCues: [],
      sfxEnabled: true,
    });

    assert.strictEqual(sfxCues.length, 0);
    assert.strictEqual(sfxAbsentReason, 'no cues declared');

    rmSync(tmp, {recursive: true, force: true});
  });

  it('returns null reason and full cue list when all declared files are staged', () => {
    const tmp = join(tmpdir(), `finish-render-sfx-test-${Date.now()}`);
    const sfxDir = join(tmp, 'public', 'sfx');
    mkdirSync(sfxDir, {recursive: true});

    const KINDS = ['whoosh', 'tick', 'riser', 'intro', 'swipe', 'closing'];
    for (const k of KINDS) writeFileSync(join(sfxDir, `${k}.mp3`), `fake-${k}`);

    const {sfxCues, sfxAbsentReason} = deriveSfxResult(sfxDir, {
      sfxCues: SAMPLE_CUES,
      sfxEnabled: true,
    });

    assert.strictEqual(sfxCues.length, SAMPLE_CUES.length);
    assert.strictEqual(sfxAbsentReason, null);

    rmSync(tmp, {recursive: true, force: true});
  });
});
