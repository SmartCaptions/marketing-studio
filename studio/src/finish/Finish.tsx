/**
 * Finish — a directed video whose visuals a finishing session wrote (@work/Visuals), inside the
 * layers the factory keeps fixed: the voice-over, word-timed captions and the AI label.
 */
import React from 'react';
import {AbsoluteFill, Html5Audio, Sequence, staticFile, type CalculateMetadataFunction} from 'remotion';
import {Visuals, USES} from '@work/Visuals';
import {getBrand} from '../lib/brand';
import {AiLabel, COLLAGE_PAPER, ShotCaptions} from '../templates/HybridPost';
import {FinishProvider, buildTimeline} from './kit';
import {FPS, type FinishProps} from './schema';

export const calculateFinishMetadata: CalculateMetadataFunction<FinishProps> = ({props}) => {
  const uses: unknown = USES;
  if (!Array.isArray(uses) || uses.some((k) => typeof k !== 'string')) {
    throw new Error('Visuals.tsx must export USES: a string array of the media keys it shows (empty when none)');
  }
  const unknownKeys = (uses as string[]).filter((k) => !props.media[k]);
  if (unknownKeys.length) throw new Error(`USES names media that is not staged: ${unknownKeys.join(', ')}`);
  const timeline = buildTimeline(props.shots);
  return {
    durationInFrames: timeline.totalFrames,
    fps: FPS,
    props: {...props, uses: uses as string[], aiDisclosure: (uses as string[]).some((k) => props.media[k].ai)},
  };
};

export const Finish: React.FC<FinishProps> = (props) => {
  const timeline = buildTimeline(props.shots);
  const brand = getBrand(props.brandId);
  return (
    <AbsoluteFill style={{backgroundColor: props.look === 'collage' ? COLLAGE_PAPER : brand.colors.bg}}>
      <FinishProvider props={props} timeline={timeline}>
        <Visuals />
      </FinishProvider>
      {props.shots.map((shot, i) => (
        <Sequence key={i} from={timeline.shots[i].from} durationInFrames={timeline.shots[i].durationInFrames}>
          {shot.audioSrc ? <Html5Audio src={staticFile(shot.audioSrc)} /> : null}
          <ShotCaptions
            captions={shot.captions}
            look={props.look}
            language={props.language}
            brandId={props.brandId}
            sceneStartFrame={0}
          />
        </Sequence>
      ))}
      {props.aiDisclosure && <AiLabel look={props.look} language={props.language} brandId={props.brandId} />}
    </AbsoluteFill>
  );
};
