// Source of truth for SmartCaptions HEBREW social clip props.
// GENERATED FILES (edited here, never in the JSON directly):
//   props/smartcaptions-social-x-he.json
//   props/smartcaptions-social-linkedin-he.json
//   props/smartcaptions-social-vertical-he.json
//
// Headlines/hook come from brief.he.social; CTA from brief.he.og.cta.
// Feature lines come from brief.he.featureLines (Hebrew, keyed one-click/languages/control).
// Hebrew feature screenshots extracted from studio/public/smartcaptions/demo-he.webm.
// Voice: editor-to-editor, plain and confident, no hype, no em dashes.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brief = JSON.parse(
  readFileSync(join(root, 'out', 'smartcaptions', 'marketing', 'brief.json'), 'utf8'),
);

const {x, linkedin, vertical} = brief.he.social;
const cta = brief.he.og.cta; // "נסיון חינם ב-smartcaptions.co.il"
const kicker = 'smartcaptions.co.il'; // unchanged

// Pull Hebrew feature lines from brief.he.featureLines
const heFeatureLines = brief.he.featureLines;
const REQUIRED_KEYS = ['one-click', 'languages', 'control'];
for (const key of REQUIRED_KEYS) {
  if (!Array.isArray(heFeatureLines[key]) || heFeatureLines[key].length < 3) {
    throw new Error(
      `build-smartcaptions-social-props-he: brief.he.featureLines["${key}"] must have 3 lines, got ${heFeatureLines[key]?.length ?? 'none'}`,
    );
  }
}
const f1 = heFeatureLines['one-click'];  // ["לחיצה אחת מתמללת...", "בלי ייצוא...", "הכתוביות נוחתות..."]
const f2 = heFeatureLines['languages'];  // ["מזהה את שפת...", "מתרגם כתוביות...", "עברית ו-RTL..."]
const f3 = heFeatureLines['control'];    // ["מתקנים מילים...", "מילוי ציר הזמן...", "מקסימום מילים..."]

// ── X (landscape 1920x1080) ──────────────────────────────────────────────────
const socialX = {
  brandId: 'smartcaptions',
  locale: 'he',
  kicker,
  headline: x.headline,
  lines: [
    f1[0], // "לחיצה אחת מתמללת את כל הרצף"
    f1[1], // "בלי ייצוא, בלי העלאות, בלי סיבובים"
    f1[2], // "הכתוביות נוחתות ישר על ציר הזמן"
  ],
  screenshot: 'smartcaptions/feature-1-he.png',
  cta,
};

// ── LinkedIn (landscape 1920x1080) ──────────────────────────────────────────
const socialLinkedin = {
  brandId: 'smartcaptions',
  locale: 'he',
  kicker,
  headline: linkedin.headline,
  lines: [
    f1[1], // "בלי ייצוא, בלי העלאות, בלי סיבובים"
    f2[0], // "מזהה את שפת הדיבור אוטומטית"
    f3[1], // "מילוי ציר הזמן סוגר כל רווח"
  ],
  screenshot: 'smartcaptions/feature-2-he.png',
  cta,
};

// ── Vertical (portrait 1080x1920) ────────────────────────────────────────────
const socialVertical = {
  brandId: 'smartcaptions',
  locale: 'he',
  kicker,
  headline: vertical.headline,
  lines: [
    f1[0], // "לחיצה אחת מתמללת את כל הרצף"
    f2[0], // "מזהה את שפת הדיבור אוטומטית"
    f3[1], // "מילוי ציר הזמן סוגר כל רווח"
  ],
  screenshot: 'smartcaptions/feature-1-he.png',
  cta,
  formatWidth: 1080,
  formatHeight: 1920,
};

const writes = [
  ['props/smartcaptions-social-x-he.json', socialX],
  ['props/smartcaptions-social-linkedin-he.json', socialLinkedin],
  ['props/smartcaptions-social-vertical-he.json', socialVertical],
];

for (const [rel, props] of writes) {
  writeFileSync(join(root, rel), JSON.stringify(props, null, 2) + '\n');
  console.log(`wrote ${rel}`);
}
