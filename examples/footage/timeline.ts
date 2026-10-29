import { defineVideo, groove, group, midiToFreq, music, noteToMidi, react, series, sfx, slide, spring, text, zoom } from "@smashcut/core";
import { Background } from "../hello/lib/Background";
import { Fonts } from "../hello/lib/Fonts";
import { font, paper } from "../hello/lib/theme";
import { browser } from "./lib/browser";
import { STEPS, TYPED, VIEW_MS } from "./lib/tour";

// A tour of a small task board cut from one screen recording (assets/tour.mp4, made by capture.ts from
// site/index.html). Each scene trims the slice it needs; one plays at double speed, and the outro loops a slice.
type Slice = { trim: [number, number]; playbackRate?: number };
const A: Slice = { trim: [1.6, 7.6] }; // "+ New task", the title and label typed, "Create task"
const B: Slice = { trim: [8.0, 11.2], playbackRate: 2 }; // the card moves to "In progress", then "Done", at 2×
const C: Slice = { trim: [11.1, 14.6] }; // the Insights tab slides in, bars and counters grow
const LOOP: Slice = { trim: [11.5, 13.3] }; // the bars growing, over and over in the outro

const INTRO = 2.2;
const OUTRO = 4;
/** Timeline seconds a slice plays for. */
const len = ({ trim: [a, b], playbackRate = 1 }: Slice) => (b - a) / playbackRate;
// Scene start times: each starts where the previous one ends, minus the transition overlap.
const SA = INTRO - 0.6;
const SB = SA + len(A) - 0.8;
const SC = SB + len(B) - 0.8;
const SD = SC + len(C) - 0.8;
/** Timeline time of a moment in the recording, as shown by the slice starting at `start`. */
const at = (slice: Slice, start: number, t: number) => start + (t - slice.trim[0]) / (slice.playbackRate ?? 1);

const note = (n: string) => midiToFreq(noteToMidi(n));
const headline = { fontFamily: font, color: paper.text, fontWeight: 800, letterSpacing: -1.5 };

const caption = (s: string) =>
  text(s, { position: "top", inset: 52, style: { ...headline, fontSize: 60 }, enter: { type: "fade-up", duration: 0.6 } });
const badge = (s: string) =>
  text(s, {
    at: 0.4,
    position: "bottom-right",
    inset: 60,
    style: { fontFamily: font, fontSize: 30, fontWeight: 800, color: "#fff", background: paper.accent, padding: "10px 22px", borderRadius: 999 },
    enter: "zoom",
  });

// The browser window sits below the caption and springs up into place.
const rise = { y: (t: Parameters<typeof spring>[0]) => 70 + 90 * (1 - spring(t, { damping: 16, stiffness: 90 })) };

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  background: paper.bg,
  layers: [
    react(Fonts, {}),
    react(Background, {}),
    series([
      group(
        [
          text("Board", { y: -60, style: { ...headline, fontSize: 150 }, scale: (t) => spring(t, { from: 0.7, damping: 12 }) }),
          text("A quick tour, cut from one recording", {
            at: 0.5,
            y: 70,
            style: { fontFamily: font, fontSize: 44, fontWeight: 500, color: paper.muted },
            enter: "fade-up",
          }),
        ],
        { duration: INTRO },
      ),
      zoom(0.6),
      group([caption("Add a task in seconds."), browser(A, { ...rise, duration: len(A) })], { duration: len(A) }),
      slide(0.8, { direction: "left" }),
      group([caption("Move it along to done."), browser(B, { ...rise, duration: len(B) }), badge("2× speed")], { duration: len(B) }),
      slide(0.8, { direction: "left" }),
      group([caption("See how the week went."), browser(C, { ...rise, duration: len(C) })], { duration: len(C) }),
      zoom(0.8),
      group(
        [
          text("Plan less.\nShip more.", {
            at: 0.2,
            x: -470,
            y: -40,
            style: { ...headline, fontSize: 96, lineHeight: 1.05, textAlign: "left" },
            enter: "fade-up",
          }),
          text("example.com/board", {
            at: 0.6,
            x: -540,
            y: 160,
            style: { fontFamily: font, fontSize: 36, fontWeight: 700, color: "#fff", background: paper.accent, padding: "16px 40px", borderRadius: 999 },
            enter: "zoom",
          }),
          // Picture-in-picture: the bars growing, looped for as long as the outro lasts.
          browser(
            { ...LOOP, loop: true },
            { at: 0.3, duration: OUTRO - 0.3, x: 400, scale: 0.6, rotate: -2, enter: { type: "fade-up", duration: 0.7 } },
          ),
        ],
        { duration: OUTRO },
      ),
    ]),
  ],
  audio: [
    music(groove({ seed: 2, key: "C major", intensity: 0.5 }), { fadeIn: 0.5, fadeOut: 1.5, duck: 0.35 }),
    sfx.pluck({ at: 0.05, freq: note("G5") }),
    sfx.swoosh({ at: SA - 0.15, length: 0.9 }),
    // Clicks inside the recording, the drawer sliding in, and soft keys while the page types.
    sfx.tick({ at: at(A, SA, STEPS[0].at) }),
    sfx.swoosh({ at: at(A, SA, STEPS[0].at), length: 0.6, volume: 0.4 }),
    ...Array.from({ length: 22 }, (_, i) => sfx.tick({ at: at(A, SA, TYPED.from) + i * ((TYPED.to - TYPED.from) / 22), volume: 0.25 })),
    sfx.tick({ at: at(A, SA, STEPS[1].at) }),
    sfx.pluck({ at: at(A, SA, STEPS[1].at) + 0.2, freq: note("E5") }),
    sfx.swoosh({ at: SB - 0.15, length: 1 }),
    // The card lands in "In progress", then in "Done" (the page moves it 450 ms after each step).
    sfx.pluck({ at: at(B, SB, STEPS[2].at + 0.45), freq: note("G5"), volume: 0.8 }),
    sfx.strum({ at: at(B, SB, STEPS[2].at + 1.95), root: note("C3") }),
    sfx.swoosh({ at: SC - 0.15, length: 1 }),
    sfx.swoosh({ at: at(C, SC, STEPS[3].at), length: VIEW_MS / 1000, volume: 0.4 }),
    sfx.riser({ at: SD - 0.9, length: 1 }),
    sfx.strum({ at: SD + 0.7, root: note("C3") }),
  ],
});
