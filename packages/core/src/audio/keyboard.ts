import { keyInfo, type Finger } from "../keys";
import type { Keystroke } from "../typing";
import { addInto, biquad, reverb } from "./fx";
import { makeStereo, rng, type AudioSource } from "./synth";

/** Switch character: MX Blue, MX Brown, MX Red on a stock steel-plate board, or a laptop membrane. */
export type KeySwitch = "clicky" | "tactile" | "linear" | "membrane";

/** A resonance: frequency in Hz, decay time constant in seconds, relative amplitude. */
interface Resonance {
  freq: number;
  decay: number;
  amp: number;
}

interface SwitchPreset {
  /** Keycap: hollow ABS shell, a few bright inharmonic modes. Most of the "clack" lives here. */
  cap: Resonance;
  /** Steel plate ring. */
  plate: Resonance;
  /** Case body: the mid "clack" of a stock MX board (well above a custom board's low thock). */
  case: Resonance;
  /** Unlubed spring ping: a trace of metallic shimmer. Keep tiny, or every key whistles. */
  spring: Resonance;
  /** Broadband "tak" of the stem slamming the housing. */
  impact: number;
  /** Click jacket: fires this many seconds before bottom-out, and again on release. */
  click?: { amp: number; lead: number };
  /** Tactile bump: a short scratchy rub this many seconds before bottom-out. */
  bump?: { amp: number; lead: number };
  /** Level of the top-out (release) clack relative to bottom-out. */
  up: number;
  /** Lowpass in Hz for muffled boards. */
  lowpass?: number;
}

const SWITCHES: Record<KeySwitch, SwitchPreset> = {
  // MX Blue: click jacket on the way down and up over a bright clack.
  clicky: {
    cap: { freq: 3300, decay: 0.005, amp: 0.5 },
    plate: { freq: 1650, decay: 0.009, amp: 0.26 },
    case: { freq: 560, decay: 0.014, amp: 0.32 },
    spring: { freq: 6800, decay: 0.03, amp: 0.01 },
    impact: 0.7,
    click: { amp: 1, lead: 0.01 },
    up: 0.7,
  },
  // MX Brown: a scratchy bump, then the same plastic clack.
  tactile: {
    cap: { freq: 3050, decay: 0.0055, amp: 0.55 },
    plate: { freq: 1500, decay: 0.01, amp: 0.28 },
    case: { freq: 520, decay: 0.016, amp: 0.36 },
    spring: { freq: 6300, decay: 0.03, amp: 0.01 },
    impact: 0.65,
    bump: { amp: 0.22, lead: 0.008 },
    up: 0.62,
  },
  // MX Red: smooth travel, clean clack on bottom-out and top-out.
  linear: {
    cap: { freq: 2850, decay: 0.006, amp: 0.55 },
    plate: { freq: 1420, decay: 0.011, amp: 0.3 },
    case: { freq: 470, decay: 0.018, amp: 0.4 },
    spring: { freq: 6000, decay: 0.025, amp: 0.008 },
    impact: 0.6,
    up: 0.6,
  },
  // Laptop / rubber dome: short, muffled, nearly silent release.
  membrane: {
    cap: { freq: 1700, decay: 0.004, amp: 0.4 },
    plate: { freq: 800, decay: 0.006, amp: 0.1 },
    case: { freq: 260, decay: 0.012, amp: 0.3 },
    spring: { freq: 5000, decay: 0.01, amp: 0 },
    impact: 0.25,
    up: 0.08,
    lowpass: 3600,
  },
};

// Inharmonic mode ratios of a small plastic shell, of a plate, and of the case.
const CAP_RATIOS = [1, 1.38, 1.83, 2.41];
const PLATE_RATIOS = [1, 1.62];
const CASE_RATIOS = [1, 1.93];

/**
 * How each finger presses. Index and middle fingers strike firmly and centred; ring and pinky are
 * lighter, less consistent and hit the cap off-centre more often; the thumb whacks the space bar.
 */
