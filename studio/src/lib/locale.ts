/**
 * Minimal locale/direction helpers for opt-in RTL rendering.
 *
 * Usage: pass `locale="he"` or `locale="ar"` to a template's nullable `locale`
 * prop.  All callers that omit `locale` (or pass null) continue to render LTR
 * with the brand's default fonts — this module has ZERO effect on existing
 * English renders.
 */

export type Dir = 'ltr' | 'rtl';

/** True when the locale string starts with the 'he' language subtag. */
export const isHebrew = (locale?: string | null): boolean =>
  typeof locale === 'string' && /^he\b/.test(locale);

/** True when the locale string starts with the 'ar' language subtag. */
export const isArabic = (locale?: string | null): boolean =>
  typeof locale === 'string' && /^ar\b/.test(locale);

/** True when the locale is any right-to-left language (Hebrew or Arabic). */
export const isRtl = (locale?: string | null): boolean =>
  isHebrew(locale) || isArabic(locale);

/** Return the CSS `dir` attribute value for the locale. */
export const localeDir = (locale?: string | null): Dir => (isRtl(locale) ? 'rtl' : 'ltr');

/** The on-screen "AI-generated visuals" label, in the locale's language. */
export const aiDisclosureLabel = (locale?: string | null): string =>
  isHebrew(locale)
    ? 'הוויזואליה נוצרה בבינה מלאכותית'
    : isArabic(locale)
      ? 'مرئيات مولّدة بالذكاء الاصطناعي'
      : 'AI-generated visuals';
