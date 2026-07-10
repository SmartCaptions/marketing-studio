import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {brandSpring, entrance, staggerDelay} from '../lib/motion';
import {useFormat} from '../lib/layout';

const easeOutExpo = Easing.out(Easing.exp);

export const Headline: React.FC<{kicker: string; headline: string; brand: Brand}> = ({kicker, headline, brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scale, width, safe} = useFormat();
  const fonts = loadBrandFonts(brand);
  const words = headline.split(' ');
  const kickerIn = entrance(frame, fps, brand.motion, {durFrames: 12, easing: easeOutExpo});
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: Math.round(36 * scale)}}>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: Math.round(30 * scale),
          letterSpacing: '0.35em',
          color: brand.colors.brand,
          opacity: kickerIn,
        }}
      >
        {kicker.toUpperCase()}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: `0 ${Math.round(28 * scale)}px`,
          maxWidth: Math.min(1500, width - 2 * safe.left),
        }}
      >
        {words.map((w, i) => {
          const s = brandSpring(frame, fps, brand.motion, {delayFrames: 8 + staggerDelay(i, 4, brand.motion)});
          return (
            <span
              key={i}
              style={{
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: Math.round(120 * scale),
                lineHeight: 1.08,
                color: brand.colors.ink,
                opacity: s,
                transform: `translateY(${(1 - s) * 40 * scale}px)`,
                display: 'inline-block',
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
