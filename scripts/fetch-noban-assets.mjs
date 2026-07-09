import {copyFileSync, mkdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = 'C:/Projects/noban-gg/marketing/assets/shots';
const dest = join(root, 'studio', 'public', 'noban');

if (!existsSync(src)) {
  console.error(`source not found: ${src}`);
  process.exit(1);
}
mkdirSync(dest, {recursive: true});
for (const f of ['cockpit.webp', 'governance.webp', 'ledger.webp']) {
  copyFileSync(join(src, f), join(dest, f));
  console.log(`copied ${f}`);
}
