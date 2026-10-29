import { describe, expect, it } from "vitest";
import {
  clipVisual,
  defineVideo,
  dip,
  fade,
  frameContext,
  group,
  interpolate,
  kf,
  resolveComposition,
  series,
  slide,
  solid,
  text,
  type FrameContext,
} from "./index";

const at = (local: number, fps = 30): FrameContext => ({
  frame: Math.round(local * fps),
  time: local,
  localFrame: Math.round(local * fps),
  local,
  duration: 10,
  progress: local / 10,
  fps,
  width: 1920,
  height: 1080,
});

describe("interpolate / kf", () => {
  it("maps linearly and clamps", () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(-1, [0, 10], [0, 100])).toBe(0);
    expect(interpolate(20, [0, 10], [0, 100])).toBe(100);
  });

  it("handles multiple segments", () => {
    expect(interpolate(15, [0, 10, 20], [0, 100, 0])).toBe(50);
  });

  it("evaluates keyframes on clip-local seconds", () => {
    const k = kf([[1, 10], [0, 0]]);
    expect(k(at(0))).toBe(0);
    expect(k(at(0.5))).toBe(5);
    expect(k(at(2))).toBe(10);
  });
});

describe("resolveComposition", () => {
  it("infers duration from a series and overlaps transitions", () => {
    const comp = resolveComposition(
      defineVideo({
        size: [100, 100],
        fps: 10,
        layers: [series([solid("red", { duration: 2 }), fade(0.5), solid("blue", { duration: 3 })]), text("hi")],
      }),
    );
    expect(comp.durationInFrames).toBe(45);
    const [a, b] = comp.layers[0].children;
    expect([a.start, a.duration]).toEqual([0, 20]);
    expect([b.start, b.duration]).toEqual([15, 30]);
    expect(a.transitionOut).toBe(b.transitionIn);
    // Overlays without a duration fill the video.
    expect(comp.layers[1].duration).toBe(45);
  });

  it("offsets group children by `at`", () => {
    const comp = resolveComposition(
      defineVideo({ size: [100, 100], fps: 10, layers: [group([solid("red"), text("x", { at: 1, duration: 1 })])] }),
    );
    const [bg, label] = comp.layers[0].children;
    expect(comp.durationInFrames).toBe(20);
    expect([bg.start, bg.duration]).toEqual([0, 20]);
    expect([label.start, label.duration]).toEqual([10, 10]);
  });

  it("reports clips in a series without a duration", () => {
    expect(() =>
      resolveComposition(defineVideo({ size: [1, 1], layers: [series([solid("red")])] })),
    ).toThrow(/needs a duration/);
  });

  it("rejects transitions longer than their neighbours", () => {
    expect(() =>
      resolveComposition(
        defineVideo({
          size: [1, 1],
          layers: [series([solid("a", { duration: 0.2 }), fade(1), solid("b", { duration: 1 })])],
        }),
      ),
    ).toThrow(/longer than one of its neighbours/);
  });

  it("fails without any duration", () => {
    expect(() => resolveComposition(defineVideo({ size: [1, 1], layers: [solid("red")] }))).toThrow(
      /Cannot infer the video duration/,
    );
  });
});

describe("clipVisual", () => {
  const comp = resolveComposition(
    defineVideo({
      size: [100, 100],
      fps: 10,
      layers: [
        series([
          solid("a", { duration: 2 }),
          slide(1, { direction: "left", easing: "linear" }),
          solid("b", { duration: 2, enter: { type: "fade", duration: 0.5, easing: "linear" } }),
        ]),
      ],
    }),
  );
  const [a, b] = comp.layers[0].children;

  it("slides both clips during the transition", () => {
    const frame = b.start + 5; // halfway through the 10-frame overlap
    expect(clipVisual(a, frameContext(comp, a, frame)).x).toBe(-50);
    expect(clipVisual(b, frameContext(comp, b, frame)).x).toBe(50);
  });

  it("dip never shows both clips at once", () => {
    const dipped = resolveComposition(
      defineVideo({ size: [100, 100], fps: 10, layers: [series([solid("a", { duration: 2 }), dip(1, { easing: "linear" }), solid("b", { duration: 2 })])] }),
    );
    const [first, second] = dipped.layers[0].children;
    for (let f = second.start; f < second.start + 10; f++) {
      const out = clipVisual(first, frameContext(dipped, first, f)).opacity;
      const inc = clipVisual(second, frameContext(dipped, second, f)).opacity;
      expect(Math.min(out, inc)).toBe(0);
    }
  });

  it("applies enter effects at the clip start", () => {
    expect(clipVisual(b, frameContext(comp, b, b.start)).opacity).toBe(0);
    expect(clipVisual(b, frameContext(comp, b, b.start + 5)).opacity).toBe(1);
  });
});
