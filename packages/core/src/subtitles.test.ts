import { describe, expect, it } from "vitest";
import { cueAt, defineVideo, framed, parseSubtitles, pip, resolveComposition, solid, subtitles, text } from "./index";

const SRT = `1
00:00:01,000 --> 00:00:02,500
Hello <i>there</i>,
general.

2
00:00:03,000 --> 00:00:04,000
{\\an8}Second cue
`;

const VTT = `WEBVTT
Kind: captions

NOTE a comment
that spans lines

intro
00:01.000 --> 00:02.000 align:center
<v Narrator>Every <00:01.400>word <00:01.700>counts.</v>
`;

describe("parseSubtitles", () => {
  it("reads SRT, stripping tags and keeping line breaks", () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 2.5, text: "Hello there,\ngeneral." });
    expect(cues[1].text).toBe("Second cue");
  });

  it("reads WebVTT with headers, notes, cue settings, voices and short timestamps", () => {
    const [cue] = parseSubtitles(VTT);
    expect(cue).toMatchObject({ start: 1, end: 2, text: "Every word counts." });
  });

  it("times words from inline VTT timestamps", () => {
    const [cue] = parseSubtitles(VTT);
    expect(cue.words.map((w) => [w.text, w.start, w.end])).toEqual([
      ["Every", 1, 1.4],
      ["word", 1.4, 1.7],
      ["counts.", 1.7, 2],
    ]);
  });

  it("estimates word timing across the cue when there are no timestamps", () => {
    const [cue] = parseSubtitles(SRT);
    expect(cue.words[0].start).toBe(1);
    expect(cue.words.at(-1)!.end).toBeCloseTo(2.5);
    // Longer words take longer.
    const span = (i: number) => cue.words[i].end - cue.words[i].start;
    expect(span(2)).toBeGreaterThan(span(1));
    // The line break is kept on the last word of the first line.
    expect(cue.words.map((w) => !!w.br)).toEqual([false, true, false]);
  });

  it("finds the cue at a time", () => {
    const cues = parseSubtitles(SRT);
    expect(cueAt(cues, 0.5)).toBeUndefined();
    expect(cueAt(cues, 1)?.text).toMatch(/^Hello/);
    expect(cueAt(cues, 2.7)).toBeUndefined();
    expect(cueAt(cues, 3.5)?.text).toBe("Second cue");
  });
});

describe("subtitles in the timeline", () => {
  it("lasts until the last cue, counted from `from`", () => {
    const comp = resolveComposition(defineVideo({ size: [1, 1], fps: 10, layers: [subtitles(SRT, { from: 1 })] }));
    expect(comp.durationInFrames).toBe(30);
  });
});

describe("frames", () => {
  it("resolve like groups around their children", () => {
    const comp = resolveComposition(
      defineVideo({
        size: [1, 1],
        fps: 10,
        layers: [framed([solid("red"), text("hi", { at: 1, duration: 2 })], { chrome: "window", title: "x" })],
      }),
    );
    const [frame] = comp.layers;
    expect(frame.node.kind).toBe("frame");
    expect(comp.durationInFrames).toBe(30);
    expect(frame.children.map((c) => [c.start, c.duration])).toEqual([
      [0, 30],
      [10, 20],
    ]);
  });

  it("pip() is a corner-anchored frame showing the full scene", () => {
    const node = pip(solid("red"), { corner: "top-left", size: 0.25, margin: 32 });
    expect(node).toMatchObject({ kind: "frame", position: "top-left", inset: 32 });
    expect(node.frame).toMatchObject({ chrome: "none", width: 0.25, viewport: "parent" });
  });
});
