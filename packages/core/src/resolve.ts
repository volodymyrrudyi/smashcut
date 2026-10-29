import { footageDuration, mediaInfo } from "./footage";
import type { Composition, FrameContext, Node, TransitionSpec } from "./types";

type Media = Composition["media"];

export interface ResolvedTransition {
  spec: TransitionSpec;
  /** Absolute frame where the overlap starts. */
  start: number;
  frames: number;
}

export interface ResolvedClip {
  node: Node;
  /** Stable id within the tree, used as a React key. */
  path: string;
  /** Absolute start frame. */
  start: number;
  /** Duration in frames. */
  duration: number;
  children: ResolvedClip[];
  transitionIn?: ResolvedTransition;
  transitionOut?: ResolvedTransition;
}

export interface ResolvedComposition {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  background: string;
  layers: ResolvedClip[];
  media: NonNullable<Media>;
}

export const toFrames = (seconds: number, fps: number) => Math.round(seconds * fps);

const describe = (node: Node, path: string) => `${node.kind}${node.id ? ` "${node.id}"` : ""} at ${path}`;

/** Duration in frames that a node defines on its own, or undefined if it fills whatever it is given. */
export function intrinsicFrames(node: Node, fps: number, path = "root", media?: Media): number | undefined {
  if (node.duration !== undefined) return toFrames(node.duration, fps);
  if (node.kind === "video") return toFrames(footageDuration(node, mediaInfo(media, node)), fps);
  if (node.kind === "subtitles") {
    const last = node.cues.reduce((end, c) => Math.max(end, c.end), 0);
    return last > node.from ? toFrames(last - node.from, fps) : undefined;
  }
  if (node.kind === "series") {
    let total = 0;
    node.items.forEach((item, i) => {
      if (item.kind === "transition") {
        total -= toFrames(item.duration, fps);
        return;
      }
      const d = intrinsicFrames(item, fps, `${path}.${i}`, media);
      if (d === undefined) {
        throw new Error(`${describe(item, `${path}.${i}`)} is inside a series and needs a duration`);
      }
      total += d;
    });
    return total;
  }
  if (node.kind === "group" || node.kind === "frame") {
    let max: number | undefined;
    node.children.forEach((child, i) => {
      const d = intrinsicFrames(child, fps, `${path}.${i}`, media);
      if (d !== undefined) max = Math.max(max ?? 0, toFrames(child.at ?? 0, fps) + d);
    });
    return max;
  }
  return undefined;
}

function resolveNode(
  node: Node,
  start: number,
  available: number,
  fps: number,
  path: string,
  media: Media,
): ResolvedClip {
  const duration = intrinsicFrames(node, fps, path, media) ?? available;
  const clip: ResolvedClip = { node, path, start, duration, children: [] };

  if (node.kind === "group" || node.kind === "frame") {
    clip.children = node.children.map((child, i) => {
      const at = toFrames(child.at ?? 0, fps);
      return resolveNode(child, start + at, Math.max(0, duration - at), fps, `${path}.${i}`, media);
    });
  }

  if (node.kind === "series") {
    let cursor = start;
    let prev: ResolvedClip | undefined;
    let pending: TransitionSpec | undefined;
    node.items.forEach((item, i) => {
      const itemPath = `${path}.${i}`;
      if (item.kind === "transition") {
        if (!prev || pending) throw new Error(`Transition at ${itemPath} must sit between two clips`);
        pending = item;
        return;
      }
      const d = intrinsicFrames(item, fps, itemPath, media)!;
      let s = cursor;
      let transitionIn: ResolvedTransition | undefined;
      if (pending) {
        const frames = toFrames(pending.duration, fps);
        if (frames > prev!.duration || frames > d) {
          throw new Error(`Transition before ${describe(item, itemPath)} is longer than one of its neighbours`);
        }
        s -= frames;
        transitionIn = { spec: pending, start: s, frames };
        prev!.transitionOut = transitionIn;
        pending = undefined;
      }
      const child = resolveNode(item, s, d, fps, itemPath, media);
      child.transitionIn = transitionIn;
      clip.children.push(child);
      cursor = s + d;
      prev = child;
    });
    if (pending) throw new Error(`Series at ${path} cannot end with a transition`);
  }

  return clip;
}

export function resolveComposition(comp: Composition): ResolvedComposition {
  const { fps, media } = comp;
  let durationInFrames = comp.duration !== undefined ? toFrames(comp.duration, fps) : 0;
  if (comp.duration === undefined) {
    comp.layers.forEach((layer, i) => {
      const d = intrinsicFrames(layer, fps, `${i}`, media);
      if (d !== undefined) durationInFrames = Math.max(durationInFrames, toFrames(layer.at ?? 0, fps) + d);
    });
  }
  if (durationInFrames <= 0) {
    throw new Error("Cannot infer the video duration: set `duration` on defineVideo() or on a layer");
  }
  const layers = comp.layers.map((layer, i) => {
    const at = toFrames(layer.at ?? 0, fps);
    return resolveNode(layer, at, Math.max(0, durationInFrames - at), fps, `${i}`, media);
  });
  return {
    width: comp.width,
    height: comp.height,
    fps,
    durationInFrames,
    background: comp.background,
    layers,
    media: media ?? {},
  };
}

export function isActive(clip: ResolvedClip, frame: number): boolean {
  return frame >= clip.start && frame < clip.start + clip.duration;
}

export function frameContext(comp: ResolvedComposition, clip: ResolvedClip, frame: number): FrameContext {
  const localFrame = frame - clip.start;
  return {
    frame,
    time: frame / comp.fps,
    localFrame,
    local: localFrame / comp.fps,
    duration: clip.duration / comp.fps,
    progress: clip.duration > 0 ? localFrame / clip.duration : 0,
    fps: comp.fps,
    width: comp.width,
    height: comp.height,
  };
}