const FINGERS: Record<Finger, { force: number; spread: number; offCentre: number; hold: number }> = {
  1: { force: 1.1, spread: 0.1, offCentre: 0.35, hold: 0.08 },
  2: { force: 1, spread: 0.12, offCentre: 0.2, hold: 0.09 },
  3: { force: 0.95, spread: 0.12, offCentre: 0.2, hold: 0.09 },
  4: { force: 0.8, spread: 0.18, offCentre: 0.35, hold: 0.1 },
  5: { force: 0.68, spread: 0.22, offCentre: 0.5, hold: 0.11 },
};

type KeyKind = "key" | "space" | "enter";

/** Stable per-key timbre: every key's cap and seating differ slightly, but the same key always sounds the same. */
interface KeyVoice {
  capFreqs: number[];
  plateFreq: number;
  caseFreq: number;
  springFreq: number;
  /** Larger caps (space, enter) ring lower and longer. */
  size: number;
}

function keyVoice(char: string, kind: KeyKind, p: SwitchPreset, seed: number): KeyVoice {
  const random = rng(seed * 7919 + (char.toLowerCase().codePointAt(0) ?? 0) * 104729);
  const vary = (x: number, amount: number) => x * (1 + amount * (random() * 2 - 1));
  const size = kind === "space" ? 1.6 : kind === "enter" ? 1.25 : 1;
  // Taller sculpted rows sit a little lower in pitch.
  const row = 1 - 0.02 * Math.min(3, keyInfo(char).row);
  const cap = vary(p.cap.freq * row, 0.08) / size;
  return {
    capFreqs: CAP_RATIOS.map((r) => vary(cap * r, 0.03)),
    plateFreq: vary(p.plate.freq, 0.05),
    caseFreq: vary(p.case.freq / Math.sqrt(size), 0.05),
    springFreq: vary(p.spring.freq, 0.05),
    size,
  };
}

/**
 * Add a resonance excited by a noise burst: enveloped noise (~0.1 ms attack, `decay` time constant)
 * through a band-pass at `freq`. The noise envelope sets the length and a moderate Q sets the colour,
 * so it sounds like struck plastic rather than a pitched beep.
 */
function addMode(buf: Float32Array, sr: number, start: number, freq: number, decay: number, amp: number, random: () => number, q = 4) {
  if (amp === 0 || start < 0) return;
  const n = Math.min(buf.length - start, Math.ceil(decay * 7 * sr));
  if (n <= 0) return;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = (random() * 2 - 1) * (1 - Math.exp(-t / 0.0001)) * Math.exp(-t / decay);
  }
  biquad(x, sr, "bandpass", freq, q);
  // A band-pass keeps only bandwidth/(sr/2) of white noise's power; restore the level.
  const gain = amp * 0.35 * Math.sqrt(sr / 2 / (freq / q));
  for (let i = 0; i < n; i++) buf[start + i] += x[i] * gain;
}

/** Short noise burst, high-passed by differencing: the dry "tak" of an impact. */
function addTransient(buf: Float32Array, sr: number, start: number, length: number, amp: number, random: () => number) {
  if (start < 0) return;
  const n = Math.min(buf.length - start, Math.ceil(length * 6 * sr));
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = random() * 2 - 1;
    buf[start + i] += (x - prev) * 0.5 * amp * Math.exp(-i / sr / length);
    prev = x;
  }
}

interface Press {
  sr: number;
  p: SwitchPreset;
  voice: KeyVoice;
  random: () => number;
  /** How hard the finger hits: louder and brighter when higher. ~0.5 .. 1.3. */
  force: number;
  /** 0 = dead centre, 1 = the cap's edge: off-centre hits wobble the stem and favour higher cap modes. */
  offCentre: number;
}

