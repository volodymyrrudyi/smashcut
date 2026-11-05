import { describe, expect, it } from "vitest";
import { encodePcm } from "./pcm";
import type { Stereo } from "@smashcut/core";

describe("PCM transfer", () => {
  it("encodes interleaved little-endian samples with the existing clipping and truncation", () => {
    const input: Stereo = [new Float32Array([1, -1, 2, -2, 0.5, NaN]), new Float32Array([-1, 1, -2, 2, -0.5, NaN])];
    const bytes = Buffer.from(encodePcm(input), "base64");
    expect([...Array(12)].map((_, i) => bytes.readInt16LE(i * 2))).toEqual([32767, -32767, -32767, 32767, 32767, -32767, -32767, 32767, 16383, -16383, 0, 0]);
  });
  it("joins chunk boundaries and a short final chunk without dropping or duplicating samples", () => {
    const input: Stereo = [new Float32Array(70001), new Float32Array(70001)];
    for (let i = 0; i < input[0].length; i++) { input[0][i] = Math.sin(i * 0.1); input[1][i] = Math.cos(i * 0.13); }
    const chunks = [0, 32768, 65536].map((offset) => Buffer.from(encodePcm(input, offset, 32768), "base64"));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(encodePcm(input), "base64"));
    expect(chunks[2].length).toBe((70001 - 65536) * 4);
    expect(encodePcm(input, input[0].length, 1)).toBe("");
  });
});
