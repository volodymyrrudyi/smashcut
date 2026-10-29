---
name: smashcut
description: Create, edit, check and render videos with smashcut, where a video is a TypeScript timeline (timeline.ts) rendered to MP4. Use when the user wants a video, animation, product demo, explainer, social clip or launch video made in code, when a folder has a timeline.ts that imports @smashcut/core, or when they mention smashcut.
---

# Making videos with smashcut

A smashcut video is a folder. `timeline.ts` default-exports `defineVideo({...})`: a tree of clips (text, images,
footage, React components, three.js, captions) with timing in seconds, plus an `audio` list of music and sound
effects. The CLI previews it in a browser and renders it frame by frame in headless Chromium, then encodes with
ffmpeg. The same timeline always renders the same file.

```
my-video/
  timeline.ts   # export default defineVideo({...})
  assets/       # images, fonts, footage, subtitles: referenced with asset("name.png")
  lib/          # React components and helpers
```

## The loop: write, check, look, fix, render

You can't watch the preview, so check your work with `inspect` and `sheet` after every change.

1. **Start.** If there's no video folder yet: `npx smashcut init my-video && cd my-video && npm install`.
   The first time on a machine also run `npx playwright install chromium-headless-shell`. Rendering MP4 or
   footage needs `ffmpeg` on PATH.
2. **Write** `timeline.ts` (and components in `lib/`). Start from the closest example (see the end of this file).
3. **Inspect** the structure and timing: `npx smashcut inspect .` prints every clip, caption and sound with its
   start and end (`--json` for machine-readable output). If `timeline.ts` doesn't load, this fails with the
   error. Check that scenes start where you meant, transitions overlap as intended, and sound effects land on
   their cues.
4. **Look** at it: `npx smashcut sheet .` writes `out/<name>-sheet.png`, 12 frames in one image, each labelled
   with its time and frame number. Open the PNG and actually look at it. For more detail: `--every 0.5`
   (a frame every half second), `--count 24`, or one full-size frame with `npx smashcut still . --frame 120`.
   Check text overflow and overlap, things off-screen, empty or black frames, and readability.
5. **Fix** and repeat 3–4 until the sheet looks right.
6. **Render**: `npx smashcut render .` writes `out/<name>.mp4` with the soundtrack. Options: `-o file.mp4`,
   `-c 4` (parallel browsers), `--fps 60`, `--scale 2` (a 1080p layout at 4K), `--from N --to N` (frame range).

