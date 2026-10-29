import { describe, expect, it } from "vitest";
import { BACKSPACE, camera, keyboardSound, keyInfo, sfx, typing, zoomTo, type FrameContext } from "./index";

const at = (local: number): FrameContext => ({
  frame: 0,
  time: local,
  localFrame: Math.round(local * 30),
  local,
  duration: 10,
  progress: 0,
  fps: 30,
  width: 1920,
  height: 1080,
});

describe("typing", () => {
  const entry = typing("Hi there.", { at: 1, cps: 10, seed: 3, caret: "|" });

  it("schedules one keystroke per character, starting at `at`", () => {
    expect(entry.keystrokes.map((k) => k.char).join("")).toBe("Hi there.");
    expect(entry.keystrokes[0].time).toBe(1);
    expect(entry.end).toBe(entry.keystrokes.at(-1)!.time);
    const gaps = entry.keystrokes.slice(1).map((k, i) => k.time - entry.keystrokes[i].time);
    expect(gaps.every((g) => g > 0)).toBe(true);
    // Average pace stays near the requested rate (word pauses make it a little slower).
    expect((entry.end - entry.at) / gaps.length).toBeGreaterThan(0.08);
    expect((entry.end - entry.at) / gaps.length).toBeLessThan(0.16);
  });

  it("is deterministic per seed", () => {
    const again = typing("Hi there.", { at: 1, cps: 10, seed: 3 });
    const other = typing("Hi there.", { at: 1, cps: 10, seed: 4 });
    expect(again.keystrokes).toEqual(entry.keystrokes);
    expect(other.keystrokes).not.toEqual(entry.keystrokes);
  });

  it("reveals text over time with a caret while focused", () => {
    expect(entry.text(at(0))).toBe("");
    expect(entry.text(at(0.7))).toBe("|");
    expect(entry.text(at(entry.keystrokes[2].time))).toBe("Hi |");
    expect(entry.text(at(entry.end + 0.1))).toBe("Hi there.|");
    expect(entry.text(at(entry.end + 1))).toBe("Hi there.");
  });
});

describe("typos", () => {
  const entry = typing("8,141.00", { cps: 10, typos: [{ at: 2, wrong: "4", notice: 1 }] });

  it("types the mistake, backspaces it and retypes, ending on the right text", () => {
    const keys = entry.keystrokes.map((k) => k.char).join("");
    expect(keys).toBe(`8,44${BACKSPACE}${BACKSPACE}141.00`);
    expect(entry.value(entry.end)).toBe("8,141.00");
    // Mid-mistake, the wrong text is visible.
    const beforeFix = entry.keystrokes.findIndex((k) => k.char === BACKSPACE);
    expect(entry.value(entry.keystrokes[beforeFix - 1].time)).toBe("8,44");
  });

  it("pauses to notice before correcting", () => {
    const i = entry.keystrokes.findIndex((k) => k.char === BACKSPACE);
    expect(entry.keystrokes[i].time - entry.keystrokes[i - 1].time).toBeGreaterThan(0.3);
  });

  it("puts backspace under the right pinky", () => {
    expect(keyInfo(BACKSPACE)).toMatchObject({ hand: "right", finger: 5, row: 0 });
  });
});

describe("fingers", () => {
  it("maps keys to touch-typing fingers", () => {
    expect(keyInfo("f")).toMatchObject({ hand: "left", finger: 2 });
    expect(keyInfo("k")).toMatchObject({ hand: "right", finger: 3 });
    expect(keyInfo("Q")).toMatchObject({ hand: "left", finger: 5 });
    expect(keyInfo(" ")).toMatchObject({ finger: 1 });
  });

  it("types same-finger pairs slower than alternating hands", () => {
    // No jitter, so only the finger rhythm differs: "ft" is left index twice, "fj" alternates hands.
    const gap = (s: string) => {
      const [a, b] = typing(s, { cps: 10, jitter: 0 }).keystrokes;
      return b.time - a.time;
    };
    expect(gap("ft")).toBeGreaterThan(gap("fe"));
    expect(gap("fe")).toBeGreaterThan(gap("fj"));
  });
});

describe("keyboard sound", () => {
  const SR = 16000;
  const keys = typing("type this", { cps: 8 }).keystrokes;
  /** Zero crossings per second: a cheap brightness measure. */
  const brightness = (x: Float32Array) => {
    let n = 0;
    for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / (x.length / SR);
  };

  it("is deterministic, finite and not clipping", () => {
    const a = keyboardSound(keys).render(SR, 2)[0];
    const b = keyboardSound(keys).render(SR, 2)[0];
    expect(a.every((x, i) => x === b[i])).toBe(true);
    expect(a.every(Number.isFinite)).toBe(true);
    const peak = a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(1);
  });

  it("makes clicky switches brighter than linear ones", () => {
    const clicky = keyboardSound(keys, { switch: "clicky" }).render(SR, 2)[0];
    const linear = keyboardSound(keys, { switch: "linear" }).render(SR, 2)[0];
    expect(brightness(clicky)).toBeGreaterThan(brightness(linear));
  });

  it("varies between fingers and between presses", () => {
    /** Peak of the first 15 ms after each keystroke. */
    const peaks = (text: string) => {
      const strokes = typing(text, { cps: 4 }).keystrokes;
      const [l] = keyboardSound(strokes).render(SR, strokes.at(-1)!.time + 0.3);
      return strokes.map(({ time }) => {
        const s = Math.round(time * SR);
        return l.slice(s, s + Math.round(0.015 * SR)).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      });
    };
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b) / xs.length;
    // Index fingers hit harder than pinkies on average.
    expect(mean(peaks("ffffffff"))).toBeGreaterThan(mean(peaks("aaaaaaaa")));
    // The same key never sounds exactly the same twice.
    expect(new Set(peaks("jjjj")).size).toBe(4);
  });

  it("places sfx.keys at the clip start plus the typing offset", () => {
    const entry = typing("ab", { at: 1.5 });
    const clip = sfx.keys(entry, { at: 10 });
    expect(clip.at).toBe(11.5);
    // The first keystroke sits at the very start of the source.
    const [l] = clip.source.render(SR, 0.05);
    expect(Math.max(...l.slice(0, Math.round(0.01 * SR)).map(Math.abs))).toBeGreaterThan(0.01);
  });
});

describe("camera", () => {
  /** Where frame point (px, py) appears on screen under the camera at `local`. */
  const project = (cam: ReturnType<typeof camera>, local: number, px: number, py: number) => {
    const t = at(local);
    const s = cam.scale(t);
    return [960 + s * (px - 960) + cam.x(t), 540 + s * (py - 540) + cam.y(t)];
  };

  it("brings the focus point to the frame centre at the target zoom", () => {
    const cam = zoomTo({ x: 400, y: 300, scale: 2 }, { at: 1, duration: 1, hold: 1 });
    expect(cam.scale(at(0))).toBe(1);
    expect(project(cam, 0, 400, 300)).toEqual([400, 300]);
    expect(cam.scale(at(2.5))).toBe(2);
    expect(project(cam, 2.5, 400, 300)).toEqual([960, 540]);
    // And back out after the hold.
    expect(cam.scale(at(4))).toBe(1);
    expect(project(cam, 4, 400, 300)).toEqual([400, 300]);
  });

  it("pans between focus points", () => {
    const cam = camera([
      [0, { x: 400, y: 300, scale: 2 }],
      [1, { x: 800, y: 300, scale: 2 }],
    ]);
    expect(project(cam, 1, 800, 300)).toEqual([960, 540]);
  });
});
