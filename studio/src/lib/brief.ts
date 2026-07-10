import {z} from 'zod';

// A Content Brief is the upstream source of truth for a product's launch copy.
// `scripts/derive-brief.mjs` gathers raw grounding into brief-inputs.json; the
// agent synthesizes that into out/<brand>/marketing/brief.json, which the props
// builders read. Every top-level field carries a sane default so a partial brief
// (or none) never breaks a downstream builder — mirror of how brand.ts stays
// smoke-green with an optional `effects` block on a clean clone.

const platformCopy = z.object({
  hook: z.string(),
  headline: z.string(),
});

export const briefSchema = z.object({
  // The one required field — a brief is always about a specific brand.
  brandId: z.string().min(1),
  // The headline plus alternates the agent can swap for A/B or platform fit.
  hook: z
    .object({
      headline: z.string(),
      altHeadlines: z.array(z.string()),
    })
    .default({headline: '', altHeadlines: []}),
  // Feature stories ranked best-first. `benefitLines` caps at 3 to match the
  // launch template's three-line FeaturePanel. `sourceRoute` records which
  // product route grounded the feature (null when it came from README/other).
  features: z
    .array(
      z.object({
        key: z.string(),
        heading: z.string(),
        benefitLines: z.array(z.string()).max(3),
        rationale: z.string(),
        sourceRoute: z.string().nullable(),
      }),
    )
    .default([]),
  positioning: z
    .object({
      differentiator: z.string(),
    })
    .nullable()
    .default(null),
  cta: z.string().default(''),
  // Voiceover lines keyed by launch act. `act` matches launchTiming.ts act
  // names as used by the audio manifest: `logo|hook|demo|feature-N|end`.
  narration: z
    .array(
      z.object({
        act: z.string(),
        text: z.string(),
      }),
    )
    .default([]),
  social: z
    .object({
      x: platformCopy.nullable(),
      linkedin: platformCopy.nullable(),
      vertical: platformCopy.nullable(),
    })
    .nullable()
    .default(null),
});

export type Brief = z.infer<typeof briefSchema>;
