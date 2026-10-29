import { addInto, biquad, reverb } from "./fx";
import { bassNote, clap, fmNote, padNote, shaker, softKick } from "./instruments";
import { makeStereo, midiToFreq, noteToMidi, rng, type AudioSource, type Stereo } from "./synth";

/** "air": pads and a sparse glassy texture, nothing rhythmic. "pulse": adds a quiet muted pluck and a soft kick. */
export type AmbientMood = "air" | "pulse";

export interface AmbientOptions {
  /** Different seed → different track. Same seed → the same track, always. */
  seed?: number;
  /** A fixed intensity: "air" = 0, "pulse" = 0.45. Ignored when `intensity` is set. */
  mood?: AmbientMood;
  /**
   * How busy the music is, 0..1, as a constant or `[seconds, level]` keyframes (time from the clip's start).
   * 0 is the calm bed; ~0.4 brings in a quiet pulse; 1 adds a driving arpeggio, drums, a moving bass and a brighter
   * pad. The layers share one key, tempo and chord sequence and fade in and out, so the track builds and releases.
   */
  intensity?: number | [number, number][];
  /** e.g. "D major", "A minor". Picked from the seed when omitted. */
  key?: string;
  /** Default 72 for a calm bed, 90 once anything rhythmic is in play. */
  bpm?: number;
  /** Bars before the loop repeats; each chord lasts two bars. Default 8. */
  bars?: number;
}

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

// Slow, unresolved-sounding progressions (scale degrees), one chord per two bars.
const PROGRESSIONS = {
  major: [
    [0, 3, 5, 4], // I IV vi V
    [0, 5, 3, 3], // I vi IV IV
    [3, 0, 4, 5], // IV I V vi
  ],
  minor: [
    [0, 5, 2, 6], // i VI III VII
    [0, 3, 0, 5], // i iv i VI
  ],
};

const ROOTS = ["C", "D", "E", "F", "G", "A"];

/** Fold a MIDI note into [low, low + 12). */
const fold = (midi: number, low: number) => low + ((((midi - low) % 12) + 12) % 12);

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Intensity at `t` seconds: a constant, or eased between keyframes. */
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
 * Background bed for product videos: slow add9 / sus pad chords that fade in and out, a sustained sub bass and an
 * occasional glassy note far back in the reverb. With `intensity` it builds: a muted pulse, then a driving layer
 * with drums. At low intensity everything above ~5 kHz is rolled off, so keystrokes, UI sounds and voices sit on top.
 * Pair it with `music(ambient(), { duck: 0.5 })` to dip under sound effects.
 */
