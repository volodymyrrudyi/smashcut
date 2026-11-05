import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(), open: vi.fn(), capture: vi.fn(), start: vi.fn(), spawn: vi.fn(),
}));
vi.mock("./browser", () => ({ launchBrowser: mocks.launch, openVideo: mocks.open, captureFrame: mocks.capture }));
vi.mock("./server", () => ({ startServer: mocks.start }));
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), spawn: mocks.spawn, spawnSync: () => ({ status: 0 }) }));
import { renderSheet, renderStill, renderVideo } from "./render";

let root: string;
let closeServer: ReturnType<typeof vi.fn>;
let closeBrowser: ReturnType<typeof vi.fn>;
let page: { close: ReturnType<typeof vi.fn> };
let children: FakeEncoder[];
class FakeEncoder extends EventEmitter {
  stdin = new Writable({ write(_data, _encoding, done) { done(); } });
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit("close", null));
    return true;
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), "smashcut-failure-"));
  children = [];
  closeServer = vi.fn(async () => {});
  closeBrowser = vi.fn(async () => {});
  page = { close: vi.fn(async () => {}) };
  mocks.start.mockResolvedValue({ server: { close: closeServer }, url: "http://localhost", root, media: { frames: vi.fn(), close: vi.fn() } });
  mocks.launch.mockResolvedValue({ close: closeBrowser });
  mocks.open.mockResolvedValue({ page, meta: { width: 100, height: 100, fps: 30, durationInFrames: 4, footage: [], voices: { missing: [] } } });
  mocks.capture.mockRejectedValue(new Error("image missing"));
  mocks.spawn.mockImplementation(() => {
    const proc = new FakeEncoder();
    children.push(proc);
    return proc;
  });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const options = () => ({ output: path.join(root, "out.mp4"), concurrency: 1, crf: 18 });
describe("render failure cleanup", () => {
  it("closes the server when Chromium cannot launch", async () => {
    mocks.launch.mockRejectedValue(new Error("browser missing"));
    await expect(renderStill(root, { frame: 0, output: "unused.png" })).rejects.toThrow("browser missing");
    expect(closeServer).toHaveBeenCalledOnce();
  });
  it("terminates and awaits the encoder after capture fails", async () => {
    await expect(renderVideo(root, options())).rejects.toThrow("image missing");
    expect(children).toHaveLength(1);
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    expect(closeServer).toHaveBeenCalledOnce();
    expect(closeBrowser).toHaveBeenCalled();
    expect(await readdir(path.join(root, ".smashcut"))).toEqual([]);
  });
  it("cancels and joins a sibling that is still capturing", async () => {
    let rejectSibling: (reason: Error) => void = () => {};
    let releaseFailure: () => void = () => {};
    const siblingStarted = new Promise<void>((resolve) => { releaseFailure = resolve; });
    mocks.capture.mockImplementation(async (_page, frame) => {
      if (frame === 0) { await siblingStarted; throw new Error("first worker failed"); }
      releaseFailure();
      return new Promise((_, reject) => { rejectSibling = reject; });
    });
    page.close.mockImplementation(async () => { rejectSibling(new Error("page closed")); });
    closeBrowser.mockImplementation(async () => { rejectSibling(new Error("browser closed")); });
    await expect(renderVideo(root, { ...options(), concurrency: 2 })).rejects.toThrow("first worker failed");
    expect(children).toHaveLength(2);
    for (const proc of children) expect(proc.kill).toHaveBeenCalled();
    expect(closeServer).toHaveBeenCalledOnce();
    expect(await readdir(path.join(root, ".smashcut"))).toEqual([]);
  });
  it("handles encoder spawn errors without an unhandled rejection", async () => {
    mocks.spawn.mockImplementation(() => {
      const proc = new FakeEncoder();
      queueMicrotask(() => { proc.emit("error", new Error("spawn failed")); proc.emit("close", -1); });
      return proc;
    });
    mocks.capture.mockImplementation(async () => { await new Promise((resolve) => setImmediate(resolve)); return Buffer.from("png"); });
    await expect(renderVideo(root, options())).rejects.toThrow("spawn failed");
    expect(closeServer).toHaveBeenCalledOnce();
  });
});


describe("render option validation", () => {
  it.each([
    { concurrency: 0 }, { concurrency: 1.5 }, { crf: 52 }, { crf: -1 },
    { from: NaN }, { from: -1 }, { from: 3, to: 2 }, { scale: Infinity }, { fps: 0 },
  ])("rejects invalid options before starting services: %j", async (invalid) => {
    await expect(renderVideo(root, { ...options(), ...invalid })).rejects.toThrow();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("rejects nonpositive columns and noninteger still frames", async () => {
    await expect(renderSheet(root, { output: "unused.png", columns: 0 })).rejects.toThrow("columns");
    await expect(renderStill(root, { output: "unused.png", frame: 0.5 })).rejects.toThrow("frame");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("explains odd H.264 dimensions before starting an encoder", async () => {
    const video = await mocks.open();
    mocks.open.mockResolvedValue({ ...video, meta: { ...video.meta, width: 101 } });
    await expect(renderVideo(root, options())).rejects.toThrow("positive even numbers");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(closeServer).toHaveBeenCalledOnce();
  });
});
