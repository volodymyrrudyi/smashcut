import { describe, expect, it } from "vitest";
import { defineVideo, solid } from "../builders";
import { ambient, chiptune, groove, grooveBar, makeStereo, mixAudio, modern, music, noteToMidi, pattern, reverb, sfx, stringNote } from "./index";

const SR = 8000;
const peak = (xs: Float32Array) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((x, i) => x === b[i]);

describe("notes", () => {
  it("parses note names", () => {
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("C#3")).toBe(49);
    expect(noteToMidi("Bb2")).toBe(46);
  });
});

describe("chiptune", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = chiptune({ seed: 1 }).render(SR, 4)[0];
    const b = chiptune({ seed: 1 }).render(SR, 4)[0];
    const c = chiptune({ seed: 2 }).render(SR, 4)[0];
    expect(same(a, b)).toBe(true);
    expect(same(a, c)).toBe(false);
  });

  it("produces audible, finite samples for every mood", () => {
    for (const mood of ["upbeat", "chill", "epic"] as const) {
      const [l, r] = chiptune({ seed: 3, mood }).render(SR, 3);
      expect(l.length).toBe(3 * SR);
      expect(l.every(Number.isFinite) && r.every(Number.isFinite)).toBe(true);
      expect(peak(l)).toBeGreaterThan(0.05);
    }
  });
});

describe("pattern", () => {
  it("places notes on the step grid", () => {
    const [l] = pattern("C4 . . . . . . .", { bpm: 120, loop: false, env: { release: 0 } }).render(SR, 1);
    // One 16th at 120 bpm = 0.125 s; the second half of the bar is silent.
    expect(peak(l.subarray(0, SR * 0.1))).toBeGreaterThan(0);
    expect(peak(l.subarray(SR * 0.5))).toBe(0);
  });
});

describe("mixAudio", () => {
  const video = (audio = [music(chiptune({ seed: 5 }), { volume: 2 }), sfx.click({ at: 1 }), sfx.whoosh({ at: 1.5 })]) =>
    defineVideo({ size: [10, 10], fps: 10, duration: 2, layers: [solid("red")], audio });

  it("matches the video length and never exceeds full scale", () => {
    const [l, r] = mixAudio(video(), SR)!;
    expect(l.length).toBe(2 * SR);
    expect(Math.max(peak(l), peak(r))).toBeLessThanOrEqual(1);
  });

  it("is null for silent videos", () => {
    expect(mixAudio(video([]), SR)).toBeNull();
  });

  it("starts sound effects at their timeline position", () => {
    const [l] = mixAudio(video([sfx.click({ at: 1 })]), SR)!;
    expect(peak(l.subarray(0, SR))).toBe(0);
    expect(peak(l.subarray(SR, SR + 400))).toBeGreaterThan(0);
  });
});

describe("modern", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = modern({ seed: 1 }).render(SR, 3)[0];
    const b = modern({ seed: 1 }).render(SR, 3)[0];
    const c = modern({ seed: 2 }).render(SR, 3)[0];
    expect(same(a, b)).toBe(true);
    expect(same(a, c)).toBe(false);
  });

  it("produces audible, finite samples for every mood", () => {
    for (const mood of ["bright", "calm", "driving"] as const) {
      const [l, r] = modern({ seed: 3, mood }).render(SR, 3);
      expect(l.every(Number.isFinite) && r.every(Number.isFinite)).toBe(true);
      expect(peak(l)).toBeGreaterThan(0.05);
    }
  });
});

describe("reverb", () => {
  it("rings on after the input stops", () => {
    const input = makeStereo(SR);
    input[0][0] = input[1][0] = 1;
    const [l] = reverb(input, SR);
    expect(peak(l.subarray(SR / 2))).toBeGreaterThan(0);
  });
});

describe("modern sfx", () => {
  it("renders each effect with a tail inside the clip", () => {
    for (const clip of [
      sfx.tap({ at: 0 }),
      sfx.tick({ at: 0 }),
      sfx.bell({ at: 0 }),
      sfx.swoosh({ at: 0 }),
      sfx.riser({ at: 0 }),
      sfx.pluck({ at: 0 }),
      sfx.strum({ at: 0 }),
      sfx.thud({ at: 0 }),
    ]) {
      const [l] = clip.source.render(SR, clip.source.duration!);
      expect(l.every(Number.isFinite)).toBe(true);
      expect(peak(l)).toBeGreaterThan(0.01);
    }
  });
});

