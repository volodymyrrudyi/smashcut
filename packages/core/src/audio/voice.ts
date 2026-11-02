import type { Cue, Word } from "../subtitles";
import { audioFile } from "./file";
import { sound, type AudioClip, type SoundOptions } from "./mix";
import { makeStereo, type AudioSource } from "./synth";

/** Provider used when `voice()` doesn't name one. */
export const DEFAULT_VOICE_PROVIDER = "elevenlabs";

/** What to say and how: everything that decides a take. Changing any of it means a new take. */
export interface VoiceRequest {
  /** Text-to-speech provider, e.g. "elevenlabs". */
  provider: string;
  /** The provider's voice: a name ("Sarah") or an id. */
  voice: string;
  text: string;
  /** Provider model; omitted = the provider's default. */
  model?: string;
  /** Provider-specific settings, passed through as-is (ElevenLabs: stability, similarity_boost, style, speed, ...). */
  settings?: Record<string, unknown>;
}

/** A generated take: the request, the audio file and when each word is spoken. Stored in `voiceovers/`. */
export interface VoiceTake extends VoiceRequest {
  /** Project path of the audio, e.g. "/voiceovers/meet-smashcut-1a2b3c4d5e.mp3". */
  audio: string;
  /** Seconds. */
  duration: number;
  /** Word timings in seconds from the start of the take. */
  words: { text: string; start: number; end: number }[];
}

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
};

/** Canonical string for a request: equal requests (whatever their key order) give equal keys. */
export function voiceKey(req: VoiceRequest): string {
  const { provider, voice, text, model, settings } = req;
  return JSON.stringify(sortKeys({ provider, voice, text, model: model ?? null, settings: settings ?? {} }));
}

let takes = new Map<string, VoiceTake>();

/** Register the takes in `voiceovers/`. The dev server does this before your timeline runs. */
export function setVoiceTakes(list: readonly VoiceTake[]): void {
  takes = new Map(list.map((t) => [voiceKey(t), t]));
}

/** The stored take for a request, if it has been generated. */
export const findVoiceTake = (req: VoiceRequest): VoiceTake | undefined => takes.get(voiceKey(req));

export interface VoiceOptions extends SoundOptions {
  /** The provider's voice: a name ("Sarah") or an id. */
  voice: string;
  /** Default "elevenlabs". */
  provider?: string;
  model?: string;
  /** Provider-specific settings, e.g. `{ stability: 0.4, speed: 1.05 }` for ElevenLabs. */
  settings?: Record<string, unknown>;
}

export interface VoiceClip extends AudioClip {
  voice: VoiceRequest;
  /** The generated take, or undefined until it's generated (timings are estimated until then). */
  take?: VoiceTake;
  /** Seconds the clip lasts: the take's length, or an estimate before it's generated. */
  duration: number;
  /** `at + duration`: where to start the next line or cut the scene. */
  end: number;
  /** Each spoken word with timeline seconds. */
  words: Word[];
  /** The words grouped into caption cues with timeline seconds: `subtitles(vo.cues)` at the top level. */
  cues: Cue[];
  /** The `nth` (1-based) spoken occurrence of `text`, ignoring case and punctuation, with timeline seconds. */
  word(text: string, nth?: number): Word;
}

/** Roughly how fast narration is read, for timings before a take exists. */
const CHARS_PER_SECOND = 15;

/** Word timings spread over an estimated reading time, used until a take is generated. */
function estimateTake(text: string): { duration: number; words: VoiceTake["words"] } {
  const parts = text.split(/\s+/).filter(Boolean);
  const weight = (w: string) => w.length + 1;
  const total = parts.reduce((s, w) => s + weight(w), 0);
  const duration = Math.max(0.5, total / CHARS_PER_SECOND);
  let t = 0;
  const words = parts.map((w) => {
    const d = (duration * weight(w)) / total;
    const word = { text: w, start: t, end: t + d * 0.85 };
    t += d;
    return word;
  });
  return { duration, words };
}

