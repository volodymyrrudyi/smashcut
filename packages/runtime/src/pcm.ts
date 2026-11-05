import type { Stereo } from "@smashcut/core";

/** Encode a bounded slice as 16-bit little-endian stereo PCM without copying the whole mix. */
export function encodePcm([left, right]: Stereo, offset = 0, count = left.length - offset): string {
  const samples = Math.min(count, left.length - offset);
  const bytes = new Uint8Array(samples * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) {
    view.setInt16(i * 4, Math.max(-1, Math.min(1, left[offset + i])) * 0x7fff, true);
    view.setInt16(i * 4 + 2, Math.max(-1, Math.min(1, right[offset + i])) * 0x7fff, true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
