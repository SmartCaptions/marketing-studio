// Mirrors studio/src/lib/sfxCues.ts postSfxCues and HybridPost's shot timeline (30 fps,
// ceil per shot), so render-post can report the cues the template renders. The parity
// test in studio/src/lib/sfxCues.test.ts keeps the two in step.
export const POST_FPS = 30;
export const POST_RISER_LEAD = 60;

/** The template's sound cues for these shots, as HybridPost places them */
export const templateCues = (shots) => {
  const starts = [];
  let cursor = 0;
  for (const shot of shots) {
    starts.push(cursor);
    cursor += Math.ceil((shot.audioDurationMs / 1000) * POST_FPS);
  }
  if (starts.length === 0) return [];
  const cues = [{kind: 'intro', frame: 0}];
  for (let i = 1; i < starts.length; i++) cues.push({kind: 'swipe', frame: starts[i]});
  if (starts.length > 1) cues.push({kind: 'riser', frame: Math.max(0, starts[starts.length - 1] - POST_RISER_LEAD)});
  return cues.sort((a, b) => a.frame - b.frame);
};
