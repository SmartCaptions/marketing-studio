// node --test scripts/lib/finish-lint.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findLiteralText} from './finish-lint.mjs';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'studio');

const lint = (files) => {
  const src = mkdtempSync(join(tmpdir(), 'finish-lint-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(src, name)), {recursive: true});
    writeFileSync(join(src, name), text);
  }
  return findLiteralText(src, STUDIO);
};

test('words shown through the kit and style values pass', () => {
  assert.deepEqual(
    lint({
      'Visuals.tsx': `
        export const USES: string[] = [];
        export const Visuals = () => (
          <div style={{textAlign: 'center', fontFamily: 'Rubik'}} className="card">
            <T k="headline" />
            {useWord('sub').split(' ').map((w) => <span key={w}>{w}</span>)}
            {' '}
          </div>
        );`,
    }),
    [],
  );
});

test('text written in the JSX is refused with its file and line, in every file', () => {
  const problems = lint({
    'Visuals.tsx': `export const Visuals = () => (\n  <div>99% מדויק</div>\n);`,
    'parts/Card.tsx': `export const Card = ({on}) => <p>{on ? 'Best captions' : null}</p>;`,
    'parts/Tag.tsx': 'export const Tag = ({n}) => <b>{`Step ${n}`}</b>;',
  });
  assert.equal(problems.length, 3);
  assert.match(problems.find((p) => p.startsWith('Visuals.tsx')), /^Visuals\.tsx:2: text "99% מדויק"/);
  assert.match(problems.find((p) => p.includes('Card')), /parts\/Card\.tsx:1: text "Best captions"/);
  assert.match(problems.find((p) => p.includes('Tag')), /parts\/Tag\.tsx:1: text "Step "/);
});
