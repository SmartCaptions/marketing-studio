/**
 * StoryReel — 1080×1920 portrait composition for Instagram Reels / YouTube Shorts.
 *
 * Scene sequence:
 *   1. Hook headline (hookDurationMs, default 1 s)
 *   2. N scenes: each fills its narration's spoken duration
 *      - image scenes: full-bleed still with gentle push/pan
 *      - video scenes: full-bleed OffthreadVideo playback
 *      - burned captions from word-level ElevenLabs alignment
 *      - per-scene voice-over audio
 *   3. End card with CTA + brand mark (endCardDurationMs, default 2 s)
 *
 * Platform safe areas (1080×1920):
 *   Instagram Reels: critical text within centre 1080×1350 → top/bottom inset 285 px
 *   YouTube Shorts:  stay above bottom 672 px, clear of right 192 px
 *   Combined safe zone top=285, bottom=672, left=32, right=192.
 *
 * Hebrew RTL: `locale="he"` switches fonts to Rubik, sets direction=rtl.
 *   Mixed Hebrew + Latin (e.g. "Premiere Pro") renders in correct bidi order
 *   via CSS `unicode-bidi: plaintext` on caption text nodes.
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
import {loadLocaleFonts} from '../lib/fonts';
import {isHebrew} from '../lib/locale';
import {brandSpring} from '../lib/motion';
import {getHeroMark} from '../brands/marks';
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

const sceneSchema = z.object({
  /** Scene type.
   *  - "image": full-bleed still with Ken Burns push/pan.
   *  - "video": full-bleed OffthreadVideo.
   *  - "output": branded card showing verbatim transcript lines from a real
   *    SmartCaptions SRT (1–6 lines, passed exactly as given, no rewording).
   *    No media path; background is brand surface with a "SmartCaptions output"
   *    label and gentle reveal animation. */
  kind: z.enum(['image', 'video', 'output']),
  /** Path relative to studio/public/ (via staticFile). Null for "output" kind. */
  media: z.string().nullable(),
  /** Path relative to studio/public/; null for smoke/default renders. */
  audioSrc: z.string().nullable(),
  audioDurationMs: z.number().int().positive(),
  /** Word-level caption cues in ms, relative to scene start. */
  captions: z.array(phraseCueSchema),
  /** For kind="output": verbatim transcript lines (1–6) from a real SRT.
   *  Rendered as-is, no truncation beyond CSS line wrapping. */
  outputLines: z.array(z.string()).min(1).max(6).optional(),
});

export const storyReelSchema = z.object({
  brandId: z.string(),
  language: z.enum(['he', 'en']).default('he'),
  hook: z.string(),
  cta: z.string(),
  aiDisclosure: z.boolean().default(false),
  /** Hook title card duration (ms). */
  hookDurationMs: z.number().int().positive().default(1000),
  /** End card duration (ms). */
  endCardDurationMs: z.number().int().positive().default(2000),
  scenes: z.array(sceneSchema).min(1),
});

export type StoryReelProps = z.infer<typeof storyReelSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Safe area constants (pixels in 1080×1920)
// ─────────────────────────────────────────────────────────────────────────────
const SAFE_TOP = 285;    // Instagram Reels: keep critical text in centre 1080×1350
const SAFE_BOTTOM = 672; // YouTube Shorts: above platform UI (comments / title)
const SAFE_RIGHT = 192;  // YouTube Shorts: clear of like/share buttons
const SAFE_LEFT = 32;    // comfortable gutter

