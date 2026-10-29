import { describe, expect, it } from "vitest";
import {
  defineVideo,
  fade,
  footageFrame,
  footageSources,
  footageTime,
  group,
  mixAudio,
  resolveComposition,
  series,
  solid,
  video,
  type MediaInfo,
  type Stereo,
} from "./index";

const SR = 1000;
/** A 4s file whose audio is a constant `level` on both channels. */
const file = (level = 0, duration = 4): MediaInfo => {
  const ch = new Float32Array(duration * SR).fill(level);
  return { duration, width: 640, height: 360, audio: { sampleRate: SR, channels: [ch, ch.slice()] as Stereo } };
};

describe("footageTime", () => {
  const info = file();

  it("maps clip time through trim and playback rate", () => {
    const node = video("/a.mp4", { trim: [1, 3], playbackRate: 2 });
    expect(footageTime(node, info, 0)).toBe(1);
    expect(footageTime(node, info, 0.5)).toBe(2);
  });

  it("holds the last frame, or wraps when looping", () => {
    expect(footageTime(video("/a.mp4", { trim: [1, 3] }), info, 5)).toBe(3);
    expect(footageTime(video("/a.mp4", { trim: [1, 3], loop: true }), info, 2.5)).toBe(1.5);
  });

  it("picks frame indices inside the trim", () => {
    const node = video("/a.mp4", { trim: [1, 3] });
    expect(footageFrame(node, info, 0, 10)).toBe(10);
    expect(footageFrame(node, info, 1, 10)).toBe(20);
    // Holds frame 2.9s, the last one inside the trim, not 3.0s.
    expect(footageFrame(node, info, 5, 10)).toBe(29);
  });

  it("rejects empty trims", () => {
    expect(() => footageTime(video("/a.mp4", { trim: [5] }), info, 0)).toThrow(/is empty/);
  });
});

describe("footage in the timeline", () => {
  it("takes its duration from the trimmed source", () => {
    const comp = resolveComposition({
      ...defineVideo({
        size: [1, 1],
        fps: 10,
        layers: [series([video("/a.mp4", { trim: [0.5] }), fade(0.5), video("/b.mp4", { playbackRate: 2 })])],
      }),
      media: { "/a.mp4": file(), "/b.mp4": file() },
    });
    const [a, b] = comp.layers[0].children;
    expect([a.start, a.duration]).toEqual([0, 35]);
    expect([b.start, b.duration]).toEqual([30, 20]);
    expect(comp.durationInFrames).toBe(50);
  });

  it("lists sources and explains missing media info", () => {
    const layers = [group([video("/a.mp4"), series([video("/b.mp4", { duration: 1 })])]), video("/a.mp4")];
    expect(footageSources(layers)).toEqual(["/a.mp4", "/b.mp4"]);
    expect(() => resolveComposition(defineVideo({ size: [1, 1], layers }))).toThrow(/No media info for video "\/a.mp4"/);
  });
});

describe("footage audio", () => {
  const mix = (layers: Parameters<typeof defineVideo>[0]["layers"], media: Record<string, MediaInfo>) =>
    mixAudio({ ...defineVideo({ size: [1, 1], fps: 10, duration: 4, layers }), media }, SR)!;
  const at = (out: Stereo, t: number) => out[0][Math.round(t * SR)];

  it("places the track at the clip's resolved start, with volume", () => {
    const out = mix([series([solid("red", { duration: 1 }), video("/a.mp4", { trim: [0, 2], volume: 0.5 })])], {
      "/a.mp4": file(0.4),
    });
    expect(at(out, 0.5)).toBe(0);
    expect(at(out, 2)).toBeCloseTo(Math.tanh(0.2), 5);
    // Silent after the trimmed source ends.
    expect(at(out, 3.5)).toBe(0);
  });

  it("crossfades over series transitions", () => {
    const out = mix([series([video("/a.mp4", { trim: [0, 2] }), fade(1), video("/b.mp4", { trim: [0, 2] })])], {
      "/a.mp4": file(0.4),
      "/b.mp4": file(0.4),
    });
    // Halfway through the 1..2s overlap each clip is at half gain, so the sum stays level.
    expect(at(out, 1.5)).toBeCloseTo(Math.tanh(0.4), 2);
  });

  it("skips muted clips and files without audio", () => {
    const silent = { ...file(), audio: undefined };
    const comp = defineVideo({ size: [1, 1], layers: [video("/a.mp4", { muted: true }), video("/b.mp4")] });
    expect(mixAudio({ ...comp, media: { "/a.mp4": file(0.4), "/b.mp4": silent } }, SR)).toBeNull();
  });
});