export function ambient(opts: AmbientOptions = {}): AudioSource {
  const random = rng((opts.seed ?? 1) * 6151);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];
  const curve = opts.intensity ?? (opts.mood === "pulse" ? 0.45 : 0);
  const rhythmic = typeof curve === "number" ? curve > 0.2 : curve.some(([, v]) => v > 0.2);
  const [rootName, modeName] = (opts.key ?? `${pick(ROOTS)} ${pick(["major", "major", "minor"])}`).split(/\s+/);
  const mode = (modeName === "minor" ? "minor" : "major") as keyof typeof SCALES;
  const scale = SCALES[mode];
  const root = noteToMidi(`${rootName}3`);
  const bpm = opts.bpm ?? (rhythmic ? 90 : 72);
  const bars = opts.bars ?? 8;
  const beat = 60 / bpm;
  const bar = 4 * beat;
  const chordLength = 2 * bar;
  const progression = pick(PROGRESSIONS[mode]);
  const degree = (d: number) => root + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];

  type Note = { at: number; length: number; midi: number; pan?: number; velocity?: number };
  // Bed (always on).
  const pads: Note[] = [];
  const shimmer: Note[] = [];
  const basses: Note[] = [];
  const glints: Note[] = [];
  // Pulse layer.
  const pulses: Note[] = [];
  const pulseKicks: number[] = [];
  const pulseHats: number[] = [];
  // Drive layer.
  const arps: Note[] = [];
  const drivePads: Note[] = [];
  const driveBass: Note[] = [];
  const kicks: number[] = [];
  const hats: { at: number; velocity: number }[] = [];
  const claps: number[] = [];

  for (let c = 0; c < bars / 2; c++) {
    const t0 = c * chordLength;
    const d = progression[c % progression.length];
    // Open voicing without the third's tension up top: root, fifth, then third and ninth (add9),
    // or a sus2 on every other chord for a floating feel.
    const sus = random() < 0.4;
    const tones = [degree(d), degree(d + 4), degree(d + (sus ? 1 : 2)) + 12, degree(d + 1) + 12];
    pads.push(
      { at: t0, length: chordLength, midi: fold(tones[0], 48) },
      { at: t0, length: chordLength, midi: fold(tones[1], 55) },
      { at: t0, length: chordLength, midi: fold(tones[2], 60) },
      { at: t0, length: chordLength, midi: fold(tones[3], 62) },
    );
    shimmer.push({ at: t0 + bar * 0.5, length: chordLength - bar * 0.5, midi: fold(tones[3], 74) });
    basses.push({ at: t0, length: chordLength * 0.97, midi: fold(tones[0], 33) });

    // One or two glassy notes per chord, at unpredictable offbeats, panned wide.
    const count = random() < 0.5 ? 1 : 2;
    for (let k = 0; k < count; k++) {
      const at = t0 + beat * (1.5 + Math.floor(random() * 10) * 0.5);
      glints.push({ at, length: beat, midi: fold(pick(tones), 76), pan: random() * 1.2 - 0.6 });
    }

    // Pulse: muted eighth notes on the root and fifth, a soft kick on beat one of each bar and an offbeat shaker.
    for (let e = 0; e < 16; e++) {
      pulses.push({ at: t0 + e * beat * 0.5, length: beat * 0.25, midi: fold(e % 4 === 2 ? tones[1] : tones[0], 57), pan: e % 2 ? 0.2 : -0.2 });
    }
    pulseKicks.push(t0, t0 + bar);
    for (let b = 0; b < 8; b++) pulseHats.push(t0 + b * beat + beat / 2);

    // Drive: a 16th-note arpeggio over the chord, a moving 8th-note bass, a brighter pad, four-on-the-floor kick,
    // offbeat hats and a soft backbeat.
    const arp = [tones[0], tones[1], tones[2], tones[3], tones[2], tones[1]].map((m) => fold(m, 64));
    for (let s = 0; s < 32; s++) {
      arps.push({ at: t0 + s * beat * 0.25, length: beat * 0.2, midi: arp[s % arp.length] + (s % 8 === 7 ? 12 : 0), pan: Math.sin(s * 0.7) * 0.4, velocity: s % 4 === 0 ? 1 : 0.7 });
    }
    for (let e = 0; e < 16; e++) {
      driveBass.push({ at: t0 + e * beat * 0.5, length: beat * 0.4, midi: fold(tones[0], 33) + (e % 8 === 6 ? 7 : 0) });
    }
    drivePads.push({ at: t0, length: chordLength, midi: fold(tones[2], 67) }, { at: t0, length: chordLength, midi: fold(tones[3], 71) });
    for (let b = 0; b < 8; b++) {
      kicks.push(t0 + b * beat);
      hats.push({ at: t0 + b * beat + beat / 2, velocity: 1 }, { at: t0 + b * beat + beat * 0.75, velocity: 0.5 });
      if (b % 2 === 1) claps.push(t0 + b * beat);
    }
  }

  const loopLength = bars * bar;

  return {
    render(sampleRate, seconds) {
      const n = Math.ceil(seconds * sampleRate);
      const bed = { pad: makeStereo(n), air: makeStereo(n), bass: makeStereo(n), glint: makeStereo(n) };
      const pulse = makeStereo(n);
      const drive = makeStereo(n);
      const driveAir = makeStereo(n);
      const level = (t: number) => intensityAt(curve, t);
      // Skip rendering layers the curve never reaches.
      let peak = 0;
      for (let t = 0; t < seconds; t += 0.05) peak = Math.max(peak, level(t));

      for (let offset = 0; offset < seconds; offset += loopLength) {
        // Long attacks and releases overlap neighbouring chords, so changes blur instead of stepping.
        for (const p of pads) {
          padNote(bed.pad, sampleRate, offset + p.at, p.length, midiToFreq(p.midi), { volume: 0.03, attack: 1.6, release: 2.4, detune: 0.07, cutoff: [260, 950] });
        }
        for (const s of shimmer) {
          padNote(bed.air, sampleRate, offset + s.at, s.length, midiToFreq(s.midi), { volume: 0.008, attack: 2.5, release: 3, detune: 0.12, cutoff: [900, 2200] });
        }
        for (const b of basses) bassNote(bed.bass, sampleRate, offset + b.at, b.length, midiToFreq(b.midi), { volume: 0.085, drive: 0.08 });
        for (const g of glints) fmNote(bed.glint, sampleRate, offset + g.at, midiToFreq(g.midi), { preset: "glass", volume: 0.03, pan: g.pan, decay: 0.9 });

        if (peak > 0.2) {
          for (const p of pulses) fmNote(pulse, sampleRate, offset + p.at, midiToFreq(p.midi), { preset: "pluck", volume: 0.11, pan: p.pan, decay: 0.12 });
          for (const k of pulseKicks) softKick(pulse, sampleRate, offset + k, 0.38);
          for (const h of pulseHats) shaker(pulse, sampleRate, offset + h, 0.035, -0.2);
        }
        if (peak > 0.55) {
          for (const a of arps) fmNote(drive, sampleRate, offset + a.at, midiToFreq(a.midi), { preset: "pluck", volume: 0.1 * (a.velocity ?? 1), pan: a.pan, decay: 0.09 });
          for (const b of driveBass) bassNote(drive, sampleRate, offset + b.at, b.length, midiToFreq(b.midi), { volume: 0.12, drive: 0.4 });
          for (const k of kicks) softKick(drive, sampleRate, offset + k, 0.6);
          for (const h of hats) shaker(drive, sampleRate, offset + h.at, 0.1 * h.velocity, 0.25);
          for (const c of claps) clap(drive, sampleRate, offset + c, 0.15);
          for (const p of drivePads) {
            padNote(driveAir, sampleRate, offset + p.at, p.length, midiToFreq(p.midi), { volume: 0.028, attack: 0.8, release: 1.5, detune: 0.1, cutoff: [1200, 3200] });
          }
        }
      }
      // Muted, felt-piano-like plucks rather than bright ones.
      for (const ch of pulse) biquad(ch, sampleRate, "lowpass", 1800, 0.7);
      for (const ch of drive) biquad(ch, sampleRate, "lowpass", 7500, 0.7);

      // Fade the layers by the intensity curve (computed in 256-sample blocks).
      const BLOCK = 256;
      const gains = (from: number, to: number) => (ch: Float32Array) => {
        for (let i = 0; i < n; i += BLOCK) {
          const g = smoothstep(from, to, level(i / sampleRate));
          for (let j = i; j < Math.min(n, i + BLOCK); j++) ch[j] *= g;
        }
      };
      pulse.forEach(gains(0.2, 0.5));
      drive.forEach(gains(0.55, 0.95));
      driveAir.forEach(gains(0.55, 0.95));

      const out = makeStereo(n);
      for (const buf of [bed.pad, bed.air, bed.bass, bed.glint, pulse, drive, driveAir]) addInto(out, buf);
      const send = makeStereo(n);
      addInto(send, bed.pad, 0.5);
      addInto(send, bed.air, 1);
      addInto(send, bed.glint, 1);
      addInto(send, pulse, 0.3);
      addInto(send, driveAir, 0.6);
      addInto(send, drive, 0.15);
      addInto(out, reverb(send, sampleRate, { room: 0.93, damping: 0.55 }), 0.4);
      // Keep out of the way when calm: no rumble, and little in the presence range. The top opens up as it builds.
      const top = (i: number) => 5200 + 5000 * smoothstep(0.5, 1, level(i / sampleRate));
      for (const ch of out as Stereo) {
        biquad(ch, sampleRate, "highpass", 30);
        biquad(ch, sampleRate, "lowpass", top, 0.6);
      }
      return out;
    },
  };
}
