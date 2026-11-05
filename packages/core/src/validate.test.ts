import { describe, expect, it } from "vitest";
import { defineVideo, fade, group, series, solid, video } from "./builders";
import { resolveComposition } from "./resolve";

const base = () => defineVideo({ size: [100, 100], duration: 1, layers: [solid("red")] });

describe("composition validation", () => {
  it.each([NaN, Infinity, -Infinity, 0, -1, 29.97, 241])("rejects invalid fps %s", (fps) => {
    expect(() => resolveComposition({ ...base(), fps })).toThrow("fps");
  });
  it.each([NaN, Infinity, -1, 0, 1.5])("rejects invalid dimensions %s", (width) => {
    expect(() => resolveComposition({ ...base(), width })).toThrow("width");
  });
  it.each([NaN, Infinity, -1, 0])("rejects invalid video duration %s", (duration) => {
    expect(() => resolveComposition({ ...base(), duration })).toThrow("duration");
  });
  it("validates nested clip and transition timing", () => {
    expect(() => resolveComposition({ ...base(), layers: [group([solid("red", { at: NaN })])] })).toThrow("layers.0.0 at");
    expect(() => resolveComposition({ ...base(), layers: [series([solid("red", { duration: 1 }), fade(-1), solid("blue", { duration: 1 })])] })).toThrow("transition duration");
  });
  it("rejects invalid playback rates even when video duration is explicit", () => {
    expect(() => resolveComposition({ ...base(), layers: [video("/clip.mp4", { duration: 1, playbackRate: 0 })] })).toThrow("playbackRate");
  });
  it("allows odd dimensions for stills and start-only trims", () => {
    expect(resolveComposition({ ...base(), width: 101, layers: [video("/clip.mp4", { duration: 1, trim: [0] })] }).width).toBe(101);
  });
});
