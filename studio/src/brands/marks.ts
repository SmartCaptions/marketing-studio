import type React from 'react';
import {NobanMark} from './NobanMark';
import {DashClawMark} from './DashClawMark';
import {PaperRouteMark} from './PaperRouteMark';
import {SmartCaptionsMark} from './SmartCaptionsMark';
import {SmartCaptionsLogo} from './SmartCaptionsLogo';

export type MarkComponent = React.FC<{size: number; color: string}>;

const registry: Record<string, MarkComponent> = {
  noban: NobanMark,
  dashclaw: DashClawMark,
  paperroute: PaperRouteMark,
  smartcaptions: SmartCaptionsMark,
};

export const getMark = (id: string): MarkComponent => {
  const mark = registry[id];
  if (!mark) {
    throw new Error(`No mark component for brand "${id}". Available: ${Object.keys(registry).join(', ')}`);
  }
  return mark;
};

// Full-color logo registry: brands registered here get their raster/SVG logo
// in hero placements (AnimatedOG, EndCard). Falls back to the tinted mark for
// brands absent from this registry — byte-identical to the getMark path.
const fullColorRegistry: Partial<Record<string, MarkComponent>> = {
  smartcaptions: SmartCaptionsLogo,
};

/**
 * Returns the full-color logo component for brands that have one, falling
 * back to the tinted (currentColor) mark for all others. Use in hero
 * placements (AnimatedOG mark slot, LaunchVideo end card).
 */
export const getHeroMark = (id: string): MarkComponent => {
  return fullColorRegistry[id] ?? getMark(id);
};
