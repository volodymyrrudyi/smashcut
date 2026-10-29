import { useLayoutEffect, useState } from "react";
import { asset, clamp, interpolate, spring } from "@smashcut/core";
import { delayRender, useClip } from "@smashcut/runtime";
import { font } from "../../hello/lib/theme";

interface Stats {
  title: string;
  total: number;
  days: { day: string; renders: number }[];
}

// Fetched once per page; every frame after the first reads the cached copy.
let cache: Stats | undefined;
let loading: Promise<Stats> | undefined;

/**
 * A chart of assets/stats.json. The file is fetched at render time and `delayRender` holds the frame until it's
 * in, so no frame is ever captured without the data.
 */
export function StatsScreen() {
  const t = useClip();
  const [stats, setStats] = useState(cache);
  useLayoutEffect(() => {
    if (stats) return;
    loading ??= fetch(asset("stats.json")).then((r) => r.json() as Promise<Stats>);
    delayRender(loading.then((data) => setStats((cache = data))));
  }, [stats]);
  if (!stats) return null;

  const max = Math.max(...stats.days.map((d) => d.renders));
  const total = Math.round(interpolate(t.local, [0.3, 1.8], [0, stats.total], { easing: "easeOut" }));
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b0d12", color: "#f8fafc", fontFamily: font, padding: "150px 70px" }}>
      <div style={{ fontSize: 46, fontWeight: 600, color: "#94a3b8" }}>{stats.title}</div>
      <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -5, fontVariantNumeric: "tabular-nums" }}>{total.toLocaleString("en-US")}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 22, height: 1750, marginTop: 120 }}>
        {stats.days.map((d, i) => {
          const grow = clamp(spring(t, { delay: 0.4 + i * 0.12, damping: 14, stiffness: 120 }), 0, 1.2);
          return (
            <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
              <div
                style={{
                  width: "100%",
                  height: (d.renders / max) * 1600 * grow,
                  borderRadius: "22px 22px 8px 8px",
                  background: d.renders === max ? "linear-gradient(180deg, #22d3ee, #7c3aed)" : "linear-gradient(180deg, #7c3aed, #4c1d95)",
                }}
              />
              <div style={{ fontSize: 40, fontWeight: 600, color: "#94a3b8" }}>{d.day}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
