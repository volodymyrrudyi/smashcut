import { describe, expect, it } from "vitest";
import { sheetFrames } from "./render";

describe("sheetFrames", () => {
  it("takes each frame from the middle of an equal slice", () => {
    expect(sheetFrames(120, 30, { count: 4 })).toEqual([15, 45, 75, 105]);
  });

  it("samples every N seconds from the start", () => {
    expect(sheetFrames(100, 30, { every: 1 })).toEqual([0, 30, 60, 90]);
  });

  it("never asks for more frames than the video has", () => {
    expect(sheetFrames(3, 30, { count: 12 })).toEqual([0, 1, 2]);
    expect(() => sheetFrames(30, 30, { every: 0 })).toThrow("--every");
  });
});