const silence = (duration: number): AudioSource => ({
  duration,
  render: (sampleRate, seconds) => makeStereo(Math.ceil(seconds * sampleRate)),
});

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");

/** Longest caption line, in characters. */
const CUE_CHARS = 42;
/** A pause this long (seconds) between words starts a new caption. */
const CUE_GAP = 0.6;

/** Group words into captions: break after a sentence, at a pause, or when a line gets too long. */
export function wordsToCues(words: readonly Word[]): Cue[] {
  const cues: Cue[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (!current.length) return;
    const text = current.map((w) => w.text).join(" ");
    cues.push({ start: current[0].start, end: current[current.length - 1].end, text, words: current });
    current = [];
  };
  for (const w of words) {
    const prev = current[current.length - 1];
    const length = current.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (prev && (/[.!?…]["”’)]?$/.test(prev.text) || w.start - prev.end > CUE_GAP || length > CUE_CHARS)) flush();
    current.push({ text: w.text, start: w.start, end: w.end });
  }
  flush();
  // Hold each caption until the next one starts (up to a beat), so they don't flicker between words.
  cues.forEach((c, i) => {
    const next = cues[i + 1]?.start ?? Infinity;
    c.end = Math.max(c.end, Math.min(next, c.end + 0.5));
  });
  return cues;
}

/**
 * A voiceover line, spoken by a text-to-speech provider (ElevenLabs by default):
 * `voice("Meet smashcut.", { at: 1, voice: "Sarah" })`.
 *
 * The CLI generates each line once and stores it in `voiceovers/` (commit that folder). Until then the clip is
 * silent and its timings are estimated. `.end`, `.words`, `.word("smashcut")` and `.cues` give the spoken timing
 * for placing scenes, effects and captions.
 */
export function voice(text: string, opts: VoiceOptions): VoiceClip {
  const { voice: voiceName, provider = DEFAULT_VOICE_PROVIDER, model, settings, ...soundOpts } = opts;
  if (!text.trim()) throw new Error("voice(): text is empty");
  if (!voiceName) throw new Error(`voice("${text.slice(0, 30)}"): pick a voice, e.g. { voice: "Sarah" }`);
  const request: VoiceRequest = { provider, voice: voiceName, text, ...(model && { model }), ...(settings && { settings }) };
  const take = findVoiceTake(request);
  const spoken = take ?? estimateTake(text);
  const at = soundOpts.at ?? 0;
  const duration = soundOpts.duration ?? spoken.duration;
  const source = take ? audioFile(take.audio, take.duration) : silence(spoken.duration);
  const words: Word[] = spoken.words.map((w) => ({ text: w.text, start: at + w.start, end: at + w.end }));
  const clip = sound(source, { label: "voice", ...soundOpts, at, duration });
  return {
    ...clip,
    duration,
    voice: request,
    take,
    end: at + duration,
    words,
    cues: wordsToCues(words),
    word(target, nth = 1) {
      const want = norm(target);
      const found = words.filter((w) => norm(w.text) === want);
      const hit = found[nth - 1];
      if (!hit) {
        throw new Error(`voice("${text.slice(0, 30)}…"): "${target}" is spoken ${found.length} time(s), not ${nth}`);
      }
      return hit;
    },
  };
}

export const isVoiceClip = (clip: AudioClip): clip is VoiceClip => "voice" in clip && typeof clip.voice === "object";

/** Voice clips in the soundtrack whose take hasn't been generated yet. */
export function missingVoices(audio: readonly AudioClip[] = []): VoiceRequest[] {
  const seen = new Map<string, VoiceRequest>();
  for (const clip of audio) if (isVoiceClip(clip) && !clip.take) seen.set(voiceKey(clip.voice), clip.voice);
  return [...seen.values()];
}

/** Every voice request in the soundtrack, generated or not. */
export function voiceRequests(audio: readonly AudioClip[] = []): VoiceRequest[] {
  const seen = new Map<string, VoiceRequest>();
  for (const clip of audio) if (isVoiceClip(clip)) seen.set(voiceKey(clip.voice), clip.voice);
  return [...seen.values()];
}
