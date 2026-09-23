/**
 * Hebrew BiDi display fixups.
 *
 * Hebrew uses single-letter prefixes (ב, ל, מ, כ, ש, ה, ו, ד, ת, …) joined
 * to the following word with a regular ASCII hyphen in informal writing and
 * TTS narration. Unicode's BiDi algorithm can then break the line between the
 * prefix and the word it belongs to when the following word is Latin. Replacing
 * the ASCII hyphen with a non-breaking hyphen (U+2011) prevents that break
 * while preserving the visual appearance.
 *
 * Sentence-final punctuation placement (period at visual left in RTL) is
 * correct Hebrew typesetting and is not modified here.
 */

/**
 * Replace every ASCII hyphen that immediately follows a Hebrew character with
 * a non-breaking hyphen (U+2011), keeping the prefix attached to the next word.
 *
 * "ב-SmartCaptions" → "ב‑SmartCaptions"
 * "well-known"      → "well-known"  (no Hebrew char before the hyphen)
 */
export const fixHebrewPrefixHyphen = (text: string): string =>
  text.replace(/([֐-׿יִ-ﭏ])-/g, '$1‑');
