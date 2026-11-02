import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { VoiceRequest } from "@smashcut/core";
import { elevenlabs } from "./elevenlabs";

export interface SpokenWord {
  text: string;
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
}

export interface Synthesis {
  /** Encoded audio, stored as-is. */
  audio: Buffer;
  /** File extension of `audio`, e.g. "mp3". */
  format: string;
  words: SpokenWord[];
  /** What was actually used, recorded with the take (e.g. the resolved voice id and default model). */
  used: Record<string, unknown>;
}

export interface VoiceInfo {
  id: string;
  name: string;
  description?: string;
}

/** A text-to-speech service. Add one by implementing this and listing it in `PROVIDERS`. */
export interface VoiceProvider {
  name: string;
  /** Environment variable holding the API key. */
  keyEnv: string;
  synthesize(req: VoiceRequest, key: string): Promise<Synthesis>;
  voices(key: string): Promise<VoiceInfo[]>;
}

export const PROVIDERS: Record<string, VoiceProvider> = { elevenlabs };

export function getProvider(name: string): VoiceProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown voice provider "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`);
  return provider;
}

/** The provider's API key from the environment (a project `.env` is loaded into it), or a helpful error. */
export function providerKey(provider: VoiceProvider, why = "new voiceover lines can't be generated"): string {
  const key = process.env[provider.keyEnv];
  if (!key) {
    throw new Error(
      `${provider.keyEnv} is not set, so ${why}. ` +
        `Export it, or put ${provider.keyEnv}=... in the video folder's .env (keep .env out of git).`,
    );
  }
  return key;
}

/** Parse `KEY=value` lines (with optional quotes, `export` and `#` comments). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    let value = m[2];
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    out[m[1]] = value;
  }
  return out;
}

/**
 * Load the providers' API keys from `<root>/.env` into process.env, without overriding variables that are already
 * set. Only those keys: a cloned folder's .env must not be able to set things like NODE_OPTIONS or PATH.
 */
export function loadEnv(root: string): void {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  const allowed = new Set(Object.values(PROVIDERS).map((p) => p.keyEnv));
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) if (allowed.has(k)) process.env[k] ??= v;
}
