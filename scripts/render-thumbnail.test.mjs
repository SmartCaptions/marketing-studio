// node --test scripts/render-thumbnail.test.mjs — render-thumbnail leaves no temp directory behind
import {describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'render-thumbnail.mjs');

/**
 * Run the real script with a fake `npx` first on PATH and a private TMPDIR, so the test needs no
 * Remotion and does not look at the shared /tmp. The fake copies the props file it was given to
 * `seen.json`, which shows the temp directory existed while the render ran.
 */
const runWithFakeNpx = (npxBody) => {
  const base = mkdtempSync(join(tmpdir(), 'render-thumbnail-test-'));
  try {
    const bin = join(base, 'bin');
    const scratch = join(base, 'tmp');
    mkdirSync(bin);
    mkdirSync(scratch);
    // `npx remotion still Thumbnail <out> --props=<file>`: $5 is the --props argument.
    writeFileSync(join(bin, 'npx'), `#!/bin/sh\ncp "\${5#--props=}" "${join(base, 'seen.json')}"\n${npxBody}\n`);
    chmodSync(join(bin, 'npx'), 0o755);
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--title', 'Hello', '--language', 'en', '--out', join(base, 'out', 'thumb.png')],
      {encoding: 'utf8', env: {...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: scratch}},
    );
    const seenPath = join(base, 'seen.json');
    return {
      result,
      leftovers: readdirSync(scratch).filter((name) => name.startsWith('render-thumbnail-')),
      seenProps: existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : null,
    };
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
};

describe('render-thumbnail.mjs temp directory', () => {
  test('a successful render removes its props directory', () => {
    const {result, leftovers, seenProps} = runWithFakeNpx('exit 0');
    assert.equal(result.status, 0);
    assert.match(result.stdout, /render-thumbnail: written .*thumb\.png/);
    assert.equal(result.stderr, '');
    assert.deepEqual(seenProps, {brandId: 'smartcaptions', title: 'Hello', language: 'en'});
    assert.deepEqual(leftovers, []);
  });

  test('a failed render removes its props directory and still exits 1 with one sentence', () => {
    const {result, leftovers, seenProps} = runWithFakeNpx('echo "Error: no composition with id Thumbnail" >&2\nexit 1');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'render-thumbnail: Remotion still render failed: Error: no composition with id Thumbnail\n');
    assert.deepEqual(seenProps, {brandId: 'smartcaptions', title: 'Hello', language: 'en'});
    assert.deepEqual(leftovers, []);
  });
});
