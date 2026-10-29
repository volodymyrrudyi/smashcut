import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import type { TimelineSummary } from "@smashcut/core";
import { captureFrame, launchBrowser, openVideo, type RenderPage } from "./browser";
import { startServer } from "./server";

export interface StillOptions {
  frame: number;
  output: string;
  fps?: number;
  /** Pixel density: 2 renders a 1920×1080 layout at 3840×2160. */
  scale?: number;
  verbose?: boolean;
}

export interface RenderOptions {
  output: string;
  concurrency: number;
  from?: number;
  to?: number;
  crf: number;
  fps?: number;
  /** Pixel density: 2 renders a 1920×1080 layout at 3840×2160. */
  scale?: number;
  verbose?: boolean;
}

async function withVideo<T>(
  projectDir: string,
  pageOpts: { verbose?: boolean; fps?: number; scale?: number },
  fn: (ctx: { browser: Browser; url: string; first: RenderPage }) => Promise<T>,
  { footage = true } = {},
): Promise<T> {
  const { server, url, media } = await startServer(projectDir, { mode: "render" });
  const browser = await launchBrowser();
  try {
    const first = await openVideo(browser, url, pageOpts);
    // Extract footage frames up front: inside a frame capture it would count against the delayRender timeout.
    if (footage) await Promise.all(first.meta.footage.map((src) => media.frames(src, first.meta.fps)));
    return await fn({ browser, url, first });
  } finally {
    await browser.close();
    await server.close();
  }
}

export async function renderStill(projectDir: string, opts: StillOptions): Promise<void> {
  await withVideo(projectDir, opts, async ({ first }) => {
    const { meta, page } = first;
    if (opts.frame < 0 || opts.frame >= meta.durationInFrames) {
      throw new Error(`Frame ${opts.frame} is out of range 0..${meta.durationInFrames - 1}`);
    }
    await mkdir(path.dirname(opts.output), { recursive: true });
    await writeFile(opts.output, await captureFrame(page, opts.frame));
  });
}

/** The resolved timeline: every clip, caption and sound with its times. Nothing is rendered. */
export async function inspectVideo(projectDir: string, opts: { fps?: number; verbose?: boolean } = {}): Promise<TimelineSummary> {
  return withVideo(projectDir, opts, ({ first }) => first.page.evaluate(() => window.__smashcut!.inspect()), { footage: false });
}

export interface SheetOptions {
  output: string;
  /** Number of frames, evenly spaced. Default 12. */
  count?: number;
  /** Or one frame every this many seconds. */
  every?: number;
  columns?: number;
  fps?: number;
  verbose?: boolean;
}

/**
 * Frames for a contact sheet: one every `every` seconds starting at 0, or `count` frames each taken from the
 * middle of an equal slice of the video (so the first isn't a black fade-in and the last isn't the final frame).
 */
export function sheetFrames(total: number, fps: number, { count, every }: { count?: number; every?: number }): number[] {
  if (every !== undefined) {
    if (!(every > 0)) throw new Error("--every must be a positive number of seconds");
    const step = Math.max(1, Math.round(every * fps));
    return Array.from({ length: Math.ceil(total / step) }, (_, i) => i * step);
  }
  const n = Math.max(1, Math.min(count ?? 12, total));
  return [...new Set(Array.from({ length: n }, (_, i) => Math.min(total - 1, Math.floor(((i + 0.5) * total) / n))))];
}

