/**
 * Caption grouping from ElevenLabs word-level alignment.
 *
 * The `/v1/text-to-speech/{voice}/with-timestamps` endpoint returns character-level
 * timing. This module reconstructs words from that stream and groups them into
 * short readable phrases for on-screen caption display.
 *
 * All timing values are in milliseconds; frame conversion happens in the component.
 */

/**
 * ElevenLabs `with-timestamps` alignment response shape.
 * Verified 2026-09-22 against eleven_v3 and eleven_multilingual_v2:
 * the field names use singular "character_*" (not "characters_*").
 */
export type AlignmentData = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type PhraseCue = {
  /** Display text for this cue (may contain mixed Hebrew + Latin). */
  text: string;
  /** Start time in ms, relative to the start of the narration line. */
  fromMs: number;
  /** End time in ms, relative to the start of the narration line. */
  toMs: number;
};

type Word = {text: string; startMs: number; endMs: number};

/**
 * Reconstruct words with timing from character-level ElevenLabs alignment data.
 * Splits on spaces and punctuation boundaries.
 */
const extractWords = (alignment: AlignmentData): Word[] => {
  const {
    characters,
    character_start_times_seconds: startTimes,
    character_end_times_seconds: endTimes,
  } = alignment;
  const words: Word[] = [];
  let buf = '';
  let wordStart = -1;
  let wordEnd = -1;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      if (buf.trim()) {
        words.push({text: buf.trim(), startMs: Math.round(wordStart * 1000), endMs: Math.round(wordEnd * 1000)});
      }
      buf = '';
      wordStart = -1;
      wordEnd = -1;
    } else {
      if (wordStart < 0) wordStart = startTimes[i];
      buf += ch;
      wordEnd = endTimes[i];
    }
  }
  // Flush last word
  if (buf.trim()) {
    words.push({text: buf.trim(), startMs: Math.round(wordStart * 1000), endMs: Math.round(wordEnd * 1000)});
  }
  return words;
};

/**
 * Group words into short display phrases.
 *
 * @param alignment - character-level ElevenLabs alignment response
 * @param maxChars  - maximum characters per phrase line (default 32)
 * @returns array of phrase cues with ms-relative timing
 */
export const groupToPhrases = (alignment: AlignmentData, maxChars = 32): PhraseCue[] => {
  const words = extractWords(alignment);
  if (words.length === 0) return [];

  const phrases: PhraseCue[] = [];
  let group: Word[] = [];
  let groupLen = 0;

  const flush = () => {
    if (group.length === 0) return;
    phrases.push({
      text: group.map((w) => w.text).join(' '),
      fromMs: group[0].startMs,
      toMs: group[group.length - 1].endMs,
    });
    group = [];
    groupLen = 0;
  };

  for (const word of words) {
    const needed = groupLen === 0 ? word.text.length : groupLen + 1 + word.text.length;
    if (groupLen > 0 && needed > maxChars) {
      flush();
    }
    group.push(word);
    groupLen = groupLen === 0 ? word.text.length : groupLen + 1 + word.text.length;
  }
  flush();

  return phrases;
};

/**
 * Convert ms-relative phrase cues to absolute frame numbers given the scene's
 * start frame and the composition fps. Called inside the component, not the builder.
 */
export const phrasesToFrameCues = (
  phrases: PhraseCue[],
  sceneStartFrame: number,
  fps: number,
): {text: string; fromFrame: number; toFrame: number}[] =>
  phrases.map((p) => ({
    text: p.text,
    fromFrame: sceneStartFrame + Math.floor((p.fromMs / 1000) * fps),
    toFrame: sceneStartFrame + Math.ceil((p.toMs / 1000) * fps),
  }));
