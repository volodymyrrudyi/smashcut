import {
  chiptune,
  defineVideo,
  dip,
  fade,
  group,
  kf,
  music,
  pattern,
  react,
  series,
  sfx,
  slide,
  solid,
  sound,
  spring,
  text,
  wipe,
  zoom,
  type EffectType,
  type Node,
  type TransitionSpec,
} from "@smashcut/core";
import { Fonts } from "../hello/lib/Fonts";
import { font, theme } from "../hello/lib/theme";
import { Easings, Particles, Springs } from "./lib/Motion";

// Motion in smashcut: every enter / exit effect, every series transition, easings, springs and seeded randomness.
// Each scene says what it shows; the sound effects are cued from the same scene times.

const label = (s: string) =>
  text(s, {
    position: "top-left",
    inset: 48,
    style: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 30, fontWeight: 600, color: "#fff", background: "#0009", padding: "12px 24px", borderRadius: 10 },
    enter: "fade",
  });

// --- 1. Enter / exit effects: one tile per effect, staggered in, all out together --------------------------------
const EFFECTS: EffectType[] = ["fade", "fade-up", "fade-down", "zoom", "slide-left", "slide-right", "wipe"];
const EFFECTS_LEN = 4.4;
const STAGGER = 0.22;
const tiles = EFFECTS.map((effect, i) => {
  const row = i < 4 ? 0 : 1;
  const col = row === 0 ? i : i - 4 + 0.5;
  return text(`"${effect}"`, {
    at: 0.4 + i * STAGGER,
    duration: EFFECTS_LEN - 0.6 - (0.4 + i * STAGGER),
    x: -630 + col * 420,
    y: row === 0 ? -90 : 110,
    style: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 38, fontWeight: 700, color: theme.text, background: "#1e293b", padding: "34px 40px", borderRadius: 18 },
    enter: { type: effect, duration: 0.5 },
    exit: { type: effect, duration: 0.4 },
  });
});

// --- 2. Transitions: each panel is brought in by the transition it's named after ---------------------------------
const PANEL = 1.7;
const panel = (name: string, color: string) =>
  group(
    [
      solid(color),
      text(name, {
        style: { fontFamily: font, fontSize: 120, fontWeight: 800, color: "#fff", letterSpacing: -3 },
        scale: kf([[0, 0.92], [PANEL, 1.04]]),
      }),
    ],
    { duration: PANEL },
  );

// The whole video as one series: [scene, duration] pairs with the transition before each.
const scenes: [TransitionSpec | null, Node, number][] = [
  [null, group([solid(theme.bg), ...tiles, label("enter / exit")]), EFFECTS_LEN],
  [fade(0.5), panel("fade()", "#7c3aed"), PANEL],
  [dip(0.6), panel("dip()", "#db2777"), PANEL],
  [slide(0.6, { direction: "up" }), panel("slide({ direction: \"up\" })", "#0891b2"), PANEL],
  [wipe(0.6, { direction: "right" }), panel("wipe({ direction: \"right\" })", "#ca8a04"), PANEL],
  [zoom(0.6), panel("zoom()", "#16a34a"), PANEL],
  [slide(0.7, { direction: "left", easing: "easeOut" }), group([solid(theme.bg), react(Easings, {}), label("interpolate(t, …, { easing }) · spring()")]), 3.2],
  [fade(0.5), group([solid(theme.bg), react(Springs, {}), label("spring({ damping })")]), 3.0],
  [
    wipe(0.5, { direction: "down" }),
    group([
      solid(theme.bg),
      react(Particles, { count: 180, seed: 7 }),
      text("motion", {
        at: 0.6,
        style: { fontFamily: font, fontSize: 200, fontWeight: 800, color: theme.text, letterSpacing: -6 },
        scale: (t) => spring(t, { from: 0.4, to: 1, delay: 0.6, damping: 9 }),
        enter: { type: "fade", duration: 0.3 },
      }),
      label("rng(seed): random, and identical on every render"),
    ]),
    3.6,
  ],
];

// Scene start times: each starts where the previous one ends, minus the transition overlap.
const starts: number[] = [];
scenes.forEach(([transition], i) => starts.push(i === 0 ? 0 : starts[i - 1] + scenes[i - 1][2] - (transition?.duration ?? 0)));
const END = starts[starts.length - 1] + scenes[scenes.length - 1][2];
const items = scenes.flatMap(([transition, node, duration]) => [
  ...(transition ? [transition] : []),
  { ...node, duration },
]);

// A hand-written 8-bit sting for the final title, on a 16th-note grid.
const sting = pattern("C5 E5 G5 C6 - - - . G5 C6 - - - - - -", { bpm: 150, wave: "square", duty: 0.25, loop: false, volume: 0.14 });

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  background: theme.bg,
  layers: [react(Fonts, {}), series(items)],
  audio: [
    music(chiptune({ seed: 5, mood: "upbeat", key: "C major" }), { volume: 0.55, fadeIn: 0.2, fadeOut: 1.2, duration: starts[8] + 0.6, duck: 0.4 }),
    // A pop per tile as it enters.
    ...EFFECTS.map((_, i) => sfx.pop({ at: 0.4 + i * STAGGER, volume: 0.6 })),
    // An 8-bit whoosh on every transition, timed to where it starts.
    ...scenes.slice(1).map(([transition], i) => sfx.whoosh({ at: starts[i + 1] - 0.05, length: (transition?.duration ?? 0.5) + 0.2, volume: 0.25 })),
    // Blips as the spring balls land.
    ...[0, 1, 2].map((i) => sfx.blip({ at: starts[7] + 0.55 + i * 0.25, freq: 660 * Math.pow(1.25, i) })),
    sound(sting, { at: starts[8] + 0.6, label: "sting" }),
  ],
  duration: END,
});
