import { afterEach, describe, expect, it } from "vitest";
import { audioFile, fileSources } from "./file";
import { mixAudio } from "./mix";
import { missingVoices, setVoiceTakes, voice, voiceKey, voiceRequests, wordsToCues, type VoiceTake } from "./voice";

const take = (over: Partial<VoiceTake> = {}): VoiceTake => ({
  provider: "elevenlabs",
  voice: "Rachel",
  text: "Meet smashcut. Videos you write in code.",
  audio: "/voiceovers/meet-smashcut-abc.mp3",
  duration: 2.5,
  words: [
    { text: "Meet", start: 0.05, end: 0.3 },
    { text: "smashcut.", start: 0.35, end: 0.9 },
    { text: "Videos", start: 1.2, end: 1.5 },
    { text: "you", start: 1.5, end: 1.6 },
    { text: "write", start: 1.6, end: 1.8 },
    { text: "in", start: 1.8, end: 1.9 },
    { text: "code.", start: 1.9, end: 2.3 },
  ],
  ...over,
});

afterEach(() => setVoiceTakes([]));

describe("voiceKey", () => {
  it("ignores key order and treats a missing model or settings as the default", () => {
    const a = voiceKey({ provider: "elevenlabs", voice: "Rachel", text: "Hi", settings: { a: 1, b: 2 } });
    const b = voiceKey({ text: "Hi", settings: { b: 2, a: 1 }, voice: "Rachel", provider: "elevenlabs" });
    expect(a).toBe(b);
    expect(voiceKey({ provider: "p", voice: "v", text: "t" })).toBe(voiceKey({ provider: "p", voice: "v", text: "t", settings: {} }));
  });

  it("changes with anything that changes the take", () => {
    const base = { provider: "elevenlabs", voice: "Rachel", text: "Hi" };
    const keys = [
      base,
      { ...base, text: "Hi!" },
      { ...base, voice: "Adam" },
      { ...base, provider: "other" },
      { ...base, model: "eleven_v3" },
      { ...base, settings: { speed: 1.1 } },
    ].map(voiceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("voice", () => {
  it("estimates timing and stays silent until the take exists", () => {
    const vo = voice("Meet smashcut. Videos you write in code.", { at: 2, voice: "Rachel" });
    expect(vo.take).toBeUndefined();
    expect(vo.duration).toBeGreaterThan(1.5);
    expect(vo.duration).toBeLessThan(5);
    expect(vo.words).toHaveLength(7);
    expect(vo.words[0].start).toBe(2);
    expect(vo.end).toBeCloseTo(2 + vo.duration);
    expect(missingVoices([vo])).toEqual([{ provider: "elevenlabs", voice: "Rachel", text: "Meet smashcut. Videos you write in code." }]);
    const [l] = vo.source.render(1000, vo.duration);
    expect(l.every((x) => x === 0)).toBe(true);
  });

  it("uses the stored take's timing, shifted to where the line starts", () => {
    setVoiceTakes([take()]);
    const vo = voice("Meet smashcut. Videos you write in code.", { at: 3, voice: "Rachel", volume: 0.9 });
    expect(vo.take?.audio).toBe("/voiceovers/meet-smashcut-abc.mp3");
    expect(vo.duration).toBe(2.5);
    expect(vo.end).toBe(5.5);
    expect(vo.word("code").start).toBeCloseTo(4.9);
    expect(vo.word("Smashcut").end).toBeCloseTo(3.9);
    expect(vo.volume).toBe(0.9);
    expect(vo.label).toBe("voice");
    expect(missingVoices([vo])).toEqual([]);
    expect(voiceRequests([vo])).toHaveLength(1);
    expect(fileSources([vo]).map((s) => s.src)).toEqual(["/voiceovers/meet-smashcut-abc.mp3"]);
  });

  it("does not use a take made with different settings", () => {
    setVoiceTakes([take()]);
    expect(voice("Meet smashcut. Videos you write in code.", { voice: "Rachel", settings: { speed: 1.2 } }).take).toBeUndefined();
    expect(voice("Meet smashcut. Videos you write in code.", { voice: "Adam" }).take).toBeUndefined();
  });

  it("finds the nth occurrence of a word and explains a miss", () => {
    const vo = voice("one two one", { voice: "Rachel" });
    expect(vo.word("one", 2).start).toBeGreaterThan(vo.word("one").start);
    expect(() => vo.word("three")).toThrow(/spoken 0 time/);
  });

  it("requires text and a voice", () => {
    expect(() => voice("  ", { voice: "Rachel" })).toThrow(/empty/);
    expect(() => voice("Hi", { voice: "" })).toThrow(/pick a voice/);
  });

  it("splits captions at sentence ends and pauses", () => {
    setVoiceTakes([take()]);
    const vo = voice("Meet smashcut. Videos you write in code.", { voice: "Rachel" });
    expect(vo.cues.map((c) => c.text)).toEqual(["Meet smashcut.", "Videos you write in code."]);
    expect(vo.cues[0].start).toBeCloseTo(0.05);
    // Held until the next caption starts.
    expect(vo.cues[0].end).toBeCloseTo(1.2);
  });

  it("keeps captions short", () => {
    const words = "this is a long sentence that keeps going without any punctuation for quite a while"
      .split(" ")
      .map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
    const cues = wordsToCues(words);
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(42);
  });
});

describe("audioFile", () => {
  it("is silent until decoded, then plays (resampled) and reports its length", () => {
    const src = audioFile("/assets/x.wav");
    expect(src.duration).toBeUndefined();
    const ramp = new Float32Array(100).map((_, i) => i / 100);
    src.decoded = { sampleRate: 100, channels: [ramp, ramp] };
    expect(src.duration).toBe(1);
    const [l] = src.render(200, 0.5);
    expect(l).toHaveLength(100);
    expect(l[20]).toBeCloseTo(0.1);
    expect(l[21]).toBeCloseTo(0.105);
  });

  it("mixes a decoded voice take into the soundtrack", () => {
    setVoiceTakes([take()]);
    const vo = voice("Meet smashcut. Videos you write in code.", { at: 0.5, voice: "Rachel" });
    const [source] = fileSources([vo]);
    source.decoded = { sampleRate: 1000, channels: [new Float32Array(2500).fill(0.5), new Float32Array(2500).fill(0.5)] };
    const mix = mixAudio({ width: 10, height: 10, fps: 10, background: "#000", layers: [], duration: 4, audio: [vo] }, 1000)!;
    expect(mix[0][100]).toBe(0);
    expect(mix[0][1000]).toBeCloseTo(Math.tanh(0.5));
    expect(mix[0][3100]).toBe(0);
  });
});
