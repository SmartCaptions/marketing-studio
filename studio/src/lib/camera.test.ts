import {describe, expect, it} from 'vitest';
import {cameraAt} from './camera';

const VP = {width: 1600, height: 1000};
const CLICKS = [{type: 'click' as const, t: 5000, x: 800, y: 500}];

describe('cameraAt', () => {
  it('is at rest (scale 1) long before and long after a click', () => {
    expect(cameraAt(CLICKS, 0, VP).scale).toBe(1);
    expect(cameraAt(CLICKS, 20000, VP).scale).toBe(1);
  });

  it('is fully zoomed during the hold window, centered on the click', () => {
    const cam = cameraAt(CLICKS, 6000, VP);
    expect(cam.scale).toBeCloseTo(1.35, 5);
    expect(cam.originX).toBe(800);
    expect(cam.originY).toBe(500);
  });

  it('ramps between rest and full zoom during the ease-in', () => {
    const cam = cameraAt(CLICKS, 4850, VP); // window starts at 4600, ease takes 500ms
    expect(cam.scale).toBeGreaterThan(1);
    expect(cam.scale).toBeLessThan(1.35);
  });

  it('clamps the origin so a corner click does not reveal out-of-bounds', () => {
    const corner = [{type: 'click' as const, t: 5000, x: 10, y: 990}];
    const cam = cameraAt(corner, 6000, VP);
    // min visible origin at scale 1.35: half of (viewport / scale)
    expect(cam.originX).toBeGreaterThanOrEqual(1600 / 1.35 / 2 - 1);
    expect(cam.originY).toBeLessThanOrEqual(1000 - 1000 / 1.35 / 2 + 1);
  });

  it('returns rest camera for an empty click list', () => {
    expect(cameraAt([], 1000, VP)).toEqual({scale: 1, originX: 800, originY: 500});
  });
});
