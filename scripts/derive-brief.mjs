// GATHERER for the Content Brief spine. No LLM calls — this only collects raw
// grounding from a product repo into out/<brand>/marketing/brief-inputs.json;
// the agent in the main loop synthesizes brief.json from it later.
//
//   node scripts/derive-brief.mjs <brandId> <productRepoPath> [--url <landingUrl>]
//
// Token-redaction rule (PLAYBOOK): NEVER read or print .env contents from the
// product repo. This script only reads README.md, package.json, and the NAMES
// of route directories/files — never .env, never arbitrary source contents.
import {readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`derive-brief: ${msg}`);
  process.exit(1);
}

// --- args ---------------------------------------------------------------
const argv = process.argv.slice(2);
let url = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--url') {
    url = argv[++i] ?? null;
    if (!url) fail('--url given without a value');
  } else {
    positional.push(argv[i]);
  }
}
const [brandId, productRepoPath] = positional;
if (!brandId) fail('missing <brandId> (usage: derive-brief.mjs <brandId> <productRepoPath> [--url <url>])');
if (!productRepoPath) fail('missing <productRepoPath>');
if (!existsSync(productRepoPath) || !statSync(productRepoPath).isDirectory()) {
  fail(`product repo path does not exist or is not a directory: ${productRepoPath}`);
}

// --- README -------------------------------------------------------------
function readReadme(repo) {
  for (const name of ['README.md', 'readme.md', 'Readme.md']) {
    const p = join(repo, name);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
}

// --- package.json name + description -----------------------------------
function readPackage(repo) {
  const p = join(repo, 'package.json');
  if (!existsSync(p)) return null;
  try {
    const pkg = JSON.parse(readFileSync(p, 'utf8'));
    return {name: pkg.name ?? null, description: pkg.description ?? null};
  } catch {
    return null;
  }
}

// --- Next.js route list (dir/file NAMES only) --------------------------
const PAGE_FILE = /^page\.(tsx|jsx|ts|js|mdx)$/;
const ROUTE_FILE = /\.(tsx|jsx|ts|js|mdx)$/;

// App router: a route exists wherever a page.* file lives. Route groups
// "(group)" and private "_folders" don't contribute path segments.
function collectAppRoutes(appDir) {
  const routes = [];
  const walk = (dir, segments) => {
    let entries;
    try {
      entries = readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && PAGE_FILE.test(e.name))) {
      routes.push('/' + segments.join('/'));
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules') continue;
      if (e.name.startsWith('_')) continue; // private folders
      const isGroup = e.name.startsWith('(') && e.name.endsWith(')');
      walk(join(dir, e.name), isGroup ? segments : [...segments, e.name]);
    }
  };
  walk(appDir, []);
  return [...new Set(routes)].sort();
}

// Pages router: each route file (minus _app/_document and api) is a route.
function collectPagesRoutes(pagesDir) {
  const routes = [];
  const walk = (dir, segments) => {
    let entries;
    try {
      entries = readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'api') continue;
        walk(join(dir, e.name), [...segments, e.name]);
      } else if (ROUTE_FILE.test(e.name)) {
        const base = e.name.replace(ROUTE_FILE, '');
        if (base === '_app' || base === '_document') continue;
        const seg = base === 'index' ? segments : [...segments, base];
        routes.push('/' + seg.join('/'));
      }
    }
  };
  walk(pagesDir, []);
  return [...new Set(routes)].sort();
}

function collectRoutes(repo) {
  for (const rel of ['app', 'src/app']) {
    const d = join(repo, rel);
    if (existsSync(d) && statSync(d).isDirectory()) return {router: 'app', routes: collectAppRoutes(d)};
  }
  for (const rel of ['pages', 'src/pages']) {
    const d = join(repo, rel);
    if (existsSync(d) && statSync(d).isDirectory()) return {router: 'pages', routes: collectPagesRoutes(d)};
  }
  return null; // not a Next.js app — skip
}

// --- landing-page DOM text via one-shot Playwright (only with --url) ----
async function fetchLanding(landingUrl) {
  // Reuse Playwright already installed for feeders/capture; resolved from there.
  const require = createRequire(join(root, 'feeders', 'capture', 'package.json'));
  const {chromium} = require('@playwright/test');
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(landingUrl, {waitUntil: 'networkidle', timeout: 30000});
    const text = await page.evaluate(() => document.body.innerText);
    return {url: landingUrl, text};
  } finally {
    if (browser) await browser.close();
  }
}

// --- gather -------------------------------------------------------------
const inputs = {
  brandId,
  productRepoPath,
  gatheredAt: new Date().toISOString(),
  readme: readReadme(productRepoPath),
  package: readPackage(productRepoPath),
  nextRoutes: collectRoutes(productRepoPath),
  landing: null,
};

if (url) {
  try {
    inputs.landing = await fetchLanding(url);
  } catch (err) {
    // Don't abort the whole gather over a flaky fetch, but surface it loudly
    // and record the failure in the output so the synthesizer sees the gap.
    console.error(`derive-brief: landing fetch failed for ${url}: ${err.message}`);
    inputs.landing = {url, error: err.message};
  }
}

const outDir = join(root, 'out', brandId, 'marketing');
mkdirSync(outDir, {recursive: true});
const outPath = join(outDir, 'brief-inputs.json');
writeFileSync(outPath, JSON.stringify(inputs, null, 2) + '\n');
console.log(`wrote out/${brandId}/marketing/brief-inputs.json`);
