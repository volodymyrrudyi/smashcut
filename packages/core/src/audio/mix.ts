import { footageDuration, footageTime } from "../footage";
import { resolveComposition, type ResolvedClip, type ResolvedComposition } from "../resolve";
import type { Composition } from "../types";
import { makeStereo, type AudioSource, type Stereo } from "./synth";

export interface AudioClip {
  kind: "audio";
  source: AudioSource;
  /** Start in seconds on the video timeline. */
  at: number;
  /** Seconds. Defaults to the source's own length, or to the end of the video. */
  duration?: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** 0..1: how far this clip dips while any other sound (effects, keys, footage audio) plays. */
  duck?: number;
  /** Name shown in the dev timeline, e.g. "music" or "tick". */
  label?: string;
}

export interface SoundOptions {
  at?: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  /**
   * 0..1: dip this clip by up to that fraction while other sounds play, easing back after them. Meant for
   * background music: `music(ambient(), { duck: 0.5 })`.
   */
  duck?: number;
  /** Name shown in the dev timeline. `sfx.*` and `music()` set one for you. */
  label?: string;
}

/** Place an audio source on the timeline. */
export const sound = (source: AudioSource, opts: SoundOptions = {}): AudioClip => ({
  kind: "audio",
  source,
  at: opts.at ?? 0,
  duration: opts.duration,
  volume: opts.volume ?? 1,
  fadeIn: opts.fadeIn ?? 0,
  fadeOut: opts.fadeOut ?? 0,
  duck: opts.duck,
  label: opts.label,
});

/** Background track; same as `sound`, labelled "music" in the dev timeline. */
export const music = (source: AudioSource, opts: SoundOptions = {}): AudioClip => sound(source, { label: "music", ...opts });

export const DEFAULT_SAMPLE_RATE = 48_000;

/** Render every audio clip of the video into one stereo buffer, or null if the video is silent. */
export function mixAudio(comp: Composition, sampleRate = DEFAULT_SAMPLE_RATE): Stereo | null {
  const resolved = resolveComposition(comp);
  const footage = footageClips(resolved);
  if (!comp.audio?.length && !footage.length) return null;
  const { durationInFrames, fps } = resolved;
  const total = durationInFrames / fps;
  const out = makeStereo(Math.round(total * sampleRate));

  for (const f of footage) mixFootage(out, resolved, f, sampleRate);

  const clips = comp.audio ?? [];
  // Everything else first, so ducking clips can follow its level.
  for (const clip of clips) if (!clip.duck) addClip(out, clip, total, sampleRate);
  const ducked = clips.filter((c) => c.duck);
  if (ducked.length) {
    const gain = duckEnvelope(out, sampleRate);
    for (const clip of ducked) addClip(out, clip, total, sampleRate, gain);
  }

  // Gentle soft clip so stacked sounds never hard-clip.
  for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(ch[i]);
  return out;
}

/** How much of the "others" bus is sounding at each sample, 0..1: fast attack, slow release, like a sidechain. */
function duckEnvelope(others: Stereo, sampleRate: number): Float32Array {
  const n = others[0].length;
  const env = new Float32Array(n);
  const attack = 1 - Math.exp(-1 / (0.012 * sampleRate));
  const release = 1 - Math.exp(-1 / (0.4 * sampleRate));
  // Level at which the dip is complete: a keystroke or a UI tap is well above this.
  const full = 0.06;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.max(Math.abs(others[0][i]), Math.abs(others[1][i]));
    e += (x > e ? attack : release) * (x - e);
    env[i] = Math.min(1, e / full);
  }
  return env;
}

/** Mix one clip into `out`, scaled by its volume and fades, and dipped by `duckEnv` when the clip ducks. */
function addClip(out: Stereo, clip: AudioClip, total: number, sampleRate: number, duckEnv?: Float32Array) {
  if (clip.at >= total) return;
  const length = Math.min(clip.duration ?? clip.source.duration ?? total - clip.at, total - clip.at);
  const [l, r] = clip.source.render(sampleRate, length);
  const offset = Math.round(clip.at * sampleRate);
  const n = Math.min(l.length, out[0].length - offset);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let g = clip.volume;
    if (clip.fadeIn > 0 && t < clip.fadeIn) g *= t / clip.fadeIn;
    if (clip.fadeOut > 0 && t > length - clip.fadeOut) g *= Math.max(0, (length - t) / clip.fadeOut);
    if (duckEnv && clip.duck) g *= 1 - clip.duck * duckEnv[offset + i];
    out[0][offset + i] += l[i] * g;
    out[1][offset + i] += r[i] * g;
  }
}

interface FootageClip {
  clip: ResolvedClip;
  /** Frame where an ancestor cuts the clip off. */
  end: number;
}

/** Footage clips with an audio track, in timeline order. */
function footageClips(comp: ResolvedComposition): FootageClip[] {
  const out: FootageClip[] = [];
  const walk = (clip: ResolvedClip, limit: number) => {
    const end = Math.min(limit, clip.start + clip.duration);
    const { node } = clip;
    if (node.kind === "video" && !node.muted && (node.volume ?? 1) > 0 && comp.media[node.src]?.audio) {
      out.push({ clip, end });
    }
    clip.children.forEach((child) => walk(child, end));
  };
  comp.layers.forEach((clip) => walk(clip, comp.durationInFrames));
  return out;
}

/** Ramp length in seconds at hard cuts, so footage audio never clicks. */
const DECLICK = 0.005;

function mixFootage(out: Stereo, comp: ResolvedComposition, { clip, end }: FootageClip, sampleRate: number) {
  const node = clip.node;
  if (node.kind !== "video") return;
  const info = comp.media[node.src];
  const track = info.audio!;
  const [srcL, srcR] = track.channels;
  const { fps } = comp;
  const start = clip.start / fps;
  const length = (end - clip.start) / fps;
  if (length <= 0) return;
  // Without looping, the sound stops when the source runs out (the picture holds its last frame).
  const audible = node.loop ? length : Math.min(length, footageDuration(node, info));
  const fadeIn = clip.transitionIn ? clip.transitionIn.frames / fps : DECLICK;
  // If the source runs out before the clip ends, the transition happens after the sound already stopped.
  const fadeOut = clip.transitionOut && audible >= length ? clip.transitionOut.frames / fps : DECLICK;
  const volume = node.volume ?? 1;
  const offset = Math.round(start * sampleRate);
  const n = Math.min(Math.round(audible * sampleRate), out[0].length - offset);

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const pos = footageTime(node, info, t) * track.sampleRate;
    const k = Math.floor(pos);
    if (k + 1 >= srcL.length) break;
    const frac = pos - k;
    let g = volume;
    if (t < fadeIn) g *= t / fadeIn;
    if (t > audible - fadeOut) g *= Math.max(0, (audible - t) / fadeOut);
    out[0][offset + i] += (srcL[k] + (srcL[k + 1] - srcL[k]) * frac) * g;
    out[1][offset + i] += (srcR[k] + (srcR[k + 1] - srcR[k]) * frac) * g;
  }
}
