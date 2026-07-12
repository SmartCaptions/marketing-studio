// Source of truth for SmartCaptions social clip props.
// GENERATED FILES (edited here, never in the JSON directly):
//   props/smartcaptions-social-x.json
//   props/smartcaptions-social-linkedin.json
//   props/smartcaptions-social-vertical.json
//
// Copy is drawn from out/smartcaptions/marketing/brief.json (social.{x,linkedin,vertical}
// hook + headline + cta) and the feature benefitLines.
// Voice: editor-to-editor, plain and confident, no hype, no em dashes.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brief = JSON.parse(
  readFileSync(join(root, 'out', 'smartcaptions', 'marketing', 'brief.json'), 'utf8'),
);

const {x, linkedin, vertical} = brief.social;
const cta = brief.cta; // "Try free at smartcaptions.co.il"
const kicker = 'smartcaptions.co.il';

// Pull feature benefit lines by key from brief.features
const byKey = Object.fromEntries(brief.features.map((f) => [f.key, f.benefitLines]));
const REQUIRED_KEYS = ['one-click', 'languages', 'control'];
for (const key of REQUIRED_KEYS) {
  if (!byKey[key]) throw new Error(`build-smartcaptions-social-props: brief.features is missing a feature with key "${key}"`);
}
const f1 = byKey['one-click'];   // ["One click transcribes...", "No exports...", "Captions land..."]
const f2 = byKey['languages'];   // ["Auto-detects...", "Translate captions...", "Hebrew and RTL..."]
const f3 = byKey['control'];     // ["Fix words...", "Fill Timeline...", "Max words..."]

// ── X (landscape 1920×1080) ──────────────────────────────────────────────────
// Hook angle: "Stop typing captions" — core promise, workflow speed.
const socialX = {
  brandId: 'smartcaptions',
  kicker,
  headline: x.headline, // "AI captions for Premiere Pro, in one click"
  lines: [
    f1[0], // "One click transcribes your whole sequence"
    f1[1], // "No exports, no uploads, no round trips"
    f1[2], // "Captions land straight on your timeline"
  ],
  screenshot: 'smartcaptions/feature-1.png',
  cta,
};

// ── LinkedIn (landscape 1920×1080) ──────────────────────────────────────────
// Hook angle: "Caption every cut without leaving the edit" — differentiation.
// Cross-feature lines show breadth for a professional audience.
const socialLinkedin = {
  brandId: 'smartcaptions',
  kicker,
  headline: linkedin.headline, // "SmartCaptions puts AI transcription inside Premiere Pro"
  lines: [
    f1[1], // "No exports, no uploads, no round trips"
    f2[0], // "Auto-detects the spoken language"
    f3[1], // "Fill Timeline closes every caption gap"
  ],
  screenshot: 'smartcaptions/feature-2.png',
  cta,
};

// ── Vertical (portrait 1080×1920) ────────────────────────────────────────────
// Hook angle: "Captions in one click" — short punchy phone format.
// Fewer lines; shorter phrasing wins at 9:16.
const socialVertical = {
  brandId: 'smartcaptions',
  kicker,
  headline: vertical.headline, // "Inside Premiere Pro"
  lines: [
    f1[0], // "One click transcribes your whole sequence"
    f2[0], // "Auto-detects the spoken language"
    f3[1], // "Fill Timeline closes every caption gap"
  ],
  screenshot: 'smartcaptions/feature-1.png',
  cta,
  formatWidth: 1080,
  formatHeight: 1920,
};

const writes = [
  ['props/smartcaptions-social-x.json', socialX],
  ['props/smartcaptions-social-linkedin.json', socialLinkedin],
  ['props/smartcaptions-social-vertical.json', socialVertical],
];

for (const [rel, props] of writes) {
  writeFileSync(join(root, rel), JSON.stringify(props, null, 2) + '\n');
  console.log(`wrote ${rel}`);
}
