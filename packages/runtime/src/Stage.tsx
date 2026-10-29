import { useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import {
  clipVisual,
  footageFrame,
  frameContext,
  isActive,
  resolveValue,
  type FrameContext,
  type ImageNode,
  type Position,
  type ResolvedClip,
  type ResolvedComposition,
  type TextNode,
  type VideoNode,
} from "@smashcut/core";
import { ClipContext, CompositionContext } from "./context";
import { DecorView } from "./Decor";
import { FrameView, type Viewport } from "./Frame";
import { SubtitlesView } from "./Subtitles";
import { footageFrameUrl } from "./media";
import { delayRender } from "./ready";
import { frameStore } from "./store";

const ALIGN: Record<Position, Pick<CSSProperties, "justifyContent" | "alignItems">> = {
  center: { justifyContent: "center", alignItems: "center" },
  top: { justifyContent: "center", alignItems: "flex-start" },
  bottom: { justifyContent: "center", alignItems: "flex-end" },
  left: { justifyContent: "flex-start", alignItems: "center" },
  right: { justifyContent: "flex-end", alignItems: "center" },
  "top-left": { justifyContent: "flex-start", alignItems: "flex-start" },
  "top-right": { justifyContent: "flex-end", alignItems: "flex-start" },
  "bottom-left": { justifyContent: "flex-start", alignItems: "flex-end" },
  "bottom-right": { justifyContent: "flex-end", alignItems: "flex-end" },
};

export function Stage({ comp }: { comp: ResolvedComposition }) {
  const frame = useSyncExternalStore(frameStore.subscribe, frameStore.get);
  return (
    <CompositionContext.Provider value={comp}>
      <div
        style={{
          position: "relative",
          width: comp.width,
          height: comp.height,
          overflow: "hidden",
          background: comp.background,
        }}
      >
        {comp.layers.map((clip) => (
          <ClipView key={clip.path} clip={clip} frame={frame} comp={comp} viewport={comp} />
        ))}
      </div>
    </CompositionContext.Provider>
  );
}

interface ClipProps {
  clip: ResolvedClip;
  frame: number;
  comp: ResolvedComposition;
  /** Size of the box the clip lays out in: the video, or the inside of a frame. */
  viewport: Viewport;
}

function ClipView({ clip, frame, comp, viewport }: ClipProps) {
  if (!isActive(clip, frame)) return null;
  const { node } = clip;
  const t: FrameContext = { ...frameContext(comp, clip, frame), width: viewport.width, height: viewport.height };
  const v = clipVisual(clip, t);
  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    boxSizing: "border-box",
    padding: node.inset ?? (node.kind === "text" || node.kind === "subtitles" ? 64 : 0),
    ...ALIGN[node.position ?? "center"],
    opacity: v.opacity,
    transform: `translate(${v.x}px, ${v.y}px) scale(${v.scale}) rotate(${v.rotate}deg)`,
    clipPath: v.clipPath,
  };
  return (
    <ClipContext.Provider value={t}>
      <div data-clip={clip.path} data-kind={node.kind} style={style}>
        <ClipContent clip={clip} frame={frame} comp={comp} viewport={viewport} t={t} />
      </div>
    </ClipContext.Provider>
  );
}

function ClipContent({ clip, frame, comp, viewport, t }: ClipProps & { t: FrameContext }) {
  const { node } = clip;
  const children = (inner: Viewport) =>
    clip.children.map((child) => <ClipView key={child.path} clip={child} frame={frame} comp={comp} viewport={inner} />);
  switch (node.kind) {
    case "solid":
      return <div style={{ position: "absolute", inset: 0, background: resolveValue(node.color, t) }} />;
    case "image":
      return <ImageView node={node} />;
    case "video":
      return <VideoView node={node} comp={comp} t={t} />;
    case "text":
      return <TextView node={node} t={t} />;
    case "subtitles":
      return <SubtitlesView node={node} t={t} />;
    case "decor":
      return <DecorView decor={node.decor} t={t} />;
    case "react": {
      const Component = node.component;
      return <Component {...node.props} />;
    }
    case "group":
    case "series":
      return children(viewport);
    case "frame":
      return <FrameView style={node.frame} parent={viewport} content={children} />;
  }
}

function ImageView({ node }: { node: ImageNode }) {
  return <Picture node={node} src={node.src} />;
}

/** Footage is shown as pre-extracted frames, so every rendered frame is exact and deterministic. */
function VideoView({ node, comp, t }: { node: VideoNode; comp: ResolvedComposition; t: FrameContext }) {
  const index = footageFrame(node, comp.media[node.src], t.local, comp.fps);
  return <Picture node={node} src={footageFrameUrl(node.src, comp.fps, index)} />;
}

function Picture({ node, src }: { node: ImageNode | VideoNode; src: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const img = ref.current!;
    // Footage swaps `src` every frame, which rejects the previous decode; only report current ones.
    let stale = false;
    delayRender(img.decode().catch(() => !stale && console.error(`[smashcut] failed to load ${node.kind} ${src}`)));
    return () => {
      stale = true;
    };
  }, [node.kind, src]);
  const sized = node.width !== undefined || node.height !== undefined;
  return (
    <img
      ref={ref}
      src={src}
      alt=""
      style={{
        display: "block",
        width: node.width ?? (sized ? "auto" : "100%"),
        height: node.height ?? (sized ? "auto" : "100%"),
        objectFit: node.fit ?? "cover",
        borderRadius: node.radius,
      }}
    />
  );
}

function TextView({ node, t }: { node: TextNode; t: FrameContext }) {
  const s = node.style ?? {};
  return (
    <div
      style={{
        whiteSpace: "pre-wrap",
        fontFamily: s.fontFamily ?? "Inter, system-ui, -apple-system, sans-serif",
        fontSize: s.fontSize ?? 64,
        fontWeight: s.fontWeight ?? 600,
        color: s.color ?? "#fff",
        lineHeight: s.lineHeight ?? 1.2,
        letterSpacing: s.letterSpacing,
        textAlign: s.textAlign ?? "center",
        maxWidth: s.maxWidth,
        background: s.background,
        padding: s.padding,
        borderRadius: s.borderRadius,
        textShadow: s.textShadow,
      }}
    >
      {resolveValue(node.text, t)}
    </div>
  );
}
