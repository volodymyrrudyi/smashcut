import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), spawn: mock.spawn }));
import { inspectMediaCache, MediaCache } from "./media";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "smashcut-media-"));
  await writeFile(path.join(root, "clip.mp4"), "dummy");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("media subprocess lifecycle", () => {
  it("waits for an aborted encoder to exit before deleting its working directory", async () => {
    const proc = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    let spawned: () => void = () => {};
    const started = new Promise<void>((resolve) => { spawned = resolve; });
    mock.spawn.mockImplementation((_cmd, _args, opts) => {
      opts.signal.addEventListener("abort", () => proc.emit("error", new Error("aborted")));
      spawned();
      return proc;
    });
    const cache = new MediaCache(root);
    vi.spyOn(cache, "probe").mockResolvedValue({ duration: 1, width: 64, height: 64, hasAudio: false });
    const result = expect(cache.frames("/clip.mp4", 30)).rejects.toThrow("aborted");
    await started;
    let stopped = false;
    const stopping = cache.close().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    const dir = path.join(root, ".smashcut", "footage");
    expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toHaveLength(1);
    proc.emit("close", null);
    await stopping;
    await result;
    expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
    await expect(cache.frames("/clip.mp4", 30)).rejects.toThrow();
  });

  it("limits concurrent decoders and cancels queued batches during shutdown", async () => {
    mock.spawn.mockClear();
    mock.spawn.mockImplementation((_cmd, _args, opts) => {
      const proc = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      opts.signal.addEventListener("abort", () => {
        proc.emit("error", new Error("aborted"));
        setImmediate(() => proc.emit("close", null));
      });
      return proc;
    });
    const cache = new MediaCache(root);
    const results = Promise.allSettled([0, 30, 60].map((index) => cache.prepareFrames("/clip.mp4", 30, [index])));
    await vi.waitFor(() => expect(mock.spawn).toHaveBeenCalledTimes(2));
    const dir = path.join(root, ".smashcut", "footage");
    await vi.waitFor(async () => expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toHaveLength(3));
    await cache.close();
    expect(mock.spawn).toHaveBeenCalledTimes(2);
    expect((await results).every((result) => result.status === "rejected")).toBe(true);
    expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("removes incomplete extraction directories when ffmpeg exits unsuccessfully", async () => {
    const proc = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    mock.spawn.mockImplementation(() => {
      queueMicrotask(() => { proc.stderr.emit("data", "bad source"); proc.emit("close", 1); });
      return proc;
    });
    const cache = new MediaCache(root);
    vi.spyOn(cache, "probe").mockResolvedValue({ duration: 1, width: 64, height: 64, hasAudio: false });
    await expect(cache.frames("/clip.mp4", 30)).rejects.toThrow("bad source");
    expect((await readdir(path.join(root, ".smashcut", "footage"))).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});


describe("cache pruning boundaries", () => {
  it("removes only obsolete generated entries and old temporary data", async () => {
    const dir = path.join(root, ".smashcut", "footage");
    await mkdir(dir, { recursive: true });
    const legacy = path.join(dir, "a".repeat(16));
    await mkdir(legacy);
    await writeFile(path.join(legacy, "000000.jpg"), "old generated image");
    await writeFile(path.join(dir, "b".repeat(16) + ".f32"), "old generated audio");
    const oldTemp = path.join(dir, "c".repeat(16) + ".tmp-123");
    await mkdir(oldTemp);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(oldTemp, old, old);
    const oldAudioTemp = path.join(dir, "f".repeat(16) + ".f32.tmp-123");
    await writeFile(oldAudioTemp, "interrupted audio");
    await utimes(oldAudioTemp, old, old);
    const recentTemp = path.join(dir, "d".repeat(16) + ".tmp-456");
    await mkdir(recentTemp);
    await writeFile(path.join(dir, "notes.json"), "hand-written data");
    await writeFile(path.join(root, "voiceover.mp3"), "project audio");
    await symlink(path.join(root, "voiceover.mp3"), path.join(dir, "e".repeat(16) + ".f32"));
    const before = await inspectMediaCache(root);
    expect(before.entries).toBe(5);
    expect(before.staleEntries).toBe(4);
    expect(before.removedEntries).toBe(0);
    expect(await readdir(dir)).toHaveLength(7);
    const report = await inspectMediaCache(root, true);
    expect(report.removedEntries).toBe(4);
    expect(report.removedBytes).toBe(before.staleBytes);
    expect((await readdir(dir)).sort()).toEqual([path.basename(recentTemp), "e".repeat(16) + ".f32", "notes.json"].sort());
    expect(await readdir(root)).toContain("voiceover.mp3");
  });

  it("returns an empty report for a project with no media cache", async () => {
    expect(await inspectMediaCache(root, true)).toEqual({ entries: 0, bytes: 0, staleEntries: 0, staleBytes: 0, removedEntries: 0, removedBytes: 0 });
  });
});
