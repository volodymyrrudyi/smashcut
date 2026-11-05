import { afterEach, describe, expect, it, vi } from "vitest";

const originalDateNow = Date.now;
const originalPerformanceNow = performance.now;
const originalRandom = Math.random;
afterEach(() => {
  Date.now = originalDateNow;
  performance.now = originalPerformanceNow;
  Math.random = originalRandom;
  vi.resetModules();
});

describe("deterministic clocks and randomness", () => {
  it("produces the same samples for first, repeated and out-of-order frame zero", async () => {
    const { prepareRender, resetFrameRandom } = await import("./determinism");
    const { frameStore } = await import("./store");
    prepareRender(30);
    const first = [Math.random(), Math.random()];
    frameStore.set(17);
    expect(performance.now()).toBeCloseTo(17000 / 30);
    frameStore.set(0);
    expect([Math.random(), Math.random()]).toEqual(first);
    resetFrameRandom(0);
    expect([Math.random(), Math.random()]).toEqual(first);
    expect(Date.now()).toBe(Date.UTC(2025, 0, 1));
  });

  it("keeps an advancing real clock and updates the fps without reinstalling", async () => {
    const { prepareRender, realNow } = await import("./determinism");
    const { frameStore } = await import("./store");
    prepareRender();
    frameStore.set(60);
    prepareRender(60);
    expect(performance.now()).toBe(1000);
    expect(realNow()).toBeGreaterThan(Date.now());
  });
});
