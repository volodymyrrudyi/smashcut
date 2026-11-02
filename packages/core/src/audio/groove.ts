import { addInto, biquad, reverb } from "./fx";
import { bassNote, clap, padNote, shaker, softKick, stringNote } from "./instruments";
import { chordTones, composeHarmony, defaultSlots, fold, parseChord, ROOTS, type Mode } from "./harmony";
import { makeStereo, midiToFreq, noteToMidi, rng, type AudioSource } from "./synth";

export interface GrooveOptions {
  /** Different seed → different track. Same seed → the same track, always. */
  seed?: number;
  /**
   * How busy the music is, 0..1, as a constant or `[seconds, level]` keyframes (time from the clip's start).
   * 0: relaxed guitar on the beat over a held bass. ~0.4: kick, shaker, a bouncing bass and busier strumming.
   * 1: claps on the backbeat, 16th hats and warm chord stabs. Default 0.5.
   */
  intensity?: number | [number, number][];
  /** e.g. "G major" or "E minor". Picked from the seed (a major key) when omitted. */
  key?: string;
  /**
   * Chords as Roman numerals, one per bar, e.g. "I IV V" or "I V vi IV"; "blues" is the twelve-bar blues. Picked
   * from the seed when omitted: a verse and a chorus progression from a library of pop progressions.
   */
  progression?: string | string[];
  /** Default 112. */
  bpm?: number;
  /** Bars before the loop repeats; one chord per bar. Default 8 (with `progression`, whole passes of it). */
  bars?: number;
  /**
   * Seconds at which the track ends, snapped to the nearest bar line: the band stops and a held home chord
   * (guitar, bass and kick) rings out, so the music resolves instead of being cut or faded mid-phrase.
   * Leave ~2.5 s after it for the ring-out. Use `grooveBar(bpm)` to place scenes on bar lines.
   */
  end?: number;
}

/** Length of one bar in seconds at `bpm` (default 112), for lining scenes up with `groove()`. */
export const grooveBar = (bpm = 112) => (4 * 60) / bpm;

// Strumming patterns in 8ths: [eighth, downstroke, palm-muted].
const STRUMS: [number, boolean, boolean][][] = [
  // D . D U . U D U: the classic pop strum.
  [[0, true, false], [2, true, true], [3, false, true], [5, false, true], [6, true, false], [7, false, true]],
  // D . D U D U D U: busier, for a lift.
  [[0, true, false], [2, true, false], [3, false, true], [4, true, false], [5, false, true], [6, true, false], [7, false, true]],
  // Offbeat upstrokes over muted downbeats: a skank / island feel.
  [[0, true, true], [1, false, false], [2, true, true], [3, false, false], [4, true, true], [5, false, false], [6, true, true], [7, false, false]],
  // Straight muted eighths with open accents on 1 and the "and" of 2: driving.
  [[0, true, false], [1, true, true], [2, true, true], [3, true, false], [4, true, true], [5, true, true], [6, true, false], [7, true, true]],
];

// Bass lines in 8ths: [eighth, semitones above the chord's root, length in beats].
const BASSLINES: [number, number, number][][] = [
  // Root on the beat, octave on the offbeat, the fifth leading into the next bar.
  [[0, 0, 0.42], [1, 12, 0.42], [2, 0, 0.42], [3, 12, 0.42], [4, 0, 0.42], [5, 12, 0.42], [6, 0, 0.42], [7, 7, 0.42]],
  // Root, root, fifth, octave: a walking bounce.
  [[0, 0, 0.8], [2, 0, 0.42], [3, 7, 0.42], [4, 12, 0.8], [6, 7, 0.42], [7, 0, 0.42]],
  // Syncopated: on 1, the "and" of 2, and 4.
  [[0, 0, 1.3], [3, 0, 0.42], [4, 7, 0.9], [6, 12, 0.42], [7, 7, 0.42]],
];
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function intensityAt(curve: number | [number, number][], t: number): number {
  if (typeof curve === "number") return curve;
  if (!curve.length) return 0;
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, v1] = curve[i];
    if (t <= t1) {
      const [t0, v0] = curve[i - 1];
      return v0 + (v1 - v0) * smoothstep(0, 1, (t - t0) / Math.max(1e-6, t1 - t0));
    }
  }
  return curve[curve.length - 1][1];
}

/**
 * Upbeat, warm product-video groove without bells or chimes: a strummed, partly palm-muted guitar (plucked-string
 * synthesis), a bouncing bass, kick / clap / shaker / hats and short filtered-saw chord stabs. `intensity` builds it
 * up from a relaxed strum to the full band and back, on one key, tempo and chord sequence.
 */
