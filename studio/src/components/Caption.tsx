import React from 'react';
import type {Brand} from '../lib/brand';
import {loadLocaleFonts} from '../lib/fonts';
import {easeInOutCubic} from '../lib/telemetry';
import {localeDir} from '../lib/locale';

const IN_MS = 350;

export const Caption: React.FC<{
  label: string;
  brand: Brand;
  enteredMsAgo: number;
  locale?: string | null;
}> = ({label, brand, enteredMsAgo, locale}) => {
  const fonts = loadLocaleFonts(brand, locale);
  const dir = localeDir(locale);
  const p = easeInOutCubic(Math.min(Math.max(enteredMsAgo / IN_MS, 0), 1));
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row',
        gap: 16,
        padding: '18px 32px',
        borderRadius: 12,
        background: `${brand.colors.surface}f2`,
        border: `1px solid ${brand.colors.line}`,
        opacity: p,
        transform: `translateY(${(1 - p) * 24}px)`,
        direction: dir,
      }}
    >
      <div style={{width: 8, height: 8, borderRadius: 4, background: brand.colors.brand}} />
      <div style={{fontFamily: fonts.body, fontWeight: 600, fontSize: 34, color: brand.colors.ink}}>
        {label}
      </div>
    </div>
  );
};
