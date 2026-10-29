# smashcut

Videos defined in TypeScript ([getsmashcut.dev](https://getsmashcut.dev)). Each video is a folder:

```
my-video/
  timeline.ts   # export default defineVideo({...})
  assets/       # images, fonts, ... referenced with asset("name.png")
  lib/          # optional .ts / .tsx modules (React components, helpers)
```

## Quick start

Requires Node 24+ and `ffmpeg` on PATH.

```sh
npx smashcut init my-video
cd my-video && npm install
npx playwright install chromium-headless-shell   # once per machine
npm run dev       # live preview + timeline (space, ←/→, shift+←/→, N = note)
npm run still     # → out/my-video-0.png (add -- --frame 120 for another frame)
npm run render    # → out/my-video.mp4
npx smashcut sheet .     # → out/my-video-sheet.png: 12 frames in one image, labelled with their times
npx smashcut inspect .   # every clip, caption and sound with its start and end (--json for scripts)
```

`npm run dev` and friends call the `smashcut` command, so `npx smashcut render . --fps 60 --scale 2` and the rest of
the options below work too. three.js scenes need `npm install @smashcut/three three`.

## Using it with coding agents

smashcut is built to be driven by a coding agent (Claude Code, Codex, Cursor, …): the video is code, and the CLI
lets the agent check its own work without watching a preview.

- **The skill.** `smashcut init` writes `.claude/skills/smashcut/SKILL.md` into every video folder: the working
  loop, the API, the rules that keep renders deterministic, and which example to start from. It also writes a short
  `AGENTS.md` (read by Codex, Cursor and others) and a `CLAUDE.md` that points to it. The skill ships inside the
  `smashcut` npm package, so it always matches the installed version.
- **Without a project**, install it as a Claude Code plugin: `/plugin install smashcut --marketplace volodymyrrudyi/smashcut`.
- **Seeing the video.** `smashcut sheet <dir>` renders a contact sheet (`--count 12` by default, or
  `--every 0.5` seconds), each frame labelled with its time and frame number, so an agent sees the whole video in
  one image. `smashcut still <dir> --frame N` gives one frame at full size.
- **Checking the timeline.** `smashcut inspect <dir>` prints every clip, caption and sound with its start and
  end, the same names the dev timeline shows (`--json` for scripts). It fails with the load error when
  `timeline.ts` is broken.
- **Review notes.** Notes left in `smashcut dev` (press N) are saved to `.smashcut/notes.json` with what was on
  screen and audible at that moment, so you can tell an agent to "fix the notes".

## Working on smashcut itself

```sh
npm install
npm run smashcut -- dev examples/hello                  # live preview + timeline
npm run smashcut -- still examples/hello --frame 120    # → examples/hello/out/hello-120.png
npm run smashcut -- sheet examples/hello                # → examples/hello/out/hello-sheet.png
npm run smashcut -- inspect examples/hello              # the resolved timeline as text
npm run smashcut -- render examples/hello -c 4          # → examples/hello/out/hello.mp4
npm run smashcut -- render examples/hello --fps 120     # same timing, more frames → hello-120fps.mp4
npm run smashcut -- render examples/hello --scale 2     # 1080p layout rendered at 3840×2160 (4K)
npm test && npm run typecheck
```

Publishing to npm is described in `docs/publishing.md`.

### Reviewing in the dev preview

`smashcut dev` shows a timeline under the player:
- **Rows:** the mixed soundtrack's waveform, every visual clip as a bar in a collapsible tree (layers, series
  scenes, groups, frames), subtitle cues with their text, and a row per kind of sound (music, keys, tick, …,
  from the clip's `label`; `sfx.*` and `music()` set it).
- **Navigation:** click or drag anywhere to seek, ⌘/Ctrl-scroll or −/+/Fit to zoom. Click a bar for its details
  (times in seconds and frames, transitions, text, source, props, volume, …).
- **Names:** give a clip an `id` to name it in the timeline; unnamed groups list what they contain.

To point at something you don't like, press **N** at that moment, type the note and press Enter. Notes appear as
markers and are saved to `.smashcut/notes.json` in the video folder. Each note has its time, frame, and what was on
screen and audible at that instant (clip paths, the caption, the sounds playing), so it can be acted on without
reopening the preview.

### Videos outside this repo

A video folder can live anywhere. Made with an installed `smashcut init`, it's a small npm package that depends on
smashcut. Made from this repo, it needs no `node_modules`: `@smashcut/*` and React resolve from the repo, and
`tsconfig.json` points editors at its sources. To use the repo's CLI everywhere, add a shell alias:

```sh
alias smashcut="node /path/to/smashcut/packages/cli/bin/smashcut.js"
smashcut init ~/videos/launch     # timeline.ts, lib/Title.tsx, assets/, .gitignore, tsconfig.json
smashcut dev ~/videos/launch
```

`smashcut init` refuses to write into a folder that isn't empty.

## Authoring

```ts
import { defineVideo, series, group, solid, image, video, text, react, fade, slide, asset, kf } from "@smashcut/core";

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  layers: [
    series([                                   // clips back to back
      image(asset("hero.png"), { duration: 3, scale: kf([[0, 1], [3, 1.1]]) }),
      fade(0.5),                               // overlaps neighbours by 0.5s
      video(asset("demo.mp4"), { trim: [2, 6] }),  // 4s of footage, with its audio
      fade(0.5),
      react(MyComponent, { title: "Hi" }, { duration: 4 }),
    ]),
    text("overlay", { at: 1, duration: 2, position: "bottom", enter: "fade-up", exit: "fade" }),
  ],
});
```

- **Nodes:** `solid`, `image`, `video`, `text`, `react`, `group` (stacked layers), `series` (sequential with
  transitions), `framed` / `pip` (window chrome), `subtitles`, `decor.*` (overlays), `three` (from `@smashcut/three`).
- **Timing:** `at` / `duration` in seconds. A node without a duration fills its parent. Series items need one.
- **Animation:** any of `x`, `y`, `scale`, `rotate`, `opacity` (and `text`, `color`) accept a value or `(t) => value`.
  Helpers: `kf(points, easing)`, `interpolate(...)`, `spring(t, opts)`.
- **Effects:** `enter` / `exit`: `fade`, `fade-up`, `fade-down`, `zoom`, `slide-left`, `slide-right`, `wipe`.
- **Transitions:** `fade` (crossfade), `dip` (out to the background, then in: never two shots at once), `slide`,
  `wipe`, `zoom` with `{ direction, easing }`.
- **Footage:** `video(asset("clip.mp4"), opts)` takes `trim: [start, end?]`, `playbackRate`, `loop`, `volume`, `muted`,
  plus the same `fit` / `width` / `height` / `radius` as `image`. Without a `duration` it lasts as long as the trimmed
  source. Past the end it holds the last frame (or wraps with `loop`). Its audio is mixed in at the clip's position
  and crossfades over series transitions. `radius` also takes a CSS string (`"0 0 16px 16px"`).
  `examples/footage` is a tour of a small made-up task board (`examples/footage/site/index.html`) cut from a screen
  recording that `examples/footage/capture.ts` makes with Playwright on virtual time
  (`npx tsx examples/footage/capture.ts`). It trims, plays one slice at 2× and loops another.
- **Frames:** `framed(node | nodes, { chrome, width, height, viewport, url, title, theme, radius, shadow, border })`
  draws `browser` (default), `window`, `phone` or `none` chrome around its children, in `light` or `dark`. `width` ≤ 1 is
  a fraction of the parent. With `viewport: [w, h]` (or `"parent"`), children lay out at that size and are scaled into
  the frame, so a full scene fits unchanged. Inside a frame, `useClip().width/height` and slide distances follow the
  viewport. `pip(node, { corner, size, margin, ...frame options })` is a corner-anchored frame that shows a full-size
  scene (`viewport: "parent"`) on a plain rounded card by default. See `examples/frames`.
- **Subtitles:** `subtitles(srtOrVtt, { preset, from, style, highlight })` takes SRT or WebVTT text (import a file
  with `import srt from "./assets/talk.srt?raw"`) or parsed cues (`parseSubtitles`).
  - Presets: `clean` (outlined), `boxed` (a box per line, the default), `bold` (big uppercase social captions),
    `highlight` (bold with the spoken word highlighted).
  - Word timing comes from VTT inline timestamps (`<00:00:01.200>word`), or is estimated from word length.
  - `from` is the file time shown at the clip's start. Without a `duration` the clip lasts until the last cue.
    Styling tags, voices, NOTE / STYLE blocks and cue settings are ignored. See `examples/subtitles`.
- **Decorations:** `decor.vignette({ strength, size, color })`, `decor.watermark({ src | text, corner, size, alpha })`,
  `decor.border({ width, color, radius })` and `decor.grain({ amount, size, animated, seed })` are full-frame
  overlays. Add them as the last layers, or inside a group / frame to decorate only that. Grain is seeded per frame,
  so it animates but renders identically every time. See `examples/decor`.
- **three.js:** `three(setup, { background, fov, ...node props })` from `@smashcut/three`.
  - `setup({ THREE, scene, camera, renderer, width, height, texture })` builds the scene once. It may be async;
    `texture(url)` loads through `delayRender`. It returns `(t) => void`, which poses the scene for each frame.
  - Animate only from `t`: identical frames render identically, so parallel chunks match.
  - The canvas follows `--scale`, and WebGL works in headless Chromium. See `examples/three`.
- **Typing:** `typing("PO-58221", { at: 1.2, cps: 13, seed: 2, caret: "|" })` is a human-paced keystroke schedule
  (seeded jitter, pauses at word boundaries, finger-aware rhythm: alternating hands are fast, same-finger pairs slow). Pass `entry.text` to `text()`, or call `entry.text(useClip())`
  and `entry.focused(t.local)` in a React field. Chain fields with `{ at: previous.end + 0.8 }`.
  `typos: [{ at, wrong, notice }]` types `wrong` at index `at` (plus `notice` more characters), pauses, backspaces
  it and retypes. The backspaces are real `BACKSPACE` keystrokes with their own key sound. For a mistake nobody
  catches, just type the wrong text. Its sound is
  `sfx.keys(entry, { at: clipStart, switch: "clicky" })` (see Audio).
- **Camera:** `zoomTo({ x, y, scale }, { at, duration, hold })` zooms a group in on a frame-pixel point and back out.
  `camera([[t, { x, y, scale }], ...])` keyframes several shots (zoom, pan, pull out). Spread either into the group's
  props. `examples/typing` covers field entry (four switches, a corrected typo) with and without camera moves, and
  `examples/frames` zooms into a screenshot.
- **React:** components read time with `useClip()` from `@smashcut/runtime` and must be pure with respect to the frame.
  Wrap async loading in `delayRender(promise)` so the renderer waits for it.

## Examples

Each folder in `examples/` is a video. Together they cover the whole API, and most combine several features.

| Example | What it shows |
|---|---|
| `hello` | The basics: `text`, `image`, `react`, `series` with `fade` / `slide` / `wipe`, `kf`, `modern()` music. |
| `motion` | Every `enter` / `exit` effect and every transition type, easings, `spring`, seeded `rng` particles, `chiptune()` with 8-bit effects and a hand-written `pattern()` sting. |
| `frames` | Every `framed()` chrome, phone viewports, `pip()`, and a screenshot at its source pixels with a click call-out and `zoomTo()`. |
| `subtitles` | SRT and VTT in all four presets, VTT word timing vs. estimated timing, custom style and highlight colour, an `ambient()` bed that ducks. |
| `typing` | `typing()` into a form on all four switch types with a corrected typo, then a `camera()` that follows the fields. `groove()` music. |
| `footage` | A Playwright recording trimmed into scenes, one at 2× `playbackRate`, a looping picture-in-picture, sound effects cued from the recording. |
| `decor` | `vignette`, `watermark`, `border` and `grain`, one at a time and together. |
| `three` | Lit geometry, an async texture, an SVG logo extruded in 3D, and `ambient({ intensity })` building and releasing with the scenes. Try `--scale 2`. |
| `social` | A vertical 1080×1920 clip: scenes on the music's bar lines, `highlight` captions, a phone whose chart is fetched from JSON with `delayRender`, `groove({ end })`. Try `--fps 60`. |
| `launch` | A launch video for smashcut: a three.js logo, code typed into an editor with the camera following the caret, footage beside a render, captions built from scene times, decor and `groove({ intensity, end })`. |

## Audio

All sound is synthesised in code. There are no samples and no licensing, and every seed renders the same output
every time. There are four styles:
- `groove()`: upbeat and warm, with strummed guitar, a bouncing bass and kick / clap / shaker. No bells or chimes.
  The default choice for product videos.
- `ambient()`: a quiet background bed (slow pads, sub bass, a rare glassy note).
- `modern()`: FM plucks and bells, warm pads, sub bass, soft drums, reverb and echo. A foreground track.
- `chiptune()`: NES-style square/triangle/noise, for retro videos.

```ts
import { modern, music, sfx } from "@smashcut/core";

defineVideo({
  // ...
  audio: [
    music(modern({ seed: 3, mood: "bright", key: "C major" }), { volume: 0.8, fadeOut: 1.5 }),
    sfx.swoosh({ at: 1.65, length: 0.9 }),
    sfx.tap({ at: 3.6, freq: 1046.5 }),
    sfx.tick({ at: 7.05 }),
    sfx.riser({ at: 6.7, length: 1 }), // peaks at 7.7
    sfx.bell({ at: 8.3 }),
  ],
});
```

- `groove({ seed, key, bpm, bars, intensity })` is an upbeat pop/indie groove (112 bpm, I–V–vi–IV-style, one chord
  per bar).
  - Instruments: a strummed, partly palm-muted guitar (Karplus-Strong plucked strings, so no bells), a bouncing
    octave bass, kick, shaker, a clap backbeat, 16th hats and short warm saw stabs.
  - `intensity` (0..1, constant or `[seconds, level]` keyframes) builds it. At 0, one strum per beat over a held
    bass. Around 0.4 the busy strum pattern, kick, shaker and bouncing bass come in. Near 1 the claps, hats and
    stabs join. The layers crossfade, so it can drop out and come back. See `examples/launch` and `examples/social`.
  - `end: seconds` gives the music a real ending instead of a fade. It snaps to the nearest bar line
    (`grooveBar(bpm)` is one bar in seconds), stops the band and lands on a held home chord that rings out. Leave
    ~2.5 s after it.
- `ambient({ seed, mood, key, bpm, bars })` is a background bed: slow two-bar add9 / sus pad chords with long fades, a
  sustained sub bass and an occasional glassy note far back in the reverb. It has no melody, arpeggio or drums, and
  everything above ~5 kHz is rolled off so keys, clicks and voices sit on top. Moods: `air` (default), `pulse` (adds a
  quiet muted pluck and a soft kick). Use it with `duck`.
  - `intensity: [[seconds, 0..1], ...]` (or a constant) makes one track build and release with the story, with
    the same key, tempo and chords throughout. At 0 it's the calm bed. Around 0.4 a muted pulse, a soft kick and
    a shaker come in. Near 1 there's a driving 16th-note arpeggio, four-on-the-floor kick, hats, a backbeat, a
    moving bass and a brighter pad, and the low-pass opens up. The layers crossfade, so a fast drop from 1 to 0
    makes a clean "release". See `examples/three`.
- `music(src, { duck: 0.5 })` (any `sound` clip): dips the clip by up to that fraction while other sounds (effects,
  keys, footage audio) play, with a fast attack and a ~0.4 s release, like a sidechain. It's what keeps a bed under
  the action.
- Loudness: the exported soundtrack is normalised to `defineVideo({ loudness })`, default -16 LUFS. That's one gain
  for the whole mix, with peaks kept under -1.5 dBFS (AAC overshoots slightly). `loudness: false` keeps the raw mix.
- `modern({ seed, mood, key, bpm, bars })` is a generated loop: 7th-chord pads, sub bass, an FM pluck arpeggio through a
  dotted-eighth echo, a bell motif, and soft drums with sidechain pump. Moods: `bright`, `calm`, `driving`.
- `chiptune({ seed, mood, key, bpm, bars })` is the 8-bit equivalent. Moods: `upbeat`, `chill`, `epic`.
- `sfx`:
  - `pluck`, `strum` (a major-chord "done"), `thud` (a dull "something's wrong"): plucked strings that match
    `groove()`, with no bells.
  - `tap`, `tick`, `bell`, `swoosh`, `riser`: soft and reverb-tailed, matching `modern` / `ambient`.
  - `blip`, `click`, `pop`, `chime`, `whoosh`: 8-bit.
- `sfx.keys(entry, { at, switch, volume, seed })` synthesises a Cherry MX-style board (ABS caps, steel plate) for a
  `typing()` entry. Each key has a bottom-out and a top-out clack built from keycap, plate, case and spring resonances.
  Every key keeps its own timbre, and each press depends on the touch-typing finger that makes it: force,
  brightness, off-centre wobble and hold time. Space and enter rattle. Switches: `clicky` (MX Blue), `tactile`
  (MX Brown, default), `linear` (MX Red), `membrane` (laptop). `keyboardSound(keystrokes)` is the raw source, and
  `keyInfo(char)` gives a key's hand, finger, row and pan.
- Building blocks for your own sounds: `stringNote` (plucked string), `fmNote`, `padNote`, `bassNote`, drums, `reverb`, `delay`, `biquad`,
  `withReverb`, `pattern()`.
- `smashcut audio <dir>` exports the mixed soundtrack as WAV. `smashcut render` muxes it into the MP4 (AAC), and `smashcut dev`
  plays it in sync.

## How it works

- `@smashcut/core`: a pure data model. Builders produce a node tree. `resolveComposition` turns it into absolute
  frame ranges, and `clipVisual` computes per-frame transforms, effects and transitions.
- `@smashcut/runtime`: a React renderer in the browser. It exposes `window.__smashcut.seek(frame)`, which renders a
  frame and resolves once images, fonts and `delayRender` handles are ready. Render mode makes
  `Date.now`, `performance.now` and `Math.random` deterministic per frame.
- `smashcut` (the CLI): serves the project through Vite and drives headless Chromium (Playwright). It screenshots
  each frame and pipes the PNGs into ffmpeg (H.264). The frame range is split into chunks rendered by
  parallel pages, and the chunks are then concatenated.
- Footage is never seeked in a `<video>` element. The CLI probes each file with ffprobe, extracts its frames as
  JPEGs at the render frame rate into `.smashcut/footage/` (once per file and fps), and decodes its audio to PCM. The
  runtime shows the cached frame for each timeline frame, so footage is frame-exact and safe to render in parallel.

## Roadmap (next milestones)

Timeline cue helpers, `smashcut capture <url>`.
See `docs/plan.md`.
