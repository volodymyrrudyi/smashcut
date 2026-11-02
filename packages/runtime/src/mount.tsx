import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  describeTimeline,
  missingVoices,
  mixAudio,
  resolveComposition,
  voiceRequests,
  type Composition,
  type ResolvedComposition,
  type Stereo,
  type TimelineSummary,
  type VoiceRequest,
} from "@smashcut/core";
import { loadMediaAudio, loadMediaInfo, loadSoundFiles } from "./media";
import { Preview } from "./Preview";
import { Stage } from "./Stage";
import { frameStore } from "./store";
import { waitUntilReady } from "./ready";

export interface VideoMeta {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** Footage files in the timeline, so the CLI can build their frame caches before capturing. */
  footage: string[];
  /** Target LUFS for the exported soundtrack, or null to leave it as mixed. */
  loudness: number | null;
  /** Voiceover lines in the timeline: all of them, and those with no generated take yet. */
  voices: { all: VoiceRequest[]; missing: VoiceRequest[] };
}

/** Bridge the Node-side renderer drives through Playwright. */
export interface SmashcutBridge {
  ready: true;
  meta(): VideoMeta;
  /** Render `frame` and resolve once it is fully loaded and painted. */
  seek(frame: number): Promise<void>;
  /** The mixed soundtrack as base64 interleaved 16-bit little-endian PCM, or null if silent. */
  audio(sampleRate: number): Promise<string | null>;
  /** Every clip, caption and sound with its times, for `smashcut inspect`. */
  inspect(): TimelineSummary;
}

declare global {
  interface Window {
    __smashcut?: SmashcutBridge;
    __smashcut_error?: string;
  }
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EPOCH = Date.UTC(2025, 0, 1);

function encodePcm([left, right]: Stereo): string {
  const pcm = new Int16Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    pcm[2 * i] = Math.max(-1, Math.min(1, left[i])) * 0x7fff;
    pcm[2 * i + 1] = Math.max(-1, Math.min(1, right[i])) * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Make wall-clock time and randomness a pure function of the current frame. */
function installDeterminism(fps: number) {
  const now = () => (frameStore.get() / fps) * 1000;
  Date.now = () => EPOCH + now();
  performance.now = now;
  let random = mulberry32(0);
  Math.random = () => random();
  frameStore.subscribe(() => {
    random = mulberry32(frameStore.get() + 1);
  });
}

/** A small status line over the dev preview (voiceover generation). */
function showStatus(text: string, tone: "info" | "error") {
  let el = document.getElementById("smashcut-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "smashcut-status";
    document.body.append(el);
  }
  el.textContent = text;
  el.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:1000;max-width:80vw;padding:8px 14px;" +
    "border-radius:8px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px #0006;white-space:pre-wrap;" +
    (tone === "error" ? "background:#7f1d1d;color:#fecaca" : "background:#1e293b;color:#e2e8f0");
}

/** Ask the dev server for missing voiceover lines; the page reloads once they're stored. */
async function generateVoices(requests: VoiceRequest[]) {
  const n = requests.length;
  showStatus(`Generating ${n} voiceover line${n === 1 ? "" : "s"}… (timings are estimated until then)`, "info");
  try {
    const res = await fetch("/__smashcut/voice/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? res.statusText);
  } catch (err) {
    showStatus(`Voiceover not generated: ${err instanceof Error ? err.message : err}\nThe voice lines are silent, with estimated timings.`, "error");
  }
}

function showError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  window.__smashcut_error = message;
  document.body.innerHTML = "";
  const pre = document.createElement("pre");
  pre.textContent = `smashcut: ${message}`;
  pre.style.cssText = "color:#f87171;background:#18181b;padding:24px;margin:0;min-height:100vh;font:14px monospace";
  document.body.append(pre);
}

export async function mount(composition: Composition, el = document.getElementById("root")!) {
  const params = new URLSearchParams(location.search);
  const renderMode = params.has("render");
  // Timing is authored in seconds, so any frame rate can be sampled from the same timeline.
  const fps = Number(params.get("fps"));
  if (fps > 0) composition = { ...composition, fps };
  let comp: ResolvedComposition;
  try {
    // Footage durations come from the files, so probe them before resolving the timeline.
    composition = { ...composition, media: await loadMediaInfo(composition) };
    comp = resolveComposition(composition);
  } catch (err) {
    showError(err);
    throw err;
  }

  if (renderMode) {
    installDeterminism(comp.fps);
  } else {
    const fromHash = Number(location.hash.slice(1));
    if (Number.isInteger(fromHash) && fromHash > 0) frameStore.set(Math.min(fromHash, comp.durationInFrames - 1));
  }

  const root = createRoot(el);
  // Footage audio is only decoded when the soundtrack is needed, not by every render chunk.
  const audio = async (sampleRate?: number) => {
    await Promise.all([loadMediaAudio(composition.media!), loadSoundFiles(composition)]);
    return mixAudio(composition, sampleRate);
  };
  const missing = missingVoices(composition.audio);
  if (!renderMode && missing.length) void generateVoices(missing);
  flushSync(() => root.render(renderMode ? <Stage comp={comp} /> : <Preview comp={comp} composition={composition} audio={audio} />));

  window.__smashcut = {
    ready: true,
    meta: () => ({
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      durationInFrames: comp.durationInFrames,
      footage: Object.keys(comp.media),
      loudness: composition.loudness === false || composition.loudness === undefined ? null : composition.loudness,
      voices: { all: voiceRequests(composition.audio), missing },
    }),
    async seek(frame) {
      flushSync(() => frameStore.set(frame));
      await waitUntilReady();
    },
    async audio(sampleRate) {
      const mix = await audio(sampleRate);
      return mix && encodePcm(mix);
    },
    inspect: () => describeTimeline(comp, composition),
  };
}
