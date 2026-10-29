import { addDrum, type Drum } from "./drums";
import { addTone, makeStereo, midiToFreq, noteToMidi, rng, type AudioSource, type ToneOptions } from "./synth";

export type Mood = "upbeat" | "chill" | "epic";

export interface ChiptuneOptions {
  /** Different seed → different song. Same seed → the same song, always. */
  seed?: number;
  mood?: Mood;
  /** e.g. "C major", "A minor", "F# minor". Picked from the seed when omitted. */
  key?: string;
  /** Picked from the mood when omitted. */
  bpm?: number;
  /** Bars before the loop repeats. Default 8. */
  bars?: number;
}

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

// Scale degrees (0-based) of one chord per bar.
const PROGRESSIONS = {
  major: [
    [0, 4, 5, 3], // I V vi IV
    [0, 5, 3, 4], // I vi IV V
    [5, 3, 0, 4], // vi IV I V
    [0, 3, 0, 4], // I IV I V
  ],
  minor: [
    [0, 5, 2, 6], // i VI III VII
    [0, 6, 5, 6], // i VII VI VII
    [0, 3, 6, 2], // i iv VII III
    [0, 5, 3, 4], // i VI iv v
  ],
};

const MOODS: Record<Mood, { bpm: number; mode: keyof typeof SCALES; drums: Record<Drum, number[]>; rhythms: number[][] }> = {
  upbeat: {
    bpm: 128,
    mode: "major",
    drums: { kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], openhat: [14] },
    // Melody rhythms per bar: [step, length] pairs flattened.
    rhythms: [
      [0, 2, 2, 2, 4, 1, 6, 2, 8, 4, 12, 2, 14, 2],
      [0, 3, 3, 3, 6, 2, 8, 2, 10, 2, 12, 4],
      [0, 1, 2, 1, 4, 2, 6, 2, 8, 6, 14, 2],
      [0, 4, 4, 2, 6, 2, 8, 2, 10, 6],
    ],
  },
  chill: {
    bpm: 96,
    mode: "major",
    drums: { kick: [0, 10], snare: [8], hat: [0, 4, 8, 12], openhat: [] },
    rhythms: [
      [0, 6, 6, 2, 8, 8],
      [0, 4, 4, 4, 8, 4, 12, 4],
      [2, 6, 8, 6, 14, 2],
    ],
  },
  epic: {
    bpm: 140,
    mode: "minor",
    drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], openhat: [] },
    rhythms: [
      [0, 4, 4, 4, 8, 8],
      [0, 6, 6, 2, 8, 4, 12, 4],
      [0, 2, 2, 2, 4, 4, 8, 8],
    ],
  },
};

const ROOTS = ["C", "D", "E", "F", "G", "A", "Bb", "Eb"];

interface NoteEvent {
  at: number;
  length: number;
  midi: number;
  tone: ToneOptions;
}

/**
 * Procedurally composed 8-bit loop: chord progression, triangle bass, square arpeggio pad,
 * a motif-based square lead and noise/triangle drums, all derived from `seed`.
 */
