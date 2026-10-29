import { clamp, interpolate } from "@smashcut/core";
import { useClip } from "@smashcut/runtime";

/** `smashcut render` in a terminal: the frame counter and a progress bar fill up over `seconds`. */
export function Terminal({ frames, seconds, from = 0.3 }: { frames: number; seconds: number; from?: number }) {
  const t = useClip();
  const p = clamp(interpolate(t.local, [from, from + seconds], [0, 1]));
  const done = p >= 1;
  const width = 30;
  const filled = Math.round(p * width);
  return (
    <div style={{ position: "absolute", inset: 0, padding: 28, background: "#0b0d12", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 24, lineHeight: 1.7, color: "#e2e8f0", whiteSpace: "pre" }}>
      <div style={{ color: "#94a3b8" }}>$ npx smashcut render examples/launch -c 4</div>
      <div>
        Rendering frame {String(Math.round(p * frames)).padStart(String(frames).length)}/{frames}
      </div>
      <div style={{ color: "#a78bfa" }}>
        [{"█".repeat(filled)}
        {"·".repeat(width - filled)}] {Math.round(p * 100)}%
      </div>
      <div style={{ color: "#a3e635", opacity: done ? 1 : 0 }}>✓ Wrote examples/launch/out/launch.mp4</div>
    </div>
  );
}
