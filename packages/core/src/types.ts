import type { ComponentType } from "react";
import type { AudioClip } from "./audio/mix";
import type { Stereo } from "./audio/synth";
import type { Cue } from "./subtitles";

/** Everything a clip needs to know about "now". Times are in seconds, frames are integers. */
export interface FrameContext {
  /** Absolute composition frame. */
  frame: number;
  /** Absolute composition time in seconds. */
  time: number;
  /** Frames since the clip started. */
  localFrame: number;
  /** Seconds since the clip started. */
  local: number;
  /** Clip duration in seconds. */
  duration: number;
  /** local / duration, 0..1. */
  progress: number;
  fps: number;
  width: number;
  height: number;
}

/** A static value or a pure function of time. */
export type Animatable<T> = T | ((t: FrameContext) => T);

export type EasingName = "linear" | "easeIn" | "easeOut" | "easeInOut";
export type EasingFn = (x: number) => number;
export type Easing = EasingName | EasingFn;

export type Position =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type EffectType = "fade" | "fade-up" | "fade-down" | "zoom" | "slide-left" | "slide-right" | "wipe";
export type EffectSpec = EffectType | { type: EffectType; duration?: number; easing?: Easing };

export interface BaseProps {
  id?: string;
  /** Start in seconds relative to the parent. Ignored inside a series. */
  at?: number;
  /** Duration in seconds. Omitted = intrinsic duration, or fill the parent. */
  duration?: number;
  /** Where content sits inside the frame. Default "center". */
  position?: Position;
  /** Margin in px between content and frame edge. Default 64 for text, 0 otherwise. */
  inset?: number;
  x?: Animatable<number>;
  y?: Animatable<number>;
  scale?: Animatable<number>;
  /** Degrees. */
  rotate?: Animatable<number>;
  opacity?: Animatable<number>;
  enter?: EffectSpec;
  exit?: EffectSpec;
}

export interface SolidNode extends BaseProps {
  kind: "solid";
  color: Animatable<string>;
}

export interface ImageNode extends BaseProps {
  kind: "image";
  src: string;
  fit?: "cover" | "contain" | "fill";
  /** px; when omitted the image fills the frame. */
  width?: number;
  height?: number;
  /** px, or any CSS border-radius such as "0 0 16px 16px". */
  radius?: number | string;
}

export interface VideoNode extends BaseProps {
  kind: "video";
  src: string;
  fit?: "cover" | "contain" | "fill";
  /** px; when omitted the video fills the frame. */
  width?: number;
  height?: number;
  /** px, or any CSS border-radius such as "0 0 16px 16px". */
  radius?: number | string;
  /** Seconds of the source to play: [start, end]. End defaults to the end of the file. */
  trim?: [start: number, end?: number];
  /** 2 = twice as fast. Audio is resampled, so its pitch shifts with the speed. Default 1. */
  playbackRate?: number;
  /** Start over when the source runs out instead of holding the last frame. */
  loop?: boolean;
  /** Gain for the clip's own audio track. Default 1. */
  volume?: number;
  muted?: boolean;
}

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  color?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  maxWidth?: number;
  background?: string;
  padding?: number | string;
  borderRadius?: number;
  textShadow?: string;
}

export interface TextNode extends BaseProps {
  kind: "text";
  text: Animatable<string>;
  style?: TextStyle;
}

export interface ReactNodeSpec extends BaseProps {
  kind: "react";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  props: Record<string, unknown>;
}

export interface GroupNode extends BaseProps {
  kind: "group";
  children: Node[];
}

/**
 * "fade" crossfades (both clips visible at once); "dip" fades the first out completely, then the second in, so the
 * two never share the screen; "zoom" is a dip with a slight scale; "slide" and "wipe" move the incoming clip in.
 */
export type TransitionType = "fade" | "dip" | "slide" | "wipe" | "zoom";
export type Direction = "left" | "right" | "up" | "down";

export interface TransitionSpec {
  kind: "transition";
  type: TransitionType;
  /** Seconds of overlap between the neighbouring clips. */
  duration: number;
  direction: Direction;
  easing: Easing;
}

export interface SeriesNode extends BaseProps {
  kind: "series";
  items: (Node | TransitionSpec)[];
}

/** Window chrome drawn around a frame's content. */
export type FrameChrome = "browser" | "window" | "phone" | "none";

