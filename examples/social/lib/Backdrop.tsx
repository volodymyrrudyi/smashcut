import { useClip } from "@smashcut/runtime";

/** A dark gradient whose colours slowly orbit. Uses absolute time, so it carries across cuts. */
export function Backdrop() {
  const { time } = useClip();
  const a = time * 0.5;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: [
          `radial-gradient(circle at ${50 + 30 * Math.sin(a)}% ${25 + 10 * Math.cos(a)}%, #7c3aed66, transparent 55%)`,
          `radial-gradient(circle at ${50 - 30 * Math.sin(a)}% ${80 - 10 * Math.cos(a)}%, #0891b255, transparent 55%)`,
          "#0b0d12",
        ].join(", "),
      }}
    />
  );
}
