import { biquad } from "./fx";
import { rng, type Stereo } from "./synth";

const TAU = 2 * Math.PI;

/** Add a mono buffer into `out` at `start` seconds with constant-power panning. */
function place(out: Stereo, sampleRate: number, start: number, mono: Float32Array, volume: number, pan = 0) {
  const angle = ((pan + 1) * Math.PI) / 4;
  const gl = Math.cos(angle) * Math.SQRT2 * volume;
  const gr = Math.sin(angle) * Math.SQRT2 * volume;
  const first = Math.round(start * sampleRate);
  const n = Math.min(mono.length, out[0].length - first);
  for (let i = Math.max(0, -first); i < n; i++) {
    out[0][first + i] += mono[i] * gl;
    out[1][first + i] += mono[i] * gr;
  }
}

const noiseBuffer = (length: number, seed: number) => {
  const random = rng(seed);
  const b = new Float32Array(length);
  for (let i = 0; i < length; i++) b[i] = random() * 2 - 1;
  return b;
};

export interface FmOptions {
  /** Modulator / carrier frequency ratio: integers sound harmonic, non-integers bell-like. */
  ratio: number;
  /** Brightness of the attack. */
  index: number;
  /** Seconds for the brightness to fade. */
  indexDecay: number;
  /** Seconds for the volume to fall to ~37%. */
  decay: number;
}

export const FM_PRESETS = {
  marimba: { ratio: 4, index: 2.2, indexDecay: 0.035, decay: 0.32 },
  pluck: { ratio: 1, index: 2.0, indexDecay: 0.12, decay: 0.45 },
  bell: { ratio: 3.5, index: 3.2, indexDecay: 0.6, decay: 1.3 },
  glass: { ratio: 7, index: 1.2, indexDecay: 0.08, decay: 0.45 },
} satisfies Record<string, FmOptions>;

export type FmPreset = keyof typeof FM_PRESETS;

/** Two-operator FM note: mallets, plucks, bells and glassy taps. */
export function fmNote(
  out: Stereo,
  sampleRate: number,
  start: number,
  freq: number,
  opts: Partial<FmOptions> & { preset?: FmPreset; volume?: number; pan?: number } = {},
) {
  const p = { ...FM_PRESETS[opts.preset ?? "pluck"], ...opts };
  const attack = 0.002;
  const mono = new Float32Array(Math.ceil((attack + p.decay * 5) * sampleRate));
  let carrier = 0;
  let modulator = 0;
  for (let i = 0; i < mono.length; i++) {
    const t = i / sampleRate;
    const amp = t < attack ? t / attack : Math.exp(-(t - attack) / p.decay);
    const index = p.index * Math.exp(-t / p.indexDecay);
    mono[i] = amp * Math.sin(carrier + index * Math.sin(modulator));
    carrier += (TAU * freq) / sampleRate;
    modulator += (TAU * freq * p.ratio) / sampleRate;
  }
  place(out, sampleRate, start, mono, opts.volume ?? 0.15, opts.pan ?? 0);
}

/** Band-limited sawtooth correction (PolyBLEP), so pads stay smooth instead of buzzy. */
function polyBlep(t: number, dt: number) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export interface PadOptions {
  volume?: number;
  pan?: number;
  /** Semitones between the detuned voices. */
  detune?: number;
  attack?: number;
  release?: number;
  /** Low-pass cutoff opens from the first value to the second over the note. */
  cutoff?: [number, number];
}

/** Warm pad: three detuned saws spread across the stereo field, through an opening low-pass filter. */
export function padNote(out: Stereo, sampleRate: number, start: number, length: number, freq: number, opts: PadOptions = {}) {
  const { volume = 0.04, detune = 0.1, attack = 0.45, release = 0.8, cutoff = [400, 1800] } = opts;
  const n = Math.ceil((length + release) * sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const random = rng(Math.round(freq * 1000 + start * 977));
  const voices = [-detune, 0, detune].map((semi) => ({
    phase: random(),
    inc: (freq * Math.pow(2, semi / 12)) / sampleRate,
  }));
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env =
      t < attack ? (1 - Math.cos((Math.PI * t) / attack)) / 2
      : t < length ? 1
      : Math.exp((-(t - length) / release) * 4);
    const s = voices.map((v) => {
      const value = 2 * v.phase - 1 - polyBlep(v.phase, v.inc);
      v.phase += v.inc;
      if (v.phase >= 1) v.phase -= 1;
      return value;
    });
    left[i] = (s[0] + 0.7 * s[1]) * env;
    right[i] = (s[2] + 0.7 * s[1]) * env;
  }
  const sweep = (i: number) => cutoff[0] + (cutoff[1] - cutoff[0]) * Math.min(1, i / (length * sampleRate * 0.7));
  // Two stages = 24 dB/octave: warm rather than buzzy.
  for (const ch of [left, right]) {
    biquad(ch, sampleRate, "lowpass", sweep, 0.7);
    biquad(ch, sampleRate, "lowpass", sweep, 0.7);
  }
  const pan = opts.pan ?? 0;
  place(out, sampleRate, start, left, volume, Math.max(-1, pan - 0.6));
  place(out, sampleRate, start, right, volume, Math.min(1, pan + 0.6));
}

