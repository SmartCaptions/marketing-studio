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
node <studio>/scripts/finish-render.mjs --work <this dir> --media
```

- `--frames` writes PNG stills to `frames/` in a few seconds; look at them with Read.
- `--final` renders `out/video.mp4` in one to three minutes and writes `out/result.json`.
- `--media` writes one still of every staged recording, screenshot and clip to `media-frames/`,
  so you can see your footage before choosing.

A render error prints the reason: a missing word key, a media key missing from `USES`, or text
written in the JSX.

## Sound

The Finish composition renders a music bed and optional sound effects around your visuals
automatically. You do not need to add audio yourself.

**Music.** A generated music track is included in `props.json` when preparation succeeded. It
plays from start to finish, ducked under each voice-over line. When music is absent (key missing
or generation failed), the video renders voice-only; `props.json` has a `musicAbsentReason` field
saying why.

**Sound effects.** You may place up to one cue per scene boundary and one at the ending by
writing `cues.json` in your work directory:

```json
[
  {"kind": "intro",   "frame": 0},
  {"kind": "swipe",   "frame": 45},
  {"kind": "swipe",   "frame": 135},
  {"kind": "riser",   "frame": 255},
  {"kind": "closing", "frame": 299}
]
```

Valid kinds: `intro` (punchy hit at the opening), `swipe` (light cut between lines), `riser`
(rising build before the last line), `closing` (soft ending chime). Frames are absolute (same
timeline as `shots[i].from`). The riser should start 60 frames before the last line starts so it ENDS exactly at the
last shot's start (the file is 2 s = 60 frames at 30 fps) —
`shots[shots.length - 1].from - 60`. The renderer validates each cue and skips invalid ones
with a warning. All cues are reported in `result.json` under `sfx_cues`.

If you omit `cues.json`, the video renders with no sfx (music only).

## New clips

When `idea.json` says `new_clips_allowed: true` and a line needs footage none of the media
shows, you can ask tonight's run for up to 3 new AI clips instead of rendering today:
1. Write `clip-requests.json`: `[{"line": <voice-over line, from 1>, "still_prompt": "…",
   "motion_prompt": "…"}]`.
2. End without `--final`.

The next morning a new session continues in this directory, with the clips as media `new1`,
`new2`, … (about 5 s, 9:16). Using one turns on the video's AI label.

- The prompts describe a scene only: no words, letters, numbers, logos, screens or software
  interface. The factory refuses those.
- Ask only when the video would clearly be worse without the clip; a request delays the post by
  a day.

