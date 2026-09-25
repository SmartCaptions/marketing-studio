/**
 * The brand kit a finishing session builds a video's visuals from (imported as "@kit").
 * Voice-over, captions and the AI label are drawn by the Finish composition around the visuals;
 * the visuals draw everything else. Every word they show comes from the declared words through
 * <T>, and every piece of footage through <Media>, so what the video shows can be checked.
 */
import React, {createContext, useContext} from 'react';
import {Img, OffthreadVideo, staticFile} from 'remotion';
import {fixHebrewPrefixHyphen} from '../lib/bidi';
import {getBrand} from '../lib/brand';
import {loadHybridPostFonts} from '../lib/fonts';
import {isHebrew} from '../lib/locale';
import {FPS, shotFrames, type FinishMedia, type FinishProps} from './schema';

export {alphaHex, getBrand} from '../lib/brand';
export {loadHybridPostFonts} from '../lib/fonts';
export {isHebrew, localeDir} from '../lib/locale';
export {brandSpring, entrance, staggerDelay} from '../lib/motion';
export {fixHebrewPrefixHyphen} from '../lib/bidi';
export {
  Background,
  COLLAGE_DARK,
  COLLAGE_PAPER,
  CONTENT_BOTTOM,
  MediaCard,
  SAFE_BOTTOM,
  SAFE_LEFT,
  SAFE_RIGHT,
  SAFE_TOP,
  SAFE_W,
  Watermark,
} from '../templates/HybridPost';
export type {FinishMedia, FinishProps} from './schema';

/** Captions sit from here to the bottom; keep this band clear */
export const CAPTION_TOP = 1540;

export interface TimedWord {
  text: string;
  /** Absolute frames in the whole video */
  from: number;
  to: number;
}

export interface TimedShot {
  index: number;
  narration: string;
  /** Absolute first frame and length of this voice-over line */
  from: number;
  durationInFrames: number;
  words: TimedWord[];
  plan: FinishProps['shots'][number]['plan'];
}

export interface Timeline {
  fps: number;
  totalFrames: number;
  shots: TimedShot[];
}

export const buildTimeline = (shots: FinishProps['shots']): Timeline => {
  let cursor = 0;
  const timed = shots.map((shot, index) => {
    const from = cursor;
    const durationInFrames = shotFrames(shot);
    cursor += durationInFrames;
    return {
      index,
      narration: shot.narration,
      from,
      durationInFrames,
      plan: shot.plan,
      words: shot.words.map((w) => ({
        text: w.text,
        from: from + Math.floor((w.startMs / 1000) * FPS),
        to: from + Math.max(Math.floor((w.startMs / 1000) * FPS) + 1, Math.ceil((w.endMs / 1000) * FPS)),
      })),
    };
  });
  return {fps: FPS, totalFrames: cursor, shots: timed};
};

const FinishContext = createContext<{props: FinishProps; timeline: Timeline} | null>(null);

export const FinishProvider: React.FC<{props: FinishProps; timeline: Timeline; children: React.ReactNode}> = ({
  props,
  timeline,
  children,
}) => <FinishContext.Provider value={{props, timeline}}>{children}</FinishContext.Provider>;

/** The video's props and timeline: language, look, brand, voice-over lines with word frames */
export const useFinish = () => {
  const value = useContext(FinishContext);
  if (!value) throw new Error('useFinish is only available inside the Finish composition');
  const {props, timeline} = value;
  return {
    ...timeline,
    language: props.language,
    look: props.look,
    dir: isHebrew(props.language) ? ('rtl' as const) : ('ltr' as const),
    brand: getBrand(props.brandId),
    fonts: loadHybridPostFonts(props.look, props.language),
    wordmarkSrc: props.wordmarkSrc,
    attribution: props.attribution,
    media: props.media,
    uses: props.uses,
  };
};

/** A declared word (words.json), ready to show; throws on a key words.json lacks */
export const useWord = (k: string): string => {
  const value = useContext(FinishContext);
  if (!value) throw new Error('useWord is only available inside the Finish composition');
  const text = value.props.words[k];
  if (text === undefined) throw new Error(`words.json has no "${k}"; declare every shown word there`);
  return fixHebrewPrefixHyphen(text);
};

/** Shows a declared word with the language's direction; style it freely */
export const T: React.FC<{k: string; style?: React.CSSProperties; className?: string}> = ({k, style, className}) => {
  const text = useWord(k);
  const {language} = useFinish();
  return (
    <span
      className={className}
      style={{
        direction: isHebrew(language) ? 'rtl' : 'ltr',
        unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
        ...style,
      }}
    >
      {text}
    </span>
  );
};

const useMediaFor = (k: string): FinishMedia => {
  const value = useContext(FinishContext);
  if (!value) throw new Error('Media is only available inside the Finish composition');
  const media = value.props.media[k];
  if (!media) throw new Error(`there is no media "${k}"; use a key from props.media`);
  if (!value.props.uses.includes(k)) throw new Error(`media "${k}" is not in USES; list every media key the visuals show`);
  return media;
};

/**
 * Shows one staged recording, screenshot or clip, filling the box its style gives it.
 * A real recording keeps its label on screen; AI footage turns on the video's AI label.
 */
export const Media: React.FC<{
  k: string;
  style?: React.CSSProperties;
  fit?: 'cover' | 'contain';
  /** Seconds into the footage to start from */
  startFrom?: number;
  playbackRate?: number;
}> = ({k, style, fit = 'cover', startFrom = 0, playbackRate = 1}) => {
  const media = useMediaFor(k);
  const {fonts, language} = useFinish();
  const fill: React.CSSProperties = {width: '100%', height: '100%', objectFit: fit, display: 'block'};
  return (
    <div style={{position: 'relative', overflow: 'hidden', ...style}}>
      {media.kind === 'screenshot' ? (
        <Img src={staticFile(media.src)} style={fill} />
      ) : (
        <OffthreadVideo
          src={staticFile(media.src)}
          style={fill}
          muted
          startFrom={Math.round(startFrom * FPS)}
          playbackRate={playbackRate}
        />
      )}
      {media.label && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            insetInlineStart: 12,
            padding: '4px 12px',
            borderRadius: 8,
            background: 'rgba(2,6,23,0.72)',
            color: '#e2e8f0',
            fontFamily: fonts.mono,
            fontSize: 22,
            direction: isHebrew(language) ? 'rtl' : 'ltr',
            unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'],
          }}
        >
          {media.label}
        </div>
      )}
    </div>
  );
};

/** The brand wordmark image, when the video has one */
export const Wordmark: React.FC<{style?: React.CSSProperties}> = ({style}) => {
  const {wordmarkSrc} = useFinish();
  if (!wordmarkSrc) return null;
  return <Img src={staticFile(wordmarkSrc)} style={{width: 560, height: 'auto', objectFit: 'contain', ...style}} />;
};
