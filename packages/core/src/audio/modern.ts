import { addInto, biquad, delay, reverb } from "./fx";
import { bassNote, clap, fmNote, padNote, shaker, softKick, type FmPreset } from "./instruments";
import { makeStereo, midiToFreq, noteToMidi, rng, type AudioSource, type Stereo } from "./synth";

export type ModernMood = "bright" | "calm" | "driving";

export interface ModernOptions {
  /** Different seed → different track. Same seed → the same track, always. */
  seed?: number;
  mood?: ModernMood;
  /** e.g. "C major", "A minor". Picked from the seed when omitted. */
  key?: string;
  /** Picked from the mood when omitted. */
  bpm?: number;
  /** Bars before the loop repeats. Default 8. */
  bars?: number;
}

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

const PROGRESSIONS = {
  major: [
    [0, 4, 5, 3], // I V vi IV
    [5, 3, 0, 4], // vi IV I V
    [3, 4, 0, 5], // IV V I vi
    [0, 5, 3, 4], // I vi IV V
  ],
  minor: [
    [0, 5, 2, 6], // i VI III VII
    [0, 3, 5, 4], // i iv VI v
    [5, 6, 0, 0], // VI VII i i
  ],
};

interface MoodSpec {
  bpm: number;
  mode: keyof typeof SCALES;
  kick: number[];
  clap: number[];
  shaker: number[];
  /** [step, length in steps] per bar. */
  bass: [number, number][];
  /** Steps where the arpeggiated pluck plays. */
  pluck: number[];
  plucks: FmPreset[];
  /** Bell melody note positions, chosen per bar. */
  bell: number[][];
  /** How much the pad and bass dip on every kick (sidechain pump). */
  duck: number;
  room: number;
}

const MOODS: Record<ModernMood, MoodSpec> = {
  bright: {
    bpm: 112,
    mode: "major",
    kick: [0, 8, 11],
    clap: [4, 12],
    shaker: [2, 6, 10, 14],
    bass: [[0, 3], [3, 3], [8, 3], [11, 4]],
    pluck: [0, 2, 3, 6, 8, 10, 11, 14],
    plucks: ["marimba", "pluck"],
    bell: [[0, 6], [0, 3, 10], [2, 8, 12], [0, 10]],
    duck: 0.45,
    room: 0.8,
  },
  calm: {
    bpm: 86,
    mode: "major",
    kick: [0],
    clap: [],
    shaker: [4, 12],
    bass: [[0, 15]],
    pluck: [0, 4, 6, 10, 12],
    plucks: ["pluck", "glass"],
    bell: [[0], [0, 8], [4, 12]],
    duck: 0,
    room: 0.92,
  },
  driving: {
    bpm: 122,
    mode: "minor",
    kick: [0, 4, 8, 12],
    clap: [4, 12],
    shaker: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    bass: [[2, 1.5], [6, 1.5], [10, 1.5], [14, 1.5]],
    pluck: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    plucks: ["marimba", "glass"],
    bell: [[0, 8], [0, 6, 12]],
    duck: 0.6,
    room: 0.75,
  },
};

const ROOTS = ["C", "D", "Eb", "E", "F", "G", "A", "Bb"];

/** Fold a MIDI note into [low, low + 12). */
const fold = (midi: number, low: number) => low + ((((midi - low) % 12) + 12) % 12);

/**
 * Procedurally composed modern "product video" loop: warm pad chords, round sub bass,
 * FM plucks through a dotted-eighth echo, a sparse bell motif and soft drums with sidechain pump,
 * all sharing one reverb. Derived entirely from `seed`.
 */
