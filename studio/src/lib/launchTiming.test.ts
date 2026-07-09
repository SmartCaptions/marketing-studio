import {describe, expect, it} from 'vitest';
import {launchTiming} from './launchTiming';

describe('launchTiming', () => {
  it('lays out sequential acts with no gaps', () => {
    const t = launchTiming(16000, 2);
    expect(t.logo).toEqual({from: 0, len: 150});
    expect(t.hook).toEqual({from: 150, len: 186});
    expect(t.demo.from).toBe(336);
    expect(t.demo.len).toBe(Math.ceil((16000 / 1000) * 30) + 24); // 504
    expect(t.features[0].from).toBe(336 + 504);
    expect(t.features[1].from).toBe(336 + 504 + 180);
    expect(t.end.from).toBe(336 + 504 + 360);
    expect(t.total).toBe(336 + 504 + 360 + 150);
  });

  it('falls back to a fixed demo act without telemetry', () => {
    const t = launchTiming(null, 0);
    expect(t.demo.len).toBe(240);
    expect(t.features).toHaveLength(0);
    expect(t.end.from).toBe(336 + 240);
  });

  it('stays inside the spec 30-90s range for the real inputs', () => {
    const t = launchTiming(16108, 2);
    expect(t.total / 30).toBeGreaterThanOrEqual(30);
    expect(t.total / 30).toBeLessThanOrEqual(90);
  });
});
