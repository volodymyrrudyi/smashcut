import { interpolate } from "./animate";
import type { Easing, FrameContext } from "./types";

/** Where the camera looks: a point in frame pixels and a zoom. Omitted x / y = frame centre. */
export interface Shot {
  x?: number;
  y?: number;
  scale: number;
}

export interface CameraProps {
  x: (t: FrameContext) => number;
  y: (t: FrameContext) => number;
  scale: (t: FrameContext) => number;
}

/**
 * Camera moves for a group: keyframes of `[clip-local seconds, shot]`, eased between. Spread the
 * result into the group's props: `group([...], { ...camera([[0, { scale: 1 }], [1, { x: 1200, y: 400, scale: 2 }]]) })`.
 * The shot's point ends up in the centre of the frame.
 */
export function camera(shots: readonly (readonly [number, Shot])[], easing: Easing = "easeInOut"): CameraProps {
  const sorted = [...shots].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) throw new Error("camera() needs at least one shot");
  if (sorted.length === 1) sorted.push([sorted[0][0] + 1, sorted[0][1]]);
  const times = sorted.map(([time]) => time);
  const at = (t: FrameContext) => {
    const scale = interpolate(t.local, times, sorted.map(([, s]) => s.scale), { easing });
    const fx = interpolate(t.local, times, sorted.map(([, s]) => s.x ?? t.width / 2), { easing });
    const fy = interpolate(t.local, times, sorted.map(([, s]) => s.y ?? t.height / 2), { easing });
    // Content scales about the frame centre, then shifts so the focus point lands in the centre.
    return { scale, x: -scale * (fx - t.width / 2), y: -scale * (fy - t.height / 2) };
  };
  return { x: (t) => at(t).x, y: (t) => at(t).y, scale: (t) => at(t).scale };
}

export interface ZoomOptions {
  /** Clip-local seconds when the zoom in starts. */
  at: number;
  /** Seconds for the move in (and out). Default 0.8. */
  duration?: number;
  /** Seconds to stay zoomed before moving back out. Omit to stay zoomed in. */
  hold?: number;
  easing?: Easing;
}

/** Zoom in on a point, optionally hold, and zoom back out. */
export function zoomTo(target: { x: number; y: number; scale: number }, opts: ZoomOptions): CameraProps {
  const d = opts.duration ?? 0.8;
  const wide: Shot = { scale: 1 };
  const shots: [number, Shot][] = [
    [opts.at, wide],
    [opts.at + d, target],
  ];
  if (opts.hold !== undefined) shots.push([opts.at + d + opts.hold, target], [opts.at + 2 * d + opts.hold, wide]);
  return camera(shots, opts.easing);
}
