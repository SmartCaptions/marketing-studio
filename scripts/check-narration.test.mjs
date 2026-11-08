import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-narration.mjs');
const run = (...args) => spawnSync('node', [SCRIPT, ...args], {encoding: 'utf8'});

describe('check-narration.mjs usage errors', () => {
  test('--input is required', () => {
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--input is required/);
  });

  test('--input must be JSON', () => {
    const result = run('--input', 'not json');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be valid JSON/);
  });

  test('the input needs a language and at least one line', () => {
    const result = run('--input', JSON.stringify({language: 'ar', lines: []}));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /non-empty lines array/);
  });

  test('--min-match must be between 0 and 1', () => {
    const input = JSON.stringify({language: 'ar', lines: [{text: 'x', audio: '/a.mp3'}]});
    const result = run('--input', input, '--min-match', '2');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /between 0 and 1/);
  });
});
