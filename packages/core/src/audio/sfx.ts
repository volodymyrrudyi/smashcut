import { addTone, makeStereo, rng, type AudioSource, type Stereo, type ToneOptions } from "./synth";

const source = (duration: number, draw: (out: Stereo, sampleRate: number) => void): AudioSource => ({
  duration,
  render(sampleRate, seconds) {
    const out = makeStereo(Math.ceil(seconds * sampleRate));
    draw(out, sampleRate);
    return out;
  },
});

const blipTone: ToneOptions = { wave: "square", duty: 0.25, env: { attack: 0.001, decay: 0.05, sustain: 0.3, release: 0.04 } };

/** Short rising square blip. */
export const blipSound = (freq = 880, volume = 0.18) =>
  source(0.12, (out, sr) => addTone(out, sr, 0, 0.06, freq, { ...blipTone, slideTo: freq * 1.5, volume }));

/** UI click: a tiny noise tick plus a high square tick. */
export const clickSound = (volume = 0.4) =>
  source(0.06, (out, sr) => {
    addTone(out, sr, 0, 0.012, 9000, { wave: "noise", volume: volume * 0.6, env: { attack: 0.0005, decay: 0.012, sustain: 0, release: 0.005 } });
    addTone(out, sr, 0, 0.02, 1900, { wave: "square", duty: 0.5, volume: volume * 0.35, env: { attack: 0.0005, decay: 0.02, sustain: 0, release: 0.01 } });
  });

/** Bubbly pitch-up pop. */
export const popSound = (volume = 0.35) =>
  source(0.12, (out, sr) =>
    addTone(out, sr, 0, 0.08, 320, { wave: "sine", slideTo: 900, volume, env: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.03 } }),
  );

/** Rising major arpeggio. */
export const chimeSound = (rootFreq = 1046.5, volume = 0.13) =>
  source(0.75, (out, sr) =>
    [0, 4, 7, 12].forEach((semi, i) =>
      addTone(out, sr, i * 0.06, 0.08, rootFreq * Math.pow(2, semi / 12), {
        wave: "square",
        duty: 0.25,
        volume,
        pan: -0.3 + i * 0.2,
        env: { attack: 0.002, decay: 0.08, sustain: 0.5, release: 0.35 },
      }),
    ),
  );

/** Filtered noise swell for transitions; `duration` in seconds. */
export const whooshSound = (duration = 0.6, volume = 0.3) => ({
  duration,
  render(sampleRate: number, seconds: number): Stereo {
    const out = makeStereo(Math.ceil(seconds * sampleRate));
    const random = rng(7);
    const n = Math.min(out[0].length, Math.round(duration * sampleRate));
    let low = 0;
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const shape = Math.sin(Math.PI * p);
      // One-pole low-pass whose cutoff sweeps up then down, so the noise "moves past".
      const cutoff = 200 + 5000 * shape * shape;
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      low += a * (random() * 2 - 1 - low);
      const v = low * shape * volume * 2.2;
      out[0][i] += v * (1 - p * 0.6);
      out[1][i] += v * (0.4 + p * 0.6);
    }
    return out;
  },
});
