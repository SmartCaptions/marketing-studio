import {execSync} from 'node:child_process';
import {copyFileSync, cpSync, existsSync, mkdirSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'smoke');
mkdirSync(outDir, {recursive: true});

const compositions = ['ComponentGallery', 'SocialClip', 'ProductDemo', 'LogoReveal', 'LaunchVideo', 'AnimatedOG', 'StoryReel', 'HybridPost'];

for (const id of compositions) {
  const out = join(outDir, `${id}.png`);
  console.log(`smoke: rendering frame 0 of ${id}`);
  execSync(`npx remotion still ${id} "${out}" --frame=0`, {
    cwd: join(root, 'studio'),
    stdio: 'inherit',
  });
  if (!existsSync(out)) {
    console.error(`smoke FAILED: ${out} was not produced`);
    process.exit(1);
  }
}
// Finish has its own entry and renders only through finish-render.mjs, from a work directory
const work = join(outDir, 'finish-work');
rmSync(work, {recursive: true, force: true});
cpSync(join(root, 'studio', 'src', 'finish', 'example'), work, {recursive: true});
mkdirSync(join(work, 'public'), {recursive: true});
console.log('smoke: rendering frame 0 of Finish (the example work directory)');
execSync(`node scripts/finish-render.mjs --work "${work}" --frames 0`, {cwd: root, stdio: 'inherit'});
const finishStill = join(work, 'frames', 'f00000.png');
if (!existsSync(finishStill)) {
  console.error(`smoke FAILED: ${finishStill} was not produced`);
  process.exit(1);
}
copyFileSync(finishStill, join(outDir, 'Finish.png'));
console.log(`smoke OK: ${compositions.length + 1} compositions rendered to out/smoke/`);
