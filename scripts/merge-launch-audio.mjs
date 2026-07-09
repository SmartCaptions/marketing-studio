// Merges props/noban-launch.json with props/noban-audio.json for rendering/preview.
// Used by the Task 4 still-render validation and by every future noban audio render
// (Task 5 onward) — do not fold this into build-noban-audio.mjs or build-launch-props.mjs.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const launch = JSON.parse(readFileSync(join(root, 'props', 'noban-launch.json'), 'utf8'));
const audio = JSON.parse(readFileSync(join(root, 'props', 'noban-audio.json'), 'utf8'));

const merged = {...launch, audio};

const outPath = join(root, 'out', 'noban', 'launch-audio-props.json');
mkdirSync(dirname(outPath), {recursive: true});
writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
console.log(`wrote ${outPath}`);