/** Round sub bass: a sine with a touch of second harmonic so it reads on small speakers. */
export function bassNote(out: Stereo, sampleRate: number, start: number, length: number, freq: number, opts: { volume?: number; drive?: number } = {}) {
  const release = 0.06;
  const attack = 0.004;
  const drive = opts.drive ?? 0.25;
  const mono = new Float32Array(Math.ceil((length + release) * sampleRate));
  let phase = 0;
  for (let i = 0; i < mono.length; i++) {
    const t = i / sampleRate;
    const env = t < attack ? t / attack : t < length ? 1 : Math.max(0, 1 - (t - length) / release);
    mono[i] = env * (Math.sin(phase) + drive * Math.sin(2 * phase));
    phase += (TAU * freq) / sampleRate;
  }
  place(out, sampleRate, start, mono, opts.volume ?? 0.17);
}

/** Soft, round kick: a sine with a quick pitch drop and a tiny transient. */
export function softKick(out: Stereo, sampleRate: number, at: number, volume = 0.4) {
  const mono = new Float32Array(Math.ceil(0.4 * sampleRate));
  const click = noiseBuffer(Math.ceil(0.004 * sampleRate), 11);
  let phase = 0;
  for (let i = 0; i < mono.length; i++) {
    const t = i / sampleRate;
    const f = 45 + 80 * Math.exp(-t / 0.03);
    const amp = Math.min(1, t / 0.001) * Math.exp(-t / 0.13);
    mono[i] = amp * Math.sin(phase) + (i < click.length ? click[i] * 0.15 * (1 - i / click.length) : 0);
    phase += (TAU * f) / sampleRate;
  }
  place(out, sampleRate, at, mono, volume);
}

/** High, airy shaker tick. */
export function shaker(out: Stereo, sampleRate: number, at: number, volume = 0.05, pan = 0.3) {
  const mono = noiseBuffer(Math.ceil(0.12 * sampleRate), Math.round(at * 1000) + 3);
  biquad(mono, sampleRate, "highpass", 6500, 0.8);
  for (let i = 0; i < mono.length; i++) {
    const t = i / sampleRate;
    mono[i] *= (t < 0.006 ? t / 0.006 : 1) * Math.exp(-t / 0.035);
  }
  place(out, sampleRate, at, mono, volume, pan);
}

/** Layered hand clap: three quick bursts and a short room tail. */
export function clap(out: Stereo, sampleRate: number, at: number, volume = 0.16) {
  const mono = noiseBuffer(Math.ceil(0.35 * sampleRate), Math.round(at * 1000) + 7);
  biquad(mono, sampleRate, "bandpass", 1400, 1.1);
  for (let i = 0; i < mono.length; i++) {
    const t = i / sampleRate;
    let env = 0;
    for (const b of [0, 0.011, 0.022]) if (t >= b) env = Math.max(env, Math.exp(-(t - b) / 0.006));
    if (t >= 0.03) env = Math.max(env, 0.55 * Math.exp(-(t - 0.03) / 0.09));
    mono[i] *= env;
  }
  place(out, sampleRate, at, mono, volume * 2.5);
}

export interface StringOptions {
  volume?: number;
  pan?: number;
  /** Seconds for the string to ring down by 60 dB. Short = palm-muted. Default 0.9. */
  ring?: number;
  /** 0..1 pick brightness: how much high end the initial pluck has. Default 0.5. */
  brightness?: number;
  /** Seed for the pluck noise, so every note is reproducible. */
  seed?: number;
}

/**
 * Plucked string (Karplus-Strong): a burst of noise circulating in a tuned delay line that loses its highs on
 * every pass. Sounds like a guitar or harp string, not a bell.
 */
export function stringNote(out: Stereo, sampleRate: number, start: number, freq: number, opts: StringOptions = {}) {
  const ring = opts.ring ?? 0.9;
  const period = sampleRate / freq;
  const n = Math.max(2, Math.floor(period));
  // Fractional part of the period, handled by a one-sample allpass, keeps the pitch in tune.
  const frac = period - n;
  const coef = (1 - frac) / (1 + frac);
  const line = noiseBuffer(n, opts.seed ?? Math.round(freq * 1000 + start * 977));
  // A darker pick: pre-filter the initial burst.
  const bright = opts.brightness ?? 0.5;
  for (let pass = 0; pass < Math.round((1 - bright) * 4); pass++) {
    for (let i = 1; i < n; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
  }
  // Each sample in the line is revisited once per period, so the loss applies per pass: freq passes a second,
  // and the string should fall 60 dB in `ring` seconds.
  const loss = Math.pow(10, -3 / (ring * freq));
  const length = Math.ceil((ring + 0.02) * sampleRate);
  const mono = new Float32Array(length);
  let idx = 0;
  let prev = 0;
  let apX = 0;
  let apY = 0;
  for (let i = 0; i < length; i++) {
    const cur = line[idx];
    const next = line[(idx + 1) % n];
    // Averaging two neighbours is the string's lowpass; the allpass fine-tunes the loop length.
    const avg = 0.5 * (cur + next) * loss;
    const y = coef * avg + apX - coef * apY;
    apX = avg;
    apY = y;
    line[idx] = y;
    mono[i] = cur - 0.3 * prev;
    prev = cur;
    idx = (idx + 1) % n;
  }
  // Short fade-out so muted notes don't click.
  const tail = Math.min(length, Math.round(0.01 * sampleRate));
  for (let i = 0; i < tail; i++) mono[length - 1 - i] *= i / tail;
  place(out, sampleRate, start, mono, opts.volume ?? 0.2, opts.pan ?? 0);
}
