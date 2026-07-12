// Renders the SmartCaptions AnimatedOG static-plus exports: the OG image PNG
// (1200x630), the 8s seamless animated OG loop (og.mp4, og.gif), and the
// README GIF (readme.gif at 0.5 scale = 600x315).
//
// No ComfyUI hero (client.mjs is noban-hardwired; procedural fallback is
// spec-compliant for this brand) and no Blender background loop (none staged
// for smartcaptions; the brand blue wash is the backdrop). The AnimatedOG
// loop is seamless by construction: cycle = frame/durationInFrames is periodic,
// every animated value satisfies f(0) == f(T). --every-nth-frame=2 divides
// durationInFrames=240 evenly, preserving the seam in GIF exports.
import {mkdirSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'smartcaptions');
mkdirSync(outDir, {recursive: true});

const props = {
  brandId: 'smartcaptions',
  tagline: 'AI Captions & Subtitles for Premiere Pro, in One Click',
  cta: 'Try free at smartcaptions.co.il',
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};
const propsPath = join(outDir, 'og-props.json');
writeFileSync(propsPath, JSON.stringify(props));

const studioDir = join(root, 'studio');

const still = (out, width, height) => {
  console.log(`still: ${out} (${width}x${height})`);
  execSync(
    `npx remotion still AnimatedOG "${join(outDir, out)}" --props="${propsPath}" --width=${width} --height=${height}`,
    {cwd: studioDir, stdio: 'inherit'},
  );
};

const render = (args, out) => {
  console.log(`render: ${out}`);
  execSync(`npx remotion render AnimatedOG "${join(outDir, out)}" --props="${propsPath}" ${args}`, {
    cwd: studioDir,
    stdio: 'inherit',
  });
};

// OG image PNG (still at frame 0, 1200x630)
still('og.png', 1200, 630);

// Animated OG loop: mp4 (8s seamless), gif (same duration, every-nth-frame=2)
render('', 'og.mp4');
render('--codec=gif --every-nth-frame=2', 'og.gif');

// README GIF: 600x315 (0.5 scale), every-nth-frame=2 preserves seam + keeps size sane
render('--codec=gif --every-nth-frame=2 --scale=0.5', 'readme.gif');

console.log('statics OK: og.png, og.mp4, og.gif, readme.gif in out/smartcaptions/');
