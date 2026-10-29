// Records assets/tour.mp4: a frame-exact walk through site/index.html, a small made-up task board.
// Also writes assets/insights.png, the last frame as a full-resolution still (examples/frames uses a copy).
//
//   npx tsx examples/footage/capture.ts
//
// The page runs on virtual time. Playwright's clock drives timers and Date, and every CSS
// animation / transition is paused and seeked to the virtual time, so each frame is captured
// exactly 1/fps apart no matter how long a screenshot takes.
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { STEPS, TOUR } from "./lib/tour";

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, "assets", "tour.mp4");

const browser = await chromium.launch({ args: ["--hide-scrollbars", "--force-color-profile=srgb", "--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: TOUR.viewport, deviceScaleFactor: TOUR.scale });
await page.clock.install();
await page.goto(pathToFileURL(path.join(dir, TOUR.page)).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);

// Virtual-time stepping for CSS: each animation starts at the virtual time it is first seen at. (Its own
// currentTime then is real time that has passed, which varies from run to run, so it's ignored.)
await page.evaluate(() => {
  const seen = new WeakMap<Animation, number>();
  (window as unknown as { __seek: (now: number) => void }).__seek = (now) => {
    for (const anim of document.getAnimations()) {
      if (!seen.has(anim)) seen.set(anim, now);
      anim.pause();
      anim.currentTime = now - seen.get(anim)!;
    }
  };
});
await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);

const ffmpeg = spawn(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(TOUR.fps), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    out,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);

const frames = Math.round(TOUR.duration * TOUR.fps);
const frameMs = 1000 / TOUR.fps;
let next = 0;
for (let f = 0; f < frames; f++) {
  const t = f / TOUR.fps;
  while (next < STEPS.length && STEPS[next].at <= t) {
    // Not awaited: the step's own timers advance with the virtual clock below.
    const { step } = STEPS[next++];
    await page.evaluate((s) => void (window as unknown as { tour: Record<string, () => unknown> }).tour[s](), step);
  }
  await page.evaluate((now) => (window as unknown as { __seek: (n: number) => void }).__seek(now), f * frameMs);
  const jpeg = await page.screenshot({ type: "jpeg", quality: 95 });
  if (!ffmpeg.stdin.write(jpeg)) await once(ffmpeg.stdin, "drain");
  process.stderr.write(`\rCaptured ${f + 1}/${frames}`);
  await page.clock.runFor(frameMs);
}
ffmpeg.stdin.end();
const [code] = await once(ffmpeg, "close");
if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);

// The settled Insights view as a still, plus where its parts are in source pixels (for call-outs).
await page.screenshot({ path: path.join(dir, "assets", "insights.png") });
// (A plain loop: tsx would wrap a nested named function in a helper the page doesn't have.)
const boxes = await page.evaluate(
  ([k, sels]) =>
    Object.fromEntries(
      sels.map((sel) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return [sel, { x: Math.round(r.x * k), y: Math.round(r.y * k), w: Math.round(r.width * k), h: Math.round(r.height * k) }];
      }),
    ),
  [TOUR.scale, [".stats", ".chart", "#export", ".bar:last-child"]] as const,
);
await browser.close();
console.log(`\nWrote ${out}\nInsights boxes (source px): ${JSON.stringify(boxes)}`);