describe("ambient", () => {
  const rms = (xs: Float32Array) => Math.sqrt(xs.reduce((sum, x) => sum + x * x, 0) / xs.length);

  it("is deterministic per seed and differs across seeds", () => {
    const a = ambient({ seed: 1 }).render(SR, 4)[0];
    expect(same(a, ambient({ seed: 1 }).render(SR, 4)[0])).toBe(true);
    expect(same(a, ambient({ seed: 2 }).render(SR, 4)[0])).toBe(false);
  });

  it("sits well below modern() as a background bed", () => {
    for (const mood of ["air", "pulse"] as const) {
      const [l] = ambient({ seed: 3, mood }).render(SR, 8);
      expect(l.every(Number.isFinite)).toBe(true);
      expect(rms(l)).toBeGreaterThan(0.005);
      expect(rms(l)).toBeLessThan(rms(modern({ seed: 3, mood: "calm" }).render(SR, 8)[0]) * 0.75);
    }
  });
});

describe("ducking", () => {
  it("dips a ducking clip only while other sounds play, then recovers", () => {
    const comp = (duck?: number) =>
      defineVideo({
        size: [1, 1],
        duration: 6,
        layers: [solid("#000")],
        audio: [music(ambient({ seed: 3 }), { duck }), sfx.tick({ at: 3 })],
      });
    const [plain] = mixAudio(comp(), SR)!;
    const [ducked] = mixAudio(comp(0.6), SR)!;
    const diff = (from: number, to: number) => {
      let max = 0;
      for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) max = Math.max(max, Math.abs(plain[i] - ducked[i]));
      return max;
    };
    expect(diff(1, 2.9)).toBe(0);
    expect(diff(3, 3.3)).toBeGreaterThan(0.002);
    expect(diff(5.5, 6)).toBeLessThan(diff(3, 3.3) / 4);
  });
});

describe("groove", () => {
  const level = (xs: Float32Array) => 10 * Math.log10(xs.reduce((sum, x) => sum + x * x, 0) / xs.length);

  it("is deterministic per seed", () => {
    const a = groove({ seed: 2, intensity: 0.5 }).render(SR, 3)[0];
    expect(same(a, groove({ seed: 2, intensity: 0.5 }).render(SR, 3)[0])).toBe(true);
    expect(same(a, groove({ seed: 3, intensity: 0.5 }).render(SR, 3)[0])).toBe(false);
  });

  it("gets fuller as intensity rises, and follows an intensity curve", () => {
    const calm = level(groove({ seed: 2, intensity: 0 }).render(SR, 6)[0]);
    const band = level(groove({ seed: 2, intensity: 1 }).render(SR, 6)[0]);
    expect(band - calm).toBeGreaterThan(3);
    const [built] = groove({ seed: 2, intensity: [[0, 0], [3, 0], [3.5, 1]] }).render(SR, 6);
    expect(level(built.subarray(5 * SR)) - level(built.subarray(SR, 3 * SR))).toBeGreaterThan(3);
  });
});

describe("groove ending", () => {
  it("ends on a ringing home chord at a bar line, then decays to silence", () => {
    const end = 2 * grooveBar();
    const [l] = groove({ seed: 2, intensity: 1, end: end + 0.2 }).render(SR, end + 3);
    const level = (from: number, to: number) => {
      const xs = l.subarray(Math.round(from * SR), Math.round(to * SR));
      return 10 * Math.log10(xs.reduce((sum, x) => sum + x * x, 0) / xs.length + 1e-12);
    };
    // Snapped to the bar line: the final hit lands at `end`, not 0.2 s later.
    expect(level(end, end + 0.3)).toBeGreaterThan(level(end - 0.05, end) - 6);
    // It rings, then dies away well before the render ends.
    expect(level(end + 0.3, end + 0.8)).toBeGreaterThan(-40);
    expect(level(end + 2.6, end + 3)).toBeLessThan(level(end + 0.3, end + 0.8) - 20);
  });
});

describe("stringNote", () => {
  it("rings at the requested pitch and dies away", () => {
    const sr = 16000;
    const out = makeStereo(sr);
    stringNote(out, sr, 0, 220, { ring: 0.5, volume: 1 });
    const [l] = out;
    let best = 0, lag = 0;
    for (let L = 30; L < 200; L++) {
      let c = 0;
      for (let i = 400; i < 1400; i++) c += l[i] * l[i + L];
      if (c > best) [best, lag] = [c, L];
    }
    expect(sr / lag).toBeGreaterThan(215);
    expect(sr / lag).toBeLessThan(225);
    expect(peak(l.subarray(Math.round(0.45 * sr)))).toBeLessThan(peak(l.subarray(0, 800)) * 0.1);
  });
});
