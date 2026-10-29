import type { Animatable, Easing, EasingFn, EasingName, FrameContext } from "./types";

export const easings: Record<EasingName, EasingFn> = {
  linear: (x) => x,
  easeIn: (x) => x * x * x,
  easeOut: (x) => 1 - Math.pow(1 - x, 3),
  easeInOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
};

export function toEasingFn(easing: Easing = "linear"): EasingFn {
  return typeof easing === "function" ? easing : easings[easing];
}

export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/** Map `input` from `inRange` to `outRange` (piecewise linear, eased per segment). Clamps by default. */
export function interpolate(
  input: number,
  inRange: readonly number[],
  outRange: readonly number[],
  opts: { easing?: Easing; clamp?: boolean } = {},
): number {
  if (inRange.length !== outRange.length || inRange.length < 2) {
    throw new Error("interpolate: inRange and outRange must have the same length (>= 2)");
  }
  const ease = toEasingFn(opts.easing);
  const shouldClamp = opts.clamp ?? true;
  const last = inRange.length - 1;
  if (shouldClamp) {
    if (input <= inRange[0]) return outRange[0];
    if (input >= inRange[last]) return outRange[last];
  }
  let i = 0;
  while (i < last - 1 && input > inRange[i + 1]) i++;
  const span = inRange[i + 1] - inRange[i];
  const p = span === 0 ? 1 : (input - inRange[i]) / span;
  return outRange[i] + (outRange[i + 1] - outRange[i]) * ease(p);
}

/**
 * Keyframes over clip-local time in seconds.
 * `kf([[0, 0], [1, 1]], "easeOut")` animates 0 → 1 during the first second of the clip.
 */
export function kf(points: readonly (readonly [number, number])[], easing?: Easing): (t: FrameContext) => number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const times = sorted.map((p) => p[0]);
  const values = sorted.map((p) => p[1]);
  if (sorted.length === 1) return () => values[0];
  return (t) => interpolate(t.local, times, values, { easing });
}

export interface SpringOptions {
  from?: number;
  to?: number;
  /** Seconds after clip start before the spring begins. */
  delay?: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
}

/** Damped spring evaluated deterministically at the clip's local frame. */
export function spring(t: FrameContext, opts: SpringOptions = {}): number {
  const { from = 0, to = 1, delay = 0, stiffness = 100, damping = 10, mass = 1 } = opts;
  const frames = t.localFrame - Math.round(delay * t.fps);
  if (frames <= 0) return from;
  const substeps = 4;
  const dt = 1 / t.fps / substeps;
  let x = from;
  let v = 0;
  for (let i = 0; i < frames * substeps; i++) {
    const a = (-stiffness * (x - to) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
  }
  return x;
}

export function resolveValue<T>(value: Animatable<T>, t: FrameContext): T {
  return typeof value === "function" ? (value as (t: FrameContext) => T)(t) : value;
}
