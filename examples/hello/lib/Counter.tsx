import { interpolate, spring } from "@smashcut/core";
import { useClip } from "@smashcut/runtime";
import { theme } from "./theme";

/** Any React component can be a clip; read time with useClip() instead of timers. */
export function Counter({ to, label }: { to: number; label: string }) {
  const t = useClip();
  const value = Math.round(interpolate(t.local, [0.3, 2.2], [0, to], { easing: "easeOut" }));
  const pop = spring(t, { from: 0.6, to: 1, damping: 12 });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(circle at 50% 40%, #1e293b, ${theme.bg})`,
        color: theme.text,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 260, fontWeight: 800, transform: `scale(${pop})`, fontVariantNumeric: "tabular-nums" }}>
        {value.toLocaleString("en-US")}
      </div>
      <div style={{ fontSize: 48, color: theme.muted }}>{label}</div>
    </div>
  );
}
