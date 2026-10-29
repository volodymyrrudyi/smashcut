import {
  asset,
  defineVideo,
  framed,
  group,
  image,
  kf,
  modern,
  music,
  pip,
  react,
  series,
  sfx,
  slide,
  solid,
  text,
  zoomTo,
} from "@smashcut/core";
import { Counter } from "../hello/lib/Counter";
import { CLICK_DELAY, screen, type Box } from "./lib/Screen";

const label = (s: string) =>
  text(s, {
    position: "top-left",
    inset: 48,
    style: { fontSize: 30, fontWeight: 700, color: "#fff", background: "#0f172a", padding: "12px 24px", borderRadius: 10 },
    enter: "fade",
  });

const terminal = group([
  solid("#0b0d12"),
  text("$ npx smashcut render examples/frames\nRendering frame 345/345 (38.2 fps)\nWrote examples/frames/out/frames.mp4", {
    position: "top-left",
    inset: 28,
    style: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 22, fontWeight: 400, color: "#a7f3d0", textAlign: "left", lineHeight: 1.6 },
  }),
]);

const phoneList = group([
  solid("#f8fafc"),
  text("Inbox", { position: "top-left", inset: 40, y: 50, style: { fontSize: 44, fontWeight: 800, color: "#0f172a" } }),
  ...["Invoice INV-0847", "PO-58221 approved", "Price exception", "Weekly report"].map((s, i) =>
    text(s, {
      at: 0.4 + i * 0.25,
      position: "top-left",
      inset: 40,
      y: 160 + i * 96,
      style: { fontSize: 25, fontWeight: 600, color: "#334155", background: "#fff", padding: "20px 24px", borderRadius: 16, textAlign: "left" },
      enter: "fade-up",
    }),
  ),
]);

const S1 = 4;
const S2 = 4;
const S3 = 4.5;
const S4 = 5.5;
const T = 0.7;

// A 2400×1500 screenshot (examples/footage/assets/insights.png, written by its capture.ts) in a browser frame whose
// viewport is the image's own pixels. Boxes are in those pixels, as capture.ts printed them.
const SHOT: [number, number] = [2400, 1500];
const EXPORT: Box = { x: 2158, y: 168, w: 182, h: 62 };
const BEST_DAY: Box = { x: 2012, y: 641, w: 285, h: 537 };
const CALLOUT_AT = 0.7;
const SHOT_W = 1400;
/** Frame-pixel position of a source-pixel point: the frame is centred, with a 44 px browser bar on top. */
const onScreen = (sx: number, sy: number) => {
  const k = SHOT_W / SHOT[0];
  const h = SHOT[1] * k + 44;
  return { x: 960 - SHOT_W / 2 + sx * k, y: 540 - h / 2 + 44 + sy * k };
};
const ZOOM_AT = CALLOUT_AT + CLICK_DELAY + 0.8;

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  background: "#e2e8f0",
  layers: [
    series([
      // Browser and app-window chrome around ordinary nodes.
      group(
        [
          solid("#e2e8f0"),
          framed(image(asset("hero.png")), { url: "example.com/gallery", width: 780, height: 488, x: -450, enter: "fade-up" }),
          framed(terminal, {
            chrome: "window",
            title: "Terminal",
            theme: "dark",
            width: 700,
            height: 300,
            x: 470,
            y: 40,
            at: 0.3,
            enter: "fade-up",
          }),
          label("framed(): browser · window"),
        ],
        { duration: S1 },
      ),
      slide(T),
      // Phones. The right one lays a full 1170×2532 scene out in its viewport and scales it to fit.
      group(
        [
          solid("#cbd5e1"),
          framed(phoneList, { chrome: "phone", width: 390, x: -260, enter: "fade-up" }),
          framed(react(Counter, { to: 1000, label: "frames" }), {
            chrome: "phone",
            width: 390,
            viewport: [1170, 2532],
            x: 260,
            at: 0.2,
            enter: "fade-up",
          }),
          label("framed(): phone · viewport"),
        ],
        { duration: S2 },
      ),
      slide(T),
      // Picture-in-picture: full-size scenes shrunk into corners.
      group(
        [
          image(asset("hero.png"), { scale: kf([[0, 1], [S3, 1.08]]) }),
          pip(react(Counter, { to: 1000, label: "frames rendered" }), { at: 0.4, enter: "zoom" }),
          // A smaller viewport keeps the terminal text readable at this size.
          pip(terminal, {
            corner: "top-right",
            size: 0.3,
            viewport: [760, 300],
            chrome: "window",
            title: "Terminal",
            theme: "dark",
            at: 1.1,
            enter: "zoom",
          }),
          label("pip()"),
        ],
        { duration: S3 },
      ),
      slide(T, { direction: "up" }),
      // A screenshot at its source size with a click call-out, then the camera zooms in on the best day.
      group(
        [
          solid("#e2e8f0"),
          group(
            [
              screen({
                src: asset("insights.png"),
                url: "example.com/board/insights",
                imageSize: SHOT,
                width: SHOT_W,
                callout: { box: EXPORT, click: EXPORT, at: CALLOUT_AT },
                enter: "fade-up",
              }),
            ],
            zoomTo({ ...onScreen(BEST_DAY.x + BEST_DAY.w / 2, BEST_DAY.y + BEST_DAY.h * 0.3), scale: 2.2 }, { at: ZOOM_AT, duration: 0.9, hold: 1.2 }),
          ),
          label("framed() viewport = screenshot pixels · zoomTo()"),
        ],
        { duration: S4 },
      ),
    ]),
  ],
  audio: [
    music(modern({ seed: 6, mood: "bright", key: "G major" }), { volume: 0.7, fadeIn: 0.3, fadeOut: 1.2 }),
    sfx.swoosh({ at: S1 - T - 0.1, length: 0.8 }),
    sfx.swoosh({ at: S1 + S2 - 2 * T - 0.1, length: 0.8 }),
    sfx.tap({ at: S1 + S2 - 2 * T + 0.4 }),
    sfx.tap({ at: S1 + S2 - 2 * T + 1.1, freq: 2093 }),
    sfx.swoosh({ at: S1 + S2 + S3 - 3 * T - 0.1, length: 0.8 }),
    sfx.tick({ at: S1 + S2 + S3 - 3 * T + CALLOUT_AT + CLICK_DELAY }),
    sfx.swoosh({ at: S1 + S2 + S3 - 3 * T + ZOOM_AT, length: 0.9, volume: 0.4 }),
    sfx.swoosh({ at: S1 + S2 + S3 - 3 * T + ZOOM_AT + 2.1, length: 0.9, volume: 0.4 }),
  ],
});
