import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = JSON.parse(readFileSync(join(root, 'props', 'noban-demo.json'), 'utf8'));

const launch = {
  brandId: 'noban',
  kicker: 'noban.gg',
  headline: 'CS2 skin arbitrage with guardrails',
  demo: {video: demo.video, telemetry: demo.telemetry},
  features: [
    {
      screenshot: 'noban/governance.webp',
      heading: 'Guardrails, enforced in the backend',
      lines: [
        'Hard spend caps on every trade',
        'Bannable operations never run automatically',
        'Kill switch halts execution instantly',
      ],
    },
    {
      screenshot: 'noban/ledger.webp',
      heading: 'Every trade, accounted for',
      lines: [
        'FIFO cost basis and realized gains',
        'Tax worksheet export for your accountant',
        'Signed provenance and ledger bundles',
      ],
    },
  ],
  cta: 'Simulate free at noban.gg',
  assets: {
    logoSequence: 'noban/logo-reveal',
    logoFrames: 90,
    loopSequence: 'noban/background-loop',
    loopFrames: 240,
  },
};

writeFileSync(join(root, 'props', 'noban-launch.json'), JSON.stringify(launch, null, 2) + '\n');
console.log('wrote props/noban-launch.json');
