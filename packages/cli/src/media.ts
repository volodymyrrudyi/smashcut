import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
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
  private jobs = new Map<string, Promise<unknown>>();
  private readonly dir: string;

  constructor(private readonly root: string) {
    this.dir = path.join(root, ".smashcut", "footage");
  }

  /** Map a timeline `src` such as `/assets/clip.mp4` to a file inside the project. */
  file(src: string): string {
    if (/^[a-z]+:/i.test(src)) throw new Error(`Footage must be a project file, got "${src}"`);
    const file = path.join(this.root, decodeURIComponent(src));
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Footage path escapes the project: "${src}"`);
    if (!existsSync(file)) throw new Error(`Footage not found: ${src}`);
    return file;
  }

  private once<T>(key: string, job: () => Promise<T>): Promise<T> {
    let p = this.jobs.get(key) as Promise<T> | undefined;
    if (!p) {
      p = job();
      this.jobs.set(key, p);
      // Let a failed job be retried, e.g. after the file is fixed.
      p.catch(() => this.jobs.delete(key));
    }
    return p;
  }

  private async key(file: string, ...extra: (string | number)[]): Promise<string> {
    const s = await stat(file);
    return createHash("sha1")
      .update([file, s.size, s.mtimeMs, ...extra].join("\0"))
      .digest("hex")
      .slice(0, 16);
  }

  probe(src: string): Promise<ProbeResult> {
    const file = this.file(src);
    return this.once(`probe:${file}`, async () => {
      const { stdout } = await run("ffprobe", [
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
      ]);
      const data = JSON.parse(stdout) as {
        format: { duration?: string };
        streams: { codec_type: string; width?: number; height?: number; duration?: string }[];
      };
      const v = data.streams.find((s) => s.codec_type === "video");
      if (!v) throw new Error(`${src} has no video stream`);
      const duration = Number(v.duration ?? data.format.duration);
      if (!(duration > 0)) throw new Error(`Could not read the duration of ${src}`);
      return {
        duration,
        width: v.width ?? 0,
        height: v.height ?? 0,
        hasAudio: data.streams.some((s) => s.codec_type === "audio"),
      };
    });
  }

  /** Extract every frame of `src` at `fps` (once) and return the directory and frame count. */
  frames(src: string, fps: number): Promise<{ dir: string; count: number }> {
    if (!Number.isInteger(fps) || fps < 1 || fps > MAX_FPS) throw new Error(`fps must be an integer in 1..${MAX_FPS}`);
    const file = this.file(src);
    return this.once(`frames:${file}:${fps}`, async () => {
      const dir = path.join(this.dir, await this.key(file, "frames", fps));
      if (!existsSync(dir)) {
        const tmp = `${dir}.tmp-${process.pid}`;
        await rm(tmp, { recursive: true, force: true });
        await mkdir(tmp, { recursive: true });
        process.stderr.write(`Extracting frames of ${src} at ${fps} fps...\n`);
        await ffmpeg(["-i", file, "-an", "-vf", `fps=${fps}`, "-q:v", "2", "-start_number", "0", path.join(tmp, "%06d.jpg")]);
        // Rename last, so an interrupted extraction is never mistaken for a complete one.
        await rename(tmp, dir);
      }
      const count = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).length;
      if (count === 0) throw new Error(`ffmpeg extracted no frames from ${src}`);
      return { dir, count };
    });
  }

  /** Path of frame `index` at `fps`, clamped to the frames the file actually has. */
  async frame(src: string, fps: number, index: number): Promise<string> {
    const { dir, count } = await this.frames(src, fps);
    const i = Math.max(0, Math.min(count - 1, index));
    return path.join(dir, `${String(i).padStart(6, "0")}.jpg`);
  }

  /** The audio track as interleaved stereo float32 PCM at MEDIA_SAMPLE_RATE, or null if silent. */
  audio(src: string): Promise<string | null> {
    const file = this.file(src);
    return this.once(`audio:${file}`, async () => {
      if (!(await this.probe(src)).hasAudio) return null;
      const out = path.join(this.dir, `${await this.key(file, "audio", MEDIA_SAMPLE_RATE)}.f32`);
      if (!existsSync(out)) {
        await mkdir(this.dir, { recursive: true });
        const tmp = `${out}.tmp-${process.pid}`;
        await ffmpeg(["-i", file, "-vn", "-ac", "2", "-ar", String(MEDIA_SAMPLE_RATE), "-f", "f32le", tmp]);
        await rename(tmp, out);
      }
      return out;
    });
  }
}

async function ffmpeg(args: string[]): Promise<void> {
  const proc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  const [code] = await once(proc, "close");
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`);
}
