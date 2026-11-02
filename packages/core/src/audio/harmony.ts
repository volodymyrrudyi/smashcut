/**
 * Shared harmony for the music generators: Roman-numeral chords, a library of progressions and a simple song form
 * (a verse progression and a chorus progression, with turnarounds), so different seeds sound like different songs.
 *
 * Numerals are relative to the key's own scale: in a minor key `i VI III VII` is A minor, F, C, G in A minor.
 * Uppercase is a major chord and lowercase minor, whatever the scale says, so `V` in a minor key is the raised
 * (harmonic-minor) dominant and `iv` in a major key is the borrowed minor four. `b` / `#` shift the root a semitone
 * (`bVII`, `bVI`). Suffixes: `°` (diminished), `sus2`, `sus4`, `7` (minor seventh), `maj7`.
 */

export type Mode = "major" | "minor";

export const SCALES: Record<Mode, number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

export interface Chord {
  /** As written, e.g. "bVII". */
  name: string;
  /** Semitones above the key's tonic, 0..11. */
  root: number;
  /** Root, third (or sus note) and fifth as semitones above the chord's root. */
  triad: [number, number, number];
  /** The seventh as semitones above the root: a written `7` / `maj7`, else the one that fits the key. */
  seventh: number;
}

const NUMERALS = ["i", "ii", "iii", "iv", "v", "vi", "vii"];
const CHORD = /^([b#]?)(vii|vi|v|iv|iii|ii|i)(°|o|dim)?(sus2|sus4|maj7|7)?$/i;

/** Parse one Roman numeral, e.g. "IV", "bVII", "ii°", "Vsus4", "vi7". */
export function parseChord(numeral: string, mode: Mode): Chord {
  const m = CHORD.exec(numeral.trim());
  if (!m) throw new Error(`Unknown chord "${numeral}": use Roman numerals such as I, IV, V, vi, bVII, ii°, Vsus4.`);
  const [, accidental, roman, dim, suffix = ""] = m;
  const scale = SCALES[mode];
  const root = (scale[NUMERALS.indexOf(roman.toLowerCase())] + (accidental === "b" ? -1 : accidental === "#" ? 1 : 0) + 12) % 12;
  const minor = roman === roman.toLowerCase();
  const sus = suffix.toLowerCase();
  const triad: [number, number, number] = dim
    ? [0, 3, 6]
    : sus === "sus2" ? [0, 2, 7]
    : sus === "sus4" ? [0, 5, 7]
    : [0, minor ? 3 : 4, 7];
  const inKey = (semis: number) => scale.includes((root + semis) % 12);
  const seventh =
    sus === "maj7" ? 11
    : sus === "7" || minor || dim || triad[1] !== 4 ? 10
    // A major chord: the dominant seventh when that's the key's own note (V in major, VII in minor), else maj7.
    : inKey(10) && !inKey(11) ? 10
    : 11;
  return { name: numeral.trim(), root, triad, seventh };
}

/** The classic twelve-bar blues, available as `progression: "blues"`. */
const BLUES = "I I I I IV IV I I V IV I V";

/** Parse "I V vi IV", "I–IV–V", "i, VI, III, VII" or "blues". */
export function parseProgression(progression: string | string[], mode: Mode): Chord[] {
  const text = Array.isArray(progression) ? progression.join(" ") : progression.trim() === "blues" ? BLUES : progression;
  const chords = text.split(/[\s,|–—-]+/).filter(Boolean).map((c) => parseChord(c, mode));
  if (!chords.length) throw new Error(`Empty progression "${text}".`);
  return chords;
}

/** Four-chord sections. Plenty of variety, still all in the key. */
const LIBRARY: Record<"pop" | "dreamy", Record<Mode, string[]>> = {
  // Bright, song-like progressions for groove(), modern() and chiptune().
  pop: {
    major: [
      "I V vi IV", // the "four chords"
      "I vi IV V", // fifties
      "vi IV I V",
      "I IV V IV", // three chords
      "I IV I V", // three chords
      "I IV V V", // three chords
      "IV I V vi",
      "I iii IV V",
      "I vi ii V", // doo-wop / turnaround
      "I IV vi V",
      "IV V iii vi", // "royal road"
      "I bVII IV I", // mixolydian rock
      "I IV iv I", // borrowed minor four: bittersweet
      "I bVI bVII I", // heroic
      "I III IV iv",
      "ii IV I V",
      "vi V IV V",
      "I Vsus4 vi IV",
    ],
    minor: [
      "i VI III VII",
      "i VII VI VII",
      "i iv VII III",
      "i VI iv v",
      "i iv v iv", // three chords
      "i VII VI V", // Andalusian
      "i iv VI V",
      "VI VII i i",
      "i v VI iv",
      "i ii° V i",
      "i III VII VI",
      "iv VI VII i",
    ],
  },
  // Slow, open progressions for ambient(): fewer cadences, more drift.
  dreamy: {
    major: [
      "I IV vi V",
      "I vi IV IV",
      "IV I V vi",
      "I iii vi IV",
      "IV vi I V",
      "I V vi iii",
      "I bVII IV IV",
      "vi IV I I",
      "I IV iv I",
      "IV V vi vi",
    ],
    minor: [
      "i VI III VII",
      "i iv i VI",
      "i VI iv i",
      "i III VI VII",
      "i VII iv iv",
      "VI III VII i",
      "i v VI VI",
    ],
  },
};

export interface HarmonyOptions {
  random: () => number;
  mode: Mode;
  /** Number of chord slots in the loop. */
  slots: number;
  /** A user-given progression: played as written, cycled to fill the loop. */
  progression?: string | string[];
  library: keyof typeof LIBRARY;
}

export interface Harmony {
  /** One chord per slot. */
  chords: Chord[];
  /** Section letter per slot ("A", "B"); a repeated letter repeats that section's chords. */
  sections: string[];
}

/** Default loop length in slots: `fallback` normally, a whole number of passes of a user progression otherwise. */
export function defaultSlots(fallback: number, progression: string | string[] | undefined, mode: Mode): number {
  if (progression === undefined) return fallback;
  const n = parseProgression(progression, mode).length;
  return n * Math.max(1, Math.round(fallback / n));
}

const TONIC = new Set([0]);

/**
 * The chord sequence for one loop. With a user `progression`, that progression cycled. Otherwise a verse (A) and a
 * chorus (B) from the library: 4 slots → A, 8 → A B, 12 → A A B, 16 → A A B B. A section that's followed by one
 * starting on the home chord (including the loop back to the top) ends on the dominant instead of the tonic,
 * so the music leads somewhere rather than stopping on every repeat.
 */
export function composeHarmony({ random, mode, slots, progression, library }: HarmonyOptions): Harmony {
  if (progression !== undefined) {
    const chords = parseProgression(progression, mode);
    return { chords: Array.from({ length: slots }, (_, i) => chords[i % chords.length]), sections: Array(slots).fill("A") };
  }
  const options = LIBRARY[library][mode];
  const a = options[Math.floor(random() * options.length)];
  // The chorus: a different progression, preferably starting on a different chord, so the change is audible.
  const others = options.filter((p) => p !== a && p.split(" ")[0] !== a.split(" ")[0]);
  const b = others[Math.floor(random() * others.length)];
  const A = parseProgression(a, mode);
  const B = parseProgression(b, mode);

  const count = Math.max(1, Math.round(slots / 4));
  const letters = count === 1 ? ["A"] : count === 2 ? ["A", "B"] : count === 3 ? ["A", "A", "B"] : ["A", "A", "B", "B"];
  const order = Array.from({ length: count }, (_, i) => letters[i % letters.length]);
  const dominant = parseChord(mode === "major" ? "V" : random() < 0.5 ? "V" : "VII", mode);

  const chords: Chord[] = [];
  const sections: string[] = [];
  for (let i = 0; i < slots; i++) {
    const s = Math.min(order.length - 1, Math.floor(i / 4));
    const section = order[s] === "A" ? A : B;
    chords.push(section[i % 4]);
    sections.push(order[s]);
  }
  // Turnarounds: the last chord before a section (or the loop restart) that begins on the tonic.
  for (let s = 0; s < order.length; s++) {
    const end = Math.min(slots, (s + 1) * 4) - 1;
    const next = chords[(end + 1) % slots];
    if (TONIC.has(chords[end].root) && TONIC.has(next.root) && slots > 1) chords[end] = dominant;
  }
  return { chords, sections };
}

/** MIDI notes of a chord in a key whose tonic is `tonic`: root, third, fifth and (with `seventh`) the seventh. */
export function chordTones(chord: Chord, tonic: number, seventh = false): number[] {
  const base = tonic + chord.root;
  const tones = chord.triad.map((x) => base + x);
  if (seventh) tones.push(base + chord.seventh);
  return tones;
}

/** Fold a MIDI note into [low, low + 12). */
export const fold = (midi: number, low: number) => low + ((((midi - low) % 12) + 12) % 12);

/** All twelve keys, spelled the way the instruments' note parser expects. */
export const ROOTS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
