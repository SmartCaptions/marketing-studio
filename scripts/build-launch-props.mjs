// Source of truth for launch video copy: props/noban-launch.json is GENERATED
// by this script; edit copy here, never in the JSON (it gets clobbered).
//
// If out/noban/marketing/brief.json exists and validates, its COPY (headline,
// feature headings + lines, cta) overrides the hardcoded copy below; the
// screenshots/assets/demo structure always stays local. With no valid brief the
// output is byte-identical to the pre-brief builder (the compatibility contract).
import {readFileSync, existsSync, writeFileSync} from 'node:fs';
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

// Overlay Content Brief copy when a valid brief exists. Structural checks below
// mirror studio/src/lib/brief.ts (the canonical zod schema, used by the studio +
// tests) — same convention the build-*-audio scripts use to mirror launchTiming.
// A missing or malformed brief falls through to the hardcoded copy untouched, so
// output is byte-identical with no brief present.
const briefPath = join(root, 'out', 'noban', 'marketing', 'brief.json');
if (existsSync(briefPath)) {
  const brief = validBrief(readFileSync(briefPath, 'utf8'));
  if (!brief) {
    console.warn('build-launch-props: out/noban/marketing/brief.json is invalid; using hardcoded copy');
  } else {
    if (brief.hook.headline) launch.headline = brief.hook.headline;
    if (brief.cta) launch.cta = brief.cta;
    // Overlay copy by feature index; screenshots/structure stay local.
    brief.features.slice(0, launch.features.length).forEach((bf, i) => {
      if (bf.heading) launch.features[i].heading = bf.heading;
      if (bf.benefitLines.length) launch.features[i].lines = bf.benefitLines.slice(0, 3);
    });
  }
}

// Returns the parsed brief if it structurally matches brief.ts (only the copy
// fields this builder consumes are validated), otherwise null.
function validBrief(text) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return null;
  }
  if (!b || typeof b !== 'object') return null;
  if (typeof b.brandId !== 'string' || b.brandId.length === 0) return null;
  const hook = b.hook ?? {headline: '', altHeadlines: []};
  if (typeof hook.headline !== 'string') return null;
  const features = b.features ?? [];
  if (!Array.isArray(features)) return null;
  for (const f of features) {
    if (!f || typeof f.heading !== 'string') return null;
    if (!Array.isArray(f.benefitLines) || f.benefitLines.length > 3) return null;
    if (!f.benefitLines.every((l) => typeof l === 'string')) return null;
  }
  if (b.cta != null && typeof b.cta !== 'string') return null;
  return {hook, cta: typeof b.cta === 'string' ? b.cta : '', features};
}

writeFileSync(join(root, 'props', 'noban-launch.json'), JSON.stringify(launch, null, 2) + '\n');
console.log('wrote props/noban-launch.json');
