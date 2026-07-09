export type Act = {from: number; len: number};

const FPS = 30;
const LOGO_LEN = 150;
const HOOK_LEN = 186;
const DEMO_FALLBACK_LEN = 240;
const DEMO_TAIL = 24;
const FEATURE_LEN = 180;
const END_LEN = 150;

export const launchTiming = (
  telemetryDurationMs: number | null,
  featureCount: number,
): {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act; total: number} => {
  const demoLen = telemetryDurationMs
    ? Math.ceil((telemetryDurationMs / 1000) * FPS) + DEMO_TAIL
    : DEMO_FALLBACK_LEN;
  let cursor = 0;
  const next = (len: number): Act => {
    const act = {from: cursor, len};
    cursor += len;
    return act;
  };
  const logo = next(LOGO_LEN);
  const hook = next(HOOK_LEN);
  const demo = next(demoLen);
  const features = Array.from({length: featureCount}, () => next(FEATURE_LEN));
  const end = next(END_LEN);
  return {logo, hook, demo, features, end, total: cursor};
};