export function chiptune(opts: ChiptuneOptions = {}): AudioSource {
  const seed = opts.seed ?? 1;
  const random = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];

  const mood = MOODS[opts.mood ?? "upbeat"];
  const [rootName, modeName] = (opts.key ?? `${pick(ROOTS)} ${mood.mode}`).split(/\s+/);
  const mode = (modeName === "minor" ? "minor" : "major") as keyof typeof SCALES;
  const scale = SCALES[mode];
  const root = noteToMidi(`${rootName}3`);
  const bpm = opts.bpm ?? mood.bpm;
  const bars = opts.bars ?? 8;
  const step = 60 / bpm / 4;
  const barLength = step * 16;
  const progression = pick(PROGRESSIONS[mode]);

  /** MIDI note of scale degree `d` (any integer; wraps into octaves). */
  const degree = (d: number) => root + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];
  const chordOf = (bar: number) => progression[bar % progression.length];

  const events: NoteEvent[] = [];
  const drums: { at: number; drum: Drum; volume: number }[] = [];

  const bass: ToneOptions = { wave: "triangle", volume: 0.32, env: { attack: 0.002, decay: 0.05, sustain: 0.9, release: 0.03 } };
  const pad: ToneOptions = { wave: "square", duty: 0.125, volume: 0.05, pan: -0.35, env: { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.1 } };
  const lead: ToneOptions = {
    wave: "square",
    duty: pick([0.25, 0.5]),
    volume: 0.09,
    pan: 0.2,
    vibrato: { rate: 6, depth: 0.15, delay: 0.12 },
    env: { attack: 0.005, decay: 0.1, sustain: 0.6, release: 0.08 },
  };
  const echo: ToneOptions = { ...lead, volume: 0.03, pan: -0.5 };

  // Motifs: the melody of bars 0–1 returns in bars 4–5, so the tune sounds composed rather than random.
  const motif: { rhythm: number[]; notes: number[] }[] = [];
  let prev = 7 + chordOf(0); // start around the middle of the lead's range

  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * barLength;
    const chord = chordOf(bar);
    const triad = [chord, chord + 2, chord + 4];

    // Bass: root with octave jumps on upbeat, long roots otherwise.
    for (let s = 0; s < 16; s += 2) {
      if (opts.mood === "chill" && s % 8 !== 0) continue;
      const octave = opts.mood !== "chill" && s % 4 === 2 ? 12 : 0;
      events.push({ at: t0 + s * step, length: (opts.mood === "chill" ? 7.5 : 1.8) * step, midi: degree(chord) - 12 + octave, tone: bass });
    }

    // Pad: one long note per half bar with a fast chord arpeggio.
    const third = degree(chord + 2) - degree(chord);
    const fifth = degree(chord + 4) - degree(chord);
    for (const half of [0, 8]) {
      events.push({ at: t0 + half * step, length: 7.6 * step, midi: degree(chord) + 12, tone: { ...pad, arp: [0, third, fifth] } });
    }

    // Lead: reuse the opening motif in the second phrase, otherwise compose a new bar.
    const reuse = bar >= 4 && bar - 4 < motif.length && bar !== bars - 1;
    const fresh = pick(mood.rhythms);
    const rhythm = reuse ? motif[bar - 4].rhythm : fresh;
    const notes: number[] = reuse ? motif[bar - 4].notes : [];
    for (let k = 0, n = 0; k < rhythm.length; k += 2, n++) {
      const [s, len] = [rhythm[k], rhythm[k + 1]];
      let d: number;
      if (reuse) {
        d = notes[n % notes.length];
      } else if (bar === bars - 1 && k + 2 >= rhythm.length) {
        d = 7; // resolve to the tonic at the end of the loop
      } else if (s % 4 === 0) {
        // Strong beats: nearest chord tone in the lead's register.
        d = triad.map((c) => c + 7).reduce((best, c) => (Math.abs(c - prev) < Math.abs(best - prev) ? c : best));
      } else {
        d = prev + pick([-2, -1, -1, 1, 1, 2]);
      }
      d = Math.max(3, Math.min(13, d));
      if (!reuse) notes.push(d);
      prev = d;
      events.push({ at: t0 + s * step, length: len * step * 0.9, midi: degree(d) + 12, tone: lead });
      events.push({ at: t0 + (s + 3) * step, length: len * step * 0.9, midi: degree(d) + 12, tone: echo });
    }
    if (bar < 2) motif.push({ rhythm, notes });

    // Drums, with a fill in the last bar.
    for (const [drum, steps] of Object.entries(mood.drums) as [Drum, number[]][]) {
      for (const s of steps) drums.push({ at: t0 + s * step, drum, volume: 1 });
    }
    if (bar === bars - 1) for (const s of [13, 14, 15]) drums.push({ at: t0 + s * step, drum: "snare", volume: 0.7 });
  }

  const loopLength = bars * barLength;
  return {
    render(sampleRate, seconds) {
      const out = makeStereo(Math.ceil(seconds * sampleRate));
      for (let offset = 0; offset < seconds; offset += loopLength) {
        for (const e of events) addTone(out, sampleRate, offset + e.at, e.length, midiToFreq(e.midi), e.tone);
        for (const d of drums) addDrum(out, sampleRate, offset + d.at, d.drum, d.volume);
      }
      return out;
    },
  };
}
