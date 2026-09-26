/**
 * HybridPost — 1080×1920, 30 fps social post composition.
 *
 * Two selectable looks driven by the `look` prop:
 *
 *   "studio"  — brand navy background, soft blue glow, blue-bordered rounded
 *               recording cards with shadow, dark pill captions, Secular One
 *               display headings.
 *
 *   "collage" — cream paper background with grain, sticky notes in pastel
 *               colours with slight tilts, recordings as taped tilted photos
 *               with a white border, Amatic SC label-tape captions, Suez One
 *               headings.
 *
 * Shot types (Shot.kind):
 *   "title"      — large headline with optional highlighted substring, optional extra lines.
 *   "chat"       — chat message bubble (sender, lines).
 *   "steps"      — list that pops items word-by-word; `crossed` draws a strikethrough
 *                  across all items near the end of the shot.
 *   "compare"    — two-column left/right comparison (label + items each side).
 *   "question"   — question heading with answer prompts.
 *   "recording"  — cropped screen recording in the look's card/frame; muted.
 *   "screenshot" — still image in the look's card/frame.
 *   "clip"       — AI video, full-bleed or framed; triggers ai_disclosure label.
 *   "end"        — wordmark + heading + sub-lines + optional attribution.
 *
 * Duration contract:
 *   Each shot's durationFrames = ceil(audioDurationMs / 1000 * 30); the end
 *   shot adds an extra 2 s hold baked into the props builder (audioDurationMs
 *   already includes it).
 *
 * Safe zones (from StoryReel, unchanged):
 *   top=285, bottom=672, left=32, right=192 (px in 1080×1920).
 *
 * BiDi / Hebrew safety rules (same as StoryReel):
 *   - direction: rtl, unicode-bidi: plaintext on all text nodes.
 *   - fixHebrewPrefixHyphen applied to every string.
 *   - Long English inside RTL headings: maxWidth + wordWrap so it never clips.
 */
import React from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {alphaHex, getBrand} from '../lib/brand';
import {duckedVolume, resolveSfxLayers, shotVoWindows} from '../lib/audioMix';
import {loadHybridPostFonts} from '../lib/fonts';
import {isHebrew} from '../lib/locale';
import {brandSpring} from '../lib/motion';
import {postSfxCues} from '../lib/sfxCues';
import {phrasesToFrameCues} from '../lib/wordCaptions';
import type {PhraseCue} from '../lib/wordCaptions';
import {fixHebrewPrefixHyphen} from '../lib/bidi';

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────
const phraseCueSchema = z.object({
  text: z.string(),
  fromMs: z.number(),
  toMs: z.number(),
});

const shotSchema = z.object({
  kind: z.enum([
    'title',
    'chat',
    'steps',
    'compare',
    'question',
    'recording',
    'screenshot',
    'clip',
    'end',
  ]),
  narration: z.string().min(1),
  heading: z.string().optional(),
  highlight: z.string().optional(),
  lines: z.array(z.string()).optional(),
  sender: z.string().optional(),
  crossed: z.boolean().optional(),
  left: z
    .object({label: z.string(), items: z.array(z.string())})
    .optional(),
  right: z
    .object({label: z.string(), items: z.array(z.string())})
    .optional(),
  media: z.string().optional(),
  start_s: z.number().optional(),
  end_s: z.number().optional(),
  crop: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  /** When true, the staged media file is already cropped+trimmed; render it full-frame. */
  mediaCropped: z.boolean().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
  // Built by the props builder:
  audioSrc: z.string().nullable(),
  audioDurationMs: z.number().int().positive(),
  captions: z.array(phraseCueSchema),
  // Steps: word-indexed pop times (frame index per item, from builder)
  stepPopFrames: z.array(z.number()).optional(),
});

export const hybridPostSchema = z.object({
  brandId: z.string().default('smartcaptions'),
  language: z.enum(['he', 'en']).default('he'),
  look: z.enum(['studio', 'collage']).default('studio'),
  aiDisclosure: z.boolean().default(false),
  wordmarkSrc: z.string().nullable().default(null),
  attribution: z.string().nullable().default(null),
  shots: z.array(shotSchema).min(1).max(20),
  /** Generated music track; null when generation failed or the key is absent. */
  music: z.object({src: z.string(), durationMs: z.number().positive()}).nullable().optional(),
  /** Why music is absent, for the review card. */
  musicAbsentReason: z.string().nullable().optional(),
  /** Sound-effect cue layer. `enabled` is set by the builder only when sfx files are staged. */
  sfx: z.object({enabled: z.boolean()}).optional(),
});

export type HybridPostProps = z.infer<typeof hybridPostSchema>;
type Shot = z.infer<typeof shotSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Safe zone constants (1080×1920, same as StoryReel)
// ─────────────────────────────────────────────────────────────────────────────
export const SAFE_TOP = 285;
export const SAFE_BOTTOM = 672;
// Bottom inset to align the drawn-shot content zone with the caption zone (CAPTION_TOP=1540).
// Using SAFE_BOTTOM (672) only reached y=1248; CONTENT_BOTTOM (380) reaches y=1540.
export const CONTENT_BOTTOM = 380;
export const SAFE_LEFT = 32;
export const SAFE_RIGHT = 192;
export const SAFE_W = 1080 - SAFE_LEFT - SAFE_RIGHT; // 856 px
// const SAFE_H = 1920 - SAFE_TOP - SAFE_BOTTOM; // 963 px (kept for reference)
// const SAFE_CX = SAFE_LEFT + SAFE_W / 2; // available for centred layouts if needed

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const easeIn = (frame: number, startFrame: number, durationFrames: number) =>
  clamp01((frame - startFrame) / Math.max(1, durationFrames));

const easeOut3 = (x: number) => 1 - Math.pow(clamp01(1 - x), 3);

const fadeIn = (frame: number, start: number, duration: number) =>
  easeOut3(easeIn(frame, start, duration));

