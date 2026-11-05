import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, opendir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Highest frame rate footage frames are extracted at; also the limit for `--fps`. */
export const MAX_FPS = 240;

/** Sample rate footage audio is decoded at; the mixer resamples if it renders at another rate. */
export const MEDIA_SAMPLE_RATE = 48_000;

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/**
 * Footage support for one project: probing, a per-fps JPEG frame cache, and decoded audio.
 * Everything is cached under `.smashcut/footage/` keyed by the file's path, size and mtime, and
 * concurrent requests for the same work (e.g. from parallel render chunks) share one ffmpeg run.
 */
export class MediaCache {
  private controller = new AbortController();
  private jobs = new Map<string, Promise<unknown>>();
  private readonly dir: string;
  private decoders = 0;
  private decoderSlots: (() => void)[] = [];
  private probes = new Map<string, { key: string; result: ProbeResult }>();

  constructor(private readonly root: string) {
    this.dir = path.join(root, ".smashcut", "footage");
  }

  /** Map a timeline `src` such as `/assets/clip.mp4` to a file inside the project. */
  file(src: string): string {
    if (/^[a-z]+:/i.test(src)) throw new Error(`Media must be a project file, got "${src}"`);
    const file = path.join(this.root, decodeURIComponent(src));
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Media path escapes the project: "${src}"`);
    if (!existsSync(file)) throw new Error(`File not found: ${src}`);
    return file;
  }

  /** Stop subprocesses and wait for their exit before removing temporary files or stopping the server. */
  async close(): Promise<void> {
    this.controller.abort();
    await Promise.allSettled([...this.jobs.values()]);
  }

  private once<T>(key: string, job: () => Promise<T>): Promise<T> {
    this.controller.signal.throwIfAborted();
    let p = this.jobs.get(key) as Promise<T> | undefined;
    if (!p) {
      p = job();
      this.jobs.set(key, p);
      // Keep only in-flight jobs: every new request rechecks the source file identity.
      void p.finally(() => { if (this.jobs.get(key) === p) this.jobs.delete(key); }).catch(() => {});
    }
    return p;
  }

  /** Scrubbing across many uncached batches must not launch unbounded ffmpeg processes. */
  private async decode(args: string[]): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.decoders < 2) { this.decoders++; resolve(); }
      else this.decoderSlots.push(resolve);
    });
    try {
      this.controller.signal.throwIfAborted();
      await ffmpeg(args, this.controller.signal);
    } finally {
      const next = this.decoderSlots.shift();
      if (next) next();
      else this.decoders--;
    }
  }

  private async key(file: string, ...extra: (string | number)[]): Promise<string> {
    const s = await stat(file);
    return createHash("sha1")
      .update(["v2", file, s.size, s.mtimeMs, ...extra].join("\0"))
      .digest("hex")
      .slice(0, 16);
  }

  async probe(src: string): Promise<ProbeResult> {
    const file = this.file(src);
    const key = await this.key(file, "probe");
    const cached = this.probes.get(file);
    if (cached?.key === key) return cached.result;
    return this.once(key, async () => {
      const { stdout } = await run("ffprobe", [
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
      ], { signal: this.controller.signal, killSignal: "SIGKILL" });
      const data = JSON.parse(stdout) as {
        format: { duration?: string };
        streams: { codec_type: string; width?: number; height?: number; duration?: string }[];
      };
      const v = data.streams.find((s) => s.codec_type === "video");
      if (!v) throw new Error(`${src} has no video stream`);
      const duration = Number(v.duration ?? data.format.duration);
      if (!(duration > 0)) throw new Error(`Could not read the duration of ${src}`);
      const result = {
        duration,
        width: v.width ?? 0,
        height: v.height ?? 0,
        hasAudio: data.streams.some((s) => s.codec_type === "audio"),
      };
      this.probes.set(file, { key, result });
      return result;
    });
  }

  private async manifest(dir: string, src: string, signature: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `manifest-${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify({ version: 2, src, signature }) + "\n");
      await rename(tmp, path.join(dir, "manifest.json"));
    } finally { await rm(tmp, { force: true }); }
  }

  /** Extract the whole source explicitly (primarily useful for verification against sparse extraction). */
  async frames(src: string, fps: number): Promise<{ dir: string; count: number }> {
    checkFps(fps);
    const info = await this.probe(src);
    const count = Math.max(1, Math.ceil(info.duration * fps));
    const dir = await this.prepareFrames(src, fps, Array.from({ length: count }, (_, i) => i));
    return { dir, count: (await readdir(dir)).filter((f) => /^\d+\.jpg$/.test(f)).length };
  }

  /** Batch exact source indices into one decode. Files keep their source PTS, so gaps are never renumbered. */
  async prepareFrames(src: string, fps: number, indices: readonly number[]): Promise<string> {
    checkFps(fps);
    if (indices.some((i) => !Number.isSafeInteger(i) || i < 0)) throw new Error("Frame indices must be nonnegative integers");
    const file = this.file(src);
    const signature = await this.key(file);
    const key = await this.key(file, "frames", fps);
    const dir = path.join(this.dir, key);
    const frames = [...new Set(indices)].sort((a, b) => a - b);
    const missing = frames.filter((i) => !existsSync(path.join(dir, frameName(i))));
    if (!missing.length) return dir;
    const selection = createHash("sha1").update(missing.join(",")).digest("hex");
    return this.once(`${key}:${selection}`, async () => {
      await this.manifest(dir, src, signature);
      const tmp = path.join(this.dir, `${key}.tmp-${randomUUID()}`);
      await mkdir(tmp, { recursive: true });
      try {
        const ranges: [number, number][] = [];
        for (const index of missing) {
          const last = ranges.at(-1);
          if (last && index === last[1] + 1) last[1] = index;
          else ranges.push([index, index]);
        }
        const select = ranges.map(([from, to]) => from === to ? `eq(n\\,${from})` : `between(n\\,${from}\\,${to})`).join("+");
        // A file avoids command-line length limits for sparse high-speed footage or large contact sheets.
        const filter = path.join(tmp, "select.txt");
        await writeFile(filter, `fps=${fps},select=${select}`);
        process.stderr.write(`Extracting ${missing.length} frame(s) of ${src} at ${fps} fps...\n`);
        await this.decode([
          "-i", file, "-an", "-filter_script:v", filter, "-fps_mode", "passthrough", "-enc_time_base", `1:${fps}`,
          "-q:v", "2", "-frames:v", String(missing.length), "-frame_pts", "1", path.join(tmp, "%012d.jpg"),
        ]);
        for (const image of (await readdir(tmp)).filter((f) => /^\d+\.jpg$/.test(f))) {
          await rename(path.join(tmp, image), path.join(dir, image));
        }
        // A stream may end between output sample times. Match full extraction's last-frame hold without
        // retaining every preceding frame. This also handles inaccurate container duration metadata.
        const absent = missing.filter((i) => !existsSync(path.join(dir, frameName(i))));
        if (absent.length) {
          const last = path.join(tmp, "last.jpg");
          await this.decode(["-i", file, "-an", "-vf", `fps=${fps}`, "-q:v", "2", "-update", "1", last]);
          if (!existsSync(last)) throw new Error(`ffmpeg extracted no frames from ${src}`);
          for (const index of absent) {
            const staged = path.join(tmp, frameName(index));
            await copyFile(last, staged);
            await rename(staged, path.join(dir, frameName(index)));
          }
        }
        return dir;
      } finally { await rm(tmp, { recursive: true, force: true }); }
    });
  }

  /** Preview requests cache at most one second at a time; render commands prewarm their exact indices. */
  async frame(src: string, fps: number, index: number): Promise<string> {
    checkFps(fps);
    if (!Number.isSafeInteger(index)) throw new Error("Frame index must be an integer");
    const file = this.file(src);
    const dir = path.join(this.dir, await this.key(file, "frames", fps));
    let frame = Math.max(0, index);
    let image = path.join(dir, frameName(frame));
    if (existsSync(image)) return image;
    const info = await this.probe(src);
    frame = Math.min(Math.max(0, Math.ceil(info.duration * fps) - 1), frame);
    image = path.join(dir, frameName(frame));
    if (!existsSync(image)) {
      const start = Math.floor(frame / fps) * fps;
      const end = Math.min(Math.ceil(info.duration * fps), start + fps);
      await this.prepareFrames(src, fps, Array.from({ length: end - start }, (_, i) => start + i));
    }
    return image;
  }

  /** Any audio file (a voiceover take, a recording) as interleaved stereo float32 PCM at MEDIA_SAMPLE_RATE. */
  async sound(src: string): Promise<string> {
    const file = this.file(src);
    const key = await this.key(file, "sound", MEDIA_SAMPLE_RATE);
    return this.once(key, async () => {
      const dir = path.join(this.dir, key);
      const out = path.join(dir, "audio.f32");
      await this.manifest(dir, src, await this.key(file));
      if (!existsSync(out)) {
        await mkdir(this.dir, { recursive: true });
        const tmp = path.join(this.dir, `${key}.f32.tmp-${randomUUID()}`);
        try {
          await this.decode(["-i", file, "-vn", "-ac", "2", "-ar", String(MEDIA_SAMPLE_RATE), "-f", "f32le", tmp]);
          await rename(tmp, out);
        } finally {
          await rm(tmp, { force: true });
        }
      }
      return out;
    });
  }

  /** The audio track as interleaved stereo float32 PCM at MEDIA_SAMPLE_RATE, or null if silent. */
  async audio(src: string): Promise<string | null> {
    const file = this.file(src);
    const key = await this.key(file, "audio", MEDIA_SAMPLE_RATE);
    return this.once(key, async () => {
      if (!(await this.probe(src)).hasAudio) return null;
      const dir = path.join(this.dir, key);
      const out = path.join(dir, "audio.f32");
      await this.manifest(dir, src, await this.key(file));
      if (!existsSync(out)) {
        await mkdir(this.dir, { recursive: true });
        const tmp = path.join(this.dir, `${key}.f32.tmp-${randomUUID()}`);
        try {
          await this.decode(["-i", file, "-vn", "-ac", "2", "-ar", String(MEDIA_SAMPLE_RATE), "-f", "f32le", tmp]);
          await rename(tmp, out);
        } finally {
          await rm(tmp, { force: true });
        }
      }
      return out;
    });
  }
}

