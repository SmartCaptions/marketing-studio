#!/usr/bin/env node
// Copy voice-linter: mechanical gate that keeps AI-slop copy out of renders.
// Walks every string value in a JSON file (props, briefs, brand files, any
// shape) and flags em dashes, slop-lexicon words, breathless hype, and
// mechanism-first ("feature-speak") phrasing.
//
// Usage: node scripts/lint-copy.mjs <file.json> [--json] [--fix-report]
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ACRONYM_ALLOWLIST = new Set([
  'API', 'JSON', 'HTML', 'CSS', 'GPU', 'CPU', 'README', 'OG', 'CTA', 'VO', 'URL', 'SDK', 'UI', 'UX',
  'FIFO', 'MP4', 'GIF', 'PNG', 'SVG', 'SRT', 'VTT',
]);

// name: label used for grouping/reporting. re: word-boundary regex, matched case-insensitively.
const SLOP_TERMS = [
  {name: 'seamless', re: /\bseamless(ly)?\b/i},
  {name: 'elevate', re: /\belevate\b/i},
  {name: 'delve', re: /\bdelve\b/i},
  {name: 'unleash', re: /\bunleash\b/i},
  {name: 'supercharge', re: /\bsupercharge\b/i},
  {name: 'game-changing', re: /\bgame-changing\b/i},
  {name: 'revolutionize', re: /\brevolutionize\b/i},
  {name: 'cutting-edge', re: /\bcutting-edge\b/i},
  {name: 'effortless', re: /\beffortless(ly)?\b/i},
  {name: 'empower', re: /\bempower\b/i},
  {name: 'robust', re: /\brobust\b/i},
  {name: 'leverage', re: /\bleverage\b/i},
  {name: "in today's world", re: /\bin today['’]s world\b/i},
  {name: 'look no further', re: /\blook no further\b/i},
];

const SUGGESTIONS = {
  'em-dash': 'Replace the em dash with a comma, period, or a rewritten sentence.',
  'slop-lexicon': "Cut or replace the flagged word with plain, specific language.",
  'breathless-hype': 'Drop to at most one exclamation mark and avoid all-caps emphasis.',
  'feature-speak': 'Lead with the benefit to the reader, not the mechanism.',
};

function isSkippableKey(key) {
  if (!key) return false;
  const lower = key.toLowerCase();
  if (['id', 'key', 'act', 'comp'].includes(lower)) return true;
  if (/Path$|Src$|File$/.test(key)) return true;
  if (/^fonts?$/i.test(key)) return true;
  return false;
}

function isPathLikeValue(str) {
  return /[\\/]/.test(str);
}

function isHexColor(str) {
  return /^#[0-9a-fA-F]{3,8}$/.test(str);
}

function isUrl(str) {
  return /^https?:\/\//i.test(str);
}

function shouldSkip(str, ownKey, containerKey) {
  if (isSkippableKey(ownKey) || isSkippableKey(containerKey)) return true;
  if (isPathLikeValue(str)) return true;
  if (isHexColor(str)) return true;
  if (isUrl(str)) return true;
  return false;
}

function lintString(str, path, out) {
  // Rule 1: em dash.
  if (str.includes('—')) {
    out.push({
      rule: 'em-dash',
      level: 'ERROR',
      path,
      text: str,
      message: 'Contains an em dash.',
    });
  }

  // Rule 2: slop lexicon.
  for (const term of SLOP_TERMS) {
    const match = term.re.exec(str);
    if (match) {
      out.push({
        rule: 'slop-lexicon',
        level: 'ERROR',
        path,
        text: match[0],
        message: `Slop word "${term.name}" found.`,
      });
    }
  }
  const trimmed = str.trim();
  if (/^unlock\b/i.test(trimmed)) {
    out.push({
      rule: 'slop-lexicon',
      level: 'ERROR',
      path,
      text: trimmed.split(/\s+/)[0],
      message: 'Slop word "unlock" used as a verb opener.',
    });
  }

  // Rule 3: breathless hype.
  const bangCount = (str.match(/!/g) || []).length;
  if (bangCount >= 3) {
    out.push({
      rule: 'breathless-hype',
      level: 'ERROR',
      path,
      text: str,
      message: `${bangCount} exclamation marks in one string.`,
    });
  }
  const capsWords = str.match(/\b[A-Z]{4,}\b/g) || [];
  for (const word of capsWords) {
    if (ACRONYM_ALLOWLIST.has(word)) continue;
    out.push({
      rule: 'breathless-hype',
      level: 'ERROR',
      path,
      text: word,
      message: `ALL-CAPS word "${word}" is not an allowlisted acronym.`,
    });
  }

  // Rule 4: feature-speak heuristic (WARN only).
  if (trimmed.length > 30) {
    const gerundMatch = /^([A-Z][a-zA-Z]*ing)\b/.exec(trimmed);
    const opener = /^(Allows|Enables|Provides|Supports)\b/.exec(trimmed);
    if (gerundMatch || opener) {
      const word = (gerundMatch || opener)[1];
      out.push({
        rule: 'feature-speak',
        level: 'WARN',
        path,
        text: word,
        message: `Starts with mechanism-first phrasing ("${word}") instead of a benefit.`,
      });
    }
  }
}

function walk(node, path, ownKey, containerKey, out) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`, ownKey, containerKey, out));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      walk(v, path ? `${path}.${k}` : k, k, ownKey, out);
    }
    return;
  }
  if (typeof node === 'string') {
    if (shouldSkip(node, ownKey, containerKey)) return;
    lintString(node, path, out);
  }
}

export function lintJson(root) {
  const violations = [];
  walk(root, '', null, null, violations);
  return violations;
}

function groupByRule(violations) {
  const groups = new Map();
  for (const v of violations) {
    if (!groups.has(v.rule)) groups.set(v.rule, []);
    groups.get(v.rule).push(v);
  }
  return groups;
}

export function formatReport(file, violations, {fixReport = false} = {}) {
  if (violations.length === 0) {
    return `lint-copy: ${file}: clean, no violations.`;
  }
  const lines = [`lint-copy: ${file}: ${violations.length} violation(s)`];
  const groups = groupByRule(violations);
  for (const [rule, items] of groups) {
    lines.push('');
    lines.push(`${rule} (${items.length}):`);
    for (const v of items) {
      lines.push(`  [${v.level}] ${v.path}: "${v.text}" - ${v.message}`);
      if (fixReport) {
        lines.push(`    fix: ${SUGGESTIONS[v.rule] || 'Review and rewrite.'}`);
      }
    }
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));
  const file = positional[0];

  if (!file) {
    console.error('Usage: node scripts/lint-copy.mjs <file.json> [--json] [--fix-report]');
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`lint-copy: failed to read ${file}: ${err.message}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`lint-copy: failed to parse ${file} as JSON: ${err.message}`);
    process.exit(1);
  }

  const violations = lintJson(data);
  const errorCount = violations.filter((v) => v.level === 'ERROR').length;
  const warnCount = violations.filter((v) => v.level === 'WARN').length;

  if (flags.has('--json')) {
    console.log(JSON.stringify({file, violations, errorCount, warnCount}, null, 2));
  } else {
    console.log(formatReport(file, violations, {fixReport: flags.has('--fix-report')}));
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
