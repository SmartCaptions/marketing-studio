import {describe, expect, it} from 'vitest';
import {groupToPhrases, phrasesToFrameCues} from './wordCaptions';

const makeAlignment = (text: string, start = 0, durationSec = 3) => {
  const chars = text.split('');
  const step = durationSec / chars.length;
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => start + i * step),
    character_end_times_seconds: chars.map((_, i) => start + (i + 1) * step),
  };
};

describe('groupToPhrases', () => {
  it('empty alignment returns empty array', () => {
    expect(groupToPhrases({characters: [], character_start_times_seconds: [], character_end_times_seconds: []})).toEqual([]);
  });

  it('short sentence stays as one phrase', () => {
    const a = makeAlignment('Open the panel');
    const phrases = groupToPhrases(a, 32);
    expect(phrases).toHaveLength(1);
    expect(phrases[0].text).toBe('Open the panel');
  });

  it('long sentence splits at word boundary within maxChars', () => {
    // 32 chars max: "Open the panel and transcribe" = 29 chars (ok), adding " your" would be 34
    const a = makeAlignment('Open the panel and transcribe your sequence now');
    const phrases = groupToPhrases(a, 32);
    expect(phrases.length).toBeGreaterThan(1);
    for (const p of phrases) {
      expect(p.text.length).toBeLessThanOrEqual(32);
    }
  });

  it('sentence-ending period causes a break at that word', () => {
    // "Hello world. Next sentence." should split at the first period.
    const a = makeAlignment('Hello world. Next sentence.');
    const phrases = groupToPhrases(a, 64); // large maxChars so length is not the trigger
    // Must have at least 2 phrases due to the period
    expect(phrases.length).toBeGreaterThanOrEqual(2);
    // First phrase ends with "."
    expect(phrases[0].text).toMatch(/\.$/);
    // "Hello world." must be the first cue (not combined with "Next")
    expect(phrases[0].text).toBe('Hello world.');
  });

  it('sentence-ending question mark causes a break', () => {
    const a = makeAlignment('מה עושים? ממשיכים כמובן.');
    const phrases = groupToPhrases(a, 64);
    expect(phrases.length).toBeGreaterThanOrEqual(2);
    expect(phrases[0].text).toBe('מה עושים?');
  });

  it('comma break fires only when group is long enough', () => {
    // Short text before comma: "Hi, there" → should stay in one cue (Hi < 16 chars).
    const a = makeAlignment('Hi, there friends today');
    const phrases = groupToPhrases(a, 64);
    // "Hi," is only 3 chars, below COMMA_MIN_LEN, so no comma-break here
    expect(phrases[0].text).toContain('Hi,');
  });

  it('cross-sentence cue bug: period in middle does not bleed into next cue', () => {
    // Reproduces the real bug: "הלקוח רוצה תמלול בעברית. בתוך Premiere Pro."
    const text = 'הלקוח רוצה תמלול בעברית. בתוך Premiere Pro.';
    const a = makeAlignment(text, 0, 4);
    const phrases = groupToPhrases(a, 32);
    // No cue should cross the period boundary
    for (const p of phrases) {
      // A cue cannot start with "בתוך" while also containing "בעברית."
      const hasFirstSentenceEnd = p.text.includes('בעברית.');
      const hasNextSentenceStart = p.text.includes('בתוך');
      expect(hasFirstSentenceEnd && hasNextSentenceStart).toBe(false);
    }
    // "Premiere Pro." should appear together in one cue
    const allText = phrases.map((p) => p.text).join(' ');
    expect(allText).toContain('Premiere Pro.');
    const premiereCue = phrases.find((p) => p.text.includes('Premiere'));
    expect(premiereCue?.text).toContain('Pro.');
  });

  it('timing is preserved: fromMs < toMs', () => {
    const a = makeAlignment('Hello world', 0.5, 2);
    const phrases = groupToPhrases(a);
    for (const p of phrases) {
      expect(p.fromMs).toBeLessThan(p.toMs);
    }
  });

  it('Hebrew text groups correctly', () => {
    // Hebrew short phrase: "עורך ב-Premiere Pro"
    const text = 'עורך ב-Premiere Pro';
    const a = makeAlignment(text, 0, 2);
    const phrases = groupToPhrases(a, 32);
    // Should be one phrase (19 chars < 32)
    expect(phrases).toHaveLength(1);
    expect(phrases[0].text).toContain('Premiere Pro');
  });

  it('single long word stays as one phrase', () => {
    const a = makeAlignment('supercalifragilisticexpialidocious');
    const phrases = groupToPhrases(a, 10);
    expect(phrases).toHaveLength(1);
    expect(phrases[0].text).toBe('supercalifragilisticexpialidocious');
  });

  it('consecutive spaces produce no empty words', () => {
    // 'word1  word2' — double space → both words still extracted, joined in one phrase
    const a = makeAlignment('word1  word2');
    const phrases = groupToPhrases(a);
    // No empty-text phrases
    for (const p of phrases) {
      expect(p.text.trim().length).toBeGreaterThan(0);
    }
    // Both words appear in the output
    const allText = phrases.map((p) => p.text).join(' ');
    expect(allText).toContain('word1');
    expect(allText).toContain('word2');
  });
});

describe('phrasesToFrameCues', () => {
  it('converts ms timing to frames at scene offset', () => {
    const phrases = [{text: 'hello', fromMs: 500, toMs: 1000}];
    const cues = phrasesToFrameCues(phrases, 30, 30);
    expect(cues[0].fromFrame).toBe(30 + 15); // 30 + 500ms*30fps/1000
    expect(cues[0].toFrame).toBe(30 + 30);   // 30 + 1000ms*30fps/1000
  });

  it('sceneStartFrame offsets all cues', () => {
    const phrases = [
      {text: 'a', fromMs: 0, toMs: 500},
      {text: 'b', fromMs: 500, toMs: 1000},
    ];
    const cues = phrasesToFrameCues(phrases, 90, 30);
    expect(cues[0].fromFrame).toBe(90);
    expect(cues[1].fromFrame).toBe(90 + 15);
  });
});
