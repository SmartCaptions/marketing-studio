// Source of truth for SmartCaptions per-feature social clip props.
// GENERATED FILES (edit here, never in the JSON directly):
//   props/smartcaptions-feature-one-click-x.json
//   props/smartcaptions-feature-one-click-vertical.json
//   props/smartcaptions-feature-languages-x.json
//   props/smartcaptions-feature-languages-vertical.json
//   props/smartcaptions-feature-control-x.json
//   props/smartcaptions-feature-control-vertical.json
//
// Copy is drawn from out/smartcaptions/marketing/brief.json (features[].heading
// and benefitLines). Each feature maps to its staged screenshot in
// studio/public/smartcaptions/.
// Voice: editor-to-editor, plain and confident, no hype, no em dashes.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brief = JSON.parse(
  readFileSync(join(root, 'out', 'smartcaptions', 'marketing', 'brief.json'), 'utf8'),
);

const cta = brief.cta; // "Try free at smartcaptions.co.il"
const kicker = 'smartcaptions.co.il';

// Feature-to-screenshot mapping (staged in studio/public/smartcaptions/).
const SCREENSHOT_MAP = {
  'one-click': 'smartcaptions/feature-1.png',
  languages: 'smartcaptions/feature-2.png',
  control: 'smartcaptions/feature-3.png',
};

const REQUIRED_KEYS = Object.keys(SCREENSHOT_MAP);

// Validate brief has all required features with 3 benefitLines each.
const byKey = Object.fromEntries(brief.features.map((f) => [f.key, f]));
for (const key of REQUIRED_KEYS) {
  const feat = byKey[key];
  if (!feat) {
    throw new Error(`build-smartcaptions-feature-props: brief.features["${key}"] not found`);
  }
  if (!Array.isArray(feat.benefitLines) || feat.benefitLines.length < 3) {
    throw new Error(
      `build-smartcaptions-feature-props: brief.features["${key}"].benefitLines must have 3 items, got ${feat.benefitLines?.length ?? 'none'}`,
    );
  }
}

const writes = [];

for (const key of REQUIRED_KEYS) {
  const feat = byKey[key];
  const {heading, benefitLines} = feat;
  const screenshot = SCREENSHOT_MAP[key];

  // ── X (landscape 1920x1080) ────────────────────────────────────────────────
  writes.push([
    `props/smartcaptions-feature-${key}-x.json`,
    {
      brandId: 'smartcaptions',
      kicker,
      headline: heading,
      lines: [benefitLines[0], benefitLines[1], benefitLines[2]],
      screenshot,
      cta,
    },
  ]);

  // ── Vertical (portrait 1080x1920) ─────────────────────────────────────────
  writes.push([
    `props/smartcaptions-feature-${key}-vertical.json`,
    {
      brandId: 'smartcaptions',
      kicker,
      headline: heading,
      lines: [benefitLines[0], benefitLines[1], benefitLines[2]],
      screenshot,
      cta,
      formatWidth: 1080,
      formatHeight: 1920,
    },
  ]);
}

for (const [rel, props] of writes) {
  writeFileSync(join(root, rel), JSON.stringify(props, null, 2) + '\n');
  console.log(`wrote ${rel}`);
}
