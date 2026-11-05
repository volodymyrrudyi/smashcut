import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { voiceKey, type VoiceRequest, type VoiceTake } from "@smashcut/core";
import { getProvider, providerKey, type VoiceProvider } from "./provider";

/** Generated takes live here, next to timeline.ts, and are meant to be committed. */
export const VOICE_DIR = "voiceovers";

/** A take as stored on disk: the audio path is relative to `voiceovers/`. */
interface StoredTake extends VoiceTake {
  generated?: Record<string, unknown>;
}

/** File name (without extension) for a request: a readable slug of the text plus a hash of the whole request. */
export function takeName(req: VoiceRequest): string {
  const slug = req.text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .slice(0, 48);
  const hash = createHash("sha1").update(voiceKey(req)).digest("hex").slice(0, 10);
  return slug ? `${slug}-${hash}` : hash;
}

/** Every stored take, with its audio as a project path (`/voiceovers/…`), ready for the timeline. */
export async function readTakes(root: string): Promise<VoiceTake[]> {
  const dir = path.join(root, VOICE_DIR);
  if (!existsSync(dir)) return [];
  const out: VoiceTake[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const take = JSON.parse(await readFile(path.join(dir, file), "utf8")) as StoredTake;
      if (!existsSync(path.join(dir, take.audio))) continue;
      const { generated: _, ...rest } = take;
      out.push({ ...rest, audio: `/${VOICE_DIR}/${encodeURIComponent(take.audio)}` });
    } catch {
      // A hand-edited or half-written file: ignore it, the line just gets generated again.
    }
  }
  return out;
}

const run = promisify(execFile);

/** Length of an audio file from ffprobe, or undefined if ffprobe isn't available. */
async function probeDuration(file: string): Promise<number | undefined> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    const d = Number(stdout.trim());
    return d > 0 ? d : undefined;
  } catch {
    return undefined;
  }
}

const jobs = new Map<string, Promise<VoiceTake>>();

/** Generate one take and store it (audio + JSON). Concurrent calls for the same request share the work. */
export function generateTake(root: string, req: VoiceRequest, provider: VoiceProvider = getProvider(req.provider), signal?: AbortSignal): Promise<VoiceTake> {
  const id = `${path.resolve(root)}\0${voiceKey(req)}`;
  let job = jobs.get(id);
  if (!job) {
    job = (async () => {
      const key = providerKey(provider);
      signal?.throwIfAborted();
      const result = await provider.synthesize(req, key, signal);
      signal?.throwIfAborted();
      const dir = path.join(root, VOICE_DIR);
      await mkdir(dir, { recursive: true });
      const name = takeName(req);
      const audioFile = `${name}.${result.format}`;
      await writeFile(path.join(dir, audioFile), result.audio);
      const lastWord = result.words.at(-1)?.end ?? 0;
      const duration = (await probeDuration(path.join(dir, audioFile))) ?? lastWord + 0.3;
      const round = (s: number) => Math.round(s * 1000) / 1000;
      const take: StoredTake = {
        provider: req.provider,
        voice: req.voice,
        text: req.text,
        ...(req.model && { model: req.model }),
        ...(req.settings && { settings: req.settings }),
        audio: audioFile,
        duration: round(duration),
        words: result.words.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) })),
        generated: { ...result.used, at: new Date().toISOString() },
      };
      // JSON last (and atomically): a take only counts once its JSON exists.
      const json = path.join(dir, `${name}.json`);
      await writeFile(`${json}.tmp`, JSON.stringify(take, null, 2) + "\n");
      await rename(`${json}.tmp`, json);
      return { ...take, audio: `/${VOICE_DIR}/${encodeURIComponent(audioFile)}` };
    })();
    jobs.set(id, job);
    job.finally(() => jobs.delete(id)).catch(() => {});
  }
  return job;
}

/** Generate every request that has no stored take yet, a few at a time. Returns the new takes. */
export async function generateMissing(
  root: string,
  requests: readonly VoiceRequest[],
  log: (msg: string) => void = (m) => process.stderr.write(m + "\n"),
  signal?: AbortSignal,
): Promise<VoiceTake[]> {
  signal?.throwIfAborted();
  const have = new Set((await readTakes(root)).map(voiceKey));
  const todo = requests.filter((r) => !have.has(voiceKey(r)));
  if (!todo.length) return [];
  // Fail on a missing key before starting anything.
  for (const name of new Set(todo.map((r) => r.provider))) providerKey(getProvider(name));
  log(`Generating ${todo.length} voiceover line${todo.length === 1 ? "" : "s"}...`);
  const out: VoiceTake[] = [];
  const queue = [...todo];
  const controller = new AbortController();
  const workSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let failure: unknown;
  const worker = async () => {
    try {
      for (let req = queue.shift(); req; req = queue.shift()) {
        workSignal.throwIfAborted();
        const take = await generateTake(root, req, getProvider(req.provider), workSignal);
        log(`  ${req.provider}/${req.voice}: “${req.text.length > 60 ? req.text.slice(0, 59) + "…" : req.text}” (${take.duration.toFixed(2)}s)`);
        out.push(take);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        failure = error;
        controller.abort(error);
      }
      throw error;
    }
  };
  // ElevenLabs allows a few concurrent requests even on small plans.
  await Promise.allSettled(Array.from({ length: Math.min(2, todo.length) }, worker));
  if (controller.signal.aborted) throw failure;
  signal?.throwIfAborted();
  return out;
}

/** Stored takes no request uses any more, as file names (JSON and audio) inside `voiceovers/`. */
export async function unusedTakeFiles(root: string, requests: readonly VoiceRequest[]): Promise<string[]> {
  const dir = path.join(root, VOICE_DIR);
  if (!existsSync(dir)) return [];
  const used = new Set(requests.map(voiceKey));
  const out: string[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    try {
      const take = JSON.parse(await readFile(path.join(dir, file), "utf8")) as StoredTake;
      if (!used.has(voiceKey(take))) out.push(file, take.audio);
    } catch {}
  }
  return out;
}

export async function removeTakeFiles(root: string, files: readonly string[]): Promise<void> {
  const dir = path.join(root, VOICE_DIR);
  await Promise.all(files.map((f) => rm(path.join(dir, path.basename(f)), { force: true })));
}
