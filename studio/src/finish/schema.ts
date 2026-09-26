/**
 * Props of the Finish composition: one directed video whose visuals a finishing session wrote.
 * scripts/finish-prepare.mjs builds them (voice-over, word timings, staged media); the session's
 * declared words and media list are merged in by scripts/finish-render.mjs.
 */
import {z} from 'zod';

const phraseCueSchema = z.object({text: z.string(), fromMs: z.number(), toMs: z.number()});
const spokenWordSchema = z.object({text: z.string(), startMs: z.number(), endMs: z.number()});

export const finishMediaSchema = z.object({
  /** Path relative to the work directory's public folder */
  src: z.string(),
  kind: z.enum(['recording', 'screenshot', 'clip']),
  /** True for footage an image or video model made; using it turns on the AI label */
  ai: z.boolean(),
  /** Shown on the media while it is on screen (real recordings say they are real) */
  label: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Seconds of footage; null for a still */
  durationS: z.number().nullable(),
  /** What the footage shows, for the session to choose from */
  shows: z.string(),
});

/** The director's suggestion for a line; the session may follow it or not */
const planSchema = z.object({
  kind: z.string(),
  heading: z.string().optional(),
  highlight: z.string().optional(),
  lines: z.array(z.string()).optional(),
  media: z.string().optional(),
});

export const finishShotSchema = z.object({
  narration: z.string().min(1),
  audioSrc: z.string().nullable(),
  /** Narration plus the gap after it (and the closing hold on the last line) */
  audioDurationMs: z.number().int().positive(),
  captions: z.array(phraseCueSchema),
  words: z.array(spokenWordSchema),
  plan: planSchema,
});

const sfxCueSchema = z.object({
  kind: z.string(),
  frame: z.number().int().nonnegative(),
});

export const finishPropsSchema = z.object({
  brandId: z.string(),
  language: z.enum(['he', 'en']),
  look: z.enum(['studio', 'collage']),
  wordmarkSrc: z.string().nullable(),
  attribution: z.string().nullable(),
  shots: z.array(finishShotSchema).min(1).max(20),
  media: z.record(z.string(), finishMediaSchema),
  /** Every word the visuals show, by key (the session's words.json) */
  words: z.record(z.string(), z.string()),
  /** Media keys the visuals use (the session's USES export); set by calculateMetadata */
  uses: z.array(z.string()),
  /** True when any used media is AI footage; set by calculateMetadata */
  aiDisclosure: z.boolean(),
  /** Generated music track; null when generation failed or the key is absent. */
  music: z.object({src: z.string(), durationMs: z.number().positive()}).nullable().optional(),
  /** Why music is absent (for the review card). */
  musicAbsentReason: z.string().nullable().optional(),
  /** Sound-effect cues the finishing session declared, or template-derived defaults. */
  sfxCues: z.array(sfxCueSchema).optional(),
  /** True when sfx files are staged (set by prepare step). */
  sfxEnabled: z.boolean().optional(),
  /** Each effect's volume, levelled to this video's voice by finish-prepare */
  sfxGains: z.record(z.string(), z.number().min(0).max(1)).optional(),
  /** When true, voice-over <Audio> elements are suppressed but ducking windows stay active.
   *  Used for music-only renders to measure per-window ducked-music LUFS. */
  muteVoice: z.boolean().optional(),
});

export type FinishProps = z.infer<typeof finishPropsSchema>;
export type FinishMedia = z.infer<typeof finishMediaSchema>;
export type FinishShot = z.infer<typeof finishShotSchema>;

export const FPS = 30;

export const shotFrames = (shot: Pick<FinishShot, 'audioDurationMs'>) => Math.ceil((shot.audioDurationMs / 1000) * FPS);
