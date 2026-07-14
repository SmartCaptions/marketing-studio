/**
 * Minimal locale/direction helpers for opt-in RTL rendering.
 *
 * Usage: pass `locale="he"` (or any "he-*" BCP-47 tag) to a template's
 * nullable `locale` prop.  All callers that omit `locale` (or pass null)
 * continue to render LTR with the brand's default fonts — this module has
 * ZERO effect on existing English renders.
 */

export type Dir = 'ltr' | 'rtl';

/** True when the locale string starts with the 'he' language subtag. */
export const isHebrew = (locale?: string | null): boolean =>
  typeof locale === 'string' && /^he\b/.test(locale);

/** Return the CSS `dir` attribute value for the locale. */
export const localeDir = (locale?: string | null): Dir => (isHebrew(locale) ? 'rtl' : 'ltr');
