import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import type { TimelineSummary } from "@smashcut/core";
import { captureFrame, launchBrowser, openVideo, type RenderPage } from "./browser";
import { startServer } from "./server";
import type { MediaCache } from "./media";
import { generateMissing, removeTakeFiles, unusedTakeFiles } from "./voice/takes";

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
  fn: (ctx: { browser: Browser; url: string; first: RenderPage; root: string; media: MediaCache }) => Promise<T>,
  { voices = true } = {},
): Promise<T> {
  validatePageOptions(pageOpts);
  const { server, url, media, root, refreshVoices } = await startServer(projectDir, { mode: "render" });
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    let first = await openVideo(browser, url, pageOpts);
    // Voiceover lines change the timeline's timing: generate the missing ones, then load the video again.
    if (voices && first.meta.voices.missing.length) {
      await generateMissing(root, first.meta.voices.missing);
      refreshVoices();
      await first.page.close();
      first = await openVideo(browser, url, pageOpts);
      const left = first.meta.voices.missing.length;
      if (left) throw new Error(`${left} voiceover line(s) are still missing after generating them`);
    }
    return await fn({ browser, url, first, root, media });
  } finally {
    try {
      await media.close();
    } finally {
      try { await browser?.close(); } finally { await server.close(); }
    }
  }
}

export async function renderStill(projectDir: string, opts: StillOptions): Promise<void> {
  integer(opts.frame, "frame", 0);
  await withVideo(projectDir, opts, async ({ first, media }) => {
    const { meta, page } = first;
    if (opts.frame < 0 || opts.frame >= meta.durationInFrames) {
      throw new Error(`Frame ${opts.frame} is out of range 0..${meta.durationInFrames - 1}`);
    }
    await prepareFootage(first, media, [[opts.frame, opts.frame]]);
    await mkdir(path.dirname(opts.output), { recursive: true });
    await writeFile(opts.output, await captureFrame(page, opts.frame));
  });
}

/**
 * The resolved timeline: every clip, caption and sound with its times. Nothing is rendered, and voiceover lines
 * aren't generated (missing ones are listed in `pendingVoices`, with estimated timings in the timeline).
 */
export async function inspectVideo(
  projectDir: string,
  opts: { fps?: number; verbose?: boolean } = {},
): Promise<TimelineSummary & { pendingVoices: number }> {
  return withVideo(
    projectDir,
    opts,
    async ({ first }) => ({
      ...(await first.page.evaluate(() => window.__smashcut!.inspect())),
      pendingVoices: first.meta.voices.missing.length,
    }),
    { voices: false },
  );
}

export interface VoiceoverReport {
  generated: number;
  lines: number;
  /** Files in voiceovers/ that no line uses any more. */
  unused: string[];
}

/** Generate every missing voiceover line; with `prune`, delete takes the timeline no longer uses. */
export async function voiceover(projectDir: string, opts: { prune?: boolean; verbose?: boolean } = {}): Promise<VoiceoverReport> {
  return withVideo(
    projectDir,
    opts,
    async ({ first, root }) => {
      const { all, missing } = first.meta.voices;
      const generated = await generateMissing(root, missing);
      const unused = await unusedTakeFiles(root, all);
      if (opts.prune) await removeTakeFiles(root, unused);
      return { generated: generated.length, lines: all.length, unused };
    },
    { voices: false },
  );
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
  integer(total, "total frames", 1);
  integer(fps, "fps", 1, 240);
  if (count !== undefined) integer(count, "count", 1);
  if (every !== undefined) {
    if (!Number.isFinite(every) || !(every > 0)) throw new Error("--every must be a positive number of seconds");
    const step = Math.max(1, Math.round(every * fps));
    return Array.from({ length: Math.ceil(total / step) }, (_, i) => i * step);
  }
  const n = Math.max(1, Math.min(count ?? 12, total));
  return [...new Set(Array.from({ length: n }, (_, i) => Math.min(total - 1, Math.floor(((i + 0.5) * total) / n))))];
}