export function groove(opts: GrooveOptions = {}): AudioSource {
  const random = rng((opts.seed ?? 1) * 7349);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];
  const curve = opts.intensity ?? 0.5;
  const [rootName, modeName] = (opts.key ?? `${pick(ROOTS)} major`).split(/\s+/);
  const mode: Mode = modeName === "minor" ? "minor" : "major";
  const root = noteToMidi(`${rootName}3`);
  const bpm = opts.bpm ?? 112;
  const bars = opts.bars ?? defaultSlots(8, opts.progression, mode);
  const beat = 60 / bpm;
  const bar = 4 * beat;
  const harmony = composeHarmony({ random, mode, slots: bars, progression: opts.progression, library: "pop" });
  // The verse and the chorus strum differently, so the chorus lifts.
  const verseStrum = Math.floor(random() * STRUMS.length);
  const chorusStrum = (verseStrum + 1 + Math.floor(random() * (STRUMS.length - 1))) % STRUMS.length;
  const bassline = pick(BASSLINES);

  type Strum = { at: number; notes: number[]; down: boolean; ring: number; velocity: number };
  const sparse: Strum[] = [];
  const busy: Strum[] = [];
  const heldBass: { at: number; length: number; midi: number }[] = [];
  const bounceBass: { at: number; length: number; midi: number }[] = [];
  const kicks: number[] = [];
  const shakers: { at: number; velocity: number }[] = [];
  const claps: number[] = [];
  const hats: { at: number; velocity: number }[] = [];
  const stabs: { at: number; midi: number }[] = [];

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const triad = chordTones(harmony.chords[b], root);
    const pattern = STRUMS[harmony.sections[b] === "B" ? chorusStrum : verseStrum];
    // Guitar voicing: root, fifth, octave, third, fifth on top (an open-ish shape in the guitar's range).
    const shape = [fold(triad[0], 40), fold(triad[2], 47), fold(triad[0], 52), fold(triad[1], 55), fold(triad[2], 59)].sort((a, x) => a - x);

    // Calm: one let-ring downstroke per beat, softer on 2 and 4.
    for (let q = 0; q < 4; q++) sparse.push({ at: t0 + q * beat, notes: shape, down: true, ring: 1.4, velocity: q % 2 ? 0.7 : 1 });
    // Busy: the 8th-note pattern, muted strokes short and quiet.
    for (const [e, down, muted] of pattern) {
      busy.push({ at: t0 + (e * beat) / 2, notes: shape, down, ring: muted ? 0.12 : 0.7, velocity: muted ? 0.6 : 1 });
    }

    heldBass.push({ at: t0, length: bar * 0.95, midi: fold(triad[0], 33) });
    for (const [e, semis, length] of bassline) {
      bounceBass.push({ at: t0 + (e * beat) / 2, length: beat * length, midi: fold(triad[0], 33) + semis });
    }
    for (let q = 0; q < 4; q++) {
      kicks.push(t0 + q * beat);
      shakers.push({ at: t0 + q * beat + beat / 2, velocity: 1 }, { at: t0 + q * beat, velocity: 0.45 });
      if (q % 2 === 1) claps.push(t0 + q * beat);
      for (let s = 0; s < 4; s++) hats.push({ at: t0 + q * beat + (s * beat) / 4, velocity: s === 2 ? 1 : 0.45 });
    }
    // Stabs on the "and" of 2 and 4: the chord's upper notes, short and warm.
    for (const at of [t0 + 1.5 * beat, t0 + 3.5 * beat]) {
      for (const m of [fold(triad[1], 64), fold(triad[2], 67), fold(triad[0], 72)]) stabs.push({ at, midi: m });
    }
  }

  const loopLength = bars * bar;
  const ending = opts.end === undefined ? undefined : Math.max(bar, Math.round(opts.end / bar) * bar);
  // The home chord, voiced like the strums, for the final hit.
  const home = chordTones(parseChord(mode === "minor" ? "i" : "I", mode), root);
  const homeShape = [fold(home[0], 40), fold(home[2], 47), fold(home[0], 52), fold(home[1], 55), fold(home[2], 59)].sort((a, x) => a - x);

  return {
    render(sampleRate, seconds) {
      const n = Math.ceil(seconds * sampleRate);
      const layer = () => makeStereo(n);
      const L = {
        sparse: layer(), busy: layer(), held: layer(), bounce: layer(),
        kick: layer(), shaker: layer(), clap: layer(), hats: layer(), stabs: layer(),
      };
      const level = (t: number) => intensityAt(curve, t);
      let peak = 0;
      for (let t = 0; t < seconds; t += 0.05) peak = Math.max(peak, level(t));

      // Nothing new starts at or after the ending; the final chord is added on its own afterwards.
      const before = (t: number) => ending === undefined || t < ending - 0.001;

      const strum = (out: typeof L.busy, s: Strum, offset: number, base: number) => {
        if (!before(offset + s.at)) return;
        // Strings sound one after another across the stroke (low to high going down, high to low going up).
        const order = s.down ? s.notes : [...s.notes].reverse();
        order.forEach((m, k) =>
          stringNote(out, sampleRate, offset + s.at + k * 0.011, midiToFreq(m), {
            volume: base * s.velocity * (1 - k * 0.06),
            ring: s.ring,
            brightness: s.down ? 0.55 : 0.7,
            pan: (k / (order.length - 1) - 0.5) * 0.5,
          }),
        );
      };

      for (let offset = 0; offset < seconds; offset += loopLength) {
        for (const s of sparse) strum(L.sparse, s, offset, 0.09);
        for (const b of heldBass) if (before(offset + b.at)) bassNote(L.held, sampleRate, offset + b.at, Math.min(b.length, (ending ?? Infinity) - offset - b.at), midiToFreq(b.midi), { volume: 0.12, drive: 0.15 });
        if (peak > 0.2) {
          for (const s of busy) strum(L.busy, s, offset, 0.1);
          for (const b of bounceBass) if (before(offset + b.at)) bassNote(L.bounce, sampleRate, offset + b.at, b.length, midiToFreq(b.midi), { volume: 0.13, drive: 0.45 });
          for (const k of kicks) if (before(offset + k)) softKick(L.kick, sampleRate, offset + k, 0.55);
          for (const s of shakers) if (before(offset + s.at)) shaker(L.shaker, sampleRate, offset + s.at, 0.07 * s.velocity, 0.3);
        }
        if (peak > 0.5) {
          for (const c of claps) if (before(offset + c)) clap(L.clap, sampleRate, offset + c, 0.18);
          for (const h of hats) if (before(offset + h.at)) shaker(L.hats, sampleRate, offset + h.at, 0.07 * h.velocity, -0.25);
          for (const s of stabs) if (before(offset + s.at)) padNote(L.stabs, sampleRate, offset + s.at, beat * 0.3, midiToFreq(s.midi), { volume: 0.03, attack: 0.008, release: 0.12, detune: 0.12, cutoff: [1400, 2200] });
        }
      }

      // Fade each layer with the intensity curve (256-sample blocks).
      const BLOCK = 256;
      const fadeBy = (buf: typeof L.busy, gain: (x: number) => number) => {
        for (const ch of buf) {
          for (let i = 0; i < n; i += BLOCK) {
            const g = gain(level(i / sampleRate));
            for (let j = i; j < Math.min(n, i + BLOCK); j++) ch[j] *= g;
          }
        }
      };
      fadeBy(L.sparse, (x) => 1 - smoothstep(0.2, 0.45, x));
      fadeBy(L.held, (x) => 1 - smoothstep(0.2, 0.45, x));
      fadeBy(L.busy, (x) => smoothstep(0.2, 0.45, x));
      fadeBy(L.bounce, (x) => smoothstep(0.2, 0.45, x));
      fadeBy(L.kick, (x) => smoothstep(0.25, 0.5, x));
      fadeBy(L.shaker, (x) => smoothstep(0.25, 0.5, x));
      fadeBy(L.clap, (x) => smoothstep(0.55, 0.85, x));
      fadeBy(L.hats, (x) => smoothstep(0.65, 0.95, x));
      fadeBy(L.stabs, (x) => smoothstep(0.6, 0.9, x));

      const out = makeStereo(n);
      for (const buf of Object.values(L)) addInto(out, buf);

      // A small, bright room: present, not washy.
      const send = makeStereo(n);
      addInto(send, L.sparse, 0.4);
      addInto(send, L.busy, 0.2);
      addInto(send, L.clap, 0.5);
      addInto(send, L.stabs, 0.4);

      // The ending: on the bar line, a full let-ring strum of the home chord over a held bass and one kick.
      if (ending !== undefined && ending < seconds) {
        const final = makeStereo(n);
        strum(final, { at: ending - 0.012, notes: homeShape, down: true, ring: 2.6, velocity: 1.15 }, 0, 0.11);
        stringNote(final, sampleRate, ending + 0.05, midiToFreq(fold(home[0], 64)), { volume: 0.05, ring: 2.2, brightness: 0.6, pan: 0.3 });
        bassNote(final, sampleRate, ending, Math.min(2.2, seconds - ending), midiToFreq(fold(home[0], 33)), { volume: 0.13, drive: 0.2 });
        softKick(final, sampleRate, ending, 0.6);
        // Let the bass die away instead of stopping.
        const fadeFrom = Math.round((ending + 1.2) * sampleRate);
        for (const ch of final) for (let i = fadeFrom; i < n; i++) ch[i] *= Math.max(0, 1 - (i - fadeFrom) / (1.6 * sampleRate));
        addInto(out, final);
        addInto(send, final, 0.35);
      }
      addInto(out, reverb(send, sampleRate, { room: 0.55, damping: 0.6 }), 0.25);
      for (const ch of out) {
        biquad(ch, sampleRate, "highpass", 32);
        biquad(ch, sampleRate, "lowpass", 11000, 0.6);
      }
      return out;
    },
  };
}