// ─────────────────────────────────────────────────────────────────────────────
// Look-specific design tokens (not brand colors — these are look constants)
// ─────────────────────────────────────────────────────────────────────────────
export const COLLAGE_PAPER = '#f3ece0';
const COLLAGE_PASTEL = ['#fffde7', '#fce4ec', '#e3f2fd', '#e8f5e9', '#fff3e0', '#f3e5f5'];
const COLLAGE_TAPE_BG = '#f9d94b'; // yellow tape
export const COLLAGE_DARK = '#1f2937';

const STUDIO_CARD_BORDER = '#1667ff';
const STUDIO_CAPTION_BG = 'rgba(2,6,23,0.88)';

// ─────────────────────────────────────────────────────────────────────────────
// Background
// ─────────────────────────────────────────────────────────────────────────────
export const Background: React.FC<{look: 'studio' | 'collage'; brandId: string}> = ({
  look,
  brandId,
}) => {
  const brand = getBrand(brandId);
  if (look === 'collage') {
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{backgroundColor: COLLAGE_PAPER}} />
        {/* Subtle paper grain via an inline SVG element (not background-image) */}
        <AbsoluteFill style={{opacity: 0.06}}>
          <svg
            width="100%"
            height="100%"
            style={{position: 'absolute', inset: 0}}
            xmlns="http://www.w3.org/2000/svg"
          >
            <filter id="hp-noise">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.85"
                numOctaves="4"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#hp-noise)" />
          </svg>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{backgroundColor: brand.colors.bg}} />
      {/* Soft blue glow in the upper third */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 900px 700px at 50% 30%, ${brand.colors.brand}${alphaHex(0.18)}, transparent 70%)`,
        }}
      />
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Persistent brand watermark (top-right, studio look only)
// ─────────────────────────────────────────────────────────────────────────────
export const Watermark: React.FC<{look: 'studio' | 'collage'; brandId: string}> = ({
  look,
  brandId,
}) => {
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look);
  if (look !== 'studio') return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 70,
        fontFamily: fonts.mono,
        fontSize: 28,
        fontWeight: 500,
        letterSpacing: '0.04em',
        color: brand.colors.ink3,
        direction: 'ltr',
      }}
    >
      {brand.name}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AI disclosure label (shown persistently when ai_disclosure or any clip shot)
// ─────────────────────────────────────────────────────────────────────────────
export const AiLabel: React.FC<{look: 'studio' | 'collage'; language: 'he' | 'en'; brandId: string}> = ({
  look,
  language,
  brandId,
}) => {
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const text =
    language === 'he' ? 'הוויזואליה נוצרה בבינה מלאכותית' : 'AI-generated visuals';

  if (look === 'collage') {
    // Place in the top margin (above SAFE_TOP) so it never touches shot headings.
    return (
      <div
        style={{
          position: 'absolute',
          top: 60,
          ...(dir === 'rtl' ? {right: SAFE_LEFT} : {left: SAFE_LEFT}),
          backgroundColor: COLLAGE_DARK,
          color: '#ffffff',
          fontFamily: fonts.label,
          fontSize: 36,
          fontWeight: 700,
          padding: '8px 20px',
          letterSpacing: '0.06em',
          direction: dir,
          unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
          transform: 'rotate(-1deg)',
        }}
      >
        {text}
      </div>
    );
  }

  // Studio: anchor to top-LEFT so it never touches the top-right Watermark.
  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: SAFE_LEFT,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 14px',
        borderRadius: 20,
        background: `${brand.colors.bg}${alphaHex(0.75)}`,
        border: `1px solid ${brand.colors.line}`,
        direction: dir,
      }}
    >
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: brand.colors.brand,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: isHebrew(language) ? 'normal' : '0.04em',
          color: brand.colors.ink3,
          unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
        }}
      >
        {text}
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Caption pill / label-tape overlay (per shot)
// ─────────────────────────────────────────────────────────────────────────────
export const ShotCaptions: React.FC<{
  captions: PhraseCue[];
  look: 'studio' | 'collage';
  language: 'he' | 'en';
  brandId: string;
  sceneStartFrame: number;
}> = ({captions, look, language, brandId, sceneStartFrame}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const FADE = 4;

  const cues = phrasesToFrameCues(captions, sceneStartFrame, fps);
  const active = cues.find((c) => frame >= c.fromFrame && frame < c.toFrame) ?? null;
  if (!active) return null;

  // Clamp fade to half the cue duration — short cues (< 2×FADE frames) would
  // produce a non-monotonic input array and crash interpolate.
  const safeFade = Math.min(FADE, Math.floor((active.toFrame - active.fromFrame) / 2));
  const opacity = interpolate(
    frame,
    [active.fromFrame, active.fromFrame + safeFade, active.toFrame - safeFade, active.toFrame],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const text = fixHebrewPrefixHyphen(active.text);

  // Caption area: fixed zone below all visuals, above the bottom handle zone.
  const captionTop = 1540;

  if (look === 'collage') {
    return (
      <div
        style={{
          position: 'absolute',
          top: captionTop,
          left: SAFE_LEFT,
          right: SAFE_RIGHT,
          display: 'flex',
          justifyContent: 'center',
          opacity,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            backgroundColor: COLLAGE_DARK,
            color: '#f9fafb',
            fontFamily: fonts.label,
            fontSize: 64,
            fontWeight: 700,
            padding: '6px 28px',
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            maxWidth: 840,
            wordBreak: 'break-word',
            transform: `rotate(${-1.2 + (opacity - 0.5) * 0.4}deg)`,
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: captionTop,
        left: SAFE_LEFT,
        right: SAFE_RIGHT,
        display: 'flex',
        justifyContent: 'center',
        opacity,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          maxWidth: 880,
          padding: '18px 32px',
          borderRadius: 12,
          background: STUDIO_CAPTION_BG,
          border: `1.5px solid ${brand.colors.brand}${alphaHex(0.4)}`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.body,
            fontWeight: 700,
            fontSize: 52,
            lineHeight: 1.25,
            color: '#ffffff',
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Media card wrapper (recording / screenshot)
// ─────────────────────────────────────────────────────────────────────────────
export const MediaCard: React.FC<{
  look: 'studio' | 'collage';
  width: number;
  height: number;
  children: React.ReactNode;
  /** Index used for collage tilt direction */
  index?: number;
  /** Push-in progress 0→1 */
  progress: number;
}> = ({look, width, height, children, index = 0, progress}) => {
  const tilts = [-2.2, 1.6, -1.2, 2.0];
  const tilt = tilts[index % tilts.length];

  if (look === 'collage') {
    const BORDER = 22;
    const BOTTOM_EXTRA = 40; // extra white at bottom for "photo" look
    return (
      <div
        style={{
          width: width + BORDER * 2,
          height: height + BORDER * 2 + BOTTOM_EXTRA,
          backgroundColor: '#fcfaf5',
          boxShadow: '4px 6px 28px rgba(60,40,20,0.32)',
          position: 'relative',
          transform: `rotate(${tilt}deg) scale(${0.96 + progress * 0.04})`,
          flexShrink: 0,
        }}
      >
        {/* Yellow tape at top centre */}
        <div
          style={{
            position: 'absolute',
            top: -18,
            left: '50%',
            marginLeft: -55,
            width: 110,
            height: 30,
            backgroundColor: COLLAGE_TAPE_BG,
            opacity: 0.85,
            transform: 'rotate(-8deg)',
            zIndex: 2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: BORDER,
            left: BORDER,
            width,
            height,
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </div>
    );
  }

  // Studio card
  return (
    <div
      style={{
        borderRadius: 32,
        border: `6px solid ${STUDIO_CARD_BORDER}`,
        boxShadow: `0 0 0 1px ${STUDIO_CARD_BORDER}44, 0 32px 80px rgba(22,103,255,0.28)`,
        overflow: 'hidden',
        width,
        height,
        transform: `scale(${0.96 + progress * 0.04})`,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Cropped video player (for recording and clip shots)
// ─────────────────────────────────────────────────────────────────────────────
export const CroppedVideo: React.FC<{
  src: string;
  /** Source pixel crop box [x0, y0, x1, y1] — when provided AND preCropped is false,
   *  the video is expected to be the full source and CSS transform is used to crop it.
   *  When preCropped is true, the media is already cropped and rendered full-frame. */
  crop?: [number, number, number, number] | null;
  /** When true, the staged file is already cropped; render it at width×height with objectFit: cover. */
  preCropped?: boolean;
  /** Source start offset in seconds (ignored when preCropped is true) */
  startFrom?: number;
  /** Displayed width in px */
  width: number;
  /** Displayed height in px */
  height: number;
  /** Playback rate (default 1) */
  playbackRate?: number;
  /** Natural dimensions of the source file — used when CSS-transforming a non-pre-cropped video */
  sourceW?: number;
  sourceH?: number;
}> = ({src, crop, preCropped = false, startFrom = 0, width, height, playbackRate = 1, sourceW = 1920, sourceH = 1080}) => {
  // Pre-cropped: the media file already contains just the crop region — render full frame.
  // Use objectFit: contain so the entire pre-cropped frame is visible without any second crop.
  if (!crop || preCropped) {
    return (
      <OffthreadVideo
        src={staticFile(src)}
        style={{width, height, objectFit: 'contain'}}
        startFrom={Math.round(startFrom * 30)}
        muted
        playbackRate={playbackRate}
      />
    );
  }

  // CSS-transform crop: shift and scale the full source so the crop region fills width×height.
  // Only used for media that was NOT pre-cropped (e.g. clip shots with a crop that strips
  // a small number of pixels from the source, where ffmpeg pre-crop wasn't applied).
  //
  // Transform order (right-to-left in CSS, transformOrigin: 0 0):
  //   1. translate(-x0, -y0): move crop origin to (0,0)
  //   2. scale(width/cw, height/ch): scale so crop fills display box
  //
  // The outer container's overflow:hidden clips the result to [0,0,width,height].
  const [x0, y0, x1, y1] = crop;
  const cw = x1 - x0;
  const ch = y1 - y0;
  const scaleX = width / cw;
  const scaleY = height / ch;

  return (
    <div style={{width, height, overflow: 'hidden', position: 'relative'}}>
      <OffthreadVideo
        src={staticFile(src)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: sourceW,
          height: sourceH,
          transformOrigin: '0 0',
          transform: `scale(${scaleX}, ${scaleY}) translate(${-x0}px, ${-y0}px)`,
        }}
        startFrom={Math.round(startFrom * 30)}
        muted
        playbackRate={playbackRate}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shot: title
// ─────────────────────────────────────────────────────────────────────────────
const TitleShot: React.FC<{
  shot: Shot;
  look: 'studio' | 'collage';
  language: 'he' | 'en';
  brandId: string;
}> = ({shot, look, language, brandId}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const spring = brandSpring(frame, fps, brand.motion);
  const inkColor = look === 'collage' ? COLLAGE_DARK : brand.colors.ink;

  const renderHeading = () => {
    if (!shot.heading) return null;
    const heading = fixHebrewPrefixHyphen(shot.heading);
    const highlight = shot.highlight;

    if (highlight && heading.includes(highlight)) {
      const before = heading.slice(0, heading.indexOf(highlight));
      const after = heading.slice(heading.indexOf(highlight) + highlight.length);
      return (
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 88,
            fontWeight: 400,
            lineHeight: 1.2,
            color: inkColor,
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            maxWidth: SAFE_W,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
          }}
        >
          {before}
          <span style={{color: brand.colors.profit}}>{highlight}</span>
          {after}
        </div>
      );
    }

    return (
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: 88,
          fontWeight: 400,
          lineHeight: 1.2,
          color: inkColor,
          direction: dir,
          textAlign: 'center',
          unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
          maxWidth: SAFE_W,
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
        }}
      >
        {heading}
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: SAFE_TOP,
        bottom: CONTENT_BOTTOM,
        left: SAFE_LEFT,
        right: SAFE_RIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 28,
        direction: dir,
        transform: `translateY(${(1 - spring) * 24}px)`,
        overflow: 'hidden',
      }}
    >
      {renderHeading()}
      {shot.lines?.map((line, i) => (
        <div
          key={i}
          style={{
            fontFamily: fonts.body,
            fontSize: 52,
            fontWeight: 600,
            color: look === 'collage' ? '#4b5563' : brand.colors.ink2,
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            maxWidth: SAFE_W,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            opacity: fadeIn(frame, 6 + i * 4, 8),
          }}
        >
          {fixHebrewPrefixHyphen(line)}
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shot: chat
// ─────────────────────────────────────────────────────────────────────────────
const ChatShot: React.FC<{
  shot: Shot;
  look: 'studio' | 'collage';
  language: 'he' | 'en';
  brandId: string;
}> = ({shot, look, language, brandId}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const spring = brandSpring(frame, fps, brand.motion);
  const inkColor = look === 'collage' ? COLLAGE_DARK : brand.colors.ink;

  const bubbleBg =
    look === 'collage' ? '#fffde7' : brand.colors.surface;
  const bubbleBorder =
    look === 'collage' ? '3px solid #fdd835' : `2px solid ${brand.colors.line}`;
  const textColor = look === 'collage' ? COLLAGE_DARK : brand.colors.ink2;

  return (
    <div
      style={{
        position: 'absolute',
        top: SAFE_TOP,
        bottom: CONTENT_BOTTOM,
        left: SAFE_LEFT,
        right: SAFE_RIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 32,
        direction: dir,
        overflow: 'hidden',
      }}
    >
      {/* Heading above bubble */}
      {shot.heading && (
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 80,
            fontWeight: 400,
            lineHeight: 1.2,
            color: inkColor,
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            maxWidth: SAFE_W,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            opacity: spring,
          }}
        >
          {fixHebrewPrefixHyphen(shot.heading)}
        </div>
      )}

      {/* Chat bubble */}
      <div
        style={{
          backgroundColor: bubbleBg,
          border: bubbleBorder,
          borderRadius: look === 'collage' ? 8 : 28,
          padding: '32px 40px',
          maxWidth: SAFE_W - 40,
          transform: `scale(${0.9 + spring * 0.1}) ${look === 'collage' ? 'rotate(2.5deg)' : ''}`,
          boxShadow:
            look === 'collage'
              ? '4px 4px 0 #fdd835, 2px 2px 20px rgba(0,0,0,0.1)'
              : `0 8px 40px ${brand.colors.bg}cc`,
          direction: dir,
        }}
      >
        {shot.lines?.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: fonts.body,
              fontSize: 44,
              fontWeight: 500,
              lineHeight: 1.55,
              color: textColor,
              direction: dir,
              textAlign: dir === 'rtl' ? 'right' : 'left',
              unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
              maxWidth: SAFE_W - 120,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}
          >
            {fixHebrewPrefixHyphen(line)}
          </div>
        ))}
      </div>

      {/* Sender line */}
      {shot.sender && (
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 28,
            color: look === 'collage' ? '#6b7280' : brand.colors.ink3,
            direction: dir,
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            opacity: spring * 0.8,
          }}
        >
          {shot.sender}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shot: steps
// ─────────────────────────────────────────────────────────────────────────────
const StepsShot: React.FC<{
  shot: Shot;
  look: 'studio' | 'collage';
  language: 'he' | 'en';
  brandId: string;
  durationFrames: number;
}> = ({shot, look, language, brandId, durationFrames}) => {
  const frame = useCurrentFrame();
  useVideoConfig(); // consumed for Remotion render context; fps not needed here
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const inkColor = look === 'collage' ? COLLAGE_DARK : brand.colors.ink;
  const items = shot.lines ?? [];
  const popFrames = shot.stepPopFrames ?? items.map((_, i) => Math.round((i / Math.max(1, items.length - 1)) * durationFrames * 0.7));

  // Strikethrough progress: animate over last 20% of shot
  const crossStart = Math.round(durationFrames * 0.78);
  const crossProgress = clamp01((frame - crossStart) / 18);

  return (
    <div
      style={{
        position: 'absolute',
        top: SAFE_TOP,
        bottom: CONTENT_BOTTOM,
        left: SAFE_LEFT,
        right: SAFE_RIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 24,
        direction: dir,
        overflow: 'hidden',
      }}
    >
      {shot.heading && (
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 80,
            fontWeight: 400,
            color: inkColor,
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            maxWidth: SAFE_W,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            marginBottom: 12,
          }}
        >
          {fixHebrewPrefixHyphen(shot.heading)}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 20,
          justifyContent: 'center',
          maxWidth: SAFE_W,
          direction: dir,
          position: 'relative',
        }}
      >
        {items.map((item, i) => {
          const popProgress = easeOut3(clamp01((frame - (popFrames[i] ?? 0)) / 8));
          const itemVisible = frame >= (popFrames[i] ?? 0);

          if (look === 'collage') {
            const colors = COLLAGE_PASTEL;
            const tilts = [-4, 3, -2, 5, -5, 2];
            return (
              <div
                key={i}
                style={{
                  backgroundColor: colors[i % colors.length],
                  padding: '18px 28px',
                  fontFamily: fonts.display,
                  fontSize: 60,
                  fontWeight: 400,
                  color: COLLAGE_DARK,
                  direction: dir,
                  textAlign: 'center',
                  unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
                  maxWidth: 360,
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  boxShadow: '3px 3px 0 rgba(0,0,0,0.15)',
                  transform: `rotate(${tilts[i % tilts.length]}deg) scale(${0.7 + popProgress * 0.3})`,
                  opacity: itemVisible ? popProgress : 0,
                }}
              >
                {fixHebrewPrefixHyphen(item)}
              </div>
            );
          }

          return (
            <div
              key={i}
              style={{
                backgroundColor: brand.colors.surface,
                border: `1px solid ${brand.colors.line}`,
                borderRadius: 60,
                padding: '16px 36px',
                fontFamily: fonts.body,
                fontSize: 56,
                fontWeight: 700,
                color: brand.colors.ink2,
                direction: dir,
                textAlign: 'center',
                unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
                maxWidth: 400,
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
                transform: `scale(${0.7 + popProgress * 0.3})`,
                opacity: itemVisible ? popProgress : 0,
              }}
            >
              {fixHebrewPrefixHyphen(item)}
            </div>
          );
        })}
      </div>

      {/* Strikethrough (crossed) */}
      {shot.crossed && crossProgress > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: look === 'collage' ? `${(1 - crossProgress) * 40}%` : `${(1 - crossProgress) * 10}%`,
            right: look === 'collage' ? `${(1 - crossProgress) * 40}%` : `${(1 - crossProgress) * 10}%`,
            height: 20,
            backgroundColor: brand.colors.loss,
            borderRadius: 10,
            opacity: 0.9,
            transform: 'translateY(-50%) rotate(-8deg)',
            transformOrigin: 'left center',
          }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shot: compare
// ─────────────────────────────────────────────────────────────────────────────
const CompareShot: React.FC<{
  shot: Shot;
  look: 'studio' | 'collage';
  language: 'he' | 'en';
  brandId: string;
}> = ({shot, look, language, brandId}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const spring = brandSpring(frame, fps, brand.motion);
  const inkColor = look === 'collage' ? COLLAGE_DARK : brand.colors.ink;

  const renderColumn = (side: {label: string; items: string[]}, colorKey: 'loss' | 'safe', delay: number) => {
    const colOpacity = easeOut3(clamp01((frame - delay) / 10));
    const bgColor = look === 'collage'
      ? (colorKey === 'loss' ? '#fce4ec' : '#e8f5e9')
      : brand.colors.surface;
    const labelColor = look === 'collage'
      ? (colorKey === 'loss' ? '#c62828' : '#2e7d32')
      : brand.colors[colorKey];
    return (
      <div
        style={{
          flex: 1,
          backgroundColor: bgColor,
          border: `2px solid ${labelColor}`,
          borderRadius: look === 'collage' ? 8 : 20,
          padding: '24px 20px',
          opacity: colOpacity,
          direction: dir,
          transform: look === 'collage' ? `rotate(${colorKey === 'loss' ? -1.5 : 1.5}deg)` : 'none',
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 28,
            fontWeight: 700,
            color: labelColor,
            textAlign: 'center',
            letterSpacing: look === 'studio' ? '0.08em' : 'normal',
            marginBottom: 16,
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
          }}
        >
          {side.label}
        </div>
        {side.items.map((item, i) => (
          <div
            key={i}
            style={{
              fontFamily: fonts.body,
              fontSize: 40,
              fontWeight: 500,
              color: look === 'collage' ? COLLAGE_DARK : brand.colors.ink2,
              direction: dir,
              textAlign: 'center',
              unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
              lineHeight: 1.45,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}
          >
            {fixHebrewPrefixHyphen(item)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: SAFE_TOP,
        bottom: CONTENT_BOTTOM,
        left: SAFE_LEFT,
        right: SAFE_RIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 32,
        direction: dir,
        overflow: 'hidden',
      }}
    >
      {shot.heading && (
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 72,
            fontWeight: 400,
            color: inkColor,
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            maxWidth: SAFE_W,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            opacity: spring,
          }}
        >
          {fixHebrewPrefixHyphen(shot.heading)}
        </div>
      )}
      <div style={{display: 'flex', gap: 20, direction: dir}}>
        {shot.left && renderColumn(shot.left, 'loss', 6)}
        {shot.right && renderColumn(shot.right, 'safe', 14)}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shot: question
// ─────────────────────────────────────────────────────────────────────────────
const QuestionShot: React.FC<{
  shot: Shot;
  look: 'studio' | 'collage';
  language: 'he' | 'en';
  brandId: string;
}> = ({shot, look, language, brandId}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const spring = brandSpring(frame, fps, brand.motion);
  const inkColor = look === 'collage' ? COLLAGE_DARK : brand.colors.ink;

  return (
    <div
      style={{
        position: 'absolute',
        top: SAFE_TOP,
        bottom: CONTENT_BOTTOM,
        left: SAFE_LEFT,
        right: SAFE_RIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 36,
        direction: dir,
        overflow: 'hidden',
      }}
    >
      {shot.heading && (
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 84,
            fontWeight: 400,
            color: inkColor,
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            maxWidth: SAFE_W,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            opacity: spring,
          }}
        >
          {fixHebrewPrefixHyphen(shot.heading)}
        </div>
      )}
      {shot.lines?.map((line, i) => (
        <div
          key={i}
          style={{
            fontFamily: fonts.body,
            fontSize: 48,
            fontWeight: 600,
            color: look === 'collage' ? '#374151' : brand.colors.ink2,
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            maxWidth: SAFE_W,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            opacity: fadeIn(frame, 10 + i * 6, 10),
          }}
        >
          {fixHebrewPrefixHyphen(line)}
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shot: recording / screenshot
// ─────────────────────────────────────────────────────────────────────────────
const RecordingShot: React.FC<{
  shot: Shot;
  look: 'studio' | 'collage';
  language: 'he' | 'en';
  brandId: string;
  durationFrames: number;
  shotIndex: number;
}> = ({shot, look, language, brandId, durationFrames, shotIndex}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const spring = brandSpring(frame, fps, brand.motion);
  const inkColor = look === 'collage' ? COLLAGE_DARK : brand.colors.ink;

  // Layout zones for recording shots (1080×1920 coordinate space):
  //   HEADING_ZONE:  SAFE_TOP … SAFE_TOP+HEADING_H  (only when heading present)
  //   CARD_ZONE:     headingBottom+CARD_GAP … CAPTION_TOP-CARD_GAP
  //   CAPTION_ZONE:  CAPTION_TOP … (bottom of screen)
  const CAPTION_TOP_REC = 1540;
  const HEADING_H_REC = 160;      // px reserved for a single-line heading at fontSize 68
  const CARD_GAP = 36;
  const CARD_MAX_W = 960;
  // In collage look, MediaCard adds BORDER*2 (44) + BOTTOM_EXTRA (40) = 84 px below
  // the video/photo, plus the ~2.2° rotation extends the visual bottom by ~25 px.
  // These must stay above CAPTION_TOP, so we subtract them from the card zone.
  const COLLAGE_CARD_EXTRA = 84;  // photo border height added by collage MediaCard
  const COLLAGE_TILT_MARGIN = 25; // extra vertical reach from the rotation transform
  const cardHExtra = look === 'collage' ? COLLAGE_CARD_EXTRA + COLLAGE_TILT_MARGIN : 0;
  // Height of the label row (fontSize 26 + padding 8+8 + 8px gap below card visual bottom).
  const LABEL_H_ROW = 60;

  const headingPresent = !!shot.heading;
  const contentTop = headingPresent
    ? SAFE_TOP + HEADING_H_REC + CARD_GAP
    : SAFE_TOP + CARD_GAP;
  // The card zone bottom is tightened to keep the entire card block (video, photo border,
  // tilt margin, and label row) above CAPTION_TOP.
  const contentBottom = CAPTION_TOP_REC - CARD_GAP - cardHExtra - (shot.label ? LABEL_H_ROW : 0);
  const availH = contentBottom - contentTop; // vertical space for the card

  // Card dimensions — aspect ratio from crop box, width up to CARD_MAX_W.
  const crop = shot.crop ?? null;
  const mediaCropped = shot.mediaCropped ?? false;
  let mediaW: number, mediaH: number;
  if (crop) {
    const [x0, y0, x1, y1] = crop;
    const aspect = (x1 - x0) / (y1 - y0);
    mediaW = CARD_MAX_W;
    mediaH = Math.round(mediaW / aspect);
    if (mediaH > availH) {
      mediaH = availH;
      mediaW = Math.round(mediaH * aspect);
    }
  } else {
    mediaW = Math.min(CARD_MAX_W, 860);
    mediaH = Math.round(mediaW * 9 / 16);
    if (mediaH > availH) {
      mediaH = availH;
      mediaW = Math.round(mediaH * 16 / 9);
    }
  }

  // Card absolute position: horizontally centred, vertically centred in the card zone.
  const cardLeft = Math.round((1080 - mediaW) / 2);
  const cardTop = contentTop + Math.round((availH - mediaH) / 2);
  // In collage look the MediaCard div extends cardHExtra px below the video area
  // (photo border + tilt margin).  The label must sit below that visual bottom.
  const cardVisualBottom = cardTop + mediaH + cardHExtra;
  const labelTop = cardVisualBottom + 8;

  // Gentle push-in
  const pushScale = 1 + spring * 0.012 * (durationFrames / 90);

  // Source range for recording
  const startFrom = shot.start_s ?? 0;
  const endFrom = shot.end_s;
  let playbackRate = 1;
  if (endFrom && shot.audioDurationMs) {
    const sourceSecs = endFrom - startFrom;
    const targetSecs = shot.audioDurationMs / 1000;
    if (sourceSecs < targetSecs) {
      // Source is shorter than narration — slow it down to fill
      playbackRate = sourceSecs / targetSecs;
    }
  }

  const isScreenshot = shot.kind === 'screenshot';
  const mediaSrc = shot.media ?? null;

  return (
    <AbsoluteFill>
      {/* Heading — fixed zone at top of safe area, wraps to 90% width */}
      {shot.heading && (
        <div
          style={{
            position: 'absolute',
            top: SAFE_TOP,
            left: SAFE_LEFT,
            right: SAFE_RIGHT,
            height: HEADING_H_REC,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: spring,
          }}
        >
          <div
            style={{
              fontFamily: fonts.display,
              fontSize: 68,
              fontWeight: 400,
              color: inkColor,
              direction: dir,
              textAlign: 'center',
              unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
              maxWidth: SAFE_W * 0.9,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}
          >
            {fixHebrewPrefixHyphen(shot.heading)}
          </div>
        </div>
      )}

      {/* Card — absolutely positioned in the card zone */}
      <div
        style={{
          position: 'absolute',
          top: cardTop,
          left: cardLeft,
          transform: `scale(${pushScale})`,
          transformOrigin: 'center center',
        }}
      >
        <MediaCard
          look={look}
          width={mediaW}
          height={mediaH}
          index={shotIndex}
          progress={spring}
        >
          {mediaSrc && isScreenshot ? (
            <Img
              src={staticFile(mediaSrc)}
              style={{width: mediaW, height: mediaH, objectFit: 'contain'}}
            />
          ) : mediaSrc ? (
            <CroppedVideo
              src={mediaSrc}
              crop={mediaCropped ? null : crop}
              preCropped={mediaCropped}
              startFrom={startFrom}
              width={mediaW}
              height={mediaH}
              playbackRate={playbackRate}
              sourceW={1920}
              sourceH={1080}
            />
          ) : (
            <div
              style={{
                width: mediaW,
                height: mediaH,
                backgroundColor: brand.colors.surface2,
              }}
            />
          )}
        </MediaCard>
      </div>

      {/* Label — below the card, clearly separated from heading */}
      {shot.label && (
        <div
          style={{
            position: 'absolute',
            top: labelTop,
            left: SAFE_LEFT,
            right: SAFE_RIGHT,
            display: 'flex',
            justifyContent: dir === 'rtl' ? 'flex-end' : 'flex-start',
            paddingLeft: dir === 'ltr' ? 20 : 0,
            paddingRight: dir === 'rtl' ? 20 : 0,
          }}
        >
          <div
            style={{
              backgroundColor:
                look === 'collage' ? 'transparent' : `${brand.colors.surface}${alphaHex(0.9)}`,
              border: look === 'studio' ? `1px solid ${brand.colors.line}` : 'none',
              borderRadius: 20,
              padding: '8px 20px',
              fontFamily: fonts.mono,
              fontSize: 26,
              fontWeight: look === 'collage' ? 700 : 500,
              color: look === 'collage' ? '#b91c1c' : brand.colors.ink3,
              direction: dir,
              unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
              opacity: spring,
              maxWidth: SAFE_W - 40,
            }}
          >
            {shot.label}
          </div>
        </div>
      )}

      {/* Note (bottom of safe zone, small) */}
      {shot.note && (
        <div
          style={{
            position: 'absolute',
            bottom: SAFE_BOTTOM + 20,
            left: SAFE_LEFT,
            right: SAFE_RIGHT,
            fontFamily: fonts.mono,
            fontSize: 26,
            color: look === 'collage' ? '#6b7280' : brand.colors.ink3,
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            opacity: spring * 0.75,
          }}
        >
          {fixHebrewPrefixHyphen(shot.note)}
        </div>
      )}
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shot: clip (AI video)
// ─────────────────────────────────────────────────────────────────────────────
const ClipShot: React.FC<{
  shot: Shot;
  look: 'studio' | 'collage';
  language: 'he' | 'en';
  brandId: string;
  shotIndex: number;
}> = ({shot, look, language, brandId, shotIndex}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const spring = brandSpring(frame, fps, brand.motion);

  const startFrom = shot.start_s ?? 0;
  const mediaSrc = shot.media ?? null;

  // Clip is full-bleed unless it has a crop
  const hasCrop = !!shot.crop;
  const crop = shot.crop ?? null;

  return (
    <AbsoluteFill>
      {/* Full-bleed video background */}
      {mediaSrc && !hasCrop ? (
        <AbsoluteFill>
          <OffthreadVideo
            src={staticFile(mediaSrc)}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
            startFrom={Math.round(startFrom * 30)}
            muted
          />
        </AbsoluteFill>
      ) : mediaSrc && hasCrop ? (
        <div
          style={{
            position: 'absolute',
            top: SAFE_TOP,
            bottom: SAFE_BOTTOM,
            left: SAFE_LEFT,
            right: SAFE_RIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{transform: `scale(${0.96 + spring * 0.04})`}}>
            <MediaCard
              look={look}
              width={SAFE_W - 40}
              height={Math.round((SAFE_W - 40) * 16 / 9)}
              index={shotIndex}
              progress={spring}
            >
              <CroppedVideo
                src={mediaSrc}
                crop={shot.mediaCropped ? null : crop}
                preCropped={shot.mediaCropped ?? false}
                startFrom={startFrom}
                width={SAFE_W - 40}
                height={Math.round((SAFE_W - 40) * 16 / 9)}
                sourceW={1080}
                sourceH={1920}
              />
            </MediaCard>
          </div>
        </div>
      ) : null}

      {/* Heading / label overlay */}
      {shot.heading && (
        <div
          style={{
            position: 'absolute',
            top: SAFE_TOP + 40,
            left: SAFE_LEFT,
            right: SAFE_RIGHT,
            fontFamily: fonts.display,
            fontSize: 72,
            color: '#ffffff',
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
            maxWidth: SAFE_W,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            textShadow: '0 2px 12px rgba(0,0,0,0.7)',
            opacity: spring,
          }}
        >
          {fixHebrewPrefixHyphen(shot.heading)}
        </div>
      )}
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shot: end
// ─────────────────────────────────────────────────────────────────────────────
const EndShot: React.FC<{
  shot: Shot;
  look: 'studio' | 'collage';
  language: 'he' | 'en';
  brandId: string;
  wordmarkSrc: string | null;
  attribution: string | null;
}> = ({shot, look, language, brandId, wordmarkSrc, attribution}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadHybridPostFonts(look, language);
  const dir = isHebrew(language) ? 'rtl' : 'ltr';
  const spring = brandSpring(frame, fps, brand.motion);
  const inkColor = look === 'collage' ? COLLAGE_DARK : brand.colors.ink;

  const wordmarkEl = wordmarkSrc ? (
    look === 'collage' ? (
      <div
        style={{
          backgroundColor: '#0f172a',
          padding: '24px 36px',
          transform: `rotate(-2deg) scale(${0.88 + spring * 0.12})`,
          opacity: spring,
        }}
      >
        <Img
          src={staticFile(wordmarkSrc)}
          style={{width: 560, height: 'auto', objectFit: 'contain'}}
        />
      </div>
    ) : (
      <div style={{transform: `scale(${0.9 + spring * 0.1})`, opacity: spring}}>
        <Img
          src={staticFile(wordmarkSrc)}
          style={{width: 560, height: 'auto', objectFit: 'contain'}}
        />
      </div>
    )
  ) : null;

  return (
    <AbsoluteFill>
      {/* Glow / wash */}
      {look === 'studio' && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(60% 40% at 50% 50%, ${brand.colors.brand}${alphaHex(0.18)}, transparent 70%)`,
          }}
        />
      )}

      {/* Plain div — not AbsoluteFill — so bottom: CONTENT_BOTTOM is respected.
          AbsoluteFill injects height: 100% which overrides the bottom constraint
          and pushes content into the caption zone. */}
      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          bottom: CONTENT_BOTTOM,
          left: SAFE_LEFT,
          right: SAFE_RIGHT,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 32,
          direction: dir,
          transform: `translateY(${(1 - spring) * 20}px)`,
          overflow: 'hidden',
        }}
      >
        {wordmarkEl}

        {shot.heading && (
          <div
            style={{
              fontFamily: fonts.display,
              fontSize: 72,
              fontWeight: 400,
              color: inkColor,
              direction: dir,
              textAlign: 'center',
              unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
              maxWidth: SAFE_W,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              opacity: spring,
            }}
          >
            {fixHebrewPrefixHyphen(shot.heading)}
          </div>
        )}

        {shot.lines?.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: fonts.body,
              fontSize: 48,
              fontWeight: 500,
              color: look === 'collage' ? '#374151' : brand.colors.ink2,
              direction: dir,
              textAlign: 'center',
              unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
              maxWidth: SAFE_W,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              opacity: fadeIn(frame, 8 + i * 8, 10),
            }}
          >
            {fixHebrewPrefixHyphen(line)}
          </div>
        ))}

        {/* Highlight last sub-line in accent color */}
        {attribution && (
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 28,
              color: look === 'collage' ? '#6b7280' : brand.colors.ink3,
              direction: dir,
              textAlign: 'center',
              unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
              opacity: spring * 0.7,
            }}
          >
            {attribution}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main composition
