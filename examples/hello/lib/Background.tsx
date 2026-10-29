import { useClip } from "@smashcut/runtime";
import { paper } from "./theme";

function Glow({ color, x, y }: { color: string; x: number; y: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x - 500,
        top: y - 500,
        width: 1000,
        height: 1000,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color}2e, transparent 62%)`,
      }}
    />
  );
}

/** A light grid with two slowly drifting glows. Uses absolute time, so it never jumps at a cut. */
export function Background() {
  const { time, width, height } = useClip();
  const a = time * 0.4;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: paper.bg }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${paper.grid} 1px, transparent 1px), linear-gradient(90deg, ${paper.grid} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          backgroundPosition: `${-time * 8}px ${-time * 8}px`,
          maskImage: "radial-gradient(ellipse at center, #000 25%, transparent 78%)",
          opacity: 0.7,
        }}
      />
      <Glow color={paper.accent} x={width * 0.2 + 140 * Math.sin(a)} y={height * 0.22 + 90 * Math.cos(a * 1.3)} />
      <Glow color={paper.cyan} x={width * 0.81 + 150 * Math.cos(a)} y={height * 0.8 + 100 * Math.sin(a * 1.1)} />
    </div>
  );
}
