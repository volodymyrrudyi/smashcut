import type { ComponentType } from "react";
import type { AudioClip } from "./audio/mix";
import type {
  Animatable,
  BaseProps,
  BorderDecor,
  Composition,
  DecorNode,
  Direction,
  Easing,
  FrameNode,
  FrameStyle,
  GrainDecor,
  GroupNode,
  ImageNode,
  Node,
  Position,
  ReactNodeSpec,
  SeriesNode,
  SolidNode,
  TextNode,
  TransitionSpec,
  TransitionType,
  VignetteDecor,
  WatermarkDecor,
  VideoNode,
} from "./types";

export interface VideoOptions {
  size: [width: number, height: number];
  fps?: number;
  /** Seconds. Inferred from layers when omitted. */
  duration?: number;
  background?: string;
  layers: Node[];
  audio?: AudioClip[];
  /**
   * Integrated loudness (LUFS) the exported soundtrack is normalised to, with peaks kept under -1.5 dBFS.
   * One gain for the whole mix, so the balance between music and effects is kept. Default -16 (web / social);
   * false leaves the mix as is.
   */
  loudness?: number | false;
}

export function defineVideo(opts: VideoOptions): Composition {
  const [width, height] = opts.size;
  return {
    width,
    height,
    fps: opts.fps ?? 30,
    duration: opts.duration,
    background: opts.background ?? "#000",
    layers: opts.layers,
    audio: opts.audio,
    loudness: opts.loudness ?? -16,
  };
}

/** URL of a file in the video's assets/ folder. */
export function asset(path: string): string {
  return "/assets/" + path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

export const solid = (color: Animatable<string>, opts: BaseProps = {}): SolidNode => ({ ...opts, kind: "solid", color });

export const image = (src: string, opts: Omit<ImageNode, "kind" | "src"> = {}): ImageNode => ({
  ...opts,
  kind: "image",
  src,
});

/** A footage file. Its duration defaults to the (trimmed) length of the source. */
export const video = (src: string, opts: Omit<VideoNode, "kind" | "src"> = {}): VideoNode => ({
  ...opts,
  kind: "video",
  src,
});

export const text = (content: Animatable<string>, opts: Omit<TextNode, "kind" | "text"> = {}): TextNode => ({
  ...opts,
  kind: "text",
  text: content,
});

export function react<P extends object>(component: ComponentType<P>, props: P, opts: BaseProps = {}): ReactNodeSpec {
  return { ...opts, kind: "react", component, props: props as Record<string, unknown> };
}

/** Layers stacked on top of each other; later children render above earlier ones. */
export const group = (children: Node[], opts: BaseProps = {}): GroupNode => ({ ...opts, kind: "group", children });

/** Clips played one after another; transitions between them overlap their neighbours. */
export const series = (items: (Node | TransitionSpec)[], opts: BaseProps = {}): SeriesNode => ({
  ...opts,
  kind: "series",
  items,
});

/** Show `content` inside window chrome (default: a browser). Spread position / animation props as on any node. */
export function framed(content: Node | Node[], opts: FrameStyle & BaseProps = {}): FrameNode {
  const { chrome, width, height, viewport, url, title, theme, radius, shadow, border, background, ...props } = opts;
  return {
    ...props,
    kind: "frame",
    children: Array.isArray(content) ? content : [content],
    frame: { chrome, width, height, viewport, url, title, theme, radius, shadow, border, background },
  };
}

export interface PipOptions extends Omit<FrameStyle, "width">, Omit<BaseProps, "position" | "inset"> {
  /** Default "bottom-right". */
  corner?: Exclude<Position, "center">;
  /** Width as a fraction of the frame (≤ 1) or px. Default 0.3. */
  size?: number;
  /** Gap to the frame edges in px. Default 48. */
  margin?: number;
}

/**
 * Picture-in-picture: `content` laid out as a full-size scene, scaled into a corner window.
 * Defaults to a plain rounded card with a shadow; pass `chrome` for a browser, window or phone.
 */
export function pip(content: Node | Node[], opts: PipOptions = {}): FrameNode {
  const { corner = "bottom-right", size = 0.3, margin = 48, chrome = "none", viewport = "parent", radius = 18, ...rest } = opts;
  return framed(content, { ...rest, chrome, viewport, radius, width: size, position: corner, inset: margin });
}

type DecorOptions<D> = Omit<D, "type"> & BaseProps;
const decorNode = (decor: DecorNode["decor"], opts: BaseProps): DecorNode => ({ ...opts, kind: "decor", decor });

/** Full-frame overlays. Add them as layers (usually last) or inside a group / frame to decorate just that. */
export const decor = {
  vignette: ({ strength, size, color, ...o }: DecorOptions<VignetteDecor> = {}) =>
    decorNode({ type: "vignette", strength, size, color }, o),
  watermark: ({ src, text, corner, size, alpha, margin, color, ...o }: DecorOptions<WatermarkDecor>) =>
    decorNode({ type: "watermark", src, text, corner, size, alpha, margin, color }, o),
  border: ({ width, color, radius, ...o }: DecorOptions<BorderDecor> = {}) => decorNode({ type: "border", width, color, radius }, o),
  grain: ({ amount, size, animated, seed, ...o }: DecorOptions<GrainDecor> = {}) =>
    decorNode({ type: "grain", amount, size, animated, seed }, o),
};

interface TransitionOptions {
  direction?: Direction;
  easing?: Easing;
}

const transition =
  (type: TransitionType) =>
  (duration = 0.5, opts: TransitionOptions = {}): TransitionSpec => ({
    kind: "transition",
    type,
    duration,
    direction: opts.direction ?? "left",
    easing: opts.easing ?? "easeInOut",
  });

export const fade = transition("fade");
/** Fade out to the background, then in: one clip on screen at a time. */
export const dip = transition("dip");
export const slide = transition("slide");
export const wipe = transition("wipe");
export const zoom = transition("zoom");