/** Render a grid of frames, each labelled with its time and frame number, as one PNG. */
export async function renderSheet(projectDir: string, opts: SheetOptions): Promise<{ frames: number[]; fps: number }> {
  return withVideo(projectDir, opts, async ({ browser, first }) => {
    const { meta, page } = first;
    const frames = sheetFrames(meta.durationInFrames, meta.fps, opts);
    const shots: string[] = [];
    for (const f of frames) shots.push((await captureFrame(page, f)).toString("base64"));
    // Thumbnails fit 480×360, so landscape and portrait videos both stay readable.
    const k = Math.min(480 / meta.width, 360 / meta.height);
    const w = Math.round(meta.width * k);
    const h = Math.round(meta.height * k);
    const columns = Math.min(opts.columns ?? (meta.width >= meta.height ? 4 : 6), frames.length);
    const stamp = (f: number) => {
      const s = f / meta.fps;
      return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}  ·  frame ${f}`;
    };
    const cells = frames
      .map((f, i) => `<figure><img src="data:image/png;base64,${shots[i]}"><figcaption>${stamp(f)}</figcaption></figure>`)
      .join("");
    const sheet = await browser.newPage({ viewport: { width: columns * (w + 12) + 12, height: 200 } });
    await sheet.setContent(`<!doctype html><style>
      body { margin: 0; padding: 12px; background: #18181b; display: grid; gap: 12px;
        grid-template-columns: repeat(${columns}, ${w}px); font: 600 14px/1 ui-monospace, Menlo, monospace; color: #e4e4e7; }
      figure { margin: 0; } img { display: block; width: ${w}px; height: ${h}px; object-fit: contain; background: #000; }
      figcaption { padding: 7px 2px 0; }
    </style>${cells}`);
    await sheet.waitForFunction(() => [...document.images].every((img) => img.complete));
    await mkdir(path.dirname(path.resolve(opts.output)), { recursive: true });
    await sheet.screenshot({ path: opts.output, fullPage: true });
    return { frames, fps: meta.fps };
  });
}

const SAMPLE_RATE = 48_000;

/** 16-bit stereo PCM WAV header for `dataBytes` of samples. */
function wavHeader(dataBytes: number, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(2, 22); // stereo
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Highest true peak (dBFS) loudness normalisation may raise the soundtrack to. */
const PEAK_CEILING = -1.5;

/** Integrated loudness (LUFS) and true peak (dBFS) of an audio file, from ffmpeg's EBU R128 meter. */
async function measureLoudness(file: string): Promise<{ lufs: number; peak: number }> {
  const proc = spawn("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  let log = "";
  proc.stderr.on("data", (d) => (log += d));
  const [code] = await once(proc, "close");
  if (code !== 0) throw new Error(`ffmpeg could not measure the loudness of ${file}`);
  // The summary comes last: take the final match of each.
  const last = (re: RegExp) => Number([...log.matchAll(re)].at(-1)?.[1]);
  return { lufs: last(/I:\s+(-?[\d.]+) LUFS/g), peak: last(/Peak:\s+(-?[\d.]+) dBFS/g) };
}

/**
 * Bring the soundtrack to `target` LUFS with one gain for the whole mix (so its balance is kept),
 * capped so the true peak stays at or below -1.5 dBFS: AAC encoding overshoots peaks by up to ~1 dB.
 */
async function normalizeLoudness(file: string, target: number): Promise<void> {
  const { lufs, peak } = await measureLoudness(file);
  // ffmpeg reports -70 LUFS for silence; nothing to bring up.
  if (!Number.isFinite(lufs) || lufs <= -69) return;
  const gain = Math.min(target - lufs, PEAK_CEILING - peak);
  if (Math.abs(gain) < 0.05) return;
  const tmp = `${file}.normalized.wav`;
  await runFfmpeg(["-i", file, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "pcm_s16le", tmp]);
  await rename(tmp, file);
}

/** Write the video's mixed (and loudness-normalised) soundtrack to `file`. Returns false if the video has no audio. */
async function exportAudio({ page, meta }: RenderPage, file: string): Promise<boolean> {
  const base64 = await page.evaluate((sr) => window.__smashcut!.audio(sr), SAMPLE_RATE);
  if (!base64) return false;
  const pcm = Buffer.from(base64, "base64");
  await writeFile(file, Buffer.concat([wavHeader(pcm.length, SAMPLE_RATE), pcm]));
  if (meta.loudness !== null) await normalizeLoudness(file, meta.loudness);
  return true;
}

export async function renderAudio(projectDir: string, opts: StillOptions): Promise<boolean> {
  assertFfmpeg();
  return withVideo(projectDir, opts, async ({ first }) => {
    await mkdir(path.dirname(path.resolve(opts.output)), { recursive: true });
    return exportAudio(first, opts.output);
  });
}

function assertFfmpeg() {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
    throw new Error("ffmpeg not found on PATH (macOS: `brew install ffmpeg`)");
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  const proc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  const [code] = await once(proc, "close");
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
}

/** Split [from, to] into `n` contiguous, near-equal ranges. */
export function chunkRange(from: number, to: number, n: number): [number, number][] {
  const total = to - from + 1;
  const count = Math.max(1, Math.min(n, total));
  const size = Math.ceil(total / count);
  const chunks: [number, number][] = [];
  for (let start = from; start <= to; start += size) chunks.push([start, Math.min(to, start + size - 1)]);
  return chunks;
}

export async function renderVideo(projectDir: string, opts: RenderOptions): Promise<void> {
  assertFfmpeg();
  await withVideo(projectDir, opts, async ({ url, first }) => {
    const { meta } = first;
    const from = opts.from ?? 0;
    const to = Math.min(opts.to ?? meta.durationInFrames - 1, meta.durationInFrames - 1);
    if (from < 0 || from > to) throw new Error(`Invalid frame range ${from}..${to}`);

    const extraBrowsers: Browser[] = [];
    const tmp = path.join(path.resolve(projectDir), ".smashcut", `render-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    await mkdir(path.dirname(path.resolve(opts.output)), { recursive: true });

    const total = to - from + 1;
    let done = 0;
    const started = performance.now();
    const report = () => {
      const fps = done / ((performance.now() - started) / 1000);
      process.stderr.write(`\rRendering frame ${done}/${total} (${fps.toFixed(1)} fps)   `);
    };

    try {
      const chunks = chunkRange(from, to, opts.concurrency);
      // One browser per chunk: pages in a shared browser serialize on its compositor.
      const files = await Promise.all(
        chunks.map(async ([start, end], i) => {
          let page = first.page;
          if (i > 0) {
            const own = await launchBrowser();
            extraBrowsers.push(own);
            page = (await openVideo(own, url, opts)).page;
          }
          const file = path.join(tmp, `chunk-${String(i).padStart(3, "0")}.mp4`);
          const ffmpeg = spawn(
            "ffmpeg",
            [
              "-hide_banner", "-loglevel", "error", "-y",
              "-f", "image2pipe", "-framerate", String(meta.fps), "-i", "-",
              "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(opts.crf), "-preset", "medium",
              file,
            ],
            { stdio: ["pipe", "inherit", "inherit"] },
          );
          const exited = once(ffmpeg, "close");
          let closed = false;
          exited.then(() => (closed = true));
          // A dying ffmpeg surfaces as a non-zero exit code below, not as an EPIPE crash.
          ffmpeg.stdin.on("error", () => {});
          for (let f = start; f <= end && !closed; f++) {
            const png = await captureFrame(page, f);
            if (!ffmpeg.stdin.write(png)) await Promise.race([once(ffmpeg.stdin, "drain"), exited]);
            done++;
            report();
          }
          ffmpeg.stdin.end();
          const [code] = await exited;
          if (code !== 0) throw new Error(`ffmpeg exited with code ${code} while encoding chunk ${i}`);
          return file;
        }),
      );
      process.stderr.write("\n");

      let video = files[0];
      if (files.length > 1) {
        video = path.join(tmp, "video.mp4");
        const list = path.join(tmp, "chunks.txt");
        await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
        await runFfmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video]);
      }

      const wav = path.join(tmp, "audio.wav");
      if (await exportAudio(first, wav)) {
        // Trim the soundtrack to the rendered frame range, then mux it in.
        await runFfmpeg([
          "-i", video,
          "-ss", String(from / meta.fps), "-t", String(total / meta.fps), "-i", wav,
          "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
          "-movflags", "+faststart", opts.output,
        ]);
      } else if (files.length === 1) {
        await rename(video, opts.output);
      } else {
        await runFfmpeg(["-i", video, "-c", "copy", "-movflags", "+faststart", opts.output]);
      }
    } finally {
      await Promise.all(extraBrowsers.map((b) => b.close()));
      await rm(tmp, { recursive: true, force: true });
    }
  });
}
