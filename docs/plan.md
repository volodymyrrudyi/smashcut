# smashcut: plan and progress

Videos defined as code. Each video is a folder with `timeline.ts`, `assets/` and optional `lib/*.ts(x)`. The
renderer is our own (an alternative to Remotion): a pure TypeScript model, a React runtime in headless Chromium,
and ffmpeg for encoding.

_Last updated: 2026-10-28_

## Architecture (as built)

| Package | Role |
|---|---|
| `@smashcut/core` | Pure model, with no DOM. Builders (`defineVideo`, `series`, `group`, `text`, `image`, `video`, `solid`, `react`), time resolution (seconds → frames, transition overlaps, footage durations from media info), footage timing (`footageTime`, `footageFrame`), animation (`kf`, `interpolate`, `spring`, easings), per-frame visuals, and the whole audio engine, including mixing footage audio. |
| `@smashcut/runtime` | Browser side. A React renderer for a frame, the `delayRender` readiness gate, determinism shims (`Date.now`, `performance.now`, `Math.random` per frame), the dev preview player with synced audio, and the `window.__smashcut` bridge. Before resolving the timeline, it probes footage files and loads their audio when the soundtrack is needed. |
| `@smashcut/three` | Optional three.js integration: the `three(setup)` node, with a renderer, scene and camera per clip, async setup through `delayRender`, and per-frame posing from `t`. |
| `smashcut` (CLI) | `smashcut dev / still / render / audio`. A Vite dev server serves the project and the footage endpoints (`/__smashcut/media/info`, `/frame`, `/audio`, backed by `MediaCache`). Playwright drives one Chromium per chunk, screenshots are piped to ffmpeg (H.264), the chunks are concatenated, and AAC audio is muxed in. |

Key decisions:
- **Timing is authored in seconds.** Frames are only sampled, so `--fps 30/60/120` renders the same timeline with
  identical timing.
- **`--scale 2`** renders a 1080p layout at 4K (device pixel ratio), so vector content stays sharp.
- **Rendering is deterministic.** A frame is a pure function of the frame number, and audio is a pure function of
  its seeds. This is what allows parallel chunked rendering.
- **Audio is synthesised, not sampled.** It needs no licensing, can be reproduced exactly, and sound effects are
  placed from the same constants as the animations, so sync survives retiming. Footage is the one exception: its
  own audio track is decoded and mixed in.
- **Footage is never seeked in a `<video>` element.** Seeking in headless Chromium isn't frame-accurate. Instead,
  frames are extracted with ffmpeg at the render frame rate into `.smashcut/footage/` (once per file and fps, shared by
  every render chunk), and each timeline frame shows its exact cached JPEG. The CLI fills the cache before the first
  capture, so extraction never counts against the `delayRender` timeout.

## Progress

### Done
- [x] **M1: skeleton.** Core model, runtime, `solid` / `image` / `text` / `react` / `group` nodes, keyframes,
      springs, enter/exit effects (`fade`, `fade-up`, `zoom`, `slide-*`, `wipe`), and `smashcut still`.
- [x] **Render pipeline.** Chunked parallel render with one browser per chunk (about 5× faster than shared pages),
      ffmpeg concat, frame ranges (`--from/--to`), `--crf`.
- [x] **`series` with transitions.** `fade`, `slide`, `wipe`, and `zoom` (a hand-off, so text never overlaps).
- [x] **Frame rate and resolution.** `--fps` override and `--scale` (4K). Verified 4K60 and 1080p120 output.
- [x] **Dev preview.** Scrubber, play/pause, keyboard stepping, frame in URL hash, synced audio, mute.
- [x] **Audio engine.**
  - Mixer with clip timing, volume and fades, plus a soft clipper. WAV export via `smashcut audio`, AAC mux on render.
  - `modern()` generator (moods `bright` / `calm` / `driving`): FM plucks and bells, PolyBLEP pads, sub bass, soft
    drums, sidechain pump, Freeverb, ping-pong delay.
  - `chiptune()` generator (moods `upbeat` / `chill` / `epic`): NES-style square, triangle and noise channels.
  - Sound effects: `tap`, `tick`, `bell`, `swoosh`, `riser` (modern) and `blip`, `click`, `pop`, `chime`, `whoosh` (8-bit).
  - Building blocks: `fmNote`, `padNote`, `bassNote`, `biquad`, `reverb`, `delay`, `withReverb`, `pattern()`.
  - Mixes measured at about -14 LUFS with no clipping.
