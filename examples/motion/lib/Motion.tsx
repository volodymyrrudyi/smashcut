import { clamp, interpolate, rng, spring, type EasingName } from "@smashcut/core";
import { useClip } from "@smashcut/runtime";
import { font, theme } from "../../hello/lib/theme";

const LANE_COLORS = ["#94a3b8", "#f472b6", "#22d3ee", "#a78bfa", "#facc15"];

/** Five dots racing across: one per easing, and a spring, all from 0.4 s to 2.2 s. */
export function Easings() {
  const t = useClip();
  const lanes: [string, number][] = (["linear", "easeIn", "easeOut", "easeInOut"] as EasingName[]).map((easing) => [
    `"${easing}"`,
    interpolate(t.local, [0.4, 2.2], [0, 1], { easing }),
  ]);
  lanes.push(["spring()", spring(t, { delay: 0.4, stiffness: 90, damping: 9 })]);
  return (
    <div style={{ position: "absolute", inset: 0, padding: "190px 220px", fontFamily: font, color: theme.text }}>
      {lanes.map(([name, p], i) => (
        <div key={name} style={{ position: "relative", height: 140 }}>
          <div style={{ position: "absolute", top: 0, fontSize: 30, fontWeight: 600, color: LANE_COLORS[i], fontFamily: "ui-monospace, Menlo, monospace" }}>{name}</div>
          <div style={{ position: "absolute", top: 76, left: 0, right: 0, height: 4, borderRadius: 2, background: "#1e293b" }} />
          <div
            style={{
              position: "absolute",
              top: 58,
              left: `calc(${p * 100}% - ${p * 40}px)`,
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: LANE_COLORS[i],
              boxShadow: `0 0 30px ${LANE_COLORS[i]}88`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Three balls dropping onto a line on springs with less and less damping. */
export function Springs() {
  const t = useClip();
  const springs = [
    { damping: 26, label: "damping 26" },
    { damping: 12, label: "damping 12" },
    { damping: 5, label: "damping 5" },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: font, color: theme.text }}>
      <div style={{ position: "absolute", left: 360, right: 360, top: 700, height: 4, background: "#334155", borderRadius: 2 }} />
      {springs.map(({ damping, label }, i) => {
        const y = spring(t, { from: 160, to: 600, delay: 0.3 + i * 0.25, stiffness: 140, damping });
        const x = 560 + i * 400;
        return (
          <div key={label}>
            <div
              style={{
                position: "absolute",
                left: x - 50,
                top: y,
                width: 100,
                height: 100,
                borderRadius: "50%",
                background: `radial-gradient(circle at 35% 30%, #fff8, ${LANE_COLORS[i + 2]} 45%)`,
              }}
            />
            <div style={{ position: "absolute", left: x - 150, width: 300, top: 740, textAlign: "center", fontSize: 30, fontWeight: 600, color: theme.muted }}>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A burst of particles laid out by a seeded `rng`: random, but the same on every render and every frame. */
export function Particles({ count = 180, seed = 7 }: { count?: number; seed?: number }) {
  const t = useClip();
  const random = rng(seed);
  const dots = Array.from({ length: count }, () => ({
    angle: random() * Math.PI * 2,
    speed: 160 + random() * 520,
    size: 4 + random() * 14,
    hue: 250 + random() * 90,
    delay: random() * 0.6,
  }));
  const cx = t.width / 2;
  const cy = t.height / 2;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {dots.map((d, i) => {
        const p = clamp((t.local - d.delay) / 2.2);
        const r = d.speed * (1 - Math.pow(1 - p, 3));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx + Math.cos(d.angle + t.local * 0.3) * r - d.size / 2,
              top: cy + Math.sin(d.angle + t.local * 0.3) * r - d.size / 2,
              width: d.size,
              height: d.size,
              borderRadius: "50%",
              background: `hsl(${d.hue} 90% 65%)`,
              opacity: p > 0 ? 0.85 - 0.5 * p : 0,
            }}
          />
        );
      })}
    </div>
  );
}
