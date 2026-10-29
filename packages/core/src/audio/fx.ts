import { makeStereo, type AudioSource, type Stereo } from "./synth";

export type FilterType = "lowpass" | "highpass" | "bandpass";

/**
 * RBJ biquad filter, applied in place. `cutoff` may be a function of the sample index for sweeps;
 * coefficients are then refreshed every 64 samples.
 */
export function biquad(
  x: Float32Array,
  sampleRate: number,
  type: FilterType,
  cutoff: number | ((i: number) => number),
  q = Math.SQRT1_2,
) {
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  const update = (fc: number) => {
    const w = (2 * Math.PI * Math.min(Math.max(fc, 10), sampleRate * 0.45)) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const [n0, n1, n2] =
      type === "lowpass" ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
      : type === "highpass" ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
      : [alpha, 0, -alpha];
    b0 = n0 / a0;
    b1 = n1 / a0;
    b2 = n2 / a0;
    a1 = (-2 * cos) / a0;
    a2 = (1 - alpha) / a0;
  };
  const sweep = typeof cutoff === "function" ? cutoff : undefined;
  if (!sweep) update(cutoff as number);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (sweep && (i & 63) === 0) update(sweep(i));
    const x0 = x[i];
    const y = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

// Freeverb tunings (samples at 44.1 kHz).
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

export interface ReverbOptions {
  /** 0..1, bigger = longer tail. Default 0.8. */
  room?: number;
  /** 0..1, higher = darker tail. Default 0.5. */
  damping?: number;
}

/** Freeverb (Schroeder–Moorer): returns only the wet signal. */
export function reverb(input: Stereo, sampleRate: number, opts: ReverbOptions = {}): Stereo {
  const feedback = (opts.room ?? 0.8) * 0.28 + 0.7;
  const damp = (opts.damping ?? 0.5) * 0.4;
  const scale = sampleRate / 44100;
  const n = input[0].length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (input[0][i] + input[1][i]) * 0.015;
  const out = makeStereo(n);

  for (let ch = 0; ch < 2; ch++) {
    const combs = COMBS.map((len) => ({ buf: new Float32Array(Math.round((len + ch * STEREO_SPREAD) * scale)), idx: 0, store: 0 }));
    const allpasses = ALLPASSES.map((len) => ({ buf: new Float32Array(Math.round((len + ch * STEREO_SPREAD) * scale)), idx: 0 }));
    const dst = out[ch];
    for (let i = 0; i < n; i++) {
      const x = mono[i];
      let sum = 0;
      for (const c of combs) {
        const y = c.buf[c.idx];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.idx] = x + c.store * feedback;
        if (++c.idx === c.buf.length) c.idx = 0;
        sum += y;
      }
      for (const a of allpasses) {
        const b = a.buf[a.idx];
        a.buf[a.idx] = sum + b * 0.5;
        sum = b - sum;
        if (++a.idx === a.buf.length) a.idx = 0;
      }
      dst[i] = sum * 3;
    }
  }
  return out;
}

export interface DelayOptions {
  /** Seconds between echoes. */
  time: number;
  /** 0..1. Default 0.4. */
  feedback?: number;
  /** Echoes bounce between left and right. Default true. */
  pingPong?: boolean;
}

/** Echo with darkening repeats; returns only the wet signal. */
export function delay(input: Stereo, sampleRate: number, opts: DelayOptions): Stereo {
  const d = Math.max(1, Math.round(opts.time * sampleRate));
  const fb = opts.feedback ?? 0.4;
  const pingPong = opts.pingPong ?? true;
  const n = input[0].length;
  const out = makeStereo(n);
  const bufL = new Float32Array(d);
  const bufR = new Float32Array(d);
  let lpL = 0, lpR = 0;
  for (let i = 0, idx = 0; i < n; i++) {
    const dl = bufL[idx];
    const dr = bufR[idx];
    out[0][i] = dl;
    out[1][i] = dr;
    lpL += 0.45 * (dl - lpL);
    lpR += 0.45 * (dr - lpR);
    if (pingPong) {
      bufL[idx] = (input[0][i] + input[1][i]) * 0.5 + lpR * fb;
      bufR[idx] = lpL * fb;
    } else {
      bufL[idx] = input[0][i] + lpL * fb;
      bufR[idx] = input[1][i] + lpR * fb;
    }
    if (++idx === d) idx = 0;
  }
  return out;
}

/** dst += src * gain, channel by channel. */
export function addInto(dst: Stereo, src: Stereo, gain = 1) {
  for (let ch = 0; ch < 2; ch++) {
    const a = dst[ch], b = src[ch];
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) a[i] += b[i] * gain;
  }
}

/** Wrap any source with a reverb tail; `tail` seconds are added to its length. */
export function withReverb(source: AudioSource, opts: ReverbOptions & { wet?: number; tail?: number } = {}): AudioSource {
  const tail = opts.tail ?? 1.2;
  return {
    duration: source.duration === undefined ? undefined : source.duration + tail,
    render(sampleRate, seconds) {
      const dry = source.render(sampleRate, seconds);
      addInto(dry, reverb(dry, sampleRate, opts), opts.wet ?? 0.3);
      return dry;
    },
  };
}
