/**
 * A minimal Visuals: what a finishing session's src/Visuals.tsx looks like. This folder is a small
 * work directory (props.json, words.json, src/): it type-checks the @work import in the studio and
 * is the fixture scripts/smoke.mjs renders through finish-render.mjs.
 */
import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame} from 'remotion';
import {Media, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, T, useFinish} from '@kit';

/** Media keys this video shows */
export const USES: string[] = [];

const Line: React.FC<{k: string; length: number}> = ({k, length}) => {
  const frame = useCurrentFrame();
  const {fonts, brand} = useFinish();
  const opacity = interpolate(frame, [0, 8, length - 8, length], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{top: SAFE_TOP, left: SAFE_LEFT, right: SAFE_RIGHT, alignItems: 'center', opacity}}>
      <T k={k} style={{fontFamily: fonts.display, fontSize: 88, color: brand.colors.ink, textAlign: 'center'}} />
    </AbsoluteFill>
  );
};

export const Visuals: React.FC = () => {
  const {shots, uses} = useFinish();
  return (
    <AbsoluteFill>
      {shots.map((shot) => (
        <Sequence key={shot.index} from={shot.from} durationInFrames={shot.durationInFrames}>
          {shot.plan.media && uses.includes(shot.plan.media) ? (
            <Media k={shot.plan.media} style={{position: 'absolute', top: 500, left: 90, width: 900, height: 900}} />
          ) : (
            <Line k={`line${shot.index + 1}`} length={shot.durationInFrames} />
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
