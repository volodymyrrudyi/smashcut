import { clamp, resolveValue, toEasingFn } from "./animate";
import { toFrames, type ResolvedClip } from "./resolve";
import type { EffectSpec, EffectType, FrameContext, TransitionSpec } from "./types";

/** The composited visual state of a clip wrapper at one frame. */
export interface Visual {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  clipPath?: string;
}

export const IDENTITY: Visual = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 };

export function combine(a: Visual, b: Partial<Visual>): Visual {
  return {
    opacity: a.opacity * (b.opacity ?? 1),
    x: a.x + (b.x ?? 0),
    y: a.y + (b.y ?? 0),
    scale: a.scale * (b.scale ?? 1),
    rotate: a.rotate + (b.rotate ?? 0),
    clipPath: b.clipPath ?? a.clipPath,
  };
}

interface Size {
  width: number;
  height: number;
}

/** Enter/exit effect. `p` = 0 fully hidden, 1 fully shown. */
export function effectVisual(type: EffectType, p: number, size: Size): Partial<Visual> {
  switch (type) {
    case "fade":
      return { opacity: p };
    case "fade-up":
      return { opacity: p, y: (1 - p) * 40 };
    case "fade-down":
      return { opacity: p, y: -(1 - p) * 40 };
    case "zoom":
      return { opacity: p, scale: 0.85 + 0.15 * p };
    case "slide-left":
      return { x: (1 - p) * size.width };
    case "slide-right":
      return { x: -(1 - p) * size.width };
    case "wipe":
      return { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
  }
}

/** Visuals for both sides of a transition at progress `p` (0 = start of overlap, 1 = end). */
export function transitionVisuals(
  spec: TransitionSpec,
  p: number,
  size: Size,
): { incoming: Partial<Visual>; outgoing: Partial<Visual> } {
  const sign = spec.direction === "left" || spec.direction === "up" ? 1 : -1;
  const horizontal = spec.direction === "left" || spec.direction === "right";
  switch (spec.type) {
    case "fade":
      return { incoming: { opacity: p }, outgoing: {} };
    case "dip":
      // Out to the background in the first half, in from it in the second: never superimposed.
      return { incoming: { opacity: clamp(2 * p - 1) }, outgoing: { opacity: clamp(1 - 2 * p) } };
    case "zoom":
      // Hand-off rather than crossfade: the outgoing clip leaves in the first half, the incoming one
      // arrives in the second, so two layouts are never superimposed.
      return {
        incoming: { opacity: clamp(2 * p - 1), scale: 1.08 - 0.08 * p },
        outgoing: { opacity: clamp(1 - 2 * p), scale: 1 - 0.08 * p },
      };
    case "slide": {
      const extent = horizontal ? size.width : size.height;
      const inOffset = sign * (1 - p) * extent;
      const outOffset = -sign * p * extent;
      return horizontal
        ? { incoming: { x: inOffset }, outgoing: { x: outOffset } }
        : { incoming: { y: inOffset }, outgoing: { y: outOffset } };
    }
    case "wipe": {
      const hidden = `${(1 - p) * 100}%`;
      const clipPath = {
        left: `inset(0 0 0 ${hidden})`,
        right: `inset(0 ${hidden} 0 0)`,
        up: `inset(${hidden} 0 0 0)`,
        down: `inset(0 0 ${hidden} 0)`,
      }[spec.direction];
      return { incoming: { clipPath }, outgoing: {} };
    }
  }
}

const DEFAULT_EFFECT_SECONDS = 0.4;

function normalizeEffect(spec: EffectSpec) {
  return typeof spec === "string" ? { type: spec, duration: DEFAULT_EFFECT_SECONDS, easing: "easeOut" as const } : {
    type: spec.type,
    duration: spec.duration ?? DEFAULT_EFFECT_SECONDS,
    easing: spec.easing ?? "easeOut",
  };
}

/** Full visual state of a clip: its own transform, enter/exit effects and series transitions. */
export function clipVisual(clip: ResolvedClip, t: FrameContext): Visual {
  const { node } = clip;
  let v: Visual = {
    opacity: resolveValue(node.opacity ?? 1, t),
    x: resolveValue(node.x ?? 0, t),
    y: resolveValue(node.y ?? 0, t),
    scale: resolveValue(node.scale ?? 1, t),
    rotate: resolveValue(node.rotate ?? 0, t),
  };

  if (node.enter) {
    const e = normalizeEffect(node.enter);
    const frames = toFrames(e.duration, t.fps);
    if (frames > 0 && t.localFrame < frames) {
      v = combine(v, effectVisual(e.type, toEasingFn(e.easing)(clamp(t.localFrame / frames)), t));
    }
  }
  if (node.exit) {
    const e = normalizeEffect(node.exit);
    const frames = toFrames(e.duration, t.fps);
    const remaining = clip.duration - 1 - t.localFrame;
    if (frames > 0 && remaining < frames) {
      v = combine(v, effectVisual(e.type, toEasingFn(e.easing)(clamp(remaining / frames)), t));
    }
  }

  for (const [tr, side] of [
    [clip.transitionIn, "incoming"],
    [clip.transitionOut, "outgoing"],
  ] as const) {
    if (!tr || t.frame < tr.start || t.frame >= tr.start + tr.frames) continue;
    const p = toEasingFn(tr.spec.easing)(clamp((t.frame - tr.start) / tr.frames));
    v = combine(v, transitionVisuals(tr.spec, p, t)[side]);
  }

  return v;
}