// Fade helpers
const fade = (frame: number, inStart: number, inEnd: number, outStart: number, outEnd: number) =>
  interpolate(frame, [inStart, inEnd, outStart, outEnd], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

// ─────────────────────────────────────────────────────────────────────────────
// Hook scene
// ─────────────────────────────────────────────────────────────────────────────
const HookScene: React.FC<{
  hook: string;
  brandId: string;
  locale: string;
  durationFrames: number;
}> = ({hook, brandId, locale, durationFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadLocaleFonts(brand, locale);
  const dir = isHebrew(locale) ? 'rtl' : 'ltr';
  const spring = brandSpring(frame, fps, brand.motion);
  // Fast entrance: text punches in from slightly below within the first 10 frames.
  const enterY = interpolate(frame, [0, 10], [28, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const opacity = fade(frame, 0, 5, durationFrames - 10, durationFrames);

  return (
    <AbsoluteFill style={{opacity}}>
      {/* Full dark fill so the hook reads over any image behind it */}
      <AbsoluteFill style={{background: brand.colors.bg}} />
      {/* Subtle brand radial wash */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 50% at 50% 40%, ${brand.colors.brand}${alphaHex(0.15)}, transparent 70%)`,
        }}
      />
      {/* Hook text, centered in the safe zone */}
      <AbsoluteFill
        style={{
          top: SAFE_TOP,
          bottom: SAFE_BOTTOM,
          left: SAFE_LEFT,
          right: SAFE_RIGHT,
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 24,
        }}
      >
        {/* Kicker line — Latin brand name, letter-spacing is fine here */}
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: '0.25em',
            color: brand.colors.brand,
            direction: dir,
            textAlign: 'center',
            opacity: spring,
          }}
        >
          {brand.name.toUpperCase()}
        </div>
        {/* Hook headline: large, bold, high-contrast card */}
        <div
          style={{
            background: `${brand.colors.surface}${alphaHex(0.9)}`,
            borderRadius: 20,
            border: `2px solid ${brand.colors.brand}${alphaHex(0.35)}`,
            padding: '36px 44px',
            maxWidth: 920,
            transform: `scale(${0.97 + spring * 0.03}) translateY(${enterY}px)`,
          }}
        >
          <div
            style={{
              fontFamily: fonts.display,
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.15,
              color: brand.colors.ink,
              direction: dir,
              textAlign: 'center',
              unicodeBidi: 'plaintext',
            }}
          >
            {fixHebrewPrefixHyphen(hook)}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Image scene with Ken Burns push/pan
// ─────────────────────────────────────────────────────────────────────────────
const ImageScene: React.FC<{
  src: string;
  durationFrames: number;
  /** Pan direction: 0=right, 1=left, 2=up, 3=down, based on scene index */
  panVariant: number;
}> = ({src, durationFrames, panVariant}) => {
  const frame = useCurrentFrame();
  const progress = durationFrames > 1 ? frame / (durationFrames - 1) : 0;
  const scale = 1 + progress * 0.05; // 1.00 → 1.05 gentle zoom

  // Pan offset: ±2% on one axis depending on variant
  const panX =
    panVariant % 2 === 0
      ? (panVariant === 0 ? progress * 2 : -progress * 2)
      : 0;
  const panY =
    panVariant % 2 !== 0
      ? (panVariant === 1 ? progress * 2 : -progress * 2)
      : 0;

  return (
    <AbsoluteFill>
      <Img
        src={staticFile(src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${panX}%, ${panY}%)`,
          transformOrigin: '50% 50%',
        }}
      />
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Caption overlay for a single scene
// ─────────────────────────────────────────────────────────────────────────────
const SceneCaptions: React.FC<{
  captions: PhraseCue[];
  sceneStartFrame: number;
  brandId: string;
  locale: string;
}> = ({captions, sceneStartFrame, brandId, locale}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadLocaleFonts(brand, locale);
  const dir = isHebrew(locale) ? 'rtl' : 'ltr';
  const FADE_FRAMES = 4;

  const cues = phrasesToFrameCues(captions, sceneStartFrame, fps);

  // Find active cue
  const activeCue = cues.find((c) => frame >= c.fromFrame && frame < c.toFrame) ?? null;
  if (!activeCue) return null;

  const opacity = interpolate(
    frame,
    [
      activeCue.fromFrame,
      activeCue.fromFrame + FADE_FRAMES,
      activeCue.toFrame - FADE_FRAMES,
      activeCue.toFrame,
    ],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <div
      style={{
        position: 'absolute',
        // Center in the safe zone, about 60% down
        top: SAFE_TOP + Math.round((1920 - SAFE_TOP - SAFE_BOTTOM) * 0.58),
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
          background: `${brand.colors.bg}${alphaHex(0.82)}`,
          border: `1.5px solid ${brand.colors.brand}${alphaHex(0.4)}`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.body,
            fontWeight: 700,
            fontSize: 52,
            lineHeight: 1.25,
            color: brand.colors.ink,
            direction: dir,
            textAlign: 'center',
            unicodeBidi: 'plaintext',
          }}
        >
          {fixHebrewPrefixHyphen(activeCue.text)}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AI disclosure label
// ─────────────────────────────────────────────────────────────────────────────
const AiDisclosureLabel: React.FC<{
  brandId: string;
  locale: string;
}> = ({brandId, locale}) => {
  const brand = getBrand(brandId);
  const fonts = loadLocaleFonts(brand, locale);
  const dir = isHebrew(locale) ? 'rtl' : 'ltr';
  const text = isHebrew(locale) ? 'הוויזואליה נוצרה בבינה מלאכותית' : 'AI-generated visuals';

  return (
    <div
      style={{
        position: 'absolute',
        top: SAFE_TOP,
        ...(dir === 'rtl' ? {right: SAFE_LEFT} : {left: SAFE_LEFT}),
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 14px',
        borderRadius: 20,
        background: `${brand.colors.bg}${alphaHex(0.72)}`,
        border: `1px solid ${brand.colors.line}`,
        direction: dir,
      }}
    >
      {/* Dot indicator */}
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
          // No letter-spacing on Hebrew: it spaces out individual letters and
          // breaks the visual flow of connected script.
          letterSpacing: isHebrew(locale) ? 'normal' : '0.04em',
          color: brand.colors.ink3,
          unicodeBidi: 'plaintext',
        }}
      >
        {text}
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Output scene: branded card showing verbatim SmartCaptions transcript lines
// ─────────────────────────────────────────────────────────────────────────────
const OutputScene: React.FC<{
  lines: string[];
  brandId: string;
  locale: string;
  durationFrames: number;
}> = ({lines, brandId, locale, durationFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadLocaleFonts(brand, locale);
  const dir = isHebrew(locale) ? 'rtl' : 'ltr';
  const spring = brandSpring(frame, fps, brand.motion);
  const opacity = fade(frame, 0, 8, durationFrames - 8, durationFrames);
  const label = isHebrew(locale) ? 'פלט של SmartCaptions' : 'SmartCaptions output';

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.bg,
        opacity,
      }}
    >
      {/* Subtle surface card */}
      <AbsoluteFill
        style={{
          top: SAFE_TOP,
          bottom: SAFE_BOTTOM,
          left: SAFE_LEFT + 40,
          right: SAFE_RIGHT + 40,
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'stretch',
          gap: 0,
        }}
      >
        {/* Card */}
        <div
          style={{
            background: brand.colors.surface,
            border: `1.5px solid ${brand.colors.brand}${alphaHex(0.5)}`,
            borderRadius: 20,
            padding: '40px 44px',
            transform: `scale(${0.96 + spring * 0.04}) translateY(${(1 - spring) * 16}px)`,
            boxShadow: `0 24px 60px ${brand.colors.bg}`,
          }}
        >
          {/* Label row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              direction: dir,
              marginBottom: 28,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: brand.colors.brand,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 24,
                fontWeight: 600,
                // No letter-spacing when the label text is Hebrew.
                letterSpacing: isHebrew(locale) ? 'normal' : '0.06em',
                color: brand.colors.brand,
                unicodeBidi: 'plaintext',
              }}
            >
              {label}
            </span>
          </div>

          {/* Verbatim transcript lines — rendered exactly as given */}
          {lines.map((line, idx) => (
            <div
              key={idx}
              style={{
                fontFamily: fonts.body,
                fontWeight: 500,
                fontSize: 44,
                lineHeight: 1.5,
                color: brand.colors.ink,
                direction: dir,
                textAlign: dir === 'rtl' ? 'right' : 'left',
                unicodeBidi: 'plaintext',
                borderBottom:
                  idx < lines.length - 1
                    ? `1px solid ${brand.colors.line}`
                    : 'none',
                paddingBottom: idx < lines.length - 1 ? 16 : 0,
                marginBottom: idx < lines.length - 1 ? 16 : 0,
              }}
            >
              {fixHebrewPrefixHyphen(line)}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// End card
// ─────────────────────────────────────────────────────────────────────────────
const ReelEndCard: React.FC<{
  cta: string;
  brandId: string;
  locale: string;
  durationFrames: number;
}> = ({cta, brandId, locale, durationFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadLocaleFonts(brand, locale);
  const dir = isHebrew(locale) ? 'rtl' : 'ltr';
  const Mark = getHeroMark(brand.id);
  const spring = brandSpring(frame, fps, brand.motion);
  const opacity = fade(frame, 0, 12, durationFrames - 8, durationFrames);

  return (
    <AbsoluteFill
      style={{
        background: brand.colors.bg,
        opacity,
      }}
    >
      {/* Radial wash */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 40% at 50% 50%, ${brand.colors.brand}${alphaHex(0.18)}, transparent 70%)`,
        }}
      />
      {/* Content */}
      <AbsoluteFill
        style={{
          top: SAFE_TOP,
          bottom: SAFE_BOTTOM,
          left: SAFE_LEFT,
          right: SAFE_RIGHT,
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 32,
          direction: dir,
        }}
      >
        <div style={{transform: `scale(${0.9 + spring * 0.1})`}}>
          <Mark size={100} color={brand.colors.brand} />
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: 80,
            color: brand.colors.ink,
            textAlign: 'center',
            opacity: spring,
          }}
        >
          {brand.name}
        </div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: '0.18em',
            color: brand.colors.profit,
            textAlign: 'center',
            opacity: spring,
            unicodeBidi: 'plaintext',
          }}
        >
          {cta.toUpperCase()}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// StoryReel
// ─────────────────────────────────────────────────────────────────────────────
export const StoryReel: React.FC<StoryReelProps> = ({
  brandId,
  language,
  hook,
  cta,
  aiDisclosure,
  hookDurationMs,
  endCardDurationMs,
  scenes,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);

  // Compute per-scene start frames
  const hookFrames = Math.ceil((hookDurationMs / 1000) * fps);
  const endCardFrames = Math.ceil((endCardDurationMs / 1000) * fps);

  const sceneStartFrames: number[] = [];
  const sceneFrameCounts: number[] = [];
  let cursor = hookFrames;
  for (const scene of scenes) {
    sceneStartFrames.push(cursor);
    const frames = Math.ceil((scene.audioDurationMs / 1000) * fps);
    sceneFrameCounts.push(frames);
    cursor += frames;
  }
  const endCardStart = cursor;

  const fadeAmount = interpolate(frame, [0, 6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg, opacity: fadeAmount}}>
      {/* ── Background: dark brand gradient behind all scenes ── */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(80% 50% at 50% 30%, ${brand.colors.brand}${alphaHex(0.12)}, transparent 70%)`,
        }}
      />

      {/* ── Hook scene ── */}
      <Sequence durationInFrames={hookFrames + 8}>
        <HookScene
          hook={hook}
          brandId={brandId}
          locale={language}
          durationFrames={hookFrames}
        />
      </Sequence>

      {/* ── Content scenes ── */}
      {scenes.map((scene, i) => {
        const startFrame = sceneStartFrames[i];
        const durationFrames = sceneFrameCounts[i];
        const XFADE = 10; // cross-fade frames between scenes

        return (
          <Sequence key={i} from={startFrame - XFADE} durationInFrames={durationFrames + XFADE * 2}>
            {/* Scene opacity: fade in/out for smooth transition */}
            <AbsoluteFill
              style={{
                opacity: interpolate(
                  frame,
                  [startFrame - XFADE, startFrame, startFrame + durationFrames, startFrame + durationFrames + XFADE],
                  [0, 1, 1, 0],
                  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
                ),
              }}
            >
              {/* Media layer */}
              {scene.kind === 'image' && scene.media ? (
                <ImageScene
                  src={scene.media}
                  durationFrames={durationFrames}
                  panVariant={i % 4}
                />
              ) : scene.kind === 'video' && scene.media ? (
                <AbsoluteFill>
                  <OffthreadVideo
                    src={staticFile(scene.media)}
                    style={{width: '100%', height: '100%', objectFit: 'cover'}}
                  />
                </AbsoluteFill>
              ) : scene.kind === 'output' ? (
                <OutputScene
                  lines={scene.outputLines ?? []}
                  brandId={brandId}
                  locale={language}
                  durationFrames={durationFrames}
                />
              ) : (
                /* Fallback: plain brand bg */
                <AbsoluteFill style={{backgroundColor: brand.colors.bg}} />
              )}

              {/* Dark gradient at bottom to ensure caption readability */}
              <AbsoluteFill
                style={{
                  background:
                    'linear-gradient(0deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.3) 35%, transparent 60%)',
                }}
              />

              {/* Voice-over audio */}
              {scene.audioSrc ? (
                <Html5Audio src={staticFile(scene.audioSrc)} />
              ) : null}

              {/* Captions — useCurrentFrame() inside a Sequence returns LOCAL frames,
                  shifted by the Sequence's `from`. The Sequence starts at
                  (startFrame - XFADE), so local frame XFADE == the moment scene
                  media begins. Caption ms offsets are relative to that moment. */}
              <SceneCaptions
                captions={scene.captions}
                sceneStartFrame={XFADE}
                brandId={brandId}
                locale={language}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* ── End card ── */}
      <Sequence from={endCardStart}>
        <ReelEndCard
          cta={cta}
          brandId={brandId}
          locale={language}
          durationFrames={endCardFrames}
        />
      </Sequence>

      {/* ── AI disclosure label (persistent across all scenes, top corner) ── */}
      {aiDisclosure ? (
        <AbsoluteFill
          style={{
            opacity: interpolate(frame, [hookFrames - 6, hookFrames + 6], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <AiDisclosureLabel brandId={brandId} locale={language} />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
