import { addTone, type Stereo } from "./synth";

export type Drum = "kick" | "snare" | "hat" | "openhat";

/** Chip-style drum hits built from a pitch-dropping triangle and LFSR noise. */
export function addDrum(out: Stereo, sampleRate: number, at: number, drum: Drum, volume = 1) {
  switch (drum) {
    case "kick":
      addTone(out, sampleRate, at, 0.12, 170, {
        wave: "triangle",
        slideTo: 40,
        volume: 0.55 * volume,
        env: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 },
      });
      break;
    case "snare":
      addTone(out, sampleRate, at, 0.14, 5200, {
        wave: "noise",
        volume: 0.22 * volume,
        env: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.02 },
      });
      addTone(out, sampleRate, at, 0.05, 220, {
        wave: "triangle",
        slideTo: 120,
        volume: 0.25 * volume,
        env: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 },
      });
      break;
    case "hat":
      addTone(out, sampleRate, at, 0.035, 18000, {
        wave: "noise",
        volume: 0.08 * volume,
        pan: 0.25,
        env: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.01 },
      });
      break;
    case "openhat":
      addTone(out, sampleRate, at, 0.16, 16000, {
        wave: "noise",
        volume: 0.07 * volume,
        pan: 0.25,
        env: { attack: 0.002, decay: 0.16, sustain: 0, release: 0.03 },
      });
      break;
  }
}
