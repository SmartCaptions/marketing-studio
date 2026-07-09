// Stages rendered Blender PNG sequences into the studio's public dir.
// Usage: node scripts/stage-blender-assets.mjs [brandId]   (default: noban)
import {cpSync, existsSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandId = process.argv[2] ?? 'noban';
const src = join(root, 'assets', brandId);
const dest = join(root, 'studio', 'public', brandId);

if (!existsSync(src)) {
  console.error(`nothing to stage: ${src} does not exist (run the blender feeder first)`);
  process.exit(1);
}
// stage every rendered sequence dir except raw comfy output (hero staging is
// handled by render-statics.mjs)
const dirs = readdirSync(src, {withFileTypes: true})
  .filter((d) => d.isDirectory() && d.name !== 'comfy')
  .map((d) => d.name);
if (dirs.length === 0) {
  console.error(`no sequence dirs under ${src}`);
  process.exit(1);
}
for (const dir of dirs) {
  cpSync(join(src, dir), join(dest, dir), {recursive: true});
  console.log(`staged ${brandId}/${dir}`);
}