- [x] **Footage clips.**
  - `video(src, { trim, playbackRate, loop, volume, muted })`, plus the same `fit` / `width` / `height` / `radius`
    as `image`. Without a `duration`, a clip lasts as long as its trimmed source, so it works directly in a `series`.
  - Past the end of the trim, the picture holds the last frame inside the trim, or wraps when `loop` is set.
  - The clip's own audio is decoded with ffmpeg (48 kHz stereo) and mixed at the clip's resolved position. It
    follows trim and playback rate, crossfades over series transitions, gets a 5 ms ramp at hard cuts, and stops
    when the source runs out.
  - Dev preview: frames are served on demand, and the footage audio is mixed in on first play.
  - `radius` on `image` and `video` also accepts a CSS string (`"0 0 16px 16px"`), e.g. footage flush under a frame.
  - Verified: frame-exact stills (25 fps sources in a 30 fps timeline), the audio placement and crossfade by
    analysing the exported WAV, and a 60s 4K source (about 6s to extract, 767 MB of cache).
- [x] **Typing, keyboard sounds and camera moves.**
  - `typing(content, { at, cps, jitter, seed, caret, focus })`: a seeded, human-paced keystroke schedule (pauses
    at word and punctuation boundaries). `.text` is an animatable string with a caret that stays solid while typing
    and blinks while the field is idle. `.count`, `.focused`, `.at` and `.end` are there for custom fields and
    chaining.
  - `sfx.keys(entry, { at, switch })` / `keyboardSound(keystrokes)`: a synthesised Cherry MX-style board (ABS caps,
    steel plate).
    - Each keystroke is a bottom-out and a top-out clack: a broadband impact transient plus noise-excited
      resonances (enveloped noise through moderate-Q band-passes) for the keycap (≈3 kHz), plate (≈1.5 kHz) and
      case (≈500 Hz clack). An earlier version used pure damped sines, which sounded like beeps and chimes.
    - `tone` (-1 fuller .. 1 brighter) shifts the cap pitch and the case level.
    - Clicky switches fire the click jacket ~10 ms before bottom-out and again on release. Tactile switches get a
      scratchy bump.
    - Every key has a stable timbre (seeded per key, lower on taller rows). Space and enter add stabiliser rattle.
      There's a desk reflection and a small room.
    - Switch presets: `clicky` (MX Blue), `tactile` (MX Brown), `linear` (MX Red), `membrane` (laptop).
  - Finger model (`keyInfo`, `packages/core/src/keys.ts`): every key maps to its touch-typing finger.
    - Fingers differ in force, consistency, off-centre strikes and hold time. Pinkies are light and uneven,
      index and middle fingers firm, the thumb hits space hard.
    - Force sets loudness and brightness. Soft presses sometimes don't fully bottom out, and off-centre hits add
      a stem-wobble clack.
    - The typing rhythm follows the fingers as well: alternating hands ≈0.8×, same finger ≈1.4×, double letters
      ≈0.85×.
  - Checked: strokes land on their characters, nothing clips, and finger/press variance is measurable. The timbre
    can only be judged by ear: audition files are written to `examples/typing/out/keys/` (v3 = current).
  - `camera(shots)` / `zoomTo(target, { at, duration, hold })`: zoom and pan a group so a frame-pixel point lands
    in the centre, eased between shots.
