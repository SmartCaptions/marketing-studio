import {z} from 'zod';
import noban from '../../../brands/noban.json';
import dashclaw from '../../../brands/dashclaw.json';
import paperroute from '../../../brands/paperroute.json';

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'expected #rrggbb hex color');

export const brandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().min(1),
  url: z.string().min(1),
  colors: z.object({
    bg: hex,
    surface: hex,
    surface2: hex,
    line: hex,
    ink: hex,
    ink2: hex,
    ink3: hex,
    brand: hex,
    profit: hex,
    safe: hex,
    loss: hex,
    info: hex,
    rare: hex,
  }),
  fonts: z.object({
    display: z.string().min(1),
    body: z.string().min(1),
    mono: z.string().min(1),
  }),
  // How loudly the brand mark is allowed to bloom. `wash` is the alpha of the
  // radial backdrop behind the mark, `glow` the alpha of its drop-shadow. Brands
  // whose rules forbid a hero wash (dashclaw: orange is signal, never decoration)
  // set wash to 0. Defaults reproduce the values these were hardcoded to.
  effects: z
    .object({
      wash: z.number().min(0).max(1),
      glow: z.number().min(0).max(1),
    })
    .default({wash: 0.165, glow: 0.4}),
  // FilmGrade overlay intensities — the template-to-agency production-value pass.
  // Each layer is 0..1 (letterbox capped low) and skipped at 0. Defaults are
  // deliberately RESTRAINED (grain barely-there, gentle vignette, faint accent bloom,
  // no aberration, no letterbox); brands whose rules forbid a hero wash/glow
  // (paperroute One Green Rule, dashclaw orange-is-signal) zero their bloom.
  grade: z
    .object({
      grain: z.number().min(0).max(1),
      vignette: z.number().min(0).max(1),
      bloom: z.number().min(0).max(1),
      aberration: z.number().min(0).max(1),
      letterbox: z.number().min(0).max(0.15),
    })
    .default({grain: 0.12, vignette: 0.18, bloom: 0.1, aberration: 0, letterbox: 0}),
  // Per-brand motion personality — retunes ALL entrance choreography (springs,
  // eased reveals, inter-element stagger) without ever moving a rest position, so
  // one knob per brand keeps a terse/mechanical brand terse and lets a lively one
  // spring. `tempo` is a duration multiplier for entrances/transitions (>1 brisker);
  // `exuberance` maps to spring bounciness (0 = critically-damped/no overshoot,
  // 1 = visibly bouncy); `stagger` scales inter-element delays; `overshoot` scales
  // how far a bouncy entrance travels past its rest point. Defaults reproduce the
  // prior smooth, no-overshoot feel; the math lives in lib/motion.ts and templates
  // consume it via `brand.motion`.
  motion: z
    .object({
      tempo: z.number().min(0.5).max(2),
      exuberance: z.number().min(0).max(1),
      stagger: z.number().min(0).max(1),
      overshoot: z.number().min(0).max(1),
    })
    .default({tempo: 1, exuberance: 0.35, stagger: 0.5, overshoot: 0.25}),
  voice: z.string().min(1),
});

/** 0..1 alpha -> the two-digit hex suffix of an #rrggbbaa color. */
export const alphaHex = (a: number): string =>
  Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');

export type Brand = z.infer<typeof brandSchema>;

const registry: Record<string, unknown> = {noban, dashclaw, paperroute};

export const getBrand = (id: string): Brand => {
  const raw = registry[id];
  if (raw === undefined) {
    throw new Error(
      `Unknown brand "${id}". Available: ${Object.keys(registry).join(', ')}`,
    );
  }
  return brandSchema.parse(raw);
};
