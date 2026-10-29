import { describe, expect, it } from "vitest";
import { defineVideo, describeTimeline, fade, formatTimeline, group, resolveComposition, series, sfx, solid, subtitles, text } from "./index";

describe("describeTimeline", () => {
  const video = defineVideo({
    size: [1920, 1080],
    fps: 30,
    layers: [
      series([group([solid("#000"), text("Hello")], { id: "intro", duration: 2 }), fade(0.5), solid("#fff", { duration: 2 })]),
      subtitles("1\n00:00:00,500 --> 00:00:01,500\nFirst line\n"),
    ],
    audio: [sfx.tick({ at: 1 }), sfx.tick({ at: 2 })],
  });
  const summary = describeTimeline(resolveComposition(video), video);

  it("lists every clip in tree order with absolute seconds and transitions", () => {
    expect(summary).toMatchObject({ width: 1920, height: 1080, fps: 30, duration: 3.5, frames: 105 });
    expect(summary.clips.map((c) => [c.path, c.depth, c.label, c.start, c.end])).toEqual([
      ["0", 0, "series (2 scenes)", 0, 3.5],
      ["0.0", 1, "intro", 0, 2],
      ["0.0.0", 2, "solid #000", 0, 2],
      ["0.0.1", 2, "“Hello”", 0, 2],
      ["0.2", 1, "solid #fff", 1.5, 3.5],
      ["1", 0, "subtitles (1 cues, boxed)", 0, 1.5],
    ]);
    expect(summary.clips[1].transitionOut).toBe("fade 0.5s");
    expect(summary.clips[4].transitionIn).toBe("fade 0.5s");
  });

  it("includes captions and sounds", () => {
    expect(summary.captions).toEqual([{ start: 0.5, end: 1.5, text: "First line" }]);
    expect(summary.sounds.map((s) => [s.label, s.start])).toEqual([
      ["tick", 1],
      ["tick", 2],
    ]);
  });

  it("formats as indented text, grouping sounds by label", () => {
    const out = formatTimeline(summary);
    expect(out).toContain("1920×1080, 30 fps, 0:03.50 (105 frames)");
    expect(out).toContain("0:00.00–0:02.00    intro  [out: fade 0.5s]");
    expect(out).toContain("0:00.50–0:01.50  First line");
    expect(out).toMatch(/tick\s+0:01\.00, 0:02\.00/);
  });
});
