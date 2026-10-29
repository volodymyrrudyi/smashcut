import { asset, defineVideo, fade, group, image, kf, modern, music, react, series, sfx, slide, solid, text, wipe } from "@smashcut/core";
import { Counter } from "./lib/Counter";
import { theme } from "./lib/theme";

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  background: theme.bg,
  layers: [
    series([
      group(
        [
          solid(theme.bg),
          text("Smashcut", {
            style: { fontSize: 220, fontWeight: 800, letterSpacing: -6 },
            scale: kf([[0, 0.85], [1.2, 1]], "easeOut"),
            enter: { type: "fade-up", duration: 0.8 },
          }),
          text("videos as TypeScript", {
            at: 0.8,
            y: 150,
            style: { fontSize: 48, fontWeight: 400, color: theme.muted },
            enter: "fade",
          }),
        ],
        { duration: 3 },
      ),
      fade(0.6),
      group(
        [
          image(asset("hero.png"), { scale: kf([[0, 1], [3, 1.12]]) }),
          text("Static images, Ken Burns included", {
            position: "bottom-left",
            style: { fontSize: 44, background: "#0009", padding: "16px 28px", borderRadius: 12 },
            enter: "fade-up",
            exit: "fade",
          }),
        ],
        { duration: 3 },
      ),
      slide(0.6, { direction: "left" }),
      react(Counter, { to: 1000, label: "frames rendered" }, { duration: 3 }),
      wipe(0.5, { direction: "left" }),
      group([solid(theme.accent), text("The end", { style: { fontSize: 140, fontWeight: 800 }, enter: "zoom" })], {
        duration: 2,
      }),
    ]),
    text("made with smashcut", {
      at: 0.5,
      position: "bottom-right",
      inset: 40,
      opacity: 0.6,
      style: { fontSize: 24, fontWeight: 500 },
      enter: "fade",
    }),
  ],
  // Music and sound effects are synthesised in code; scenes start at 0, 2.4, 4.8 and 7.3 s.
  audio: [
    music(modern({ seed: 3, mood: "bright", key: "C major" }), { volume: 0.8, fadeIn: 0.2, fadeOut: 1.2 }),
    sfx.swoosh({ at: 2.2, length: 0.8 }),
    sfx.swoosh({ at: 4.6, length: 0.8 }),
    sfx.tap({ at: 5.1 }),
    sfx.riser({ at: 6.4, length: 0.9 }),
    sfx.bell({ at: 7.3 }),
  ],
});
