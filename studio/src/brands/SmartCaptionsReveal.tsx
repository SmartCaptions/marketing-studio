import React from 'react';
import {brandSpring, staggerDelay} from '../lib/motion';
import type {Motion} from '../lib/motion';
import {SmartCaptionsLogo} from './SmartCaptionsLogo';

// Base stagger gap between band entrances, in frames (before stagger scaling).
const STAGGER_BASE_FRAMES = 12;
// Slide travel distance as a fraction of the logo box size.
const SLIDE_FRACTION = 0.28;

/**
 * Remotion-native three-band assembly reveal for the SmartCaptions logo.
 *
 * Splits the logo vertically into three bands and animates them entering in
 * sequence using brand motion tokens:
 *   - Band 2 (bottom diamond plate): slides UP + fades in first
 *   - Band 1 (middle body):          fades in second
 *   - Band 0 (top chevrons):         slides DOWN + fades in last
 *
 * The logo holds cleanly once all bands settle (~frame 45 for smartcaptions
 * at tempo 1.05). No Blender sequence required. Gate via hasHeroLogo before
 * rendering — other brands keep the PngSequence path byte-identically.
 */
export const SmartCaptionsReveal: React.FC<{
  size: number;
  frame: number;
  fps: number;
  motion: Motion;
  color: string;
}> = ({size, frame, fps, motion, color}) => {
  const bandH = size / 3;
  const slide = Math.round(size * SLIDE_FRACTION);

  // entryOrder[bandIdx] = entry index (0 = enters first).
  // Band 2 (bottom) → 0, Band 1 (middle) → 1, Band 0 (top) → 2.
  const entryOrder = [2, 1, 0];

  return (
    <div style={{width: size, height: size, position: 'relative'}}>
      {[0, 1, 2].map((bandIdx) => {
        const eIdx = entryOrder[bandIdx];
        const delay = staggerDelay(eIdx, STAGGER_BASE_FRAMES, motion);
        const s = brandSpring(frame, fps, motion, {delayFrames: delay});
        // Direction: bottom slides up (+y → 0), middle no slide, top slides down (-y → 0)
        const dir = bandIdx === 2 ? 1 : bandIdx === 0 ? -1 : 0;
        const translateY = dir * slide * (1 - s);
        return (
          <div
            key={bandIdx}
            style={{
              position: 'absolute',
              top: bandIdx * bandH,
              left: 0,
              width: size,
              height: bandH,
              overflow: 'hidden',
              opacity: s,
              transform: `translateY(${translateY}px)`,
            }}
          >
            {/* Position the full logo so only this band's slice is visible */}
            <div style={{position: 'absolute', top: -bandIdx * bandH, left: 0}}>
              <SmartCaptionsLogo size={size} color={color} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
