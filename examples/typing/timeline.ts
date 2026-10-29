import {
  camera,
  defineVideo,
  groove,
  group,
  midiToFreq,
  music,
  noteToMidi,
  react,
  series,
  sfx,
  slide,
  text,
  typing,
  type KeySwitch,
  type Typing,
  type Typo,
} from "@smashcut/core";
import { Background } from "../hello/lib/Background";
import { Fonts } from "../hello/lib/Fonts";
import { font, paper } from "../hello/lib/theme";
import { Form, fieldFocus } from "./lib/Form";

const LABELS = ["Customer", "PO number", "Order total, USD", "Notes"];
const GAP = 0.85; // seconds between one field's last key and the next field's first
const note = (n: string) => midiToFreq(noteToMidi(n));

/** Type `values` into consecutive fields, starting at `at` (clip-local seconds). */
function entries(values: string[], at: number, seed: number, typos: (Typo[] | undefined)[] = []): Typing[] {
  const out: Typing[] = [];
  values.forEach((value, i) => {
    const start = i === 0 ? at : out[i - 1].end + GAP;
    out.push(typing(value, { at: start, cps: 13, seed: seed + i, caret: "|", typos: typos[i] }));
  });
  return out;
}

const caption = (s: string) =>
  text(s, {
    position: "bottom-left",
    inset: 48,
    style: { fontFamily: font, fontSize: 34, fontWeight: 700, color: "#fff", background: paper.text, padding: "14px 28px", borderRadius: 12 },
    enter: "fade-up",
  });

// Scene 1: plain field entry, every field on a different switch. The PO number gets a typo that is noticed
// two characters later, backspaced and retyped.
const SWITCHES: KeySwitch[] = ["linear", "tactile", "clicky", "membrane"];
const NAMES = { linear: "MX Red", tactile: "MX Brown", clicky: "MX Blue", membrane: "laptop" };
const one = entries(["Ridgeway Electric Inc.", "PO-58221", "8,141.00", "Rush: deliver by Friday"], 0.9, 1, [
  undefined,
  [{ at: 4, wrong: "9", notice: 2 }],
]);
const submit1 = one[3].end + 0.7;
const D1 = submit1 + 1.6;

// Scene 2: the camera follows the typing. Zoom into the customer field, pan to the PO number,
// then pull back out for the rest of the form.
const two = entries(["Lakeside Logistics", "PO-58307", "1,240.00", "Split delivery OK"], 1.5, 11);
const submit2 = two[3].end + 0.7;
const D2 = submit2 + 1.6;
const ZOOM = 2.2;
const shots = camera([
  [0.5, { scale: 1 }],
  [1.3, { ...fieldFocus(0), scale: ZOOM }],
  [two[0].end + 0.25, { ...fieldFocus(0), scale: ZOOM }],
  [two[1].at - 0.1, { ...fieldFocus(1), scale: ZOOM }],
  [two[1].end + 0.35, { ...fieldFocus(1), scale: ZOOM }],
  [two[1].end + 1.15, { scale: 1 }],
]);

const TRANSITION = 0.8;
const S2 = D1 - TRANSITION;

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
          react(Form, {
            title: "New sales order",
            fields: one.map((entry, i) => ({ label: `${LABELS[i]} · ${NAMES[SWITCHES[i]]}`, entry })),
            submitAt: submit1,
          }),
          caption("Field entry: four switches, one typo"),
        ],
        { duration: D1 },
      ),
      slide(TRANSITION, { direction: "left" }),
      group(
        [
          group([react(Form, { title: "New sales order", fields: two.map((entry, i) => ({ label: LABELS[i], entry })), submitAt: submit2 })], shots),
          caption("Field entry + camera"),
        ],
        { duration: D2 },
      ),
    ]),
  ],
  audio: [
    music(groove({ seed: 2, key: "D major", intensity: 0.5 }), { fadeIn: 0.5, fadeOut: 1.5, duck: 0.35 }),
    // Scene 1: each field on its own switch (the typo's backspaces get their own key sound).
    ...one.map((entry, i) => sfx.keys(entry, { at: 0, switch: SWITCHES[i], volume: 0.7 })),
    sfx.tick({ at: submit1 }),
    sfx.strum({ at: submit1 + 0.3, root: note("D3") }),
    sfx.swoosh({ at: S2 - 0.1, length: 0.9 }),
    // Scene 2 on clicky switches.
    ...two.map((entry) => sfx.keys(entry, { at: S2, switch: "clicky", volume: 0.7 })),
    // Soft air for the camera moves in and out.
    sfx.swoosh({ at: S2 + 0.5, length: 0.8, volume: 0.35 }),
    sfx.swoosh({ at: S2 + two[1].end + 0.35, length: 0.8, volume: 0.35 }),
    sfx.tick({ at: S2 + submit2 }),
    sfx.strum({ at: S2 + submit2 + 0.3, root: note("A2") }),
  ],
});
