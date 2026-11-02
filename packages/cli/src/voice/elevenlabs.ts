import type { VoiceRequest } from "@smashcut/core";
import type { SpokenWord, VoiceInfo, VoiceProvider } from "./provider";

const API = "https://api.elevenlabs.io";
export const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";
/** MP3 at 44.1 kHz / 128 kbps: available on every plan, and small enough to commit. */
const OUTPUT_FORMAT = "mp3_44100_128";
/** Settings that go in the request's `voice_settings`; anything else (seed, language_code, ...) goes top-level. */
const VOICE_SETTINGS = new Set(["stability", "similarity_boost", "style", "use_speaker_boost", "speed", "clone_strength"]);

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Turn ElevenLabs' per-character timings into words (runs of non-space characters). */
export function alignmentToWords(a: Alignment): SpokenWord[] {
  const words: SpokenWord[] = [];
  let current: SpokenWord | null = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      current = null;
      return;
    }
    const start = a.character_start_times_seconds[i];
    const end = a.character_end_times_seconds[i];
    if (!current) {
      current = { text: "", start, end };
      words.push(current);
    }
    current.text += ch;
    current.end = end;
  });
  return words;
}

/** ElevenLabs voice ids are 20 alphanumeric characters. */
const looksLikeId = (s: string) => /^[A-Za-z0-9]{20}$/.test(s);

/** Pick a voice by name: exact (ignoring case), else the name before " - " / " (" in its full title. */
export function matchVoice(voices: VoiceInfo[], wanted: string): VoiceInfo | undefined {
  const w = wanted.trim().toLowerCase();
  return (
    voices.find((v) => v.name.toLowerCase() === w) ??
    voices.find((v) => v.name.toLowerCase().split(/\s+[-–(]\s*/)[0] === w)
  );
}

async function call(path: string, key: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(API + path, { ...init, headers: { "xi-api-key": key, ...init.headers } });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const body = JSON.parse(detail);
      detail = body.detail?.message ?? body.detail ?? detail;
      if (typeof detail !== "string") detail = JSON.stringify(detail);
    } catch {}
    const hint = res.status === 401 ? " (check ELEVENLABS_API_KEY)" : "";
    throw new Error(`ElevenLabs ${res.status}${hint}: ${detail}`);
  }
  return res;
}

let voiceList: Promise<VoiceInfo[]> | undefined;

export const elevenlabs: VoiceProvider = {
  name: "elevenlabs",
  keyEnv: "ELEVENLABS_API_KEY",

  async voices(key) {
    voiceList ??= call("/v1/voices", key)
      .then((r) => r.json() as Promise<{ voices: { voice_id: string; name: string; category?: string; description?: string }[] }>)
      .then(({ voices }) =>
        voices.map((v) => ({ id: v.voice_id, name: v.name, description: [v.category, v.description].filter(Boolean).join(": ") || undefined })),
      );
    voiceList.catch(() => (voiceList = undefined));
    return voiceList;
  },

  async synthesize(req: VoiceRequest, key) {
    let voiceId = req.voice;
    if (!looksLikeId(req.voice)) {
      const found = matchVoice(await this.voices(key), req.voice);
      if (!found) throw new Error(`ElevenLabs has no voice named "${req.voice}" on this account (run \`smashcut voices\`)`);
      voiceId = found.id;
    }
    const model = req.model ?? ELEVENLABS_DEFAULT_MODEL;
    const voiceSettings: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.settings ?? {})) (VOICE_SETTINGS.has(k) ? voiceSettings : extra)[k] = v;
    const body = {
      text: req.text,
      model_id: model,
      ...(Object.keys(voiceSettings).length && { voice_settings: voiceSettings }),
      ...extra,
    };
    const res = await call(`/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`, key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { audio_base64: string; alignment?: Alignment | null; normalized_alignment?: Alignment | null };
    const alignment = data.alignment ?? data.normalized_alignment;
    return {
      audio: Buffer.from(data.audio_base64, "base64"),
      format: "mp3",
      words: alignment ? alignmentToWords(alignment) : [],
      used: { voiceId, model, outputFormat: OUTPUT_FORMAT },
    };
  },
};
