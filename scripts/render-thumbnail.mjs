#!/usr/bin/env node
/**
 * render-thumbnail.mjs — render a 1280×720 PNG thumbnail via the Thumbnail composition.
 *
 * Usage:
 *   node scripts/render-thumbnail.mjs --title "<title>" --language he|en|ar --out <abs.png>
 *
 * Options:
 *   --title <text>      Title text to display (required)
 *   --language <code>   Language code: he, en, or ar (required)
 *   --brand <id>        Brand id (default: smartcaptions)
 *   --out <path>        Absolute path for the output PNG (required)
 *
 * Exit 0 on success, exit 1 with one sentence to stderr on failure.
 */
import {execSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_DIR = `${ROOT}/studio`;

const args = process.argv.slice(2);
const get = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
};

const title = get('--title');
const language = get('--language');
const brandId = get('--brand') ?? 'smartcaptions';
const outPath = get('--out');

// Validate
const VALID_LANGS = ['he', 'en', 'ar'];
if (!title) {
  console.error('render-thumbnail: --title is required.');
  process.exit(1);
}
if (!language || !VALID_LANGS.includes(language)) {
  console.error(`render-thumbnail: --language must be one of ${VALID_LANGS.join(', ')}.`);
  process.exit(1);
}
if (!outPath) {
  console.error('render-thumbnail: --out is required (absolute path to .png).');
  process.exit(1);
}

const outAbs = resolve(outPath);

// Ensure output directory exists
try {
  mkdirSync(dirname(outAbs), {recursive: true});
} catch (err) {
  console.error(`render-thumbnail: cannot create output directory: ${err.message}`);
  process.exit(1);
}

// Write props JSON to a temp file
const propsDir = `${tmpdir()}/render-thumbnail-${randomBytes(4).toString('hex')}`;
mkdirSync(propsDir, {recursive: true});
const propsPath = `${propsDir}/thumbnail-props.json`;
const props = {brandId, title, language};
writeFileSync(propsPath, JSON.stringify(props));

// Run Remotion renderStill
try {
  execSync(
    `npx remotion still Thumbnail "${outAbs}" --props="${propsPath}"`,
    {cwd: STUDIO_DIR, stdio: 'inherit', timeout: 120_000},
  );
} catch (err) {
  console.error(`render-thumbnail: Remotion still render failed: ${err.message.slice(0, 200)}`);
  process.exit(1);
}

console.log(`render-thumbnail: written ${outAbs}`);
