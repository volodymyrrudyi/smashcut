import type { Typing } from "../typing";
import { keyboardSound, type KeyboardOptions } from "./keyboard";
import { sound, type SoundOptions } from "./mix";
import { blipSound, chimeSound, clickSound, popSound, whooshSound } from "./sfx";
import { bellSound, pluckSound, riserSound, strumSound, swooshSound, tapSound, thudSound, tickSound } from "./ui";

export * from "./synth";
export * from "./drums";
export * from "./chiptune";
export * from "./fx";
export * from "./instruments";
export * from "./modern";
export * from "./ambient";
export * from "./groove";
export * from "./mix";
export * from "./keyboard";
export { blipSound, chimeSound, clickSound, popSound, whooshSound };
export { bellSound, pluckSound, riserSound, strumSound, swooshSound, tapSound, thudSound, tickSound };

type SfxOptions = SoundOptions & { at: number };

/** Ready-made timeline sound effects: `sfx.tick({ at: 7.05 })`. */
export const sfx = {
  // Soft, reverb-tailed set that matches `modern()` music.
  tap: ({ freq, ...o }: SfxOptions & { freq?: number }) => sound(tapSound(freq), { label: "tap", ...o }),
  tick: (o: SfxOptions) => sound(tickSound(), { label: "tick", ...o }),
  bell: ({ freq, ...o }: SfxOptions & { freq?: number }) => sound(bellSound(freq), { label: "bell", ...o }),
  swoosh: ({ length, ...o }: SfxOptions & { length?: number }) => sound(swooshSound(length), { label: "swoosh", ...o }),
  /** Peaks at `at + length`. */
  riser: ({ length, ...o }: SfxOptions & { length?: number }) => sound(riserSound(length), { label: "riser", ...o }),

  // Plucked-string set that matches `groove()`: no bells or glass.
  pluck: ({ freq, ...o }: SfxOptions & { freq?: number }) => sound(pluckSound(freq), { label: "pluck", ...o }),
  /** A quick major-chord strum on `root` (Hz): a warm "done". */
  strum: ({ root, ...o }: SfxOptions & { root?: number }) => sound(strumSound(root), { label: "strum", ...o }),
  thud: ({ freq, ...o }: SfxOptions & { freq?: number }) => sound(thudSound(freq), { label: "thud", ...o }),

  // 8-bit set that matches `chiptune()` music.
  blip: ({ freq, ...o }: SfxOptions & { freq?: number }) => sound(blipSound(freq), { label: "blip", ...o }),
  click: (o: SfxOptions) => sound(clickSound(), { label: "click", ...o }),
  pop: (o: SfxOptions) => sound(popSound(), { label: "pop", ...o }),
  chime: ({ freq, ...o }: SfxOptions & { freq?: number }) => sound(chimeSound(freq), { label: "chime", ...o }),
  whoosh: ({ length, ...o }: SfxOptions & { length?: number }) => sound(whooshSound(length), { label: "whoosh", ...o }),

  /**
   * Keystrokes for a `typing()` animation. `at` is where the clip showing the typing starts on the
   * timeline; the sound then lines up with every character.
   */
  keys: (entry: Typing, { at, switch: sw, seed, volume, tone, ...o }: SfxOptions & KeyboardOptions) =>
    sound(
      keyboardSound(
        entry.keystrokes.map((k) => ({ ...k, time: k.time - entry.at })),
        { switch: sw, seed, volume, tone },
      ),
      { label: "keys", ...o, at: at + entry.at },
    ),
};
