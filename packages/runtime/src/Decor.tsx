import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { rng, type Decor, type FrameContext, type GrainDecor, type Position, type WatermarkDecor } from "@smashcut/core";
import { delayRender } from "./ready";

const fill: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

/** A decor node: a full-frame overlay drawn over whatever sits below it. */
export function DecorView({ decor, t }: { decor: Decor; t: FrameContext }) {
  switch (decor.type) {
    case "vignette": {
      const size = decor.size ?? 0.55;
      const strength = decor.strength ?? 0.55;
      // color-mix works for any CSS colour, not just 6-digit hex.
      const shade = (k: number) => `color-mix(in srgb, ${decor.color ?? "#000"} ${k * strength * 100}%, transparent)`;
      // An eased (roughly quadratic) falloff: a linear ramp shows a visible ring where the clear centre ends.
      const stops = [0, 0.25, 0.5, 0.75, 1].map((p) => `${shade(p * p)} ${(size + (1 - size) * p) * 100}%`).join(", ");
      // Extend the ellipse past the frame so the corners, not the edges, get the full strength.
      return <div style={{ ...fill, background: `radial-gradient(ellipse 75% 75% at 50% 50%, ${stops})` }} />;
    }
    case "border": {
      const width = decor.width ?? 24;
      const radius = decor.radius ?? 0;
      // A huge spread shadow outside a rounded box paints the border with a rounded inner edge.
      return (
        <div style={{ ...fill, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: width,
              borderRadius: radius,
              boxShadow: `0 0 0 ${Math.max(t.width, t.height)}px ${decor.color ?? "#fff"}`,
            }}
          />
        </div>
      );
    }
    case "watermark":
      return <Watermark decor={decor} />;
    case "grain":
      return <Grain decor={decor} t={t} />;
  }
}

const CORNERS: Record<Exclude<Position, "center">, CSSProperties> = {
  top: { top: 0, left: "50%", transform: "translateX(-50%)" },
  bottom: { bottom: 0, left: "50%", transform: "translateX(-50%)" },
  left: { left: 0, top: "50%", transform: "translateY(-50%)" },
  right: { right: 0, top: "50%", transform: "translateY(-50%)" },
  "top-left": { top: 0, left: 0 },
  "top-right": { top: 0, right: 0 },
  "bottom-left": { bottom: 0, left: 0 },
  "bottom-right": { bottom: 0, right: 0 },
};

function Watermark({ decor }: { decor: WatermarkDecor }) {
  const ref = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (ref.current) delayRender(ref.current.decode().catch(() => console.error(`[smashcut] failed to load watermark ${decor.src}`)));
  }, [decor.src]);
  const margin = decor.margin ?? 40;
  return (
    <div style={fill}>
      <div style={{ position: "absolute", margin, opacity: decor.alpha ?? 0.6, ...CORNERS[decor.corner ?? "bottom-right"] }}>
        {decor.src ? (
          <img ref={ref} src={decor.src} alt="" style={{ display: "block", height: decor.size ?? 44 }} />
        ) : (
          <div
            style={{
              fontFamily: "Inter, system-ui, -apple-system, sans-serif",
              fontSize: decor.size ?? 28,
              fontWeight: 600,
              color: decor.color ?? "#fff",
              textShadow: "0 1px 6px rgba(0,0,0,0.4)",
              whiteSpace: "nowrap",
            }}
          >
            {decor.text}
          </div>
        )}
      </div>
    </div>
  );
}

/** Film grain: seeded noise, re-drawn every frame (or once when not animated), blended over the picture. */
function Grain({ decor, t }: { decor: GrainDecor; t: FrameContext }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = Math.max(1, decor.size ?? 2);
  const w = Math.ceil(t.width / size);
  const h = Math.ceil(t.height / size);
  const key = decor.animated === false ? 0 : t.frame;
  useLayoutEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    const random = rng((decor.seed ?? 1) * 7919 + key);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [w, h, key, decor.seed]);
  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{
        ...fill,
        width: "100%",
        height: "100%",
        opacity: decor.amount ?? 0.08,
        mixBlendMode: "overlay",
        imageRendering: "pixelated",
      }}
    />
  );
}
