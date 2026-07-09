import type {ClickEvent} from './telemetry';
import {easeInOutCubic} from './telemetry';

const ZOOM = 1.35;
const LEAD_MS = 400; // window starts this long before the click
const IN_MS = 500;
const HOLD_MS = 1800;
const OUT_MS = 600;

type Camera = {scale: number; originX: number; originY: number};

const clampOrigin = (v: number, span: number, scale: number): number => {
  const half = span / scale / 2;
  return Math.min(Math.max(v, half), span - half);
};

export const cameraAt = (
  clickList: ClickEvent[],
  tMs: number,
  viewport: {width: number; height: number},
): Camera => {
  const rest: Camera = {scale: 1, originX: viewport.width / 2, originY: viewport.height / 2};
  // last window whose zoom has begun; later clicks win overlaps
  let active: ClickEvent | undefined;
  for (const c of clickList) {
    if (tMs >= c.t - LEAD_MS) active = c;
  }
  if (!active) return rest;

  const start = active.t - LEAD_MS;
  const sinceStart = tMs - start;
  let k: number; // 0 = rest, 1 = fully zoomed
  if (sinceStart < IN_MS) k = easeInOutCubic(sinceStart / IN_MS);
  else if (sinceStart < IN_MS + HOLD_MS) k = 1;
  else if (sinceStart < IN_MS + HOLD_MS + OUT_MS)
    k = 1 - easeInOutCubic((sinceStart - IN_MS - HOLD_MS) / OUT_MS);
  else return rest;

  const scale = 1 + (ZOOM - 1) * k;
  return {
    scale,
    originX: clampOrigin(active.x, viewport.width, ZOOM),
    originY: clampOrigin(active.y, viewport.height, ZOOM),
  };
};
