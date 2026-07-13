import React from 'react';
import {Img, staticFile} from 'remotion';

// The full-color SVG has transparent padding: artwork occupies roughly the
// middle 55% of the 1024x1024 canvas. We inflate the render size so that
// the visible artwork fills the requested `size` footprint. The overflow
// region is fully transparent, so no clipping is needed.
//
// IMPORTANT: Tailwind preflight applies `img { max-width: 100%; height: auto; }`
// which would cap the Img at the container width (= size) instead of renderSize.
// The Img must override both rules to render at the full inflated size.
const ARTWORK_FILL = 0.55;

/**
 * Full-color SmartCaptions logo. Matches the MarkComponent interface
 * ({size, color}) but ignores `color` — colors come from the SVG artwork.
 * Drop-in replacement for SmartCaptionsMark in hero placements.
 */
export const SmartCaptionsLogo: React.FC<{size: number; color: string}> = ({size}) => {
  const renderSize = Math.round(size / ARTWORK_FILL);
  const offset = -Math.round((renderSize - size) / 2);
  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        overflow: 'visible',
        flexShrink: 0,
      }}
    >
      <Img
        src={staticFile('smartcaptions/smartcaptions-logo.svg')}
        style={{
          position: 'absolute',
          width: renderSize,
          height: renderSize,
          // Override Tailwind preflight's `max-width: 100%; height: auto` which
          // would cap the image at the container width (size) instead of renderSize,
          // breaking the artwork-fill inflation and the centering offset.
          maxWidth: 'none',
          top: offset,
          left: offset,
        }}
      />
    </div>
  );
};
