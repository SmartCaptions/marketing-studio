import React from 'react';
import {interpolate} from 'remotion';
import {brandSpring, staggerDelay} from '../lib/motion';
import type {Motion} from '../lib/motion';
import {SmartCaptionsLogo} from './SmartCaptionsLogo';

// Base stagger gap between band entrances, in frames (before stagger scaling).
const STAGGER_BASE_FRAMES = 12;
// Slide travel distance as a fraction of the logo box size.
const SLIDE_FRACTION = 0.28;
// Pixels of Y-overlap between adjacent bands to prevent hairline seam gaps
// caused by sub-pixel rounding of size/3 boundaries.
const SEAM_OVERLAP = 2;
// Must stay in sync with SmartCaptionsLogo's ARTWORK_FILL constant.
// Used here to derive the horizontal overscan width of each band container
// so the inflated (1/ARTWORK_FILL ≈ 1.818×) SVG image never clips left/right.
const ARTWORK_FILL = 0.55;

/**
 * Remotion-native three-band assembly reveal for the SmartCaptions logo.
 *
 * Three defect-free properties:
 *
 *   1. NO HORIZONTAL CLIP — each band container is renderSize wide (≈1.818×
 *      size), offset left by hMargin, so the inflated image never clips on
 *      the left or right.  Only Y carries a clip boundary.
 *
 *   2. NO SEAM LINES — adjacent bands overlap by SEAM_OVERLAP pixels in Y.
 *      The inner-wrapper `top` is adjusted to keep artwork pixel-aligned.
 *      No gap or hairline can appear at any band boundary.
 *
 *   3. SETTLED == PLAIN LOGO — once all springs settle (~frame 44 for
 *      smartcaptions), the banded stack fades out and the plain unclipped
 *      SmartCaptionsLogo fades in at the same (0,0) position.  The settled
 *      frame is byte-comparable to a direct SmartCaptionsLogo render.
 *
 * Entry order: band 2 (bottom diamond plate) slides up first, band 1 (middle
 * body) fades second, band 0 (top chevrons) slides down last.
 *
 * Gate via hasHeroLogo before rendering — other brands keep the PngSequence
 * path byte-identically.
 */
export const SmartCaptionsReveal: React.FC<{
  size: number;
  frame: number;
  fps: number;
  motion: Motion;
  color: string;
}> = ({size, frame, fps, motion, color}) => {
  const slide = Math.round(size * SLIDE_FRACTION);

  // Horizontal overscan: make each band container wide enough for the full
  // inflated image so the left/right tips never get clipped.
  // hMargin is the extension on each side; -hMargin left + renderSize width
  // is equivalent to centering a renderSize-wide clip around x=0…size.
  const renderSize = Math.round(size / ARTWORK_FILL); // ≈ 909 @ size=500
  const hMargin = Math.round((renderSize - size) / 2); // ≈ 205 @ size=500
  // SmartCaptionsLogo internally computes offset = -Math.round((renderSize-size)/2)
  // = -hMargin, so inner-wrapper left:hMargin exactly cancels it — pixel-aligned.

  // entryOrder[bandIdx] = entry index (0 = enters first).
  // Band 2 (bottom) → 0, Band 1 (middle) → 1, Band 0 (top) → 2.
  const entryOrder = [2, 1, 0];

  // Settle crossfade: once the last (top) band spring has settled, swap the
  // banded stack for the plain unclipped logo so the final hold is clip-free.
  const lastEntryDelay = staggerDelay(2, STAGGER_BASE_FRAMES, motion); // top band delay
  const settleStart = lastEntryDelay + 20; // ≈ frame 44 for smartcaptions
  const settledOpacity = interpolate(frame, [settleStart, settleStart + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{width: size, height: size, position: 'relative'}}>

      {/* ── Banded assembly stack ─────────────────────────────────────── */}
      {/* Fades out as the plain logo fades in.                           */}
      <div style={{position: 'absolute', top: 0, left: 0, width: size, height: size, opacity: 1 - settledOpacity}}>
        {[0, 1, 2].map((bandIdx) => {
          const eIdx = entryOrder[bandIdx];
          const delay = staggerDelay(eIdx, STAGGER_BASE_FRAMES, motion);
          const s = brandSpring(frame, fps, motion, {delayFrames: delay});
          // Direction: bottom slides up (+), middle no slide, top slides down (−)
          const dir = bandIdx === 2 ? 1 : bandIdx === 0 ? -1 : 0;
          const translateY = dir * slide * (1 - s);

          // Seam-free clip bounds in SmartCaptionsReveal coordinate space.
          // Extend each band by SEAM_OVERLAP into its neighbors.
          const nomTop = Math.floor((bandIdx * size) / 3);
          const nomBot = bandIdx < 2 ? Math.ceil(((bandIdx + 1) * size) / 3) : size;
          const clipTop = Math.max(0, nomTop - (bandIdx > 0 ? SEAM_OVERLAP : 0));
          const clipBot = Math.min(size, nomBot + (bandIdx < 2 ? SEAM_OVERLAP : 0));
          const clipH = clipBot - clipTop;

          return (
            <div
              key={bandIdx}
              style={{
                position: 'absolute',
                // Y: band's seam-extended clip region
                top: clipTop,
                height: clipH,
                // X: extend left by hMargin so the full inflated image fits.
                // overflow:hidden clips Y only — left/right edges are SVG padding.
                left: -hMargin,
                width: renderSize,
                overflow: 'hidden',
                opacity: s,
                transform: `translateY(${translateY}px)`,
              }}
            >
              {/*
               * Inner wrapper: positions the SmartCaptionsLogo so the correct
               * artwork slice appears at the top of this clip region.
               *   left: hMargin  — compensates the band container's left: -hMargin
               *   top: -clipTop  — band's clipTop aligns with the logo's y=clipTop
               */}
              <div style={{position: 'absolute', top: -clipTop, left: hMargin}}>
                <SmartCaptionsLogo size={size} color={color} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Plain unclipped logo ─────────────────────────────────────── */}
      {/* Pixel-aligned to (0,0) — identical position to the settled bands.  */}
      {/* At settledOpacity=1 this is the sole output, making the settled    */}
      {/* frame byte-comparable to a plain SmartCaptionsLogo render.         */}
      <div style={{position: 'absolute', top: 0, left: 0, width: size, height: size, opacity: settledOpacity}}>
        <SmartCaptionsLogo size={size} color={color} />
      </div>

    </div>
  );
};
