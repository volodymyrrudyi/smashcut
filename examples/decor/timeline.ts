import { asset, decor, defineVideo, fade, group, image, kf, series, text } from "@smashcut/core";

const SCENE = 2.5;

const label = (s: string) =>
  text(s, {
    position: "top-left",
    inset: 48,
    style: { fontSize: 30, fontWeight: 700, color: "#fff", background: "#0f172a", padding: "12px 24px", borderRadius: 10 },
  });

const scene = (name: string, ...decorations: ReturnType<(typeof decor)[keyof typeof decor]>[]) =>
  group([image(asset("hero.png"), { scale: kf([[0, 1], [SCENE, 1.05]]) }), ...decorations, label(name)], { duration: SCENE });

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  layers: [
    series([
      scene("decor.vignette()", decor.vignette({ strength: 0.75 })),
      fade(0.3),
      scene("decor.watermark()", decor.watermark({ src: asset("logo.svg"), size: 64 }), decor.watermark({ text: "© smashcut", corner: "bottom-left" })),
      fade(0.3),
      scene("decor.border()", decor.border({ width: 36, color: "#f8fafc", radius: 28 })),
      fade(0.3),
      scene("decor.grain()", decor.grain({ amount: 0.22 })),
      fade(0.3),
      scene(
        "all together",
        decor.grain({ amount: 0.1 }),
        decor.vignette(),
        decor.border({ width: 20, color: "#0f172a", radius: 20 }),
        decor.watermark({ src: asset("logo.svg"), size: 56, alpha: 0.8 }),
      ),
    ]),
  ],
});
