import { addDrum, type Drum } from "./drums";
import { chordTones, composeHarmony, defaultSlots, ROOTS, SCALES, type Chord, type Mode } from "./harmony";
import { addTone, makeStereo, midiToFreq, noteToMidi, rng, type AudioSource, type ToneOptions } from "./synth";

export type Mood = "upbeat" | "chill" | "epic";

export interface ChiptuneOptions {
  /** Different seed → different song. Same seed → the same song, always. */
  seed?: number;
  mood?: Mood;
  /** e.g. "C major", "A minor", "F# minor". Picked from the seed when omitted. */
  key?: string;
  /**
   * Chords as Roman numerals, one per bar, e.g. "I IV V" or "i VI III VII"; "blues" is the twelve-bar blues.
   * Picked from the seed when omitted: a verse and a chorus progression from a library of pop progressions.
   */
  progression?: string | string[];
  /** Picked from the mood when omitted. */
  bpm?: number;
  /** Bars before the loop repeats; one chord per bar. Default 8 (with `progression`, whole passes of it). */
  bars?: number;
}

const MOODS: Record<Mood, { bpm: number; mode: Mode; drums: Record<Drum, number[]>; rhythms: number[][] }> = {
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
  const mode: Mode = modeName === "minor" ? "minor" : "major";
  const scale = SCALES[mode];
  const root = noteToMidi(`${rootName}3`);
  const bpm = opts.bpm ?? mood.bpm;
  const bars = opts.bars ?? defaultSlots(8, opts.progression, mode);
  const step = 60 / bpm / 4;
  const barLength = step * 16;
  const harmony = composeHarmony({ random, mode, slots: bars, progression: opts.progression, library: "pop" });

  // The lead's range: from the key's fourth above middle octave up to its seventh an octave higher.
  const low = root + 12 + scale[3];
  const high = root + 24 + scale[6];
  const inRange = (pcs: Set<number>) => {
    const out: number[] = [];
    for (let m = low; m <= high; m++) if (pcs.has((m - root + 120) % 12)) out.push(m);
    return out;
  };
  /** Pitches the lead may use over `chord`: the key's scale, with chord tones from outside the key replacing the
   *  scale notes a semitone from them (so a borrowed iv or bVII doesn't rub against the melody). */
  const pitchesOver = (chord: Chord) => {
    const pcs = new Set(scale);
    for (const t of chord.triad) {
      const pc = (chord.root + t) % 12;
      if (pcs.has(pc)) continue;
      pcs.delete((pc + 1) % 12);
      pcs.delete((pc + 11) % 12);
      pcs.add(pc);
    }
    return inRange(pcs);
  };
  const chordPitches = (chord: Chord) => inRange(new Set(chord.triad.map((t) => (chord.root + t) % 12)));
  const nearest = (xs: number[], target: number) => xs.reduce((best, x) => (Math.abs(x - target) < Math.abs(best - target) ? x : best));

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

  // Motifs: a section's melody returns when the section repeats, and within a section bars 3–4 answer bars 1–2 in
  // the same rhythm, so the tune sounds composed rather than random.
  const motifs = new Map<string, { rhythm: number[]; notes: number[]; chord: Chord }>();
  let prev = root + 24; // start around the middle of the lead's range

  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * barLength;
    const chord = harmony.chords[bar];
    const tones = chordTones(chord, root);

    // Bass: root with octave jumps on upbeat, long roots otherwise.
    for (let s = 0; s < 16; s += 2) {
      if (opts.mood === "chill" && s % 8 !== 0) continue;
      const octave = opts.mood !== "chill" && s % 4 === 2 ? 12 : 0;
      events.push({ at: t0 + s * step, length: (opts.mood === "chill" ? 7.5 : 1.8) * step, midi: tones[0] - 12 + octave, tone: bass });
    }

    // Pad: one long note per half bar with a fast chord arpeggio.
    const [, third, fifth] = chord.triad;
    for (const half of [0, 8]) {
      events.push({ at: t0 + half * step, length: 7.6 * step, midi: tones[0] + 12, tone: { ...pad, arp: [0, third, fifth] } });
    }

    // Lead: bring back an earlier phrase where the section repeats, otherwise compose a new bar.
    const key = `${harmony.sections[bar]}${bar % 4}`;
    const earlier = motifs.get(key) ?? motifs.get(`${harmony.sections[bar]}${(bar % 4) - 2}`);
    const fresh = pick(mood.rhythms);
    const rhythm = earlier && bar !== bars - 1 ? earlier.rhythm : fresh;
    const reuse = earlier !== undefined && rhythm === earlier.rhythm && earlier.chord === chord;
    const scaleHere = pitchesOver(chord);
    const chordHere = chordPitches(chord);
    const notes: number[] = [];
    for (let k = 0, n = 0; k < rhythm.length; k += 2, n++) {
      const [s, len] = [rhythm[k], rhythm[k + 1]];
      let midi: number;
      if (reuse) {
        midi = earlier.notes[n % earlier.notes.length];
      } else if (bar === bars - 1 && k + 2 >= rhythm.length) {
        midi = nearest(inRange(new Set([0])), prev); // resolve to the tonic at the end of the loop
      } else if (s % 4 === 0) {
        // Strong beats: nearest chord tone in the lead's register.
        midi = nearest(chordHere, prev);
      } else {
        // Otherwise a step or two along the scale.
        const i = scaleHere.indexOf(nearest(scaleHere, prev));
        midi = scaleHere[Math.max(0, Math.min(scaleHere.length - 1, i + pick([-2, -1, -1, 1, 1, 2])))];
      }
      notes.push(midi);
      prev = midi;
      events.push({ at: t0 + s * step, length: len * step * 0.9, midi, tone: lead });
      events.push({ at: t0 + (s + 3) * step, length: len * step * 0.9, midi, tone: echo });
    }
    if (!motifs.has(key)) motifs.set(key, { rhythm, notes, chord });

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
