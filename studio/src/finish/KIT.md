# Finish kit

A finishing work directory renders with the `Finish` composition (1080×1920, 30 fps). Finish
draws three layers itself, around your visuals:
- the voice-over, one line after another;
- word-timed captions in the band from y = 1540 down;
- the AI label at the top, whenever a media key you use is AI footage.

You write everything else.

## What you write

- `src/Visuals.tsx` exports:
  - `Visuals`: a component with no props;
  - `USES`: the media keys it shows, as a string array (empty when none).

  Other files under `src/` are fine; import them relatively.
- `words.json`: `{ "key": "text", … }`, every word the visuals show. Show them with
  `<T k="key" style={…}/>`, or `useWord("key")` when you need the string (for example to
  animate letter by letter). Text written straight into the JSX is refused at render, with the
  file and line.

Import from `remotion` and from `@kit`. Nothing else is installed.

## `@kit`

| Export | What it is |
|---|---|
| `useFinish()` | `{fps, totalFrames, shots, language, look, dir, brand, fonts, wordmarkSrc, attribution, media, uses}` |
| `shots[i]` | `{index, narration, from, durationInFrames, words: [{text, from, to}], plan}`. All frames are absolute. `plan` is the director's suggestion for the line: `kind`, `heading`, `highlight`, `lines`, `media`. |
| `media[key]` | `{src, kind: recording \| screenshot \| clip, ai, label, width, height, durationS, shows}` |
| `<T k style/>`, `useWord(k)` | A declared word, with the language's direction |
| `<Media k style fit startFrom playbackRate/>` | A staged recording, screenshot or clip, filling its box. A real recording keeps its label on screen. |
| `<Wordmark style/>` | The SmartCaptions wordmark image |
| `brand` | `brand.colors` (`bg`, `ink`, `ink2`, `ink3`, `brand`, `line`, …), `brand.motion`, `brand.name` |
| `fonts` | `display`, `body`, `label`, `mono` font families for the look and language |
| `brandSpring(frame, fps, brand.motion, {delayFrames})`, `entrance(...)`, `staggerDelay(...)` | Brand-tuned motion |
| `alphaHex(a)`, `isHebrew(lang)`, `fixHebrewPrefixHyphen(text)` | Helpers |
| `SAFE_TOP`, `SAFE_LEFT`, `SAFE_RIGHT`, `SAFE_W`, `CAPTION_TOP` | The layout the platforms leave visible. The platform buttons sit on the right edge and the captions below `CAPTION_TOP`. |
| `Background`, `Watermark`, `MediaCard`, `COLLAGE_PAPER`, `COLLAGE_DARK` | The template's studio and collage pieces, if you want them |

`staticFile(media[key].src)` is not needed; `<Media>` does it. For a still you animate yourself
(pan, zoom, parallax), wrap `<Media>` in your own transforms.

## Rendering

```
node <studio>/scripts/finish-render.mjs --work <this dir> --frames 0,45,300
node <studio>/scripts/finish-render.mjs --work <this dir> --frames every:30
node <studio>/scripts/finish-render.mjs --work <this dir> --final
```

- `--frames` writes PNG stills to `frames/` in a few seconds; look at them with Read.
- `--final` renders `out/video.mp4` in one to three minutes and writes `out/result.json`.

A render error prints the reason: a missing word key, a media key missing from `USES`, or text
written in the JSX.
