import type { Composition, Node } from "./types";

export const MAX_FPS = 240;

export function finiteNumber(value: number, name: string, min = 0, max = Infinity): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number in ${min}..${max}, got ${value}`);
  }
}

export function positiveInteger(value: number, name: string, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer in 1..${max}, got ${value}`);
  }
}

/** Validate raw compositions too, so callers cannot bypass checks by spreading a builder's result. */
export function validateComposition(comp: Composition): void {
  positiveInteger(comp.width, "Video width");
  positiveInteger(comp.height, "Video height");
  positiveInteger(comp.fps, "Video fps", MAX_FPS);
  if (comp.duration !== undefined) finiteNumber(comp.duration, "Video duration", Number.MIN_VALUE);
  if (typeof comp.loudness === "number") finiteNumber(comp.loudness, "Video loudness", -70, 0);
  const walk = (node: Node, path: string) => {
    if (node.at !== undefined) finiteNumber(node.at, `${path} at`);
    if (node.duration !== undefined) finiteNumber(node.duration, `${path} duration`);
    if (node.kind === "video") {
      if (node.playbackRate !== undefined) finiteNumber(node.playbackRate, `${path} playbackRate`, Number.MIN_VALUE);
      if (node.trim) {
        finiteNumber(node.trim[0], `${path} trim start`);
        if (node.trim[1] !== undefined) finiteNumber(node.trim[1], `${path} trim end`, Number.MIN_VALUE);
        if (node.trim[1] !== undefined && node.trim[1] <= node.trim[0]) throw new Error(`${path} trim end must be after its start`);
      }
    }
    if (node.kind === "group" || node.kind === "frame") node.children.forEach((n, i) => walk(n, `${path}.${i}`));
    if (node.kind === "series") node.items.forEach((n, i) => {
      if (n.kind === "transition") finiteNumber(n.duration, `${path}.${i} transition duration`);
      else walk(n, `${path}.${i}`);
    });
  };
  comp.layers.forEach((node, i) => walk(node, `layers.${i}`));
  comp.audio?.forEach((clip, i) => {
    const name = `audio.${i}`;
    finiteNumber(clip.at, `${name} at`);
    if (clip.duration !== undefined) finiteNumber(clip.duration, `${name} duration`);
    if (clip.source.duration !== undefined) finiteNumber(clip.source.duration, `${name} source duration`);
    finiteNumber(clip.volume, `${name} volume`);
    finiteNumber(clip.fadeIn, `${name} fadeIn`);
    finiteNumber(clip.fadeOut, `${name} fadeOut`);
    if (clip.duck !== undefined) finiteNumber(clip.duck, `${name} duck`, 0, 1);
  });
}