/** One impact (bottom-out, or top-out when `up`) into `buf` at sample `at`. */
function addImpact(buf: Float32Array, at: number, level: number, up: boolean, press: Press) {
  const { sr, p, voice, random, force, offCentre } = press;
  const jitter = () => 1 + 0.015 * (random() * 2 - 1);
  const s = voice.size;
  // Harder presses excite the upper modes and the transient disproportionately: brighter, not just louder.
  const bright = Math.pow(force, 1.6);
  // Top-out is the stem slapping the top housing: a touch higher, almost no case.
  const capShift = up ? 1.08 : 1;
  addTransient(buf, sr, at, up ? 0.00035 : 0.0005, p.impact * level * bright, random);
  voice.capFreqs.forEach((f, k) => {
    const weight = k === 0 ? 1 - 0.4 * offCentre : (1 + offCentre) / (1 + 0.35 * k);
    addMode(buf, sr, at, f * capShift * jitter(), p.cap.decay * s * (1 - 0.12 * k), p.cap.amp * level * weight * (k > 1 ? bright : 1), random, 5);
  });
  PLATE_RATIOS.forEach((r, k) =>
    addMode(buf, sr, at, voice.plateFreq * r * jitter(), p.plate.decay * s, (p.plate.amp * level * (up ? 0.6 : 1)) / (1 + k), random, 6),
  );
  CASE_RATIOS.forEach((r, k) =>
    addMode(buf, sr, at, voice.caseFreq * r * jitter(), p.case.decay * s, (p.case.amp * level * (up ? 0.25 : 1)) / (1 + 1.5 * k), random, 3),
  );
  addMode(buf, sr, at, voice.springFreq * jitter(), p.spring.decay, p.spring.amp * level, random, 12);

  // An off-centre strike rocks the stem in the housing: a second, smaller clack 1–3 ms later.
  if (!up && offCentre > 0.3) {
    const wobble = at + Math.round((0.001 + 0.002 * random()) * sr);
    const amp = (offCentre - 0.3) * 0.6 * level;
    addTransient(buf, sr, wobble, 0.0003, p.impact * amp, random);
    addMode(buf, sr, wobble, voice.capFreqs[1] * jitter(), p.cap.decay * 0.6, p.cap.amp * amp, random, 5);
  }
  // Stabiliser wire rattle on long keys.
  if (s > 1 && !up) {
    for (const [delay, amp] of [[0.004, 0.25], [0.0095, 0.13]]) {
      const start = at + Math.round(delay * sr);
      addTransient(buf, sr, start, 0.0003, amp * level, random);
      addMode(buf, sr, start, 3600 * jitter(), 0.004, amp * 0.6 * level, random, 4);
    }
  }
}

/** A click-jacket snap: a very short, bright noise crack. */
function addClick(buf: Float32Array, at: number, level: number, { sr, random }: Press) {
  addTransient(buf, sr, at, 0.00025, level * 1.2, random);
  addMode(buf, sr, at, 4200 * (1 + 0.05 * (random() * 2 - 1)), 0.002, level * 0.5, random, 3);
}

/** A tactile bump: a brief, scratchy rub of the stem leg over the leaf. */
function addBump(buf: Float32Array, at: number, level: number, { sr, random }: Press) {
  if (at < 0) return;
  const n = Math.min(buf.length - at, Math.ceil(0.004 * sr));
  const rub = new Float32Array(n);
  for (let i = 0; i < n; i++) rub[i] = (random() * 2 - 1) * Math.sin((Math.PI * i) / n);
  biquad(rub, sr, "bandpass", 2600, 0.8);
  for (let i = 0; i < n; i++) buf[at + i] += rub[i] * level * 2;
}

export interface KeyboardOptions {
  switch?: KeySwitch;
  /** -1 (fuller, darker caps and more body) .. 1 (brighter, thinner). Default 0. */
  tone?: number;
  volume?: number;
  /** Seed for the board's per-key timbre and per-press variation. */
  seed?: number;
}

/** Seconds of lead-in before each bottom-out, for click jackets and tactile bumps. */
const LEAD = 0.02;
/** Seconds of sound per stroke buffer after release. */
const TAIL = 0.3;
/** Keeps a firm press at volume 1 around -6 dBFS. */
const LEVEL = 0.85;

