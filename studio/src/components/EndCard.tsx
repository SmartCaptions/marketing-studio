import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadLocaleFonts} from '../lib/fonts';
import {brandSpring} from '../lib/motion';
import {getHeroMark} from '../brands/marks';
import {localeDir} from '../lib/locale';

export const EndCard: React.FC<{cta: string; brand: Brand; locale?: string | null}> = ({cta, brand, locale}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadLocaleFonts(brand, locale);
  const dir = localeDir(locale);
  const s = brandSpring(frame, fps, brand.motion);
  const Mark = getHeroMark(brand.id);
  return (
    <AbsoluteFill
      style={{justifyContent: 'center', alignItems: 'center', gap: 32, opacity: s, transform: `scale(${0.96 + s * 0.04})`}}
    >
      <Mark size={110} color={brand.colors.brand} />
      <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 96, color: brand.colors.ink, direction: dir, textAlign: 'center'}}>
        {brand.name}
      </div>
      <div style={{fontFamily: fonts.mono, fontSize: 34, letterSpacing: '0.2em', color: brand.colors.profit, direction: dir, textAlign: 'center'}}>
        {cta.toUpperCase()}
      </div>
    </AbsoluteFill>
  );
};
