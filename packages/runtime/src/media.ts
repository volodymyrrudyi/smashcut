import { footageSources, type Composition, type MediaInfo, type Stereo } from "@smashcut/core";

const query = (src: string) => `src=${encodeURIComponent(src)}`;

async function check(res: Response, src: string): Promise<Response> {
  if (!res.ok) throw new Error(`Footage ${src}: ${(await res.text()) || res.statusText}`);
  return res;
}

/** URL of the cached JPEG for frame `index` of `src` sampled at `fps`. */
export const footageFrameUrl = (src: string, fps: number, index: number) =>
  `/__smashcut/media/frame?${query(src)}&fps=${fps}&i=${index}`;

/** Probe every footage file in the timeline; the result is the composition's `media` map. */
export async function loadMediaInfo(composition: Composition): Promise<Record<string, MediaInfo>> {
  const srcs = footageSources(composition.layers);
  const entries = await Promise.all(
    srcs.map(async (src) => {
      const res = await check(await fetch(`/__smashcut/media/info?${query(src)}`), src);
      const { duration, width, height } = (await res.json()) as MediaInfo;
      return [src, { duration, width, height }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** Decode the audio track of every footage file into `media` (in place). Silent files are skipped. */
export async function loadMediaAudio(media: Record<string, MediaInfo>): Promise<void> {
  await Promise.all(
    Object.entries(media).map(async ([src, info]) => {
      if (info.audio) return;
      const res = await check(await fetch(`/__smashcut/media/audio?${query(src)}`), src);
      if (res.status === 204) return;
      const sampleRate = Number(res.headers.get("X-Sample-Rate"));
      const pcm = new Float32Array(await res.arrayBuffer());
      const n = pcm.length >> 1;
      const channels: Stereo = [new Float32Array(n), new Float32Array(n)];
      for (let i = 0; i < n; i++) {
        channels[0][i] = pcm[2 * i];
        channels[1][i] = pcm[2 * i + 1];
      }
      info.audio = { sampleRate, channels };
    }),
  );
}
