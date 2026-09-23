import {describe, expect, it} from 'vitest';
import {fixHebrewPrefixHyphen} from './bidi';

const NBSP = '‑'; // non-breaking hyphen

describe('fixHebrewPrefixHyphen', () => {
  it('replaces ASCII hyphen after Hebrew prefix ב before Latin word', () => {
    expect(fixHebrewPrefixHyphen('ב-SmartCaptions')).toBe(`ב${NBSP}SmartCaptions`);
  });

  it('fixes the exact failing caption at 14.4–16.5 s', () => {
    // This is SRT line 8 from the HE reel review; the hyphen after ב was
    // breaking before "SmartCaptions" in the browser's BiDi layout.
    const input = 'התחילו עם תמלול ב-SmartCaptions.';
    const result = fixHebrewPrefixHyphen(input);
    expect(result).toBe(`התחילו עם תמלול ב${NBSP}SmartCaptions.`);
    // No regular ASCII hyphen should remain after a Hebrew character.
    expect(result).not.toMatch(/[֐-׿יִ-ﭏ]-/);
  });

  it('leaves ASCII hyphen between Latin characters untouched', () => {
    expect(fixHebrewPrefixHyphen('well-known')).toBe('well-known');
  });

  it('leaves a string with no Hebrew unchanged', () => {
    const s = 'SmartCaptions subtitles for Premiere Pro.';
    expect(fixHebrewPrefixHyphen(s)).toBe(s);
  });

  it('replaces multiple occurrences in one string', () => {
    const input = 'ל-Premier ב-Adobe';
    expect(fixHebrewPrefixHyphen(input)).toBe(`ל${NBSP}Premier ב${NBSP}Adobe`);
  });

  it('handles the ל- prefix (common in Hebrew)', () => {
    expect(fixHebrewPrefixHyphen('ל-Premiere')).toBe(`ל${NBSP}Premiere`);
  });

  it('handles the מ- prefix', () => {
    expect(fixHebrewPrefixHyphen('מ-SmartCaptions')).toBe(`מ${NBSP}SmartCaptions`);
  });

  it('is a no-op on an empty string', () => {
    expect(fixHebrewPrefixHyphen('')).toBe('');
  });
});
