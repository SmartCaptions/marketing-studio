import React from 'react';
import {Html5Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import type {AudioManifest} from '../lib/audioMix';
import {duckedVolume, voWindows} from '../lib/audioMix';

export const SoundTrack: React.FC<{
  audio: AudioManifest;
  timing: Parameters<typeof voWindows>[1];
}> = ({audio, timing}) => {
  const {durationInFrames} = useVideoConfig();
  const windows = voWindows(audio.lines, timing);
  return (
    <>
      {audio.music ? (
        <Html5Audio
          src={staticFile(audio.music.src)}
          volume={(f) => duckedVolume(f, windows, durationInFrames)}
        />
      ) : null}
      {windows.map((w, i) => (
        <Sequence key={i} from={w.fromFrame}>
          <Html5Audio src={staticFile(w.src)} />
        </Sequence>
      ))}
    </>
  );
};
