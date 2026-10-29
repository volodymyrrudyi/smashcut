import { ambient, asset, defineVideo, fade, image, kf, music, series, sfx, solid, subtitles, text } from "@smashcut/core";
import narration from "./assets/narration.srt?raw";
import karaoke from "./assets/karaoke.vtt?raw";

const SCENE = 4;
const FADE = 0.4;
// Backgrounds run FADE longer than a scene, so each fade ends exactly on the next scene's start.
const bg = SCENE + FADE;

const label = (s: string, at: number) =>
  text(s, {
    at,
    duration: SCENE,
    position: "top-left",
    inset: 48,
    style: { fontSize: 30, fontWeight: 700, color: "#fff", background: "#0f172a", padding: "12px 24px", borderRadius: 10 },
    enter: "fade",
  });

// One SRT file, shown in three looks: each layer starts reading the file (`from`) where its scene starts.
const presets = (["clean", "boxed", "bold"] as const).map((preset, i) =>
  subtitles(narration, { preset, at: i * SCENE, duration: SCENE, from: i * SCENE }),
);

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  layers: [
    series([
      image(asset("hero.png"), { duration: bg, scale: kf([[0, 1], [bg, 1.06]]) }),
      fade(FADE),
      solid("#f1f5f9", { duration: bg }),
      fade(FADE),
      image(asset("hero.png"), { duration: bg, scale: kf([[0, 1.1], [bg, 1]]) }),
      fade(FADE),
      solid("#1e1b4b", { duration: bg }),
      fade(FADE),
      image(asset("hero.png"), { duration: SCENE + FADE + 0.6, scale: kf([[0, 1], [SCENE, 1.08]]) }),
    ]),
    ...presets,
    // Word-by-word highlight, timed by the VTT's inline timestamps.
    subtitles(karaoke, { preset: "highlight", at: 3 * SCENE, position: "center" }),
    // The SRT again, highlighted word by word with estimated timing, in a custom style and colour, centred.
    subtitles(narration, {
      preset: "highlight",
      at: 4 * SCENE,
      duration: SCENE,
      from: 0,
      position: "center",
      highlight: "#22d3ee",
      style: { fontFamily: "Georgia, serif", fontSize: 64, textShadow: "0 4px 24px #0009" },
    }),
    ...["preset: clean", "preset: boxed", "preset: bold", "preset: highlight (VTT timing)", "highlight + style (estimated timing)"].map((s, i) =>
      label(s, i * SCENE),
    ),
  ],
  audio: [
    // A quiet bed that dips whenever a scene-change tick plays.
    music(ambient({ seed: 9, key: "A minor" }), { volume: 1, fadeIn: 0.4, fadeOut: 1.2, duck: 0.5 }),
    ...[1, 2, 3, 4].map((i) => sfx.tick({ at: i * SCENE - FADE / 2 })),
  ],
});
