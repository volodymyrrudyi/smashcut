import type { CSSProperties, ReactNode } from "react";
import type { FrameStyle } from "@smashcut/core";

export interface Viewport {
  width: number;
  height: number;
}

const THEMES = {
  light: { bar: "#eef1f5", line: "#dde3ea", text: "#475569", pill: "#ffffff", content: "#ffffff" },
  dark: { bar: "#1d2230", line: "#2d3444", text: "#a7b1c2", pill: "#2a3142", content: "#0b0d12" },
};
const LIGHTS = ["#ff5f57", "#febc2e", "#28c840"];
const BAR = { browser: 44, window: 38 };
const BEZEL = 16;
const RADIUS = { browser: 14, window: 12, phone: 58, none: 18 };
const PHONE_ASPECT = 2532 / 1170;
const SHADOW = "0 30px 80px rgba(15, 23, 42, 0.25)";
const FONT = "Inter, system-ui, -apple-system, sans-serif";

/** Content box size, and how the children's layout box maps into it. */
export function frameLayout(style: FrameStyle, parent: Viewport) {
  const raw = style.width ?? 0.7;
  const width = raw <= 1 ? raw * parent.width : raw;
  const viewport = style.viewport === "parent" ? ([parent.width, parent.height] as const) : style.viewport;
  // Without a height or viewport, phones are portrait (iPhone screen aspect); other chrome follows the parent.
  const aspect = viewport ? viewport[1] / viewport[0] : style.chrome === "phone" ? PHONE_ASPECT : parent.height / parent.width;
  const height = style.height ?? width * aspect;
  const inner: Viewport = viewport ? { width: viewport[0], height: viewport[1] } : { width, height };
  // Fit the children's layout box inside the content box, centred.
  const scale = Math.min(width / inner.width, height / inner.height);
  return { width, height, inner, scale };
}

function TrafficLights() {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {LIGHTS.map((c) => (
        <div key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
      ))}
    </div>
  );
}

function Bar({ kind, style, theme }: { kind: "browser" | "window"; style: FrameStyle; theme: (typeof THEMES)["light"] }) {
  const label = kind === "browser" ? style.url : style.title;
  return (
    <div
      style={{
        position: "relative",
        height: BAR[kind],
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        background: theme.bar,
        borderBottom: `1px solid ${theme.line}`,
        fontFamily: FONT,
        color: theme.text,
      }}
    >
      <TrafficLights />
      {label && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "60%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: kind === "browser" ? 15 : 14,
            fontWeight: kind === "window" ? 600 : 400,
            ...(kind === "browser"
              ? { padding: "5px 64px", borderRadius: 8, background: theme.pill, border: `1px solid ${theme.line}` }
              : {}),
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

/** A frame node: chrome around a content box whose children lay out in their own viewport. */
export function FrameView({
  style,
  parent,
  content,
}: {
  style: FrameStyle;
  parent: Viewport;
  content: (viewport: Viewport) => ReactNode;
}) {
  const chrome = style.chrome ?? "browser";
  const theme = THEMES[style.theme ?? "light"];
  const { width, height, inner, scale } = frameLayout(style, parent);
  const radius = style.radius ?? RADIUS[chrome];
  const phone = chrome === "phone";
  const innerRadius = phone ? Math.max(0, radius - BEZEL) : chrome === "none" ? radius : 0;

  const outer: CSSProperties = {
    position: "relative",
    flex: "none",
    borderRadius: radius,
    overflow: "hidden",
    boxShadow: style.shadow === false ? "none" : (style.shadow ?? SHADOW),
    border: style.border ?? (chrome === "browser" || chrome === "window" ? `1px solid ${theme.line}` : undefined),
    background: phone ? "#0b0b0c" : theme.bar,
    padding: phone ? BEZEL : 0,
  };
  return (
    <div style={outer}>
      {(chrome === "browser" || chrome === "window") && <Bar kind={chrome} style={style} theme={theme} />}
      <div
        style={{
          position: "relative",
          width,
          height,
          overflow: "hidden",
          borderRadius: innerRadius,
          background: style.background ?? theme.content,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: (width - inner.width * scale) / 2,
            top: (height - inner.height * scale) / 2,
            width: inner.width,
            height: inner.height,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {content(inner)}
        </div>
        {phone && (
          <div
            style={{
              position: "absolute",
              top: 14,
              left: "50%",
              width: Math.min(130, width * 0.32),
              height: 36,
              transform: "translateX(-50%)",
              borderRadius: 18,
              background: "#000",
            }}
          />
        )}
      </div>
    </div>
  );
}