async function ffmpeg(args: string[], signal: AbortSignal): Promise<void> {
  const proc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "ignore", "pipe"],
    signal,
    killSignal: "SIGKILL",
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  let processError: Error | undefined;
  proc.on("error", (error) => { processError = error; });
  const code = await new Promise<number | null>((resolve) => proc.once("close", resolve));
  if (processError) throw processError;
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`);
}

function checkFps(fps: number): void {
  if (!Number.isInteger(fps) || fps < 1 || fps > MAX_FPS) throw new Error(`fps must be an integer in 1..${MAX_FPS}`);
}
const frameName = (index: number) => `${String(index).padStart(12, "0")}.jpg`;

export interface CacheReport {
  entries: number;
  bytes: number;
  staleEntries: number;
  staleBytes: number;
  removedEntries: number;
  removedBytes: number;
}

/** Inspect or prune only generated footage-cache entries, never project assets, voice takes or render output. */
export async function inspectMediaCache(root: string, prune = false): Promise<CacheReport> {
  root = path.resolve(root);
  const dir = path.join(root, ".smashcut", "footage");
  const report: CacheReport = { entries: 0, bytes: 0, staleEntries: 0, staleBytes: 0, removedEntries: 0, removedBytes: 0 };
  if (!existsSync(dir)) return report;
  const cache = new MediaCache(root);
  const size = async (file: string): Promise<number> => {
    const info = await lstat(file);
    if (info.isSymbolicLink()) return 0;
    if (!info.isDirectory()) return info.size;
    let bytes = 0;
    // Walk incrementally: cache maintenance must not allocate a stat promise for every cached frame.
    for await (const entry of await opendir(file)) {
      if (!entry.isSymbolicLink()) bytes += await size(path.join(file, entry.name));
    }
    return bytes;
  };
  for await (const entry of await opendir(dir)) {
    if (entry.isSymbolicLink() || !/^[a-f0-9]{16}(?:\.f32)?(?:\.tmp-[a-f0-9-]+)?$/.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    const bytes = await size(file);
    let stale = !entry.name.includes(".tmp-") || Date.now() - (await stat(file)).mtimeMs > 24 * 60 * 60 * 1000;
    if (entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name)) {
      try {
        const manifest = JSON.parse(await readFile(path.join(file, "manifest.json"), "utf8"));
        if (manifest.version === 2 && typeof manifest.src === "string" && typeof manifest.signature === "string") {
          const source = cache.file(manifest.src);
          const s = await stat(source);
          const signature = createHash("sha1").update(["v2", source, s.size, s.mtimeMs].join("\0")).digest("hex").slice(0, 16);
          stale = signature !== manifest.signature;
        }
      } catch { /* Legacy, incomplete, deleted or replaced source: rebuildable cache. */ }
    }
    report.entries++;
    report.bytes += bytes;
    if (stale) {
      report.staleEntries++;
      report.staleBytes += bytes;
      if (prune) {
        await rm(file, { recursive: true, force: true });
        report.removedEntries++;
        report.removedBytes += bytes;
      }
    }
  }
  return report;
}