/** Render a grid of frames, each labelled with its time and frame number, as one PNG. */
export async function renderSheet(projectDir: string, opts: SheetOptions): Promise<{ frames: number[]; fps: number }> {
  if (opts.columns !== undefined) integer(opts.columns, "columns", 1);
  if (opts.count !== undefined) integer(opts.count, "count", 1);
  if (opts.every !== undefined && (!Number.isFinite(opts.every) || opts.every <= 0)) throw new Error("--every must be a finite positive number");
  return withVideo(projectDir, opts, async ({ browser, first, media }) => {
    const { meta, page } = first;
    const frames = sheetFrames(meta.durationInFrames, meta.fps, opts);
    await prepareFootage(first, media, frames.map((frame) => [frame, frame]));
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
  const audio = await page.evaluate((sr) => window.__smashcut!.prepareAudio(sr), SAMPLE_RATE);
  if (!audio) return false;
  try {
    const bytes = audio.samples * 4;
    if (bytes > 0xffffffff - 36) throw new Error("Soundtrack exceeds the 4 GiB PCM WAV limit");
    const fileHandle = await open(file, "w");
    try {
      await fileHandle.writeFile(wavHeader(bytes, audio.sampleRate));
      for (let offset = 0; offset < audio.samples; offset += 32768) {
        const base64 = await page.evaluate((offset) => window.__smashcut!.audioChunk(offset, 32768), offset);
        await fileHandle.writeFile(Buffer.from(base64, "base64"));
      }
    } finally { await fileHandle.close(); }
  } finally { await page.evaluate(() => window.__smashcut!.releaseAudio()); }
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
  integer(from, "from", 0);
  integer(to, "to", from);
  integer(n, "concurrency", 1);
  const total = to - from + 1;
  integer(total, "total frames", 1);
  const count = Math.max(1, Math.min(n, total));
  const size = Math.ceil(total / count);
  const chunks: [number, number][] = [];
  for (let start = from; start <= to; start += size) chunks.push([start, Math.min(to, start + size - 1)]);
  return chunks;
}

export async function renderVideo(projectDir: string, opts: RenderOptions): Promise<void> {
  validatePageOptions(opts);
  integer(opts.concurrency, "concurrency", 1);
  integer(opts.crf, "crf", 0, 51);
  if (opts.from !== undefined) integer(opts.from, "from", 0);
  if (opts.to !== undefined) integer(opts.to, "to", opts.from ?? 0);
  assertFfmpeg();
  await withVideo(projectDir, opts, async ({ url, first, media }) => {
    const { meta } = first;
    const scale = opts.scale ?? 1;
    const width = Math.round(meta.width * scale);
    const height = Math.round(meta.height * scale);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2 || width % 2 || height % 2) {
      throw new Error(`H.264 output dimensions must be positive even numbers, got ${width}×${height}; adjust size or --scale`);
    }
    const from = opts.from ?? 0;
    const to = Math.min(opts.to ?? meta.durationInFrames - 1, meta.durationInFrames - 1);
    if (from < 0 || from > to) throw new Error(`Invalid frame range ${from}..${to}`);
    await prepareFootage(first, media, [[from, to]]);

    const extraBrowsers: Browser[] = [];
    const cacheDir = path.join(path.resolve(projectDir), ".smashcut");
    await mkdir(cacheDir, { recursive: true });
    const tmp = await mkdtemp(path.join(cacheDir, "render-"));

    const total = to - from + 1;
    let done = 0;
    const started = performance.now();
    const report = () => {
      const fps = done / ((performance.now() - started) / 1000);
      process.stderr.write(`\rRendering frame ${done}/${total} (${fps.toFixed(1)} fps)   `);
    };

    try {
      await mkdir(path.dirname(path.resolve(opts.output)), { recursive: true });
      const chunks = chunkRange(from, to, opts.concurrency);
      const controller = new AbortController();
      const { signal } = controller;
      let firstError: unknown;
      // One browser per chunk: pages in a shared browser serialize on its compositor.
      const results = await Promise.allSettled(
        chunks.map(async ([start, end], i) => {
          let page = first.page;
          let own: Browser | undefined;
          const cancel = () => {
            void (own ? own.close() : page.close()).catch(() => {});
          };
          signal.addEventListener("abort", cancel, { once: true });
          try {
            signal.throwIfAborted();
            if (i > 0) {
              own = await launchBrowser();
              extraBrowsers.push(own);
              signal.throwIfAborted();
              page = (await openVideo(own, url, opts)).page;
              signal.throwIfAborted();
            }
            const file = path.join(tmp, `chunk-${String(i).padStart(3, "0")}.mp4`);
            await encodeChunk(page, start, end, file, meta.fps, opts.crf, signal, () => {
              done++;
              report();
            });
            return file;
          } catch (error) {
            if (!signal.aborted) {
              firstError = error;
              controller.abort(error);
            }
            throw error;
          } finally {
            signal.removeEventListener("abort", cancel);
            await own?.close();
          }
        }),
      );
      if (signal.aborted) throw firstError;
      const files = results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      process.stderr.write("\n");

      let video = files[0];
      if (files.length > 1) {
        video = path.join(tmp, "video.mp4");
        const list = path.join(tmp, "chunks.txt");
        await writeFile(list, files.map((f) => `file '${path.basename(f)}'`).join("\n"));
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
      try {
        await Promise.allSettled(extraBrowsers.map((b) => b.close()));
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
  });
}

/** Own the encoder for the whole chunk, including capture failures and cancellation. */
async function encodeChunk(
  page: Page, start: number, end: number, file: string, fps: number, crf: number,
  signal: AbortSignal, progress: () => void,
): Promise<void> {
  signal.throwIfAborted();
  const proc = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(crf), "-preset", "medium", file,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  // Always observe both spawn errors and close, even when capture fails first.
  let spawnError: Error | undefined;
  proc.on("error", (error) => { spawnError = error; });
  const exited = new Promise<number | null>((resolve) => proc.once("close", resolve));
  let closed = false;
  void exited.then(() => { closed = true; });
  proc.stdin.on("error", () => {});
  const cancel = () => { proc.kill("SIGKILL"); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (let frame = start; frame <= end; frame++) {
      signal.throwIfAborted();
      if (closed) throw spawnError ?? new Error("ffmpeg stopped before all frames were encoded");
      const png = await captureFrame(page, frame);
      signal.throwIfAborted();
      if (!proc.stdin.write(png)) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            proc.stdin.off("drain", finish);
            proc.off("close", finish);
            resolve();
          };
          proc.stdin.once("drain", finish);
          proc.once("close", finish);
          if (closed) finish();
        });
      }
      progress();
    }
    proc.stdin.end();
    const code = await exited;
    if (spawnError) throw spawnError;
    signal.throwIfAborted();
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code} while encoding ${path.basename(file)}`);
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!closed) proc.kill("SIGKILL");
    await exited;
  }
}

function integer(value: number, name: string, min: number, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer in ${min}..${max}, got ${value}`);
  }
}

function validatePageOptions(opts: { fps?: number; scale?: number }): void {
  if (opts.fps !== undefined) integer(opts.fps, "fps", 1, 240);
  if (opts.scale !== undefined && (!Number.isFinite(opts.scale) || opts.scale <= 0)) {
    throw new Error("--scale must be a finite positive number");
  }
}

/** Prewarm only the source frames this command captures, before they count against readiness deadlines. */
async function prepareFootage(first: RenderPage, media: MediaCache, ranges: [number, number][]): Promise<void> {
  if (!first.meta.footage.length) return;
  const requests = await first.page.evaluate((ranges) => window.__smashcut!.footage(ranges), ranges);
  // Limit concurrent full-resolution decoders to keep source decoding memory bounded.
  for (const request of requests) await media.prepareFrames(request.src, first.meta.fps, request.frames);
}
