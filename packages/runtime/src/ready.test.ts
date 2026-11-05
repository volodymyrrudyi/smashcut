import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 1));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("render readiness", () => {
  it("reports a rejection even when it happened before capture", async () => {
    const { delayRender, waitUntilReady } = await import("./ready");
    delayRender(Promise.reject(new Error("texture missing")));
    await Promise.resolve();
    await expect(waitUntilReady()).rejects.toThrow("texture missing");
    await expect(waitUntilReady()).rejects.toThrow("texture missing");
  });

  it("waits for work registered by other work and clears its timers", async () => {
    const { delayRender, waitUntilReady } = await import("./ready");
    let finished = false;
    delayRender(Promise.resolve().then(() => {
      delayRender(new Promise<void>((resolve) => setTimeout(() => { finished = true; resolve(); }, 10)));
    }));
    const ready = waitUntilReady();
    await vi.runAllTimersAsync();
    await ready;
    expect(finished).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds font loading by the same readiness deadline", async () => {
    vi.stubGlobal("document", { fonts: { ready: new Promise(() => {}) } });
    const { waitUntilReady } = await import("./ready");
    const result = expect(waitUntilReady(20)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(20);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails when pending work rejects during the wait", async () => {
    const { delayRender, waitUntilReady } = await import("./ready");
    delayRender(new Promise((_, reject) => setTimeout(() => reject(new Error("setup failed")), 5)));
    const result = expect(waitUntilReady()).rejects.toThrow("setup failed");
    await vi.runAllTimersAsync();
    await result;
  });
});


it("reports failed work immediately while unrelated work is still stalled", async () => {
  const { delayRender, waitUntilReady } = await import("./ready");
  delayRender(new Promise(() => {}));
  delayRender(new Promise((_, reject) => setTimeout(() => reject(new Error("failed first")), 5)));
  const result = expect(waitUntilReady(30_000)).rejects.toThrow("failed first");
  await vi.advanceTimersByTimeAsync(5);
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
