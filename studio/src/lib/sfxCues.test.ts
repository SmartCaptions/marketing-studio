import {describe, expect, it} from 'vitest';
import {launchTiming} from './launchTiming';
import {DEFAULT_MOTION} from './motion';
import {RISER_LEAD, sfxCues, postSfxCues} from './sfxCues';

// Real noban inputs: telemetry 16085ms, 2 features of 3 benefit lines each.
const T = launchTiming(16085, 2); // demo len = ceil(16085/1000*30)+24 = 507
// -> logo{0,150} hook{150,186} demo{336,507} feature0{843,180} feature1{1023,180} end{1203,150}

describe('sfxCues', () => {
  it('derives the full cue table against the real act boundaries', () => {
    const cues = sfxCues(T, [3, 3], DEFAULT_MOTION);
    // 4 whoosh (into hook/demo/feature0/feature1) + 6 tick (3 per feature) + 1 riser
    expect(cues).toHaveLength(11);
    expect(cues.filter((c) => c.kind === 'whoosh')).toHaveLength(4);
    expect(cues.filter((c) => c.kind === 'tick')).toHaveLength(6);
    expect(cues.filter((c) => c.kind === 'riser')).toHaveLength(1);
  });

  it('places whooshes on every hard act cut', () => {
    const w = sfxCues(T, [3, 3], DEFAULT_MOTION)
      .filter((c) => c.kind === 'whoosh')
      .map((c) => c.frame);
    expect(w).toEqual([150, 336, 843, 1023]); // hook, demo, feature0, feature1 starts
  });

  it('aligns ticks to FeaturePanel stagger (act.from + 15 + i*10 at default stagger)', () => {
    const t = sfxCues(T, [3, 3], DEFAULT_MOTION)
      .filter((c) => c.kind === 'tick')
      .map((c) => c.frame);
    expect(t).toEqual([858, 868, 878, 1038, 1048, 1058]);
  });

  it('starts the riser RISER_LEAD frames before the end act', () => {
    const r = sfxCues(T, [3, 3], DEFAULT_MOTION).find((c) => c.kind === 'riser');
    expect(r?.frame).toBe(T.end.from - RISER_LEAD); // 1203 - 45 = 1158
  });

  it('returns cues sorted by frame', () => {
    const frames = sfxCues(T, [3, 3], DEFAULT_MOTION).map((c) => c.frame);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });

  it('emits no ticks and no feature whooshes when there are no feature acts', () => {
    const t0 = launchTiming(null, 0);
    const cues = sfxCues(t0, [], DEFAULT_MOTION);
    expect(cues.filter((c) => c.kind === 'tick')).toHaveLength(0);
    expect(cues.filter((c) => c.kind === 'whoosh').map((c) => c.frame)).toEqual([
      t0.hook.from,
      t0.demo.from,
    ]);
    expect(cues.find((c) => c.kind === 'riser')?.frame).toBe(t0.end.from - RISER_LEAD);
  });

  it('scales tick spacing with brand stagger', () => {
    const wide = sfxCues(T, [2, 0], {...DEFAULT_MOTION, stagger: 1}).filter((c) => c.kind === 'tick');
    // stagger 1 => staggerDelay(i,10) = i*10*(1/0.5) = i*20
    expect(wide.map((c) => c.frame)).toEqual([858, 878]); // 843+15, 843+15+20
  });
});

describe('postSfxCues', () => {
  it('returns empty array for empty shot list', () => {
    expect(postSfxCues([], 300)).toEqual([]);
  });

  it('single shot: only intro cue, no swipes or riser', () => {
    const cues = postSfxCues([0], 90);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({kind: 'intro', frame: 0});
  });

  it('two shots: intro + riser, no swipes', () => {
    // Shot starts at 0 and 90; riser = 90 - 45 = 45
    const cues = postSfxCues([0, 90], 180);
    expect(cues.map((c) => c.kind).sort()).toEqual(['intro', 'riser']);
    expect(cues.find((c) => c.kind === 'riser')?.frame).toBe(90 - RISER_LEAD);
  });

  it('three shots: intro + one swipe at interior boundary + riser', () => {
    const cues = postSfxCues([0, 60, 120], 180);
    expect(cues.filter((c) => c.kind === 'swipe')).toHaveLength(1);
    expect(cues.find((c) => c.kind === 'swipe')?.frame).toBe(60);
    expect(cues.find((c) => c.kind === 'riser')?.frame).toBe(120 - RISER_LEAD);
  });

  it('does not add closing by default', () => {
    const cues = postSfxCues([0, 60, 120], 180);
    expect(cues.some((c) => c.kind === 'closing')).toBe(false);
  });

  it('adds closing at totalFrames - 15 when includeClosing is true', () => {
    const cues = postSfxCues([0, 60, 120], 180, true);
    const closing = cues.find((c) => c.kind === 'closing');
    expect(closing?.frame).toBe(165); // 180 - 15
  });

  it('clamps riser to frame 0 when last shot is very early', () => {
    // Last shot at frame 10, riser would be 10 - 45 = negative → 0
    const cues = postSfxCues([0, 10], 90);
    expect(cues.find((c) => c.kind === 'riser')?.frame).toBe(0);
  });
});
