/**
 * scripts/lib/finish-sound.mjs — the effects library in a finishing work directory: staging it
 * (finish-prepare.mjs) and reporting which declared cues will actually play (finish-render.mjs).
 */
import {copyFileSync, existsSync, mkdirSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

/** Copy the studio's effects library into a work directory; true when it is there to play */
export const stageSfxLibrary = (studioSfxDir, workSfxDir) => {
  if (!existsSync(join(studioSfxDir, 'intro.mp3'))) return false;
  mkdirSync(workSfxDir, {recursive: true});
  for (const f of readdirSync(studioSfxDir).filter((name) => name.endsWith('.mp3'))) {
    copyFileSync(join(studioSfxDir, f), join(workSfxDir, f));
  }
  return existsSync(join(workSfxDir, 'intro.mp3'));
};

/**
 * The cues that will play: those whose file is staged. A cue without its file is skipped
 * silently by Remotion, so the count reports what the video plays, not what was declared.
 */
export const audibleCues = (sfxPublicDir, inputProps) => {
  const declared = inputProps.sfxCues ?? [];
  const sfxCues = declared.filter((c) => existsSync(join(sfxPublicDir, `${c.kind}.mp3`)));
  const sfxAbsentReason = sfxCues.length === 0
    ? (declared.length > 0 || inputProps.sfxEnabled === false ? 'sfx library not staged' : 'no cues declared')
    : null;
  return {sfxCues, sfxAbsentReason};
};
