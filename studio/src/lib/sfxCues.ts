import type {Act} from './launchTiming';
import {staggerDelay} from './motion';
import type {Motion} from './motion';

// Sound-design cue layer for the launch video. PURE derivation from the launchTiming
// act table (same source of truth voWindows uses), so cue frames are never stored in
// the audio manifest — they are recomputed at render time, exactly like voWindows.
//
// Three cue kinds, one reusable brand-agnostic SFX file each:
//   whoosh — a transition swish on every hard act boundary (logo->hook, hook->demo,
//            demo->feature, and between features)
//   riser  — a rising build that leads into the end-card CTA
//   tick   — a soft UI blip on each feature benefit-line reveal

export type SfxKind = 'whoosh' | 'tick' | 'riser' | 'intro' | 'swipe' | 'closing';
export type SfxCue = {kind: SfxKind; frame: number};

type Timing = {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act};

// Frames before the end act where the riser begins (leads into the CTA).
export const RISER_LEAD = 45;

// Must track FeaturePanel.tsx: benefit line `i` reveals at
// `delayFrames = FEATURE_LINE_DELAY + staggerDelay(i, FEATURE_LINE_STAGGER, motion)`
// relative to its feature act's start. Kept in sync via staggerDelay (imported, not
// re-derived); the two literals mirror the inline constants in FeaturePanel's map.
const FEATURE_LINE_DELAY = 15;
const FEATURE_LINE_STAGGER = 10;

export const sfxCues = (
  timing: Timing,
  featureLineCounts: number[],
  motion: Motion,
): SfxCue[] => {
  const cues: SfxCue[] = [];

  // whoosh on each hard cut: into hook, into demo, into every feature act.
  cues.push({kind: 'whoosh', frame: timing.hook.from});
  cues.push({kind: 'whoosh', frame: timing.demo.from});
  for (const f of timing.features) {
    cues.push({kind: 'whoosh', frame: f.from});
  }

  // tick per benefit line, aligned to FeaturePanel's stagger onset.
  timing.features.forEach((f, fi) => {
    const count = featureLineCounts[fi] ?? 0;
    for (let li = 0; li < count; li += 1) {
      cues.push({
        kind: 'tick',
        frame: f.from + FEATURE_LINE_DELAY + Math.round(staggerDelay(li, FEATURE_LINE_STAGGER, motion)),
      });
    }
  });

  // riser building into the end-card CTA.
  cues.push({kind: 'riser', frame: timing.end.from - RISER_LEAD});

  return cues.sort((a, b) => a.frame - b.frame);
};

// ─────────────────────────────────────────────────────────────────────────────
// Post sfx cues — for HybridPost and Finish (shot-based, not act-based)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive SFX cues for a directed video (HybridPost or Finish) from the absolute
 * start frame of each shot.
 *
 *   intro   — at frame 0 (beginning of the video)
 *   swipe   — at each shot boundary except the last (between lines)
 *   riser   — RISER_LEAD frames before the last shot starts (builds into the ending)
 *   closing — optional: if `includeClosing`, one frame after the last shot ends
 *
 * @param shotStartFrames - absolute start frame of each shot (from timeline)
 * @param totalFrames     - total video length in frames (for closing hit placement)
 * @param includeClosing  - whether to include an optional closing hit
 */
export const postSfxCues = (
  shotStartFrames: number[],
  totalFrames: number,
  includeClosing = false,
): SfxCue[] => {
  if (shotStartFrames.length === 0) return [];
  const cues: SfxCue[] = [];

  // Intro hit at the very start of the video.
  cues.push({kind: 'intro', frame: 0});

  // Swipe at each interior shot boundary (not the last shot).
  for (let i = 1; i < shotStartFrames.length - 1; i++) {
    cues.push({kind: 'swipe', frame: shotStartFrames[i]});
  }

  // Riser leading into the last shot.
  if (shotStartFrames.length > 1) {
    const lastFrom = shotStartFrames[shotStartFrames.length - 1];
    const riserFrame = Math.max(0, lastFrom - RISER_LEAD);
    cues.push({kind: 'riser', frame: riserFrame});
  }

  // Optional closing hit near the end.
  if (includeClosing && totalFrames > 0) {
    cues.push({kind: 'closing', frame: Math.max(0, totalFrames - 15)});
  }

  return cues.sort((a, b) => a.frame - b.frame);
};
