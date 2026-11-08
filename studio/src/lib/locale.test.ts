import {describe, expect, it} from 'vitest';
import {aiDisclosureLabel, isRtl, localeDir} from './locale';

describe('locale', () => {
  it('Hebrew and Arabic are right to left, English and a missing locale are not', () => {
    expect(['he', 'ar', 'he-IL', 'en', null, undefined].map((l) => isRtl(l))).toEqual([
      true, true, true, false, false, false,
    ]);
    expect(localeDir('ar')).toBe('rtl');
    expect(localeDir('en')).toBe('ltr');
  });

  it('the AI label is shown in the language of the video', () => {
    expect(aiDisclosureLabel('en')).toBe('AI-generated visuals');
    expect(aiDisclosureLabel(null)).toBe('AI-generated visuals');
    expect(aiDisclosureLabel('he')).toBe('הוויזואליה נוצרה בבינה מלאכותית');
    expect(aiDisclosureLabel('ar')).toBe('مرئيات مولّدة بالذكاء الاصطناعي');
  });
});