// ─────────────────────────────────────────────────────────────────────────────
export const HybridPost: React.FC<HybridPostProps> = ({
  brandId,
  language,
  look,
  aiDisclosure,
  wordmarkSrc,
  attribution,
  shots,
  music,
  sfx,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const brand = getBrand(brandId);

  // Compute per-shot start frames
  const shotStartFrames: number[] = [];
  const shotFrameCounts: number[] = [];
  let cursor = 0;
  for (const shot of shots) {
    shotStartFrames.push(cursor);
    const frames = Math.ceil((shot.audioDurationMs / 1000) * fps);
    shotFrameCounts.push(frames);
    cursor += frames;
  }

  // VO ducking windows and SFX cues for the sound layer.
  const voWindows = shotVoWindows(shots);
  const sfxEnabled = sfx?.enabled === true;
  const sfxCues = sfxEnabled ? postSfxCues(shotStartFrames, durationInFrames) : [];
  const sfxLayers = sfxEnabled
    ? resolveSfxLayers(sfxCues, () => true)
    : [];

  // Show AI disclosure when flag is set or any shot is a clip
  const showAiLabel = aiDisclosure || shots.some((s) => s.kind === 'clip');

  const fadeAmount = interpolate(frame, [0, 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const XFADE = 8;

  return (
    <AbsoluteFill
      style={{backgroundColor: look === 'collage' ? COLLAGE_PAPER : brand.colors.bg, opacity: fadeAmount}}
    >
      {/* Background */}
      <Background look={look} brandId={brandId} />

      {/* Music bed with sidechain ducking under voice-over */}
      {music ? (
        <Html5Audio
          src={staticFile(music.src)}
          volume={(f) => duckedVolume(f, voWindows, durationInFrames)}
        />
      ) : null}

      {/* SFX cue layer (intro, swipes, riser) */}
      {sfxLayers.map((layer, i) => (
        <Sequence key={`sfx-${i}`} from={layer.frame}>
          <Html5Audio src={staticFile(layer.src)} volume={() => layer.volume} />
        </Sequence>
      ))}

      {/* Shots */}
      {shots.map((shot, i) => {
        const startFrame = shotStartFrames[i];
        const durationFrames = shotFrameCounts[i];

        const ShotComponent = (() => {
          switch (shot.kind) {
            case 'title':
              return (
                <TitleShot
                  shot={shot}
                  look={look}
                  language={language}
                  brandId={brandId}
                />
              );
            case 'chat':
              return (
                <ChatShot
                  shot={shot}
                  look={look}
                  language={language}
                  brandId={brandId}
                />
              );
            case 'steps':
              return (
                <StepsShot
                  shot={shot}
                  look={look}
                  language={language}
                  brandId={brandId}
                  durationFrames={durationFrames}
                />
              );
            case 'compare':
              return (
                <CompareShot
                  shot={shot}
                  look={look}
                  language={language}
                  brandId={brandId}
                />
              );
            case 'question':
              return (
                <QuestionShot
                  shot={shot}
                  look={look}
                  language={language}
                  brandId={brandId}
                />
              );
            case 'recording':
            case 'screenshot':
              return (
                <RecordingShot
                  shot={shot}
                  look={look}
                  language={language}
                  brandId={brandId}
                  durationFrames={durationFrames}
                  shotIndex={i}
                />
              );
            case 'clip':
              return (
                <ClipShot
                  shot={shot}
                  look={look}
                  language={language}
                  brandId={brandId}
                  shotIndex={i}
                />
              );
            case 'end':
              return (
                <EndShot
                  shot={shot}
                  look={look}
                  language={language}
                  brandId={brandId}
                  wordmarkSrc={wordmarkSrc}
                  attribution={attribution}
                />
              );
            default:
              return null;
          }
        })();

        return (
          <Sequence
            key={i}
            from={startFrame - XFADE}
            durationInFrames={durationFrames + XFADE * 2}
          >
            <AbsoluteFill
              style={{
                opacity: interpolate(
                  frame,
                  [
                    startFrame - XFADE,
                    startFrame,
                    startFrame + durationFrames,
                    startFrame + durationFrames + XFADE,
                  ],
                  [0, 1, 1, 0],
                  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
                ),
              }}
            >
              {ShotComponent}

              {/* Voice-over audio */}
              {shot.audioSrc ? <Html5Audio src={staticFile(shot.audioSrc)} /> : null}

              {/* Captions */}
              <ShotCaptions
                captions={shot.captions}
                look={look}
                language={language}
                brandId={brandId}
                sceneStartFrame={XFADE}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* Persistent watermark (studio only) */}
      <Watermark look={look} brandId={brandId} />

      {/* AI disclosure label */}
      {showAiLabel && (
        <AbsoluteFill
          style={{
            opacity: interpolate(frame, [0, 12], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <AiLabel look={look} language={language} brandId={brandId} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
