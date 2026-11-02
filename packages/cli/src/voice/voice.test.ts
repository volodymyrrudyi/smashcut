import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alignmentToWords, matchVoice } from "./elevenlabs";
import { writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { crossSite } from "../server";
import { loadEnv, parseEnv, PROVIDERS, type VoiceProvider } from "./provider";
import { generateMissing, readTakes, removeTakeFiles, takeName, unusedTakeFiles } from "./takes";

describe("alignmentToWords", () => {
  it("groups characters into words with their first start and last end", () => {
    const text = "Hi there, you.";
    const chars = [...text];
    const words = alignmentToWords({
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * 0.1),
      character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.08),
    });
    expect(words.map((w) => w.text)).toEqual(["Hi", "there,", "you."]);
    expect(words[1].start).toBeCloseTo(0.3);
    expect(words[1].end).toBeCloseTo(0.88);
  });
});

describe("matchVoice", () => {
  const voices = [
    { id: "a".repeat(20), name: "Rachel" },
    { id: "b".repeat(20), name: "Brian - Deep, Resonant and Comforting" },
  ];
  it("matches names ignoring case, and the short name of a long title", () => {
    expect(matchVoice(voices, "rachel")?.id).toBe("a".repeat(20));
    expect(matchVoice(voices, "Brian")?.id).toBe("b".repeat(20));
    expect(matchVoice(voices, "Adam")).toBeUndefined();
  });
});

describe("parseEnv", () => {
  it("reads KEY=value lines with quotes, export and comments", () => {
    expect(parseEnv(`# comment\nexport A=1\nB="two words"\nC='x#y'\nD=plain # note\nbad line`)).toEqual({
      A: "1",
      B: "two words",
      C: "x#y",
      D: "plain",
    });
  });
});

describe("takeName", () => {
  it("is a readable slug plus a hash of the whole request", () => {
    const a = takeName({ provider: "elevenlabs", voice: "Rachel", text: "Meet smashcut! Videos you write in code." });
    expect(a).toMatch(/^meet-smashcut-videos-you-write-in-[0-9a-f]{10}$/);
    expect(takeName({ provider: "elevenlabs", voice: "Adam", text: "Meet smashcut! Videos you write in code." })).not.toBe(a);
  });
});

describe("generating takes", () => {
  let root: string;
  let calls: string[];
  const fake: VoiceProvider = {
    name: "fake",
    keyEnv: "FAKE_TTS_KEY",
    async synthesize(req) {
      calls.push(req.text);
      return {
        audio: Buffer.from(`audio for ${req.text}`),
        format: "mp3",
        words: req.text.split(" ").map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 })),
        used: { model: "fake-1" },
      };
    },
    async voices() {
      return [];
    },
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "smashcut-voice-"));
    calls = [];
    PROVIDERS.fake = fake;
    process.env.FAKE_TTS_KEY = "k";
  });
  afterEach(async () => {
    delete PROVIDERS.fake;
    delete process.env.FAKE_TTS_KEY;
    await rm(root, { recursive: true, force: true });
  });

  const req = (text: string) => ({ provider: "fake", voice: "v", text });

  it("generates each line once and reads it back for the timeline", async () => {
    await generateMissing(root, [req("one two"), req("three")], () => {});
    await generateMissing(root, [req("one two"), req("three")], () => {});
    expect(calls.sort()).toEqual(["one two", "three"]);
    const takes = await readTakes(root);
    expect(takes).toHaveLength(2);
    const t = takes.find((x) => x.text === "one two")!;
    expect(t.audio).toMatch(/^\/voiceovers\/one-two-[0-9a-f]{10}\.mp3$/);
    expect(t.words.map((w) => w.text)).toEqual(["one", "two"]);
    // No ffprobe-readable audio here: the length falls back to the last word plus a tail.
    expect(t.duration).toBeCloseTo(0.9 + 0.3);
    const stored = JSON.parse(await readFile(path.join(root, "voiceovers", t.audio.split("/").pop()!.replace(".mp3", ".json")), "utf8"));
    expect(stored.audio).toMatch(/\.mp3$/);
    expect(stored.generated.model).toBe("fake-1");
  });

  it("explains a missing API key before calling the provider", async () => {
    delete process.env.FAKE_TTS_KEY;
    await expect(generateMissing(root, [req("hello")], () => {})).rejects.toThrow(/FAKE_TTS_KEY is not set/);
    expect(calls).toEqual([]);
  });

  it("finds and removes takes the timeline no longer uses", async () => {
    await generateMissing(root, [req("keep"), req("drop")], () => {});
    const unused = await unusedTakeFiles(root, [req("keep")]);
    expect(unused).toHaveLength(2);
    expect(unused.every((f) => f.startsWith("drop-"))).toBe(true);
    await removeTakeFiles(root, unused);
    expect((await readdir(path.join(root, "voiceovers"))).every((f) => f.startsWith("keep-"))).toBe(true);
  });
});

describe("loadEnv", () => {
  it("only loads provider API keys from a folder's .env", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "smashcut-env-"));
    await writeFile(path.join(dir, ".env"), "ELEVENLABS_API_KEY=from-file\nNODE_OPTIONS=--require ./evil.js\nSMASHCUT_TEST_X=1\n");
    const saved = { key: process.env.ELEVENLABS_API_KEY, opts: process.env.NODE_OPTIONS };
    delete process.env.ELEVENLABS_API_KEY;
    try {
      loadEnv(dir);
      expect(process.env.ELEVENLABS_API_KEY).toBe("from-file");
      expect(process.env.NODE_OPTIONS).toBe(saved.opts);
      expect(process.env.SMASHCUT_TEST_X).toBeUndefined();
    } finally {
      if (saved.key === undefined) delete process.env.ELEVENLABS_API_KEY;
      else process.env.ELEVENLABS_API_KEY = saved.key;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("crossSite", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
  it("allows the local page and refuses other sites and rebound host names", () => {
    expect(crossSite(req({ host: "localhost:3210", "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(crossSite(req({ host: "127.0.0.1:3210" }))).toBe(false);
    expect(crossSite(req({ host: "[::1]:3210" }))).toBe(false);
    expect(crossSite(req({ host: "localhost:3210", "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(crossSite(req({ host: "evil.example:3210", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(crossSite(req({}))).toBe(true);
  });
});
