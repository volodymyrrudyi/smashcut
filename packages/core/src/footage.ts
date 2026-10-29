import type { Composition, MediaInfo, Node, VideoNode } from "./types";

const trimOf = (node: VideoNode, info: MediaInfo): [number, number] => {
  const start = Math.max(0, node.trim?.[0] ?? 0);
  const end = Math.min(info.duration, node.trim?.[1] ?? info.duration);
  if (end <= start) throw new Error(`video "${node.src}": trim [${start}, ${end}] is empty`);
  return [start, end];
};

/** Timeline seconds the trimmed source plays for at the clip's playback rate. */
export function footageDuration(node: VideoNode, info: MediaInfo): number {
  const [start, end] = trimOf(node, info);
  return (end - start) / (node.playbackRate ?? 1);
}

/**
 * Source time in seconds shown `local` seconds into the clip. Past the end of the trim it holds the
 * last frame, or wraps around when the clip loops.
 */
export function footageTime(node: VideoNode, info: MediaInfo, local: number): number {
  const [start, end] = trimOf(node, info);
  const length = end - start;
  let t = Math.max(0, local) * (node.playbackRate ?? 1);
  if (node.loop) t %= length;
  return start + Math.min(t, length);
}

/** Index of the frame (at `fps`) shown `local` seconds into the clip, never outside the trim. */
export function footageFrame(node: VideoNode, info: MediaInfo, local: number, fps: number): number {
  const [start, end] = trimOf(node, info);
  // A tiny epsilon keeps exact frame times (k / fps) from rounding down to the previous frame.
  const index = Math.floor(footageTime(node, info, local) * fps + 1e-6);
  return Math.max(Math.floor(start * fps + 1e-6), Math.min(Math.ceil(end * fps - 1e-6) - 1, index));
}

export function mediaInfo(media: Composition["media"], node: VideoNode): MediaInfo {
  const info = media?.[node.src];
  if (!info) throw new Error(`No media info for video "${node.src}" (is the file in assets/?)`);
  return info;
}

/** Every distinct footage `src` in the tree. */
export function footageSources(layers: Node[]): string[] {
  const out = new Set<string>();
  const walk = (node: Node) => {
    if (node.kind === "video") out.add(node.src);
    else if (node.kind === "group" || node.kind === "frame") node.children.forEach(walk);
    else if (node.kind === "series") node.items.forEach((item) => item.kind !== "transition" && walk(item));
  };
  layers.forEach(walk);
  return [...out];
}
