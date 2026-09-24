import {loadFont as loadSaira} from '@remotion/google-fonts/Saira';
import {loadFont as loadHanken} from '@remotion/google-fonts/HankenGrotesk';
import {loadFont as loadGeistMono} from '@remotion/google-fonts/GeistMono';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadJetBrainsMono} from '@remotion/google-fonts/JetBrainsMono';
import {loadFont as loadLibreFranklin} from '@remotion/google-fonts/LibreFranklin';
import {loadFont as loadRubik} from '@remotion/google-fonts/Rubik';
import {loadFont as loadSecularOne} from '@remotion/google-fonts/SecularOne';
import {loadFont as loadSuezOne} from '@remotion/google-fonts/SuezOne';
import {loadFont as loadAmaticSC} from '@remotion/google-fonts/AmaticSC';
import type {Brand} from './brand';

// Load once at module scope; Remotion delays render until fonts resolve.
// Keyed by the family name a brand JSON may name in its `fonts` block.
const families: Record<string, string> = {
  Saira: loadSaira('normal', {weights: ['600', '800']}).fontFamily,
  'Hanken Grotesk': loadHanken('normal', {weights: ['400', '600']}).fontFamily,
  'Geist Mono': loadGeistMono('normal', {weights: ['400', '500']}).fontFamily,
  // subsets pinned: Inter otherwise fans out to 28 font requests per render
  Inter: loadInter('normal', {weights: ['400', '600', '700', '800'], subsets: ['latin']})
    .fontFamily,
  'JetBrains Mono': loadJetBrainsMono('normal', {weights: ['400', '500'], subsets: ['latin']})
    .fontFamily,
  'Libre Franklin': loadLibreFranklin('normal', {
    weights: ['400', '600', '800'],
    subsets: ['latin'],
  }).fontFamily,
  // R-1: Rubik with hebrew+latin subsets for RTL/Hebrew renders.
  // Weights match Inter usage (400/600/700/800). If the Google Fonts CDN is
  // unreachable at render time the browser's font-stack falls back to system
  // sans-serif; no woff2 staticFile fallback is needed for server-side renders
  // since @remotion/google-fonts resolves fonts before the renderer paints.
  Rubik: loadRubik('normal', {weights: ['400', '600', '700', '800'], subsets: ['hebrew', 'latin']})
    .fontFamily,
  // HybridPost display faces
  // Secular One: bold Hebrew-safe display face for the Studio look.
  // hebrew+latin subsets; only weight 400 (the typeface has no variable axis).
  'Secular One': loadSecularOne('normal', {weights: ['400'], subsets: ['hebrew', 'latin']})
    .fontFamily,
  // Suez One: editorial serif display for the Collage look.
  // hebrew+latin subsets; only weight 400.
  'Suez One': loadSuezOne('normal', {weights: ['400'], subsets: ['hebrew', 'latin']}).fontFamily,
  // Amatic SC: handwritten label-tape style for Collage captions and labels.
  // Bold only; latin subset (caption text is always short ASCII or single-lang).
  'Amatic SC': loadAmaticSC('normal', {weights: ['400', '700'], subsets: ['latin', 'hebrew']})
    .fontFamily,
};

const resolve = (name: string): string => {
  const family = families[name];
  if (!family) {
    throw new Error(
      `No font loader registered for "${name}". Available: ${Object.keys(families).join(', ')}`,
    );
  }
  return family;
};

export const loadBrandFonts = (brand: Brand) => ({
  display: resolve(brand.fonts.display),
  body: resolve(brand.fonts.body),
  mono: resolve(brand.fonts.mono),
});

/**
 * Resolve fonts for a locale-aware render. When `locale` is a Hebrew locale
 * ('he' or any 'he-*' tag), display and body swap to Rubik (which ships
 * hebrew+latin subsets) while mono stays on the brand's configured mono face.
 * All other locales fall through to `loadBrandFonts` unchanged so existing
 * English renders stay byte-identical.
 */
export const loadLocaleFonts = (brand: Brand, locale?: string | null) => {
  const isHebrew = typeof locale === 'string' && /^he\b/.test(locale);
  if (!isHebrew) return loadBrandFonts(brand);
  return {
    display: resolve('Rubik'),
    body: resolve('Rubik'),
    mono: resolve(brand.fonts.mono),
  };
};

/**
 * HybridPost font sets.
 *
 * Studio look: Secular One for display headings (bold, Hebrew-safe), Rubik for body and captions,
 * Geist Mono for labels and meta text.
 *
 * Collage look: Suez One for display headings (editorial serif), Rubik for body,
 * Amatic SC for handwritten label-tape captions and sticky-note labels.
 */
export const loadHybridPostFonts = (look: 'studio' | 'collage') => {
  if (look === 'collage') {
    return {
      display: resolve('Suez One'),
      body: resolve('Rubik'),
      label: resolve('Amatic SC'),
      mono: resolve('Geist Mono'),
    };
  }
  return {
    display: resolve('Secular One'),
    body: resolve('Rubik'),
    label: resolve('Geist Mono'),
    mono: resolve('Geist Mono'),
  };
};