Don't start `smashcut dev` yourself: it's a long-running server for the user to watch in a browser. When the user
has reviewed in `dev`, they may have left notes: read `.smashcut/notes.json`. Each note has `time`, `frame`,
`text` (what's wrong) and `context` (the clips, caption and sounds at that moment). Fix each one, then check those
frames with `still --frame`.

Inside the smashcut repo itself, run the CLI as `npm run smashcut -- <command> examples/<name>`.

## A timeline

```ts
import { asset, defineVideo, fade, groove, group, image, kf, music, react, series, sfx, solid, text } from "@smashcut/core";
import { Title } from "./lib/Title";

// Scene lengths and transitions as constants, so start times can be computed for sound cues.
const INTRO = 3;
const T = 0.6;

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  background: "#0f172a",
  layers: [
    series([
      group([solid("#0f172a"), react(Title, { title: "Launch day", subtitle: "v2 is out" })], { duration: INTRO }),
      fade(T),
      group(
        [
          image(asset("screenshot.png"), { width: 1200, y: -60, radius: 16, scale: kf([[0, 1], [4, 1.06]]) }),
          text("Ship faster", { position: "bottom", enter: "fade-up", style: { fontSize: 72, fontWeight: 800 } }),
        ],
        { duration: 4 },
      ),
    ]),
  ],
  audio: [
    music(groove({ seed: 1, key: "D major", intensity: 0.5 }), { fadeOut: 1.5, duck: 0.35 }),
    sfx.swoosh({ at: INTRO - T, length: 0.8 }),
  ],
});
```

## How timing and layout work

- **Seconds everywhere.** `at` is the start relative to the parent, `duration` the length. A clip without a
  `duration` fills its parent (or, for footage and captions, lasts as long as its source).
- **`layers`** stack bottom to top and all start at 0 unless given `at`.
- **`group([...])`** stacks children over the same time span. **`series([...])`** plays items one after another;
  each item needs a duration (on itself or from its children). A transition between two items (`fade(0.5)`)
  overlaps them by its length, so a series of 3 s + `fade(0.5)` + 3 s lasts 5.5 s, and the second clip starts at
  2.5 s.
- **Layout.** Each clip fills the frame. `position` anchors content (`center` by default, or `top`, `bottom-left`,
  …), `inset` is the margin from the edge in pixels (64 for text), and `x` / `y` are pixel offsets from there.
  Sizes are in video pixels (1920×1080 by default), not CSS viewport units.
- **Animation.** `x`, `y`, `scale`, `rotate`, `opacity` (and text content and colours) take a value or a function
  of time `(t) => value`. `t.local` is seconds since the clip started, `t.progress` is 0..1 over the clip, and
  `t.frame` / `t.time` are absolute. Helpers: `kf([[0, 0], [1, 100]], "easeOut")`,
  `interpolate(t.local, [0, 1], [0, 100])`, `spring(t, { delay, damping, stiffness, from, to })`.
- **Effects.** `enter` / `exit`: `fade`, `fade-up`, `fade-down`, `zoom`, `slide-left`, `slide-right`, `wipe`, or
  `{ type, duration, easing }`.
- **Transitions** between series items: `fade` (crossfade), `dip` (out to the background, then in: never two shots
  at once), `slide` and `wipe` (with `{ direction: "left" | "right" | "up" | "down" }`), `zoom`. All take
  `{ easing }`.

## API

All from `@smashcut/core` unless noted.

| Need | Use |
|---|---|
| Background colour | `solid(color)` |
| Text | `text(content, { style: { fontSize, fontWeight, color, fontFamily, maxWidth, textAlign, background, padding } })` |
| Image | `image(asset("a.png"), { fit, width, height, radius })` |
| Footage | `video(asset("clip.mp4"), { trim: [start, end], playbackRate, loop, volume, muted })` |
| React component | `react(Component, props, { duration })`; inside, `useClip()` from `@smashcut/runtime` gives the time |
| Browser / window / phone frame | `framed(node, { chrome: "browser" \| "window" \| "phone", url, title, theme, width, viewport: [w, h] })` |
| Picture-in-picture | `pip(node, { corner, size })` |
| Camera moves on a group | spread `camera([[t, { x, y, scale }], …])` or `zoomTo({ x, y, scale }, { at, duration, hold })` into its props |
| Typing | `const entry = typing("Hello", { at: 1, cps: 13, seed: 1, typos: [{ at: 3, wrong: "x", notice: 2 }] })`, then `text(entry.text)`; sound with `sfx.keys(entry, { at: clipStart, switch: "tactile" })` |
| Captions | `subtitles(srtOrVtt, { preset: "boxed" \| "clean" \| "bold" \| "highlight" })`; load a file with `import srt from "./assets/talk.srt?raw"` |
| Overlays | `decor.vignette()`, `decor.grain()`, `decor.border()`, `decor.watermark({ text \| src, corner })` as the last layers |
| 3D | `three(setup, opts)` from `@smashcut/three` (install `@smashcut/three three`); `setup` builds the scene once and returns `(t) => void` to pose each frame |
| Randomness | `rng(seed)` returns a seeded `() => number` |

**Audio** (`audio: [...]`): `music(groove({ seed, key, intensity, end }), { volume, fadeIn, fadeOut, duck })`.
Styles: `groove()` (upbeat, the default choice), `ambient()` (quiet bed), `modern()`, `chiptune()`. `intensity`
takes a constant or `[[seconds, 0..1], …]` so the music builds with the story; `end: seconds` ends on a held chord
(leave ~2.5 s after it). `duck: 0.35` dips the music under effects. Effects: `sfx.swoosh`, `whoosh`, `riser`,
`tick`, `tap`, `pop`, `click`, `pluck`, `strum`, `thud`, `bell`, `blip`, `chime`, each `({ at, volume })`. Cue
them from the same constants as the scenes.

## Rules that keep renders correct

Frames are rendered out of order and in parallel, so every frame must be a pure function of time.

- **Animate only from time**: `(t) => …` props, or `useClip()` in components. Never `setTimeout`,
  `setInterval`, `requestAnimationFrame`, CSS animations or transitions, or `Date.now()` for motion.
- **Randomness** from `rng(seed)`, created outside the component or memoised, not `Math.random()`.
- **Anything asynchronous** (fonts, fetched JSON, images drawn to a canvas) goes through
  `delayRender(promise)` from `@smashcut/runtime`; the frame waits for it.
- **Files** go in `assets/` and are referenced with `asset("name.ext")`. Don't import images or use absolute
  paths.
- **Fonts**: register an `@font-face` from `asset("fonts/x.woff2")` in a component and wait for
  `document.fonts.load(...)` with `delayRender`; otherwise system fonts are used.
- **Keep text inside the frame**: set `style.maxWidth` on long text and check the sheet.
- **Name scenes** with `id` (`group([...], { id: "pricing", duration: 4 })`) so `inspect` and the user's dev
  timeline show readable names.

## Examples to start from

Each folder in https://github.com/volodymyrrudyi/smashcut/tree/main/examples is a complete video. Copy the
closest one (some import shared helpers from `examples/hello/lib`; copy those too).

| Example | Shows |
|---|---|
| `hello` | The basics: text, images, React, series with transitions, music |
| `motion` | Every enter/exit effect and transition, easings, springs, seeded randomness |
| `frames` | Browser, window and phone frames, picture-in-picture, a screenshot with a call-out and zoom |
| `subtitles` | SRT and VTT captions in every preset |
| `typing` | Form filling with typos, keyboard sounds and a camera that follows |
| `footage` | A screen recording trimmed into scenes, sped up and looped |
| `decor` | Vignette, watermark, border, grain |
| `three` | three.js geometry, textures, an SVG logo extruded in 3D |
| `social` | A vertical 1080×1920 clip with scenes on the beat, word-highlight captions, data from JSON |
| `launch` | A full launch video combining most of the above |

## When something's wrong

- **"Cannot infer the video duration"**: give `defineVideo` a `duration`, or the top-level clips durations.
- **A frame times out**: a `delayRender` promise never settled (a font or fetch failed). Check paths under
  `assets/`.
- **A blank or black frame in the sheet**: the clip hasn't started yet, has faded out, or sits off-screen; compare
  with `inspect`.
- **Browser missing**: `npx playwright install chromium-headless-shell`. **ffmpeg missing**: install it (macOS:
  `brew install ffmpeg`).
- **`Cannot find @smashcut/...`**: run `npm install` in the video folder.
