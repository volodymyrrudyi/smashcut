import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchBrowser, openVideo, captureFrame } from "./browser";
import { MediaCache, inspectMediaCache } from "./media";
import { inspectVideo, renderAudio, renderSheet, renderVideo, renderStill } from "./render";
import { startServer } from "./server";

const run = promisify(execFile);
const integration = process.env.SMASHCUT_E2E === "1" ? describe : describe.skip;
let root: string;
const writeTimeline = (source: string) => writeFile(path.join(root, "timeline.ts"), source);
const solidTimeline = (layers: string, audio = "") => `
  import { defineVideo, solid, image, series, group, fade, asset, video, decor } from "@smashcut/core";
  export default defineVideo({ size: [64, 64], fps: 10, duration: 1, loudness: false, layers: ${layers} ${audio} });`;
async function rgb(file: string): Promise<Buffer> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}
function colorFrame(r: number, g: number, b: number): Buffer {
  const bytes = Buffer.alloc(64 * 64 * 3);
  for (let i = 0; i < bytes.length; i += 3) { bytes[i] = r; bytes[i + 1] = g; bytes[i + 2] = b; }
  return bytes;
}

integration("real browser and encoder regressions", () => {
  beforeEach(async () => {
    // Exercise concat manifest quoting on every render.
    root = await mkdtemp(path.join(os.tmpdir(), "smashcut's-render-"));
    await mkdir(path.join(root, "assets"));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("matches golden RGB frames for solid, image, group and fade composition", async () => {
    await writeFile(path.join(root, "assets", "blue.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path fill="#00f" d="M0 0h64v64H0z"/></svg>');
    await writeTimeline(solidTimeline('[series([solid("#f00", {duration: 1}), fade(0.4, {easing: "linear"}), group([image(asset("blue.svg"))], {duration: 1})])]'));
    const { server, url } = await startServer(root, { mode: "render" });
    const browser = await launchBrowser();
    try {
      const { page } = await openVideo(browser, url);
      for (const [frame, expected] of [[0, colorFrame(255, 0, 0)], [8, colorFrame(127, 0, 128)]] as const) {
        const file = path.join(root, `${frame}.png`);
        await writeFile(file, await captureFrame(page, frame));
        const actual = await rgb(file);
        // One unit tolerance permits compositor alpha rounding.
        expect(actual.length).toBe(expected.length);
        expect(actual.every((v, i) => Math.abs(v - expected[i]) <= 1)).toBe(true);
      }
    } finally { await browser.close(); await server.close(); }
  }, 30_000);

  it("matches the visual baseline for text, subtitles, frame chrome, decor and React", async () => {
    await copyFile(new URL("../fixtures/golden/timeline.ts", import.meta.url), path.join(root, "timeline.ts"));
    await copyFile(new URL("../../../examples/hello/assets/fonts/inter.woff2", import.meta.url), path.join(root, "assets", "inter.woff2"));
    await writeFile(path.join(root, "assets", "mark.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42"><path fill="#38bdf8" d="M0 0h42v42H0z"/><path fill="#0f172a" d="M10 10h22v22H10z"/></svg>');
    const output = path.join(root, "ui.png");
    await renderStill(root, { frame: 5, output });
    const baseline = new URL("../fixtures/golden/ui.png", import.meta.url);
    if (process.env.SMASHCUT_UPDATE_GOLDENS === "1") await copyFile(output, baseline);
    const expected = await rgb(baseline.pathname);
    const actual = await rgb(output);
    expect(actual.length).toBe(expected.length);
    let different = 0;
    for (let i = 0; i < actual.length; i += 3) {
      if ([0, 1, 2].some((channel) => Math.abs(actual[i + channel] - expected[i + channel]) > 12)) different++;
    }
    // Allow a small amount of rasterizer variation, while catching missing or moved elements.
    expect(different / (actual.length / 3)).toBeLessThan(0.005);
  }, 30_000);

  it("captures the same seeded scene on repeated, out-of-order and independent seeks", async () => {
    await writeFile(path.join(root, "lib.tsx"), `
      import { useMemo } from "react";
      import { rng } from "@smashcut/core";
      import { useClip } from "@smashcut/runtime";
      export function Scene() {
        const { frame } = useClip();
        const x = useMemo(() => rng(123)() * 10, []);
        const y = 4 + Math.floor(Math.random() * 5);
        return <div style={{position:"absolute",left:x+frame,top:y,width:10,height:10,background:"white"}}/>;
      }`);
    await writeTimeline(`
      import { defineVideo, react, solid } from "@smashcut/core";
      import { Scene } from "./lib";
      const red = Math.floor(Math.random() * 255);
      if (Date.now() !== Date.UTC(2025,0,1) || performance.now() !== 0) throw new Error("late clock bootstrap");
      export default defineVideo({ size:[64,64], fps:10, duration:1,
        layers:[solid("rgb("+red+",0,0)"), react(Scene, {}, {at:0.3})] });`);
    const { server, url } = await startServer(root, { mode: "render" });
    const browser = await launchBrowser();
    try {
      const a = await openVideo(browser, url);
      const b = await openVideo(browser, url);
      const zero = await captureFrame(a.page, 0);
      for (let frame = 1; frame <= 7; frame++) await captureFrame(a.page, frame);
      const expected = await captureFrame(a.page, 7);
      expect(await captureFrame(b.page, 7)).toEqual(expected);
      expect(await captureFrame(a.page, 0)).toEqual(zero);
      expect(await captureFrame(a.page, 7)).toEqual(expected);
    } finally { await browser.close(); await server.close(); }
  }, 30_000);

  it("rejects missing images and rejected asynchronous three.js setup", async () => {
    await writeTimeline(solidTimeline('[image(asset("missing.png"))]'));
    await expect(renderStill(root, { frame: 0, output: path.join(root, "missing.png") })).rejects.toThrow(/frame 0.*Failed to load image/s);
    await writeTimeline(solidTimeline('[decor.watermark({src: asset("missing.svg")})]'));
    await expect(renderStill(root, { frame: 0, output: path.join(root, "watermark.png") })).rejects.toThrow(/Failed to load watermark/);
    await writeTimeline(`import { defineVideo } from "@smashcut/core";
      import { three } from "@smashcut/three";
      export default defineVideo({size:[64,64],duration:1,layers:[three(async () => {throw new Error("setup exploded")})]});`);
    await expect(renderStill(root, { frame: 0, output: path.join(root, "three.png") })).rejects.toThrow(/setup exploded/);
  }, 30_000);

  it("invalidates probe, extracted frames and audio when the source is replaced", async () => {
    const clip = path.join(root, "assets", "clip.mp4");
    const makeClip = async (color: string, duration: number, frequency: number) => {
      const next = path.join(root, "next.mp4");
      await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=${color}:s=64x64:r=10:d=${duration}`, "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", next]);
      await copyFile(next, clip);
    };
    await makeClip("red", 1, 440);
    const cache = new MediaCache(root);
    const before = await cache.probe("/assets/clip.mp4");
    const frameA = await cache.frame("/assets/clip.mp4", 10, 0);
    const audioA = await cache.audio("/assets/clip.mp4");
    const soundA = await cache.sound("/assets/clip.mp4");
    await makeClip("blue", 2, 880);
    expect((await cache.probe("/assets/clip.mp4")).duration).toBeGreaterThan(before.duration);
    const frameB = await cache.frame("/assets/clip.mp4", 10, 0);
    expect(frameB).not.toBe(frameA);
    expect(await readFile(frameB)).not.toEqual(await readFile(frameA));
    expect(await cache.audio("/assets/clip.mp4")).not.toBe(audioA);
    expect(await cache.sound("/assets/clip.mp4")).not.toBe(soundA);
    const report = await inspectMediaCache(root);
    expect(report.entries).toBe(6);
    expect(report.staleEntries).toBe(3);
    const { stdout: pruned } = await run(process.execPath, [new URL("../bin/smashcut.js", import.meta.url).pathname, "cache", root, "--prune", "--json"]);
    const removed = JSON.parse(pruned);
    expect(removed.removedEntries).toBe(3);
    expect(removed.removedBytes).toBe(report.staleBytes);
    expect((await inspectMediaCache(root)).staleEntries).toBe(0);
    expect(await readFile(frameB)).toBeTruthy();
    expect(await stat(clip)).toBeTruthy();
  }, 30_000);

  it("extracts only requested still/sheet/range frames and matches a full 25-to-30 fps decode", async () => {
    const source = path.join(root, "assets", "clip.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    await writeTimeline(`import {defineVideo,video,asset} from "@smashcut/core";
      export default defineVideo({size:[64,64],fps:30,layers:[video(asset("clip.mp4"),{trim:[1.5,2],muted:true})]});`);
    await inspectVideo(root);
    const cacheDir = path.join(root, ".smashcut", "footage");
    expect(await readdir(cacheDir).catch(() => [])).toEqual([]);
    const still = path.join(root, "still.png");
    await renderStill(root, { frame: 4, output: still });
    const entries = await readdir(cacheDir);
    expect(entries).toHaveLength(1);
    const dir = path.join(cacheDir, entries[0]);
    const images = () => readdir(dir).then((names) => names.filter((n) => /^\d+\.jpg$/.test(n)).sort());
    expect(await images()).toEqual(["000000000049.jpg"]);
    const reference = path.join(root, "reference");
    await mkdir(reference);
    await run("ffmpeg", ["-v", "error", "-i", source, "-an", "-vf", "fps=30", "-q:v", "2", "-start_number", "0", path.join(reference, "%012d.jpg")]);
    expect(await rgb(path.join(dir, "000000000049.jpg"))).toEqual(await rgb(path.join(reference, "000000000049.jpg")));
    await renderSheet(root, { output: path.join(root, "sheet.png"), count: 3 });
    expect(await images()).toEqual(["000000000047.jpg", "000000000049.jpg", "000000000052.jpg", "000000000057.jpg"]);
    await renderVideo(root, { output: path.join(root, "range.mp4"), from: 2, to: 4, concurrency: 2, crf: 0 });
    expect(await images()).toEqual(["000000000047.jpg", "000000000048.jpg", "000000000049.jpg", "000000000052.jpg", "000000000057.jpg"]);
    for (const image of await images()) expect(await rgb(path.join(dir, image))).toEqual(await rgb(path.join(reference, image)));
    const referenceBytes = (await Promise.all((await readdir(reference)).map((name) => stat(path.join(reference, name))))).reduce((n, info) => n + info.size, 0);
    const cacheBytes = (await inspectMediaCache(root)).bytes;
    expect(cacheBytes).toBeLessThan(referenceBytes * 0.1);
  }, 60_000);

  it("holds the actual final decoded frame when duration rounds past the FPS filter's end", async () => {
    const source = path.join(root, "assets", "short.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=0.88", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    const reference = path.join(root, "reference");
    await mkdir(reference);
    await run("ffmpeg", ["-v", "error", "-i", source, "-an", "-vf", "fps=30", "-q:v", "2", "-start_number", "0", path.join(reference, "%012d.jpg")]);
    const frames = (await readdir(reference)).sort();
    const cache = new MediaCache(root);
    const info = await cache.probe("/assets/short.mp4");
    const requested = Math.ceil(info.duration * 30) - 1;
    expect(requested).toBeGreaterThanOrEqual(frames.length);
    const dir = await cache.prepareFrames("/assets/short.mp4", 30, [requested]);
    const image = path.join(dir, `${String(requested).padStart(12, "0")}.jpg`);
    expect(await rgb(image)).toEqual(await rgb(path.join(reference, frames.at(-1)!)));
    expect((await readdir(dir)).filter((name) => name.endsWith(".jpg"))).toHaveLength(1);
  }, 30_000);

  it("exports bounded PCM chunks sample-for-sample with the legacy bridge and releases the mix", async () => {
    await writeTimeline(`import {defineVideo,solid,sfx} from "@smashcut/core";
      export default defineVideo({size:[64,64],duration:2,loudness:false,layers:[solid("black")],audio:[sfx.bell({at:0.1})]});`);
    const { server, url } = await startServer(root, { mode: "render" });
    const browser = await launchBrowser();
    try {
      const { page } = await openVideo(browser, url);
      const legacy = Buffer.from((await page.evaluate(() => window.__smashcut!.audio(48000)))!, "base64");
      const meta = await page.evaluate(() => window.__smashcut!.prepareAudio(48000));
      expect(meta?.samples).toBe(96000);
      const chunks = [];
      for (let offset = 0; offset < meta!.samples; offset += 32768) {
        chunks.push(Buffer.from(await page.evaluate((offset) => window.__smashcut!.audioChunk(offset, 32768), offset), "base64"));
      }
      expect(Buffer.concat(chunks)).toEqual(legacy);
      await expect(page.evaluate(() => window.__smashcut!.audioChunk(0, 32769))).rejects.toThrow("1..32768");
      await page.evaluate(() => window.__smashcut!.releaseAudio());
      await expect(page.evaluate(() => window.__smashcut!.audioChunk(0, 1))).rejects.toThrow("prepareAudio");
      const wav = path.join(root, "audio.wav");
      await renderAudio(root, { output: wav, frame: 0 });
      const bytes = await readFile(wav);
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.readUInt32LE(40)).toBe(legacy.length);
      expect(bytes.subarray(44)).toEqual(legacy);
    } finally { await browser.close(); await server.close(); }
  }, 30_000);

  it("renders matching single and parallel outputs with the expected streams and range", async () => {
    const clip = path.join(root, "assets", "clip.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=10:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
    await writeTimeline(solidTimeline('[video(asset("clip.mp4"), {at: 0.3})]'));
    const outputs = [path.join(root, "single.mp4"), path.join(root, "parallel.mp4")];
    for (const [i, output] of outputs.entries()) {
      await renderVideo(root, { output, concurrency: i + 1, crf: 0, from: 2, to: 7 });
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output]);
      const info = JSON.parse(stdout);
      const video = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
      expect(video).toMatchObject({ width: 64, height: 64, nb_frames: "6", r_frame_rate: "10/1" });
      expect(info.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio")).toBe(true);
      expect(Number(info.format.duration)).toBeCloseTo(0.6, 1);
    }
    const single = await rgb(outputs[0]);
    expect(await rgb(outputs[1])).toEqual(single);
    expect(single.subarray(0, 64 * 64 * 3)).not.toEqual(single.subarray(-64 * 64 * 3));
    const { stdout: pcm } = await run("ffmpeg", ["-v", "error", "-i", outputs[1], "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { encoding: "buffer" });
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++) sum += pcm.readFloatLE(i * 4) ** 2;
      return Math.sqrt(sum / ((to - from) * 48000));
    };
    // Footage starts at 0.3s; rendering from 0.2s must preserve the initial 0.1s of silence.
    expect(rms(0, 0.05)).toBeLessThan(0.002);
    expect(rms(0.15, 0.4)).toBeGreaterThan(0.03);
  }, 60_000);
});