/**
 * Synthesised mechanical keyboard (Cherry MX style on a steel plate). Every keystroke is a bottom-out
 * and a top-out clack, each exciting keycap, plate, case and spring resonances, plus the switch's click
 * or bump. Each key has a stable timbre. Each press depends on the finger that makes it (force,
 * brightness, off-centre wobble, hold time). Space and enter rattle, and keys are panned by their place
 * on the board. Keystroke times (the bottom-out) are relative to the start of the source.
 */
export function keyboardSound(keystrokes: readonly Keystroke[], opts: KeyboardOptions = {}): AudioSource {
  const base = SWITCHES[opts.switch ?? "tactile"];
  const tone = Math.max(-1, Math.min(1, opts.tone ?? 0));
  const p: SwitchPreset = {
    ...base,
    cap: { ...base.cap, freq: base.cap.freq * Math.pow(1.25, tone) },
    case: { ...base.case, amp: base.case.amp * Math.pow(1.8, -tone) },
  };
  const volume = (opts.volume ?? 0.5) * LEVEL;
  const seed = opts.seed ?? 7;
  const last = keystrokes.length ? keystrokes[keystrokes.length - 1].time : 0;
  return {
    duration: last + 0.6,
    render(sampleRate, seconds) {
      const sr = sampleRate;
      const out = makeStereo(Math.ceil(seconds * sr));
      const random = rng(seed);
      const voices = new Map<string, KeyVoice>();
      for (const { time, char } of keystrokes) {
        if (time < 0 || time >= seconds) continue;
        const kind: KeyKind = char === " " ? "space" : char === "\n" ? "enter" : "key";
        const key = keyInfo(char);
        const finger = FINGERS[key.finger];
        let voice = voices.get(char.toLowerCase());
        if (!voice) voices.set(char.toLowerCase(), (voice = keyVoice(char, kind, p, seed)));

        const force = Math.max(0.4, finger.force * (1 + finger.spread * (random() * 2 - 1)));
        const press: Press = { sr, p, voice, random, force, offCentre: Math.min(1, finger.offCentre * random() * 2) };
        // A light press sometimes stops short of fully bottoming out: a softer clack.
        const bottom = force < 0.75 && random() < 0.4 ? 0.55 : 1;
        const hold = finger.hold * (0.75 + 0.5 * random());

        const buf = new Float32Array(Math.ceil((LEAD + hold + TAIL) * sr));
        const down = Math.round(LEAD * sr);
        const upAt = Math.round((LEAD + hold) * sr);
        if (p.click) addClick(buf, down - Math.round(p.click.lead * sr), p.click.amp * force, press);
        if (p.bump) addBump(buf, down - Math.round(p.bump.lead * sr), p.bump.amp * force, press);
        addImpact(buf, down, force * bottom, false, press);
        if (p.click) addClick(buf, upAt - Math.round(0.004 * sr), p.click.amp * 0.6, press);
        // The spring returns the key on its own, so the top-out doesn't depend on the finger's force.
        addImpact(buf, upAt, p.up * (0.9 + 0.2 * random()), true, press);
        if (p.lowpass) biquad(buf, sr, "lowpass", p.lowpass, 0.7);

        // Desk reflection a few ms behind the direct sound.
        const reflect = Math.round(0.0028 * sr);
        for (let i = buf.length - 1; i >= reflect; i--) buf[i] += buf[i - reflect] * 0.2;

        const angle = ((key.pan + 1) * Math.PI) / 4;
        const gl = Math.cos(angle) * Math.SQRT2 * volume;
        const gr = Math.sin(angle) * Math.SQRT2 * volume;
        const offset = Math.round(time * sr) - down;
        for (let i = Math.max(0, -offset); i < buf.length && offset + i < out[0].length; i++) {
          out[0][offset + i] += buf[i] * gl;
          out[1][offset + i] += buf[i] * gr;
        }
      }
      // A small, close room.
      addInto(out, reverb(out, sr, { room: 0.2, damping: 0.6 }), 0.06);
      return out;
    },
  };
}
