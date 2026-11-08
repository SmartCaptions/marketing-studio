/**
 * Thumbnail — 1280×720 static composition for YouTube / social thumbnails.
 *
 * Usage: node scripts/render-thumbnail.mjs --title "<title>" --language he|en|ar --out <abs.png>
 *
 * Layout:
 *   - Dark brand background
 *   - Brand-blue top bar
 *   - Title in brand display font, RTL for he/ar
 *   - Brand wordmark bottom-right
 *   - Orange accent stripe
 */
import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadLocaleFonts} from '../lib/fonts';
import {isRtl, localeDir} from '../lib/locale';

export const thumbnailSchema = z.object({
  brandId: z.string(),
  title: z.string(),
  language: z.enum(['he', 'en', 'ar']),
});

type ThumbnailProps = z.infer<typeof thumbnailSchema>;

export const Thumbnail: React.FC<ThumbnailProps> = ({brandId, title, language}) => {
  const brand = getBrand(brandId);
  const fonts = loadLocaleFonts(brand, language);
  const {height} = useVideoConfig();

  const dir = localeDir(language);
  const rtl = isRtl(language);

  // Font size scales with title length
  const baseSize = 72;
  const fontSize = title.length > 40 ? Math.max(48, baseSize - (title.length - 40)) : baseSize;

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg, fontFamily: fonts.display}}>
      {/* Top brand bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 8,
          backgroundColor: brand.colors.brand,
        }}
      />

      {/* Orange accent bar */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: rtl ? 'auto' : 0,
          right: rtl ? 0 : 'auto',
          width: 6,
          height: height - 8 - 80,
          backgroundColor: brand.colors.profit,
          borderRadius: '0 0 3px 3px',
        }}
      />

      {/* Title */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 60,
          right: 60,
          transform: 'translateY(-55%)',
          direction: dir,
          textAlign: rtl ? 'right' : 'left',
        }}
      >
        <span
          style={{
            fontFamily: fonts.display,
            fontSize,
            fontWeight: 800,
            color: brand.colors.ink,
            lineHeight: 1.15,
            letterSpacing: rtl ? 'normal' : '-0.02em',
          }}
        >
          {title}
        </span>
      </div>

      {/* Bottom brand strip */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 80,
          backgroundColor: brand.colors.surface,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 40,
          paddingRight: 40,
        }}
      >
        <span
          style={{
            fontFamily: fonts.body,
            fontSize: 28,
            fontWeight: 600,
            color: brand.colors.info,
            letterSpacing: '0.04em',
          }}
        >
          {brand.name}
        </span>
        <span
          style={{
            fontFamily: fonts.body,
            fontSize: 22,
            fontWeight: 400,
            color: brand.colors.ink3,
            letterSpacing: '0.03em',
          }}
        >
          {brand.url}
        </span>
      </div>

      {/* Language indicator dot */}
      <div
        style={{
          position: 'absolute',
          top: 32,
          right: rtl ? 'auto' : 36,
          left: rtl ? 36 : 'auto',
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: brand.colors.profit,
        }}
      />
    </AbsoluteFill>
  );
};