export function modern(opts: ModernOptions = {}): AudioSource {
  const random = rng((opts.seed ?? 1) * 7919);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];

  const moodName = opts.mood ?? "bright";
  const mood = MOODS[moodName];
  const [rootName, modeName] = (opts.key ?? `${pick(ROOTS)} ${mood.mode}`).split(/\s+/);
  const mode = (modeName === "minor" ? "minor" : "major") as keyof typeof SCALES;
  const scale = SCALES[mode];
  const root = noteToMidi(`${rootName}3`);
  const bpm = opts.bpm ?? mood.bpm;
  const bars = opts.bars ?? 8;
  const step = 60 / bpm / 4;
  const barLength = 16 * step;
  const progression = pick(PROGRESSIONS[mode]);
  const pluckPreset = pick(mood.plucks);
  const arpShape = pick(["up", "updown", "pendulum"] as const);

  const degree = (d: number) => root + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];

  type Note = { at: number; length: number; midi: number; velocity: number; pan?: number };
  const pads: Note[] = [];
  const basses: Note[] = [];
  const plucks: Note[] = [];
  const bells: Note[] = [];
  const hits: { at: number; kind: "kick" | "clap" | "shaker"; velocity: number; intro: boolean }[] = [];

  const motif: { positions: number[]; notes: number[] }[] = [];
  let prevBell = 76;

  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * barLength;
    const chord = progression[bar % progression.length];
    const tones = [chord, chord + 2, chord + 4, chord + 6].map(degree);

    // Pad: close voicing of the 7th chord around middle C, one sustained chord per bar.
    for (const m of tones) pads.push({ at: t0, length: barLength * 0.98, midi: fold(m, 55), velocity: 1 });

    for (const [s, len] of mood.bass) {
      basses.push({ at: t0 + s * step, length: len * step * 0.92, midi: fold(tones[0], 33), velocity: 1 });
    }

    // Pluck arpeggio over the chord in the upper register.
    const arp = [...new Set([...tones.slice(0, 3), tones[0] + 12].map((m) => fold(m, 67)))].sort((a, b) => a - b);
    const top = arp.length - 1;
    mood.pluck.forEach((s, n) => {
      const k =
        arpShape === "up" ? n % arp.length
        : arpShape === "updown" ? (n % (2 * top) <= top ? n % (2 * top) : 2 * top - (n % (2 * top)))
        : [0, 2, 1, 3][n % 4] % arp.length;
      plucks.push({ at: t0 + s * step, length: step, midi: arp[k], velocity: s % 4 === 0 ? 1 : 0.65, pan: n % 2 ? 0.25 : -0.25 });
    });

    // Bell motif: phrase of bars 0–1 returns in bars 4–5; the loop ends on the tonic.
    const reuse = bar >= 4 && bar - 4 < motif.length;
    const positions = reuse ? motif[bar - 4].positions : pick(mood.bell);
    const notes: number[] = [];
    positions.forEach((s, n) => {
      let midi: number;
      if (reuse) midi = motif[bar - 4].notes[n];
      else if (bar === bars - 1 && n === positions.length - 1) midi = fold(root, 72);
      else {
        const candidates = tones.map((m) => fold(m, 72));
        midi = candidates.reduce((best, c) => (Math.abs(c - prevBell) < Math.abs(best - prevBell) ? c : best));
        if (random() < 0.35) midi = candidates[Math.floor(random() * candidates.length)];
      }
      notes.push(midi);
      prevBell = midi;
      bells.push({ at: t0 + s * step, length: step, midi, velocity: 1 });
    });
    if (bar < 2) motif.push({ positions, notes });

    // Drums enter after the first bar on the first pass; the last bar thins out before the loop.
    const last = bar === bars - 1;
    for (const s of mood.kick) if (!(last && s > 8)) hits.push({ at: t0 + s * step, kind: "kick", velocity: 1, intro: bar === 0 });
    for (const s of mood.clap) hits.push({ at: t0 + s * step, kind: "clap", velocity: 1, intro: bar === 0 });
    for (const s of mood.shaker) hits.push({ at: t0 + s * step, kind: "shaker", velocity: s % 4 === 2 ? 1 : 0.6, intro: bar === 0 });
  }

  const loopLength = bars * barLength;

  return {
    render(sampleRate, seconds) {
      const n = Math.ceil(seconds * sampleRate);
      const pad = makeStereo(n), bass = makeStereo(n), pluck = makeStereo(n), bell = makeStereo(n);
      const kicks = makeStereo(n), perc = makeStereo(n), claps = makeStereo(n);
      const kickTimes: number[] = [];

      for (let loop = 0, offset = 0; offset < seconds; loop++, offset += loopLength) {
        for (const p of pads) padNote(pad, sampleRate, offset + p.at, p.length, midiToFreq(p.midi));
        for (const b of basses) bassNote(bass, sampleRate, offset + b.at, b.length, midiToFreq(b.midi));
        for (const p of plucks) fmNote(pluck, sampleRate, offset + p.at, midiToFreq(p.midi), { preset: pluckPreset, volume: 0.13 * p.velocity, pan: p.pan });
        for (const b of bells) fmNote(bell, sampleRate, offset + b.at, midiToFreq(b.midi), { preset: "bell", volume: 0.07 });
        for (const h of hits) {
          if (h.intro && loop === 0) continue;
          const at = offset + h.at;
          if (h.kind === "kick") {
            softKick(kicks, sampleRate, at);
            kickTimes.push(at);
          } else if (h.kind === "clap") clap(claps, sampleRate, at);
          else shaker(perc, sampleRate, at, 0.05 * h.velocity);
        }
      }

      // Sidechain pump: the pad, bass and plucks breathe around every kick.
      if (mood.duck > 0) {
        const gain = new Float32Array(n).fill(1);
        for (const k of kickTimes) {
          const first = Math.round(k * sampleRate);
          for (let i = Math.max(0, first); i < Math.min(n, first + 0.5 * sampleRate); i++) {
            gain[i] = Math.min(gain[i], 1 - mood.duck * Math.exp(-(i - first) / sampleRate / 0.13));
          }
        }
        for (const [buf, amount] of [[pad, 1], [bass, 0.7], [pluck, 0.4]] as [Stereo, number][]) {
          for (const ch of buf) for (let i = 0; i < n; i++) ch[i] *= 1 - amount * (1 - gain[i]);
        }
      }

      const out = makeStereo(n);
      for (const [buf, g] of [[pad, 1], [bass, 1], [pluck, 1], [bell, 1], [kicks, 1], [perc, 1], [claps, 1]] as [Stereo, number][]) {
        addInto(out, buf, g);
      }

      const echoSend = makeStereo(n);
      addInto(echoSend, pluck, 0.5);
      addInto(echoSend, bell, 0.4);
      const echo = delay(echoSend, sampleRate, { time: 3 * step, feedback: 0.42 });
      addInto(out, echo, 0.55);

      const reverbSend = makeStereo(n);
      addInto(reverbSend, pad, 0.4);
      addInto(reverbSend, pluck, 0.3);
      addInto(reverbSend, bell, 0.7);
      addInto(reverbSend, claps, 0.4);
      addInto(reverbSend, echo, 0.4);
      addInto(out, reverb(reverbSend, sampleRate, { room: mood.room, damping: 0.45 }), 0.32);

      for (const ch of out) biquad(ch, sampleRate, "highpass", 28);
      return out;
    },
  };
}
