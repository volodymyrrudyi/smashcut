/** Two channels of float samples in -1..1. */
export type Stereo = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

export const makeStereo = (length: number): Stereo => [new Float32Array(length), new Float32Array(length)];

/** Deterministic PRNG so generated music is identical on every render. */
export function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" → 69, "C#3" → 49, "Bb2" → 46. */
export function noteToMidi(note: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim());
  if (!m) throw new Error(`Invalid note "${note}"`);
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1].toUpperCase()] + accidental;
}

export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export type Wave = "square" | "triangle" | "saw" | "sine" | "noise";

export interface Envelope {
  /** Seconds. */
  attack: number;
  decay: number;
  /** Level 0..1 held while the note is on. */
  sustain: number;
  /** Seconds after the note ends. */
  release: number;
}

export interface ToneOptions {
  wave?: Wave;
  /** Square pulse width: 0.125, 0.25 and 0.5 are the classic NES settings. */
  duty?: number;
  volume?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  env?: Partial<Envelope>;
  /** Frequency the pitch glides to by the end of the note. */
  slideTo?: number;
  /** Pitch wobble: rate in Hz, depth in semitones, starting after `delay` seconds. */
  vibrato?: { rate: number; depth: number; delay?: number };
  /** Semitone offsets cycled rapidly to fake a chord on one channel. */
  arp?: number[];
  /** Arpeggio steps per second. Default 50 (one per NES frame-ish tick). */
  arpRate?: number;
}

const DEFAULT_ENV: Envelope = { attack: 0.005, decay: 0.08, sustain: 0.7, release: 0.06 };

function envelopeAt(e: Envelope, t: number, gate: number): number {
  const held = (x: number) =>
    x < e.attack ? x / e.attack : x < e.attack + e.decay ? 1 - ((1 - e.sustain) * (x - e.attack)) / e.decay : e.sustain;
  if (t < gate) return held(t);
  if (e.release <= 0) return 0;
  return Math.max(0, held(gate) * (1 - (t - gate) / e.release));
}

/** NES-style 15-bit linear-feedback shift register noise. */
function lfsr() {
  let reg = 1;
  return () => {
    const bit = (reg ^ (reg >> 1)) & 1;
    reg = (reg >> 1) | (bit << 14);
    return reg & 1 ? 1 : -1;
  };
}

/** Mix one note into `out`. `start` and `length` (gate time) are in seconds. */
export function addTone(out: Stereo, sampleRate: number, start: number, length: number, freq: number, opts: ToneOptions = {}) {
  const env = { ...DEFAULT_ENV, ...opts.env };
  const wave = opts.wave ?? "square";
  const duty = opts.duty ?? 0.5;
  const volume = opts.volume ?? 0.2;
  const angle = (((opts.pan ?? 0) + 1) * Math.PI) / 4;
  const gainL = Math.cos(angle) * Math.SQRT2 * volume;
  const gainR = Math.sin(angle) * Math.SQRT2 * volume;
  const arp = opts.arp;
  const arpRate = opts.arpRate ?? 50;
  const vib = opts.vibrato;
  const noise = lfsr();

  const first = Math.max(0, Math.round(start * sampleRate));
  const last = Math.min(out[0].length, Math.round((start + length + env.release) * sampleRate));
  let phase = 0;
  let noiseValue = 1;
  for (let i = first; i < last; i++) {
    const t = i / sampleRate - start;
    let f = opts.slideTo ? freq * Math.pow(opts.slideTo / freq, Math.min(1, t / length)) : freq;
    let semis = arp ? arp[Math.floor(t * arpRate) % arp.length] : 0;
    if (vib && t > (vib.delay ?? 0)) semis += vib.depth * Math.sin(2 * Math.PI * vib.rate * (t - (vib.delay ?? 0)));
    if (semis) f *= Math.pow(2, semis / 12);

    phase += f / sampleRate;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      if (wave === "noise") noiseValue = noise();
    }

    let v: number;
    switch (wave) {
      case "square":
        v = phase < duty ? 1 : -1;
        break;
      case "triangle":
        // 4-bit stepped triangle, like the NES triangle channel.
        v = Math.round((4 * Math.abs(phase - 0.5) - 1 + 1) * 7.5) / 7.5 - 1;
        break;
      case "saw":
        v = 2 * phase - 1;
        break;
      case "sine":
        v = Math.sin(2 * Math.PI * phase);
        break;
      case "noise":
        v = noiseValue;
        break;
    }
    const e = envelopeAt(env, t, length);
    out[0][i] += v * e * gainL;
    out[1][i] += v * e * gainR;
  }
}

/** Anything that can render itself to samples: a song, a sound effect, a layer of both. */
export interface AudioSource {
  /** Natural length in seconds; undefined = endless, fills whatever clip it is placed in. */
  duration?: number;
  render(sampleRate: number, seconds: number): Stereo;
}

/** Layer several sources into one. */
export function layer(...sources: AudioSource[]): AudioSource {
  const durations = sources.map((s) => s.duration);
  return {
    duration: durations.some((d) => d === undefined) ? undefined : Math.max(...(durations as number[])),
    render(sampleRate, seconds) {
      const out = makeStereo(Math.ceil(seconds * sampleRate));
      for (const s of sources) {
        const [l, r] = s.render(sampleRate, seconds);
        for (let i = 0; i < out[0].length; i++) {
          out[0][i] += l[i] ?? 0;
          out[1][i] += r[i] ?? 0;
        }
      }
      return out;
    },
  };
}

export interface PatternOptions extends ToneOptions {
  bpm?: number;
  /** Grid resolution. Default 4 (16th notes). */
  stepsPerBeat?: number;
  /** Repeat to fill the clip. Default true. */
  loop?: boolean;
}

/**
 * A hand-written melody on a step grid: notes ("C4", "F#5"), "." for rest, "-" to hold the previous note.
 * `pattern("C4 - E4 . G4 - - .", { bpm: 120, wave: "square", duty: 0.25 })`
 */
export function pattern(steps: string, opts: PatternOptions = {}): AudioSource {
  const { bpm = 120, stepsPerBeat = 4, loop = true, ...tone } = opts;
  const step = 60 / bpm / stepsPerBeat;
  const tokens = steps.split(/\s+/).filter((s) => s && s !== "|");
  const notes: { at: number; steps: number; freq: number }[] = [];
  tokens.forEach((tok, i) => {
    if (tok === ".") return;
    if (tok === "-") {
      if (notes.length && notes[notes.length - 1].at + notes[notes.length - 1].steps === i) notes[notes.length - 1].steps++;
      return;
    }
    notes.push({ at: i, steps: 1, freq: midiToFreq(noteToMidi(tok)) });
  });
  const loopLength = tokens.length * step;
  return {
    duration: loop ? undefined : loopLength,
    render(sampleRate, seconds) {
      const out = makeStereo(Math.ceil(seconds * sampleRate));
      for (let offset = 0; offset < seconds; offset += loopLength) {
        for (const n of notes) addTone(out, sampleRate, offset + n.at * step, n.steps * step * 0.95, n.freq, tone);
        if (!loop) break;
      }
      return out;
    },
  };
}
