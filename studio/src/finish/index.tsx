/**
 * Bundle entry for Finish renders (scripts/finish-render.mjs). Kept apart from the studio's own
 * Root so a work directory's code is only ever bundled on its own.
 */
import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {Finish, calculateFinishMetadata} from './Finish';
import {finishPropsSchema, FPS, type FinishProps} from './schema';

const FinishRoot: React.FC = () => (
  <Composition
    id="Finish"
    component={Finish}
    schema={finishPropsSchema}
    calculateMetadata={calculateFinishMetadata}
    durationInFrames={1}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={{} as FinishProps}
  />
);

registerRoot(FinishRoot);
