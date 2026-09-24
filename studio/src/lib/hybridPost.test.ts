/**
 * Tests for HybridPost layout helpers and timing constants.
 * These tests cover pure, side-effect-free helpers that don't require
 * a Remotion rendering context.
 */
import {describe, expect, it} from 'vitest';
import {fixHebrewPrefixHyphen} from './bidi';
import {phrasesToFrameCues} from './wordCaptions';

// ─────────────────────────────────────────────────────────────────────────────
// fixHebrewPrefixHyphen
// ─────────────────────────────────────────────────────────────────────────────
describe('fixHebrewPrefixHyphen (HybridPost captions)', () => {
  it('replaces ASCII hyphen after Hebrew char', () => {
    const result = fixHebrewPrefixHyphen('ב-SmartCaptions');
    // The ASCII hyphen should be replaced by U+2011 (non-breaking hyphen)
    expect(result).toContain('‑');
    expect(result).not.toMatch(/ב-/); // original ASCII hyphen after ב gone
  });

  it('leaves plain English hyphen untouched', () => {
    const result = fixHebrewPrefixHyphen('well-known');
    expect(result).toBe('well-known');
  });

  it('empty string returns empty', () => {
    expect(fixHebrewPrefixHyphen('')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phrasesToFrameCues (caption frame timing)
// ─────────────────────────────────────────────────────────────────────────────
describe('phrasesToFrameCues (HybridPost shot timing)', () => {
  const phrases = [
    {text: 'הלקוח שלח', fromMs: 0, toMs: 800},
    {text: 'ראיון באנגלית', fromMs: 900, toMs: 1800},
  ];

  it('converts ms to frames at 30 fps with sceneStartFrame offset', () => {
    const cues = phrasesToFrameCues(phrases, 10, 30);
    // First cue: fromMs=0 → frame 10 + 0 = 10; toMs=800 → 10 + ceil(0.8*30)=34
    expect(cues[0].fromFrame).toBe(10);
    expect(cues[0].toFrame).toBe(10 + Math.ceil(0.8 * 30));
    expect(cues[0].text).toBe('הלקוח שלח');
  });

  it('second cue starts after the first', () => {
    const cues = phrasesToFrameCues(phrases, 0, 30);
    expect(cues[1].fromFrame).toBeGreaterThan(cues[0].fromFrame);
  });

  it('fromFrame < toFrame for all cues', () => {
    const cues = phrasesToFrameCues(phrases, 0, 30);
    for (const c of cues) {
      expect(c.fromFrame).toBeLessThan(c.toFrame);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shot duration arithmetic
// ─────────────────────────────────────────────────────────────────────────────
describe('shot duration arithmetic (HybridPost)', () => {
  const GAP_MS = 250;
  const END_HOLD_MS = 2000;
  const FPS = 30;

  it('normal shot: frames = ceil((narrationMs + gap) / 1000 * 30)', () => {
    const narrationMs = 3200;
    const durationMs = narrationMs + GAP_MS;
    const frames = Math.ceil((durationMs / 1000) * FPS);
    expect(frames).toBe(Math.ceil(3450 / 1000 * 30)); // ceil(3.45*30) = ceil(103.5) = 104
    expect(frames).toBe(104);
  });

  it('end shot: adds extra hold', () => {
    const narrationMs = 2800;
    const durationMs = narrationMs + GAP_MS + END_HOLD_MS;
    const frames = Math.ceil((durationMs / 1000) * FPS);
    expect(frames).toBe(Math.ceil(5050 / 1000 * 30)); // ceil(151.5) = 152
    expect(frames).toBe(152);
  });

  it('total video frames = sum of shot frames', () => {
    const shots = [
      {audioDurationMs: 3450},
      {audioDurationMs: 4000},
      {audioDurationMs: 5050},
    ];
    const total = shots.reduce((s, x) => s + Math.ceil((x.audioDurationMs / 1000) * FPS), 0);
    expect(total).toBe(
      Math.ceil(3.45 * 30) + Math.ceil(4 * 30) + Math.ceil(5.05 * 30),
    );
  });
});
