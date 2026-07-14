// Renders the SmartCaptions HEBREW AnimatedOG static-plus exports:
//   out/smartcaptions/he/og-he.png    (1200x630 still)
//   out/smartcaptions/he/og-he.mp4   (8s seamless animated OG loop)
//   out/smartcaptions/he/og-he.gif   (same, GIF codec, every-nth-frame=2)
//   out/smartcaptions/he/readme-he.gif (600x315 README GIF)
//
// locale:'he' activates RTL direction and Rubik font (hebrew+latin subsets).
// tagline and cta come from brief.he.og.
// No ComfyUI hero (noban-hardwired; procedural fallback is spec-compliant).
// No Blender background loop (none staged; blue wash is the backdrop).
// Seamless-loop invariant: durationInFrames=240; every-nth-frame=2 divides evenly.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brief = JSON.parse(
  readFileSync(join(root, 'out', 'smartcaptions', 'marketing', 'brief.json'), 'utf8'),
);

const outDir = join(root, 'out', 'smartcaptions', 'he');
mkdirSync(outDir, {recursive: true});

const props = {
  brandId: 'smartcaptions',
  locale: 'he',
  tagline: brief.he.og.tagline,
  cta: brief.he.og.cta,
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};
const propsPath = join(outDir, 'og-he-props.json');
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
still('og-he.png', 1200, 630);

// Animated OG loop: mp4 (8s seamless), gif (same duration, every-nth-frame=2)
render('', 'og-he.mp4');
render('--codec=gif --every-nth-frame=2', 'og-he.gif');

// README GIF: 600x315 (0.5 scale), every-nth-frame=2 preserves seam + keeps size sane
render('--codec=gif --every-nth-frame=2 --scale=0.5', 'readme-he.gif');

console.log('statics OK: og-he.png, og-he.mp4, og-he.gif, readme-he.gif in out/smartcaptions/he/');
