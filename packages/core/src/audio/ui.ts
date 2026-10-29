import { addInto, biquad, reverb } from "./fx";
import { fmNote, stringNote } from "./instruments";
import { makeStereo, rng, type AudioSource, type Stereo } from "./synth";

/** A sound effect with its own short reverb tail, so it sits in the same space as `modern()` music. */
const spaced = (duration: number, draw: (out: Stereo, sampleRate: number) => void, wet = 0.25): AudioSource => ({
  duration: duration + 1,
  render(sampleRate, seconds) {
    const out = makeStereo(Math.ceil(seconds * sampleRate));
    draw(out, sampleRate);
    addInto(out, reverb(out, sampleRate, { room: 0.75, damping: 0.5 }), wet);
    return out;
  },
});

/** Glassy pitched tap: soft UI feedback that can follow the music's key. */
export const tapSound = (freq = 1568, volume = 0.16) =>
  spaced(0.3, (out, sr) => fmNote(out, sr, 0, freq, { preset: "glass", volume, decay: 0.12 }));

/** Soft click: a short high sine blip with a breath of noise. Subtler than `clickSound`. */
export const tickSound = (volume = 0.25) =>
  spaced(
    0.03,
    (out, sr) => {
      const random = rng(5);
      const n = Math.ceil(0.03 * sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const v = Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t / 0.005) + (random() * 2 - 1) * 0.3 * Math.exp(-t / 0.002);
        out[0][i] += v * volume;
        out[1][i] += v * volume;
      }
    },
    0.12,
  );

/** FM-bell arpeggio (root, third, fifth, octave): a gentle "done" / success cue. */
export const bellSound = (rootFreq = 1046.5, volume = 0.09) =>
  spaced(
    0.6,
    (out, sr) =>
      [0, 4, 7, 12].forEach((semi, i) =>
        fmNote(out, sr, i * 0.07, rootFreq * Math.pow(2, semi / 12), { preset: "bell", volume, pan: -0.3 + i * 0.2, decay: 0.7 }),
      ),
    0.35,
  );

/** Airy band-passed noise that sweeps across the stereo field, for transitions. */
export const swooshSound = (length = 0.8, volume = 0.22) =>
  spaced(
    length,
    (out, sr) => {
      const n = Math.ceil(length * sr);
      const random = rng(13);
      const noise = new Float32Array(n);
      for (let i = 0; i < n; i++) noise[i] = random() * 2 - 1;
      biquad(noise, sr, "bandpass", (i) => 500 + 2600 * Math.sin((Math.PI * i) / n) ** 2, 0.7);
      for (let i = 0; i < n; i++) {
        const p = i / n;
        const v = noise[i] * Math.sin(Math.PI * p) ** 1.5 * volume * 2.5;
        out[0][i] += v * (1 - 0.7 * p);
        out[1][i] += v * (0.3 + 0.7 * p);
      }
    },
    0.3,
  );

/** Build-up that peaks exactly at `length` seconds: place it at (moment − length). */
export const riserSound = (length = 1.2, volume = 0.18) =>
  spaced(
    length,
    (out, sr) => {
      const n = Math.ceil(length * sr);
      const random = rng(17);
      const noise = new Float32Array(n);
      for (let i = 0; i < n; i++) noise[i] = random() * 2 - 1;
      biquad(noise, sr, "highpass", (i) => 300 * Math.pow(25, i / n), 0.8);
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const p = i / n;
        const swell = p * p;
        const tone = Math.sin(phase) * 0.35;
        phase += (2 * Math.PI * (220 * Math.pow(4, p))) / sr;
        const v = (noise[i] * 0.8 + tone) * swell * volume;
        out[0][i] += v;
        out[1][i] += v;
      }
    },
    0.4,
  );

/** One soft plucked-string note: a notification that matches `groove()` instead of a glassy chime. */
export const pluckSound = (freq = 659.3, volume = 0.3) =>
  spaced(0.5, (out, sr) => stringNote(out, sr, 0, freq, { volume, ring: 0.45, brightness: 0.45, seed: 11 }), 0.15);

/** A quick downstroke strum of a major chord (root, fifth, octave, third, fifth): a warm "done", not a bell. */
export const strumSound = (rootFreq = 146.8, volume = 0.22) =>
  spaced(
    1.2,
    (out, sr) =>
      [0, 7, 12, 16, 19].forEach((semi, k) =>
        stringNote(out, sr, k * 0.014, rootFreq * Math.pow(2, semi / 12), {
          volume: volume * (1 - k * 0.06),
          ring: 1.1,
          brightness: 0.6,
          pan: (k / 4 - 0.5) * 0.5,
          seed: 21 + k,
        }),
      ),
    0.2,
  );

/** A low, dull muted pluck: something went wrong (without being alarming). */
export const thudSound = (freq = 98, volume = 0.6) =>
  spaced(0.3, (out, sr) => stringNote(out, sr, 0, freq, { volume, ring: 0.18, brightness: 0.2, seed: 31 }), 0.1);
