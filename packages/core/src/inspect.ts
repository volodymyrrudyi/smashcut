import type { AudioClip } from "./audio/mix";
import type { ResolvedClip, ResolvedComposition } from "./resolve";
import type { Composition, Node } from "./types";

const short = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const file = (src: string) => decodeURIComponent(src.split("/").pop() ?? src);
const round = (s: number) => Math.round(s * 1000) / 1000;

/** A human name for a clip: its id, or what it shows. Used by the dev timeline and `smashcut inspect`. */
export function clipLabel(node: Node): string {
  if (node.id) return node.id;
  switch (node.kind) {
    case "text":
      return typeof node.text === "string" ? `“${short(node.text.replace(/\n/g, " "), 34)}”` : "text (animated)";
    case "image":
    case "video":
      return `${node.kind}: ${file(node.src)}`;
    case "react":
      return `<${node.component.displayName || node.component.name || "Component"}>`;
    case "solid":
      return typeof node.color === "string" ? `solid ${node.color}` : "solid (animated)";
    case "group":
      // Unnamed groups say what's in them; name scenes with `id` for clearer labels.
      return short(`group: ${node.children.map(clipLabel).join(", ")}`, 48);
    case "series":
      return `series (${node.items.filter((i) => i.kind !== "transition").length} scenes)`;
    case "frame":
      return `frame: ${node.frame.chrome ?? "browser"}${node.frame.url ? ` ${node.frame.url}` : node.frame.title ? ` ${node.frame.title}` : ""}`;
    case "subtitles":
      return `subtitles (${node.cues.length} cues, ${node.preset})`;
    case "decor":
      return `decor: ${node.decor.type}`;
  }
}

export interface ClipSummary {
  /** Position in the tree, e.g. "1.0.2". */
  path: string;
  depth: number;
  kind: Node["kind"];
  label: string;
  /** Seconds on the video timeline. */
  start: number;
  end: number;
  transitionIn?: string;
  transitionOut?: string;
}

export interface SoundSummary {
  label: string;
  start: number;
  end: number;
  volume: number;
}

/** Everything on a resolved timeline, in seconds: what `smashcut inspect` prints. */
export interface TimelineSummary {
  width: number;
  height: number;
  fps: number;
  duration: number;
  frames: number;
  clips: ClipSummary[];
  captions: { start: number; end: number; text: string }[];
  sounds: SoundSummary[];
}

/** Where a sound clip stops, in seconds: its own duration, its source's length, or the end of the video. */
export function soundEnd(clip: AudioClip, total: number): number {
  return Math.min(total, clip.at + (clip.duration ?? clip.source.duration ?? total - clip.at));
}

/** Flatten a resolved composition into clips, captions and sounds with absolute times. */
export function describeTimeline(comp: ResolvedComposition, composition: Composition): TimelineSummary {
  const fps = comp.fps;
  const duration = comp.durationInFrames / fps;
  const clips: ClipSummary[] = [];
  const captions: TimelineSummary["captions"] = [];
  const walk = (clip: ResolvedClip, depth: number) => {
    const { node } = clip;
    const start = clip.start / fps;
    const end = (clip.start + clip.duration) / fps;
    const transition = (t: ResolvedClip["transitionIn"]) => t && `${t.spec.type} ${round(t.frames / fps)}s`;
    clips.push({
      path: clip.path,
      depth,
      kind: node.kind,
      label: clipLabel(node),
      start: round(start),
      end: round(end),
      ...(clip.transitionIn && { transitionIn: transition(clip.transitionIn) }),
      ...(clip.transitionOut && { transitionOut: transition(clip.transitionOut) }),
    });
    if (node.kind === "subtitles") {
      for (const cue of node.cues) {
        const a = Math.max(start, start + cue.start - node.from);
        const b = Math.min(end, start + cue.end - node.from);
        if (b > a) captions.push({ start: round(a), end: round(b), text: cue.text.replace(/\n/g, " ") });
      }
    }
    clip.children.forEach((c) => walk(c, depth + 1));
  };
  comp.layers.forEach((c) => walk(c, 0));
  const sounds = (composition.audio ?? []).map((a) => ({
    label: a.label ?? "sound",
    start: round(a.at),
    end: round(soundEnd(a, duration)),
    volume: a.volume,
  }));
  return { width: comp.width, height: comp.height, fps, duration: round(duration), frames: comp.durationInFrames, clips, captions, sounds };
}

const ts = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const span = (a: number, b: number) => `${ts(a)}–${ts(b)}`;

/** The summary as readable text: the clip tree, the captions, and the sounds grouped by label. */
export function formatTimeline(t: TimelineSummary): string {
  const lines = [`${t.width}×${t.height}, ${t.fps} fps, ${ts(t.duration)} (${t.frames} frames)`, "", "Clips"];
  for (const c of t.clips) {
    const transitions = [c.transitionIn && `in: ${c.transitionIn}`, c.transitionOut && `out: ${c.transitionOut}`].filter(Boolean);
    lines.push(`  ${span(c.start, c.end)}  ${"  ".repeat(c.depth)}${c.label}${transitions.length ? `  [${transitions.join(", ")}]` : ""}`);
  }
  if (t.captions.length) {
    lines.push("", "Captions");
    for (const c of t.captions) lines.push(`  ${span(c.start, c.end)}  ${c.text}`);
  }
  if (t.sounds.length) {
    lines.push("", "Sounds");
    const byLabel = new Map<string, SoundSummary[]>();
    for (const s of t.sounds) byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s]);
    for (const [label, list] of byLabel) {
      const first = Math.min(...list.map((s) => s.start));
      const last = Math.max(...list.map((s) => s.end));
      const at = list.length <= 6 ? list.map((s) => ts(s.start)).join(", ") : `${list.length} times, ${span(first, last)}`;
      lines.push(`  ${label.padEnd(10)} ${list.length === 1 ? span(first, last) : at}`);
    }
  }
  return lines.join("\n");
}