- [x] **Examples.** Ten videos under `examples/`, each showing a group of features (listed under "The ten
      examples" below and in the README).
- [x] **Frames and picture-in-picture.**
  - `framed(content, { chrome, width, height, viewport, url, title, theme, radius, shadow, border, background })`:
    a `frame` node that holds children like `group`. Chrome: `browser` (traffic lights + address bar), `window`
    (title bar), `phone` (bezel + dynamic island), `none` (rounded card), each light or dark.
  - Viewports: with `viewport: [w, h]` or `"parent"`, children lay out at that size and are scaled into the content
    box. The runtime threads a viewport size through `ClipView`, so `useClip().width/height`, slide effects and
    transitions inside a frame use the frame's size, not the video's.
  - `pip(content, { corner, size, margin, ... })`: a corner-anchored frame, defaulting to a plain card that shows a
    full-size scene (`viewport: "parent"`).
  - `examples/footage` uses `framed()`. `examples/frames` shows every chrome, a phone with a scaled 1170×2532
    viewport, and two picture-in-picture windows.
- [x] **Subtitles.**
  - `parseSubtitles()` reads SRT and WebVTT (BOM, CRLF, headers, NOTE / STYLE blocks, cue settings, hour-less
    timestamps, styling and voice tags). Word timings come from VTT inline timestamps, or are estimated from word
    length. `cueAt()` looks up the current cue.
  - `subtitles(source, { preset, from, style, highlight })`: presets `clean`, `boxed` (a box per line), `bold`
    (uppercase social captions with a pop-in) and `highlight` (word-by-word). Cues fade at their edges. `from`
    offsets into the file, and the intrinsic duration runs to the last cue.
  - Files load with Vite's `?raw` imports (typed by `packages/core/src/env.d.ts`). `examples/subtitles` shows one
    SRT in three presets and a VTT with word timing.
- [x] **`smashcut init` and videos outside the repo.**
  - The dev/render server aliases `@smashcut/core`, `@smashcut/runtime`, `react` and `react-dom` to this install
    (`packages/cli/src/paths.ts`), so a video folder anywhere on disk works without its own `node_modules`.
  - `smashcut init <dir>` scaffolds `timeline.ts`, `lib/Title.tsx`, `assets/`, `.gitignore` and a `tsconfig.json`
    whose `paths` point at this install's sources and React types. It refuses to write into a folder that isn't
    empty.
  - Verified from a folder outside the repo: init, `tsc -p`, still, a full render with audio, and the dev server.
- [x] **Decorations.** `decor.vignette` (eased radial falloff, any CSS colour via `color-mix`), `decor.watermark`
      (image or text in a corner; `alpha` is the resting level, so the node's own `opacity` still animates),
      `decor.border` (rounded inner edge) and `decor.grain` (seeded noise per frame, overlay blend). They're `decor`
      nodes that fill their parent. `examples/decor` shows each one, then all four together.
- [x] **Screenshots on `framed()`.** `examples/frames/lib/Screen.tsx` exports `screen()`, a `framed()` browser
      whose viewport is the screenshot's source pixels. The call-out is a child component that draws in display
      pixels, and the rise animation uses the frame's `y` / `opacity` / `scale`. A compensating `y` keeps the top
      edge fixed during the push-in, since nodes scale about their centre.
- [x] **three.js.** A separate `@smashcut/three` package (three 0.170.0), so three stays an optional dependency.
  - `three(setup, opts)` builds a `WebGLRenderer` (`preserveDrawingBuffer` for capture, device pixel ratio for
    `--scale`), a scene and a camera once.
  - `setup` may be async (`ctx.texture()` loads through `delayRender`). It returns a per-frame function, and every
    frame's draw is gated by `delayRender`.
  - Verified: WebGL in headless Chromium, byte-identical PNGs for a repeated frame, a full render with 4 parallel
    browsers, 4K with `--scale 2`, and use from a `smashcut init` folder outside the repo (aliases and types for `three`
    and `@smashcut/three`).
- [x] **Quieter music, ducking and loudness.**
  - `ambient()`: a background-bed generator (moods `air`, `pulse`). It plays slow two-bar add9 / sus chords as dark
    pads with long attacks and releases, a sustained sub bass and sparse glassy notes in a big reverb. There's no
    melody, arpeggio, claps or shakers, and a 5.2 kHz low-pass keeps the presence range free for effects and voices.
    It sits about 6 dB below `modern()` at the same volume.
  - `duck` on any sound clip: the mixer renders the other sounds first, follows their level (12 ms attack, 0.4 s
    release) and dips the ducking clip by up to `duck`. Verified: untouched before the effects, dipped during them,
    recovering after.
  - Loudness normalisation on export (`smashcut render` / `smashcut audio`): ffmpeg's EBU R128 meter measures the mix, then one
    gain brings it to `loudness` (default -16 LUFS), capped at a -1.5 dBFS true peak. All examples now export at
    -16 LUFS (or just under, when the peak cap applies).
- [x] **Music that follows the story.** `ambient({ intensity })` takes keyframes (seconds → 0..1) and renders three
      layers on one key, tempo (90 bpm once rhythmic) and chord sequence:
  - the bed (always on);
  - a pulse layer (muted 8th-note pluck, soft kick, offbeat shaker), faded in from 0.2 to 0.5;
  - a drive layer (16th-note arpeggio, four-on-the-floor kick, hats, backbeat clap, 8th-note bass, a brighter pad),
    faded in from 0.55 to 0.95. The bus low-pass also opens from 5.2 to ~10 kHz with intensity.

  Measured at constant intensity 0 / 0.45 / 0.7 / 1: about -21 / -19.6 / -18 / -13.5 dB. `mood: "pulse"` is now a
  constant 0.45.
- [x] **`groove()`: upbeat music without chimes.** The FM glass / bell timbres in `ambient()` and `modern()` read as
      "chimy". `groove()` uses a different palette:
  - a Karplus-Strong plucked string (`stringNote`, allpass-tuned within ~0.5 % and ring time in seconds) strummed
    across a 5-string voicing, with palm mutes on the offbeats;
  - a bouncing octave bass, kick, shaker, clap backbeat, 16th hats and short filtered-saw stabs.

  It has the same `intensity` crossfading as `ambient()`: about -21.6 dB at 0 and -16 dB at 0.45 and above, where
  claps, hats and stabs add energy more than level. `typing` and `footage` use a steady `groove({ intensity: 0.5 })`
  with `duck: 0.35`; `social` and `launch` follow their story with intensity keyframes.
- [x] **Plucked-string effects.** `sfx.pluck` (notification), `sfx.strum` (a major-chord "done") and `sfx.thud`
      (a dull error), built on `stringNote` so they sit with `groove()`.
- [x] **Music endings.** `groove({ end })` snaps the ending to a bar line, stops every layer there and lands on a
      let-ring strum of the home chord, with held bass, one kick and a reverb send, fading over ~2.8 s.
      `social` and `launch` derive their call-to-action length from it (the next bar line after the outro starts,
      plus ~2.8 s of ring-out), so the videos end on the resolved chord instead of a mid-phrase fade.
- [x] **Example data uses `example.com`.** URL bars, addresses and calls to action in the examples use
      `example.com`, never made-up addresses on real domains.
- [x] **Timeline and review notes in `smashcut dev`** (`packages/runtime/src/Timeline.tsx`).
  - Rows: a waveform of the mix (mixed once on load, which also makes Play start instantly), a collapsible tree of
    every resolved clip, caption cues, one row per sound label (`AudioClip.label`; set by every `sfx.*`, `keys` and
    `music()`), and note markers.
  - Seeking by click / drag, zoom by ⌘/Ctrl-scroll (native non-passive listener) or buttons, auto-follow while
    playing, and a details panel for the selected bar or note.
  - **N** focuses the note box, and Enter saves. Notes go through a `GET` / `PUT` `/__smashcut/notes` endpoint
    (cross-site guarded, 1 MB limit) to `.smashcut/notes.json`, with time, frame and the on-screen / audible context
    at that moment. They're meant to be read back later, e.g. by an assistant asked to "check the notes".
  - Verified in headless Chromium: the timeline renders, clicking seeks (frame 599), a bar shows its details, N +
    typing + Enter saves a note with its context, and there are no console errors.
- [x] **Typos.** `typing(..., { typos: [{ at, wrong, notice }] })` types the mistake (and `notice` more characters),
      pauses ~0.3 s, backspaces quickly and retypes. `entry.value(t)` replays backspaces, and `keyInfo("\b")` puts
      the backspace key under the right pinky, top-right. `examples/typing/lib/Form.tsx` gained an `errors` prop
      (a red field plus a message from a given time).
- [x] **`dip` transition.** Out to the background, then in, so a title card's text never overlaps the incoming
      scene the way a crossfade would.
- [x] **The ten examples.** Each example shows a group of features, most of them in combination:
  - `hello`: the basics, with `modern()` music and effects.
  - `motion` (~18 s): every `enter` / `exit` effect, every transition type (in several directions, with easings),
    `interpolate` easings racing a `spring`, three damping values, a seeded `rng` particle burst, `chiptune()` with
    8-bit effects, and a hand-written `pattern()` sting placed with `sound()`.
  - `frames`: every chrome, a scaled phone viewport, picture-in-picture, and a 2400×1500 screenshot in a browser
    frame whose viewport is the image's pixels, with a click call-out measured in those pixels (`lib/Screen.tsx`)
    and `zoomTo()`.
  - `subtitles`: one SRT in several presets, a VTT with word timing, the `highlight` preset (estimated word timing)
    with a custom style and colour, and an `ambient()` bed that ducks under the scene ticks.
  - `typing`: each field in the first scene on a different switch (named in its label), a typo noticed two
    characters late, and the camera following the typing in the second scene.
  - `footage`: records `site/index.html`, a local made-up task board (no network, so re-capturing gives the same
    tour). Scenes trim the recording; one plays at `playbackRate: 2`; the outro loops a slice in a
    picture-in-picture. `capture.ts` also writes `assets/insights.png` (copied into `frames`) and prints
    the source-pixel boxes its call-out uses.
  - `decor`: each decoration alone, then together; the watermark is the smashcut film-reel mark (`assets/logo.svg`).
  - `three`: three.js scenes, then one that extrudes that logo with `SVGLoader` (`lib/Logo3D.ts`), grain, and
    `ambient({ intensity })` building through the scenes and releasing at the end. The comment points at `--scale 2`.
  - `social` (1080×1920): scenes on `grooveBar()` lines, `groove({ intensity, end })`, `highlight` captions
    built as SRT from scene times, a phone whose chart `fetch`es `assets/stats.json` under `delayRender`, a text
    watermark. The comment points at `--fps 60`.
  - `launch`: smashcut's own launch video. The 3D logo, a `timeline.ts` typed into a dark `window` frame with the
    camera following the caret (`lib/Editor.tsx` exports the layout), the board footage (linked from `footage`) next
    to a `smashcut render` terminal, narration captions, decor, and `groove({ intensity, end })` ending on a chord.
  - Shared look: `hello/lib/theme.ts` (`theme`, `paper`, `font`), `Fonts.tsx` and `Background.tsx`. Each video that
    uses Inter has its own `assets/fonts/inter.woff2`, since `asset()` resolves per video.
- [x] **Tests.** 68 unit tests (time resolution, visuals, audio determinism and levels, footage timing, frame
      indices and audio mixing, typing schedules and carets, finger map and rhythm, keyboard sound and its finger
      variance, camera framing, SRT/VTT parsing and word timing, subtitle durations, frame resolution, pip,
      decoration nodes, ambient determinism and level, ducking, typos, groove intensity, plucked-string pitch and decay, timeline summaries, contact-sheet frame picking) and a clean typecheck.

### Remaining for the MVP (from the original plan)
- [x] **npm packages.** `@smashcut/core`, `@smashcut/runtime`, `@smashcut/three` and the CLI as `smashcut`, all
      MIT and versioned together. They ship TypeScript sources: Vite compiles them for the browser, and the CLI runs
      through `tsx`.
  - The CLI resolves smashcut and React from the video folder first, then from its own install. Vite serves the
    `@smashcut/*` packages as source instead of pre-bundling them. Pre-bundled, a cold render of the three.js
    example loaded a second React.
  - Installed, `smashcut init` writes a `package.json` (smashcut, React types, `dev` / `still` / `render` scripts)
    and a `smashcut-env.d.ts`. From the monorepo it writes `tsconfig` paths into the repo, as before.
  - Verified from packed tarballs in a folder outside the repo: init, install, still, an MP4 with audio, `tsc`, the
    three.js example with `@smashcut/three` installed (and a clear error without it). Releasing is in
    `docs/publishing.md`.

- [x] **Agent support.** A coding agent can write a video and check its own work without watching a preview.
  - `smashcut sheet <dir>`: a contact sheet, `--count 12` frames (each from the middle of an equal slice, so not
    a black first frame) or one `--every N` seconds, labelled with time and frame number, as one PNG. Thumbnails
    fit 480×360, so vertical videos stay readable.
  - `smashcut inspect <dir> [--json]`: the resolved timeline (`describeTimeline` / `formatTimeline` in core):
    the clip tree with transitions, captions and sounds grouped by label. It runs through the runtime bridge, so
    it reports the same load errors a render would, and skips footage extraction.
  - The skill (`packages/cli/skills/smashcut/SKILL.md`): the write / inspect / sheet / fix / render loop,
    timing and layout, an API table, the determinism rules, the examples and common errors. Its example timeline
    is tested by rendering it. It ships in the npm package, `smashcut init` copies it into
    `.claude/skills/smashcut/` with an `AGENTS.md` and a `CLAUDE.md` that imports it, and the repo is a Claude
    Code marketplace (`.claude-plugin/marketplace.json`) for `/plugin install smashcut --marketplace
    volodymyrrudyi/smashcut`.
  - `clipLabel` and `soundEnd` moved from the dev timeline into core, so `inspect` and the timeline name things
    the same way.

### Next up / nice to have
- [ ] **`smashcut capture <url>`.** Turn `examples/footage/capture.ts` into a CLI command: record a scripted web page
      walkthrough (clicks, scrolls, waits) on virtual time into footage.
- [ ] **Leaner footage cache.** Extract only the trimmed ranges, scale frames to the clip's on-screen size × `--scale`,
      and prune stale cache entries.
- [ ] **Audio files** (`sound(asset("track.mp3"))`), decoded with ffmpeg. Deferred by decision on 2026-10-28. The
      footage audio decoding can be reused, so this is now cheap.
- [ ] **Pitch-preserving speed change** for footage audio (e.g. ffmpeg `atempo` at decode time).
- [ ] **A demo of footage audio.** `examples/footage` uses a silent screen recording, so a clip's own audio track is
      only covered by unit tests.
- [ ] **Motion blur** (sub-frame accumulation) for fast motion such as slide transitions.
- [ ] **Alpha output** (ProRes 4444 / WebM VP9) for overlays.
- [ ] **Faster capture.** CDP `beginFrame` / JPEG intermediates. Currently about 40 fps at 1080p and about 12 fps at
      4K, with 8 workers on a 16-core Mac.
- [ ] **Golden-frame pixel-diff tests** per node type, and an end-to-end render test in CI (including a footage clip).
- [ ] **Timeline cue helpers.** Expose resolved clip start times so audio cues don't need hand-computed scene
      offsets. Most examples compute scene starts by hand (`SA`, `S_CODE`, `starts[]`, ...).
- [ ] **Richer typing.** `\t` / `\n` moving focus between fields, selecting and replacing existing text, and a
      keyboard overlay that shows key presses. (Typos with backspace are done.)
- [ ] **3D node transforms** (`rotateX` / `rotateY` / `perspective` on `BaseProps`), which would restore effects
      like a screenshot tilting in.
- [ ] **three.js extras:** a GLTF model loader helper on the setup context, and three.js scenes as transition
      sources.
- [ ] **Subtitles extras:** speaker colours from VTT voices, per-cue positions from cue settings, and burned-in
      captions generated from a footage clip's audio.
- [ ] **Timeline extras:** drag clips to retime them (writing back to the timeline source), per-clip waveforms,
      loop a selection, and a "reviewed" state for notes.
- [ ] **Shader transitions** and a GPU-backed custom transition API.

## Known issues
- `groove()`, `ambient()` and the keyboard synth were checked by measurement only. Their timbre needs a listen;
  `smashcut audio <dir>` exports any example's soundtrack.
- Frame chrome, subtitle presets and the `smashcut init` template use `Inter, system-ui`. Without Inter loaded (the
  examples register it with `hello/lib/Fonts.tsx`) the system font is used.
- A text caret appended to a centred `text()` shifts the text by half a caret width while it blinks. Left-aligned
  fields (as in `examples/typing`) are unaffected.
- The footage cache stores every frame of the whole file at full source resolution, so long or 4K clips take a lot
  of disk space and extraction time (767 MB for 60s of 4K).
- Footage audio follows `playbackRate` by resampling, so its pitch shifts with the speed.
- Footage must be a file inside the project. URLs aren't supported.
- Examples share code through `examples/hello/lib`, but each keeps its own copy of `inter.woff2` (and `launch`
  symlinks `footage`'s recording), because `asset()` resolves against each project. Cross-project assets would remove
  the duplication.
- `examples/footage/site/index.html` types into its fields with its own timers, so the footage's key sounds are evenly
  spaced ticks over the typing window (`TYPED` in `lib/tour.ts`), not one per character.
- H.264 4K60 is level 5.2, which some older hardware decoders can't play.
