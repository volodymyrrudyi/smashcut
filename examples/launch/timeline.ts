import {
  asset,
  camera,
  decor,
  defineVideo,
  framed,
  groove,
  grooveBar,
  group,
  midiToFreq,
  music,
  noteToMidi,
  react,
  series,
  sfx,
  slide,
  spring,
  subtitles,
  text,
  typing,
  video,
  zoom,
} from "@smashcut/core";
import { three } from "@smashcut/three";
import { Fonts } from "../hello/lib/Fonts";
import { font, theme } from "../hello/lib/theme";
import { logo3D } from "../three/lib/Logo3D";
import logoSvg from "./assets/logo.svg?raw";
import { caretAt, Editor } from "./lib/Editor";
import { Terminal } from "./lib/Terminal";

// A launch video for smashcut, made with smashcut: the logo extruded in three.js, a timeline typed into an editor with
// the camera following the caret, footage (the board recording from examples/footage, linked into assets/) next
// to a render in a terminal, and a call to action on a resolved chord. Captions, decor and a music track that
// builds with the story run over all of it.

const note = (n: string) => midiToFreq(noteToMidi(n));
const headline = { fontFamily: font, color: theme.text, fontWeight: 800, letterSpacing: -2 };

// --- 2. The code: three lines are already there, two get typed, the end is already there -------------------
const BEFORE = "export default defineVideo({\n  size: [1920, 1080],\n  layers: [\n";
const TYPED = '    text("Hello, smashcut", { enter: "fade-up" }),\n    video(asset("tour.mp4"), { trim: [2, 8] }),';
const AFTER = "\n  ],\n});";
const code = typing(TYPED, { at: 1.4, cps: 19, seed: 5, caret: "▍" });
const lineBreak = code.keystrokes.find((k) => k.char === "\n")!.time;

// The editor window: 1400×760 content, centred, below a 38 px title bar. Camera targets are in video pixels.
const WIN = { w: 1400, h: 760, bar: 38 };
const onScreen = ({ x, y }: { x: number; y: number }) => ({ x: 960 - WIN.w / 2 + x, y: 540 - (WIN.h + WIN.bar) / 2 + WIN.bar + y });
const ZOOM = 1.75;
const shots = camera([
  [0.4, { scale: 1 }],
  [1.2, { ...onScreen(caretAt(3, 22)), scale: ZOOM }],
  [lineBreak, { ...onScreen(caretAt(3, 30)), scale: ZOOM }],
  [lineBreak + 0.6, { ...onScreen(caretAt(4, 22)), scale: ZOOM }],
  [code.end, { ...onScreen(caretAt(4, 30)), scale: ZOOM }],
  [code.end + 0.9, { scale: 1 }],
]);

// --- Scene timing -----------------------------------------------------------------------------------------
const INTRO = 3.4;
const CODE = code.end + 2;
const RENDER = 6;
const T = { intro: 0.7, code: 0.8, render: 0.8 };
const S_CODE = INTRO - T.intro;
const S_RENDER = S_CODE + CODE - T.code;
const S_OUTRO = S_RENDER + RENDER - T.render;
// The music's ending lands on the first bar line at least half a second into the outro; the chord rings ~2.8 s.
const BAR = grooveBar();
const MUSIC_END = Math.ceil((S_OUTRO + 0.5) / BAR) * BAR;
const OUTRO = MUSIC_END + 2.8 - S_OUTRO;
const END = S_OUTRO + OUTRO;

