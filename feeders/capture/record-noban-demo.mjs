#!/usr/bin/env node
/**
 * record-noban-demo.mjs - records a noban.gg dashboard flow for the ProductDemo template.
 *
 * Prereq: noban stack running with sim data on screen:
 *   cd C:\Projects\noban-gg && pnpm start
 *
 * Output: ../../studio/public/noban/demo.webm + ../../props/noban-demo.json
 */
import {chromium} from '@playwright/test';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOBAN = process.env.NOBAN_ROOT ?? 'C:/Projects/noban-gg';
const VIEWPORT = {width: 1600, height: 1000};
const VIEW_HOLD_MS = 3200;

const env = readFileSync(join(NOBAN, '.env'), 'utf8');
const token = env.match(/^DASHBOARD_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) {
  console.error('DASHBOARD_TOKEN not found in noban .env; run `pnpm start` there once.');
  process.exit(1);
}
const port = env.match(/^DASH_PORT=(\d+)$/m)?.[1] ?? '5173';
const redact = (err) => new Error(String(err?.message ?? err).replaceAll(token, '<redacted>'));

const base = `http://localhost:${port}`;
try {
  await fetch(base, {signal: AbortSignal.timeout(3000)});
} catch {
  console.error(`Dashboard unreachable at ${base}. Start it: cd ${NOBAN} && pnpm start`);
  process.exit(1);
}

const videoDir = join(ROOT, 'out', 'capture');
mkdirSync(videoDir, {recursive: true});
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: {dir: videoDir, size: VIEWPORT},
});
const page = await context.newPage();
const rec = new Recorder();

const nav = (name) => page.getByRole('button', {name, exact: true});
const VIEWS = [
  {name: 'Opportunities', caption: 'Detected opportunities, ranked by net dollars', ready: () => page.locator('tbody tr').first()},
  {name: 'Ledger', caption: 'Every simulated trade lands in the ledger', ready: () => page.getByText('Open cost basis').first()},
  {name: 'Governance', caption: 'Spend caps and approvals on every action', ready: () => page.getByText('Decision ledger').first()},
];

try {
  rec.start();
  await page.goto(`${base}/?token=${token}`, {waitUntil: 'networkidle'}).catch((e) => {
    throw redact(e);
  });
  await page.getByText('SIMULATION').first().waitFor({timeout: 15_000});
  rec.step('The live trading desk. Simulation on by default.');
  await page.waitForTimeout(VIEW_HOLD_MS);

  for (const view of VIEWS) {
    await rec.click(nav(view.name), view.caption);
    await view.ready().waitFor({timeout: 30_000}).catch(() => {
      throw new Error(`${view.name} never rendered data; generate sim activity first.`);
    });
    await page.waitForTimeout(VIEW_HOLD_MS);
  }

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  const destDir = join(ROOT, 'studio', 'public', 'noban');
  mkdirSync(destDir, {recursive: true});
  copyFileSync(src, join(destDir, 'demo.webm'));

  const props = {
    brandId: 'noban',
    video: 'noban/demo.webm',
    cta: 'Simulate free at noban.gg',
    telemetry,
  };
  writeFileSync(join(ROOT, 'props', 'noban-demo.json'), JSON.stringify(props, null, 2) + '\n');
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log('wrote studio/public/noban/demo.webm and props/noban-demo.json');
} catch (err) {
  console.error(redact(err).message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
