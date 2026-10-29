import {
  decor,
  defineVideo,
  fade,
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
  zoom,
} from "@smashcut/core";
import { Fonts } from "../hello/lib/Fonts";
import { font } from "../hello/lib/theme";
import { Backdrop } from "./lib/Backdrop";
import { StatsScreen } from "./lib/Stats";

// A vertical (9:16) social clip. Every scene starts on a bar line of the music, captions highlight word by
// word, and the music ends on a held chord instead of fading. 30 fps by default; for a smoother upload,
// `npx smashcut render examples/social --fps 60` renders the same timing at 60 fps.

const BAR = grooveBar(); // one bar at 112 bpm, ~2.14 s
const T = 0.4; // transition overlap
const RING = 2.8; // the closing chord rings out for this long
const note = (n: string) => midiToFreq(noteToMidi(n));

// Scene starts in bars: the hook, three tips, two bars of the phone, then the outro on bar 6.
const S = { hook: 0, tips: [1, 2, 3].map((b) => b * BAR), phone: 4 * BAR, outro: 6 * BAR };
const END = S.outro + RING;
/** A scene that lasts `bars` and overlaps the next one by the transition. */
const bars = (n: number) => n * BAR + T;

const big = { fontFamily: font, fontWeight: 800, color: "#fff", letterSpacing: -3, textAlign: "center" as const };
const pop = (delay = 0) => (t: Parameters<typeof spring>[0]) => spring(t, { from: 0.5, to: 1, delay, damping: 10, stiffness: 160 });

const TIPS = [
  ["Write it in", "TypeScript"],
  ["Preview it", "live"],
  ["Render it", "anywhere"],
];
const tip = ([lead, word]: string[], i: number) =>
  group(
    [
      text(String(i + 1), { y: -380, scale: pop(), style: { ...big, fontSize: 300, color: "#a78bfa" } }),
      text(lead, { at: 0.15, y: -40, style: { ...big, fontSize: 110, fontWeight: 600 }, enter: "fade-up" }),
      text(word, { at: 0.3, y: 100, scale: pop(0.3), style: { ...big, fontSize: 150, color: "#22d3ee" } }),
    ],
    { duration: bars(1) },
  );

// Captions, built as SRT from the scene times so they follow any retiming. The "highlight" preset estimates
// word timing from word length.
const stamp = (s: number) => {
  const ms = Math.round(s * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
const lines: [number, number, string][] = [
  [0.2, BAR - 0.1, "Here's how videos get made in code."],
  [S.tips[0] + 0.1, S.tips[1] - 0.1, "Scenes are just functions."],
  [S.tips[1] + 0.1, S.tips[2] - 0.1, "Every change shows up instantly."],
  [S.tips[2] + 0.1, S.phone - 0.1, "Then one command renders the file."],
  [S.phone + 0.2, S.outro - 0.1, "Numbers straight from JSON."],
  [S.outro + 0.2, END - 0.3, "Follow for more."],
];
const srt = lines.map(([a, b, line], i) => `${i + 1}\n${stamp(a)} --> ${stamp(b)}\n${line}\n`).join("\n");

export default defineVideo({
  size: [1080, 1920],
  fps: 30,
  background: "#0b0d12",
  layers: [
    react(Fonts, {}),
    react(Backdrop, {}),
    series([
      group(
        [
          text("Make videos\nwith code", { y: -60, scale: pop(0.1), style: { ...big, fontSize: 150, lineHeight: 1.02 } }),
          text("3 things to know", { at: 0.5, y: 200, style: { ...big, fontSize: 60, fontWeight: 600, color: "#94a3b8", letterSpacing: 0 }, enter: "fade-up" }),
        ],
        { duration: bars(1) },
      ),
      ...TIPS.flatMap((t, i) => [slide(T, { direction: "up" }), tip(t, i)]),
      zoom(T),
      group(
        [
          text("Live data", { position: "top", inset: 150, style: { ...big, fontSize: 90 }, enter: "fade-down" }),
          // A phone showing a full 1170×2532 screen, scaled into the frame. Its chart is fetched from JSON.
          framed(react(StatsScreen, {}), {
            chrome: "phone",
            width: 520,
            viewport: [1170, 2532],
            y: (t) => 10 + 400 * (1 - spring(t, { damping: 15, stiffness: 100 })),
          }),
        ],
        { duration: bars(2) },
      ),
      fade(T),
      group(
        [
          text("Made with\nsmashcut", { y: -140, scale: pop(0.1), style: { ...big, fontSize: 120, lineHeight: 1.02 } }),
          text("npx smashcut dev", {
            at: 0.5,
            y: 110,
            style: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 46, fontWeight: 700, color: "#0b0d12", background: "#22d3ee", padding: "20px 40px", borderRadius: 999 },
            enter: "zoom",
          }),
        ],
        { duration: RING },
      ),
    ]),
    subtitles(srt, { preset: "highlight", inset: 200, highlight: "#facc15", style: { fontFamily: font, fontSize: 64, maxWidth: 980 } }),
    decor.watermark({ text: "@smashcut", corner: "top-right", margin: 56, size: 40 }),
    decor.vignette({ strength: 0.35 }),
  ],
  audio: [
    // The band stops on bar 6 and a held home chord rings out under the outro.
    music(groove({ seed: 3, key: "E major", intensity: [[0, 0.3], [BAR, 0.6], [S.phone, 1]], end: S.outro }), { fadeIn: 0.2, duck: 0.3 }),
    sfx.pluck({ at: 0.15, freq: note("E5") }),
    ...S.tips.flatMap((at, i) => [sfx.swoosh({ at: at - T, length: 0.6, volume: 0.4 }), sfx.pop({ at: at + 0.05 }), sfx.pluck({ at: at + 0.35, freq: note(["G#5", "B5", "E6"][i]) })]),
    sfx.swoosh({ at: S.phone - T, length: 0.8, volume: 0.4 }),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => sfx.tick({ at: S.phone + 0.4 + i * 0.12, volume: 0.35 })),
    sfx.pop({ at: S.outro + 0.15 }),
  ],
  duration: END,
});