// --- Narration, built as SRT from the scene times -----------------------------------------------------------
const stamp = (s: number) => {
  const ms = Math.round(s * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
const narration: [number, number, string][] = [
  [S_CODE + 0.3, S_CODE + lineBreak, "Describe the video as a timeline in TypeScript."],
  [S_CODE + lineBreak + 0.1, S_RENDER - 0.2, "Text, footage, React, three.js and music are all nodes."],
  [S_RENDER + 0.3, S_RENDER + 3, "Footage plays frame-exact, inside any frame."],
  [S_RENDER + 3.1, S_OUTRO - 0.2, "One command renders it, sound included."],
];
const srt = narration.map(([a, b, line], i) => `${i + 1}\n${stamp(a)} --> ${stamp(b)}\n${line}\n`).join("\n");

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  background: "#0b1020",
  layers: [
    react(Fonts, {}),
    series([
      // 1. The reel, extruded from logo.svg, spins into place.
      group(
        [
          three(logo3D(logoSvg, { y: 0.55 }), { background: "#0b1020" }),
          text("Videos, written in TypeScript.", { at: 1.3, y: 300, style: { ...headline, fontSize: 80 }, enter: { type: "fade-up", duration: 0.6 } }),
        ],
        { duration: INTRO },
      ),
      zoom(T.intro),
      // 2. Typing the timeline; the camera follows the caret, then pulls out.
      group(
        [
          group(
            [
              framed(react(Editor, { before: BEFORE, entry: code, after: AFTER }), {
                chrome: "window",
                title: "timeline.ts",
                theme: "dark",
                width: WIN.w,
                height: WIN.h,
                enter: "fade-up",
              }),
            ],
            shots,
          ),
        ],
        { duration: CODE },
      ),
      slide(T.code, { direction: "left" }),
      // 3. The footage in a browser frame, and the render in a terminal over it.
      group(
        [
          framed(video(asset("tour.mp4"), { trim: [1.6, 7.6] }), {
            url: "localhost:5173",
            width: 1240,
            height: 775,
            x: -220,
            y: (t) => -20 + 80 * (1 - spring(t, { damping: 16, stiffness: 90 })),
          }),
          framed(react(Terminal, { frames: Math.round(END * 30), seconds: 3.6 }), {
            chrome: "window",
            title: "Terminal",
            theme: "dark",
            width: 720,
            height: 250,
            x: 520,
            y: 300,
            at: 0.6,
            enter: "fade-up",
          }),
        ],
        { duration: RENDER },
      ),
      zoom(T.render),
      // 4. Call to action, with the reel turning on the left.
      group(
        [
          three(logo3D(logoSvg, { settle: 1 }), { background: "#0b1020", x: -480, scale: 0.9 }),
          text("smashcut", { at: 0.2, x: 330, y: -110, style: { ...headline, fontSize: 200, letterSpacing: -8 }, enter: "fade-up" }),
          text("npx smashcut dev", {
            at: 0.6,
            x: 330,
            y: 80,
            style: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 44, fontWeight: 700, color: "#0b1020", background: "#22d3ee", padding: "18px 40px", borderRadius: 999 },
            enter: "zoom",
          }),
        ],
        { duration: OUTRO },
      ),
    ]),
    subtitles(srt, { preset: "boxed", inset: 40, style: { fontFamily: font, fontSize: 36 } }),
    decor.watermark({ text: "smashcut", corner: "top-right", alpha: 0.5, at: S_CODE + 0.5, duration: S_OUTRO - S_CODE - 0.5, enter: "fade", exit: "fade" }),
    decor.grain({ amount: 0.04 }),
    decor.vignette({ strength: 0.3, size: 0.6 }),
  ],
  audio: [
    // A relaxed strum under the logo, the band for the code, the full groove for the render, then the ending.
    music(
      groove({
        seed: 6,
        key: "G major",
        intensity: [[0, 0.1], [S_CODE, 0.45], [S_RENDER - 0.5, 0.5], [S_RENDER + 0.3, 1]],
        end: MUSIC_END,
      }),
      { fadeIn: 0.3, duck: 0.35 },
    ),
    // Intro: the reel lands.
    sfx.swoosh({ at: 0.05, length: 1.2, volume: 0.35 }),
    sfx.pluck({ at: 1.4, freq: note("D6") }),
    // Code: the camera moves, every keystroke, the pull-out.
    sfx.swoosh({ at: S_CODE - 0.1, length: 0.9, volume: 0.5 }),
    sfx.swoosh({ at: S_CODE + 0.4, length: 0.8, volume: 0.25 }),
    sfx.keys(code, { at: S_CODE, switch: "tactile", volume: 0.7 }),
    sfx.swoosh({ at: S_CODE + code.end, length: 0.9, volume: 0.25 }),
    // Render: the terminal appears, ticks while it counts, and a strum when it's written.
    sfx.swoosh({ at: S_RENDER - 0.1, length: 0.9, volume: 0.5 }),
    sfx.tap({ at: S_RENDER + 0.6 }),
    ...Array.from({ length: 12 }, (_, i) => sfx.tick({ at: S_RENDER + 0.9 + i * 0.3, volume: 0.2 })),
    sfx.strum({ at: S_RENDER + 0.6 + 3.9, root: note("G3") }),
    // Into the call to action.
    sfx.riser({ at: S_OUTRO - 0.9, length: 1, volume: 0.6 }),
  ],
  duration: END,
});