export interface FrameStyle {
  /** Default "browser". */
  chrome?: FrameChrome;
  /** Content width in px, or a fraction of the parent's width when ≤ 1. Default 0.7. */
  width?: number;
  /** Content height in px. Default: from `viewport`'s aspect ratio, else portrait for "phone", else the parent's. */
  height?: number;
  /**
   * Lay the children out at this size and scale them down into the content box, so a full scene fits in a
   * small frame unchanged. "parent" = the parent's size. Default: children get the content box's own size.
   */
  viewport?: [width: number, height: number] | "parent";
  /** Text in the browser address bar. */
  url?: string;
  /** Text in the window title bar. */
  title?: string;
  /** Default "light". */
  theme?: "light" | "dark";
  /** Outer corner radius in px. Default per chrome. */
  radius?: number;
  /** CSS box-shadow, or false for none. */
  shadow?: string | false;
  /** CSS border, e.g. "4px solid #fff". */
  border?: string;
  /** Behind the content. Default white (light) / near-black (dark). */
  background?: string;
}

/** Children shown inside window chrome: a browser, an app window, a phone, or a plain card. */
export interface FrameNode extends BaseProps {
  kind: "frame";
  children: Node[];
  frame: FrameStyle;
}

/**
 * Subtitle looks. "clean": white with an outline. "boxed": a dark box behind each line. "bold": big
 * uppercase social-video captions. "highlight": bold, with the word being spoken highlighted.
 */
export type SubtitlePreset = "clean" | "boxed" | "bold" | "highlight";

export interface SubtitlesNode extends BaseProps {
  kind: "subtitles";
  cues: Cue[];
  preset: SubtitlePreset;
  /** Subtitle-file seconds shown at the clip's start. */
  from: number;
  style?: TextStyle;
  highlight?: string;
}

export interface VignetteDecor {
  type: "vignette";
  /** 0..1 darkness at the corners. Default 0.55. */
  strength?: number;
  /** 0..1 radius of the clear centre. Default 0.55. */
  size?: number;
  color?: string;
}

export interface WatermarkDecor {
  type: "watermark";
  /** Image URL (e.g. `asset("logo.svg")`); or use `text`. */
  src?: string;
  text?: string;
  /** Default "bottom-right". */
  corner?: Exclude<Position, "center">;
  /** Image height / font size in px. Default 44 for images, 28 for text. */
  size?: number;
  /** Resting opacity of the mark. Default 0.6. (The node's own `opacity` still animates on top.) */
  alpha?: number;
  /** Gap to the edges in px. Default 40. */
  margin?: number;
  color?: string;
}

export interface BorderDecor {
  type: "border";
  /** px. Default 24. */
  width?: number;
  /** Default "#fff". */
  color?: string;
  /** Rounds the inner edge of the border, px. Default 0. */
  radius?: number;
}

export interface GrainDecor {
  type: "grain";
  /** 0..1 strength. Default 0.08. */
  amount?: number;
  /** Grain size in px. Default 2. */
  size?: number;
  /** New grain every frame (seeded by the frame number). Default true. */
  animated?: boolean;
  seed?: number;
}

export type Decor = VignetteDecor | WatermarkDecor | BorderDecor | GrainDecor;

/** A full-frame overlay: vignette, watermark, border or film grain. */
export interface DecorNode extends BaseProps {
  kind: "decor";
  decor: Decor;
}

export type Node =
  | DecorNode
  | SolidNode
  | ImageNode
  | VideoNode
  | TextNode
  | ReactNodeSpec
  | GroupNode
  | SeriesNode
  | FrameNode
  | SubtitlesNode;

/** What the renderer knows about a footage file. Probed by the CLI before the timeline resolves. */
export interface MediaInfo {
  /** Seconds. */
  duration: number;
  width: number;
  height: number;
  /** Decoded audio track (any sample rate), or undefined if the file is silent / not loaded. */
  audio?: { sampleRate: number; channels: Stereo };
}

export interface Composition {
  width: number;
  height: number;
  fps: number;
  /** Seconds. Inferred from layers when omitted. */
  duration?: number;
  background: string;
  layers: Node[];
  /** Music and sound effects, mixed into the rendered video. */
  audio?: AudioClip[];
  /** Integrated loudness (LUFS) the exported soundtrack is normalised to, or false to leave it as mixed. */
  loudness?: number | false;
  /** Footage metadata keyed by `src`. Filled in by the runtime; you don't set this yourself. */
  media?: Record<string, MediaInfo>;
}
