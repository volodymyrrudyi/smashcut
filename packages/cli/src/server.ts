import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { MAX_FPS, MEDIA_SAMPLE_RATE, MediaCache } from "./media";
import { aliases } from "./paths";
import { loadEnv } from "./voice/provider";
import { generateMissing, readTakes, VOICE_DIR } from "./voice/takes";
import type { VoiceRequest } from "@smashcut/core";

const ENTRY_ID = "virtual:smashcut-entry";
const RESOLVED_ENTRY_ID = "\0" + ENTRY_ID;
const VOICES_ID = "virtual:smashcut-voices";
const RESOLVED_VOICES_ID = "\0" + VOICES_ID;

const HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>smashcut</title>
    <style>html, body { margin: 0; overflow: hidden; }</style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      const fail = (e) => { window.__smashcut_error ??= String((e && (e.stack || e.message)) || e); };
      addEventListener("error", (e) => fail(e.error || e.message));
      addEventListener("unhandledrejection", (e) => fail(e.reason));
      import("/@id/__x00__${ENTRY_ID}").catch(fail);
    </script>
  </body>
</html>`;

function sendFile(res: ServerResponse, file: string, type: string) {
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-cache");
  createReadStream(file).pipe(res);
}

/**
 * Footage endpoints the runtime calls:
 *   /__smashcut/media/info?src=   → { duration, width, height, hasAudio }
 *   /__smashcut/media/frame?src=&fps=&i=  → JPEG of frame i at that frame rate
 *   /__smashcut/media/audio?src=  → interleaved stereo f32le PCM (204 if the file is silent)
 *   /__smashcut/media/sound?src=  → any audio file (voiceover take, recording) as interleaved stereo f32le PCM
 */
async function serveMedia(media: MediaCache, url: URL, req: IncomingMessage, res: ServerResponse) {
  // These endpoints start ffmpeg jobs and write to disk: only serve the smashcut page itself, never a request
  // another site makes the browser send to localhost.
  if (crossSite(req)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  const src = url.searchParams.get("src") ?? "";
  try {
    switch (url.pathname) {
      case "/__smashcut/media/info":
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(await media.probe(src)));
        return;
      case "/__smashcut/media/frame": {
        const fps = Number(url.searchParams.get("fps"));
        const i = Number(url.searchParams.get("i"));
        if (!Number.isInteger(fps) || fps < 1 || fps > MAX_FPS || !Number.isInteger(i)) {
          res.statusCode = 400;
          res.end(`frame needs an integer fps in 1..${MAX_FPS} and an integer i`);
          return;
        }
        sendFile(res, await media.frame(src, fps, i), "image/jpeg");
        return;
      }
      case "/__smashcut/media/audio": {
        const file = await media.audio(src);
        if (!file) {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.setHeader("X-Sample-Rate", String(MEDIA_SAMPLE_RATE));
        sendFile(res, file, "application/octet-stream");
        return;
      }
      case "/__smashcut/media/sound":
        res.setHeader("X-Sample-Rate", String(MEDIA_SAMPLE_RATE));
        sendFile(res, await media.sound(src), "application/octet-stream");
        return;
      default:
        res.statusCode = 404;
        res.end();
    }
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end(err instanceof Error ? err.message : String(err));
  }
}

/** Requests another site makes the browser send to localhost are refused: these endpoints write to disk. */
function crossSite(req: IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  return site !== undefined && site !== "same-origin" && site !== "none";
}

const MAX_NOTES_BYTES = 1_000_000;

/**
 * Review notes from the dev timeline, stored in `.smashcut/notes.json` so they can be read back later
 * (by you, or by an assistant asked to "check the notes"). GET returns the list, PUT replaces it.
 */
async function serveNotes(root: string, req: IncomingMessage, res: ServerResponse) {
  const file = path.join(root, ".smashcut", "notes.json");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "PUT") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_NOTES_BYTES) {
        res.statusCode = 413;
        res.end("{}");
        return;
      }
    }
    try {
      const notes = JSON.parse(body);
      if (!Array.isArray(notes)) throw new Error("notes must be an array");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(notes, null, 2) + "\n");
      res.end(JSON.stringify({ saved: notes.length, file }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }
  res.end(existsSync(file) ? await readFile(file, "utf8") : "[]");
}

const MAX_VOICE_BYTES = 1_000_000;

/** POST { requests }: generate the voiceover lines the page found missing. The page reloads when they land. */
async function serveVoiceGenerate(root: string, req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("{}");
    return;
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_VOICE_BYTES) {
      res.statusCode = 413;
      res.end("{}");
      return;
    }
  }
  try {
    const { requests } = JSON.parse(body) as { requests: VoiceRequest[] };
    if (!Array.isArray(requests)) throw new Error("requests must be an array");
    const takes = await generateMissing(root, requests);
    res.end(JSON.stringify({ generated: takes.length }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}

/** Serves a generated page that mounts the project's timeline.ts with the smashcut runtime. */
function smashcutPlugin(media: MediaCache, root: string): Plugin {
  return {
    name: "smashcut",
    resolveId(id) {
      if (id === ENTRY_ID || id === RESOLVED_ENTRY_ID) return RESOLVED_ENTRY_ID;
      if (id === VOICES_ID || id === RESOLVED_VOICES_ID) return RESOLVED_VOICES_ID;
    },
    async load(id) {
      if (id === RESOLVED_VOICES_ID) {
        // Registered before timeline.ts runs, so voice() knows each line's real timing.
        const takes = await readTakes(root);
        return `import { setVoiceTakes } from "@smashcut/core";\nsetVoiceTakes(${JSON.stringify(takes)});\n`;
      }
      if (id !== RESOLVED_ENTRY_ID) return;
      return [
        `import "${VOICES_ID}";`,
        `import composition from "/timeline.ts";`,
        `import { mount } from "@smashcut/runtime";`,
        `if (!composition || !Array.isArray(composition.layers)) {`,
        `  throw new Error("timeline.ts must \`export default defineVideo({...})\`");`,
        `}`,
        `await mount(composition);`,
      ].join("\n");
    },
    configureServer(server) {
      // New, changed or deleted takes: re-read them and reload the page (debounced: a take is two files).
      let reload: ReturnType<typeof setTimeout> | undefined;
      const voiceDir = path.join(root, VOICE_DIR) + path.sep;
      const onFile = (file: string) => {
        if (!file.startsWith(voiceDir)) return;
        clearTimeout(reload);
        reload = setTimeout(() => {
          refreshVoices(server);
          server.ws.send({ type: "full-reload" });
        }, 150);
      };
      server.watcher.on("add", onFile).on("change", onFile).on("unlink", onFile);

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname.startsWith("/__smashcut/media/")) return serveMedia(media, url, req, res);
        if (url.pathname === "/__smashcut/voice/generate") {
          if (crossSite(req)) {
            res.statusCode = 403;
            res.end();
            return;
          }
          return serveVoiceGenerate(root, req, res);
        }
        if (url.pathname === "/__smashcut/notes") {
          if (crossSite(req)) {
            res.statusCode = 403;
            res.end();
            return;
          }
          return serveNotes(root, req, res);
        }
        if (url.pathname !== "/" && url.pathname !== "/index.html") return next();
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml(req.url ?? "/", HTML));
      });
    },
  };
}

/** Make the next page load re-read `voiceovers/`. */
function refreshVoices(server: ViteDevServer) {
  const mod = server.moduleGraph.getModuleById(RESOLVED_VOICES_ID);
  if (mod) server.moduleGraph.invalidateModule(mod);
}

export interface ServerOptions {
  port?: number;
  /** Render servers don't watch files or log requests. */
  mode: "dev" | "render";
}

export async function startServer(
  projectDir: string,
  opts: ServerOptions,
): Promise<{ server: ViteDevServer; url: string; media: MediaCache; root: string; refreshVoices: () => void }> {
  const root = path.resolve(projectDir);
  if (!existsSync(path.join(root, "timeline.ts"))) {
    throw new Error(`No timeline.ts found in ${root}`);
  }
  // API keys for voiceover providers can live in the video folder's .env.
  loadEnv(root);
  const render = opts.mode === "render";
  const media = new MediaCache(root);
  const alias = aliases(root);
  const server = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(root, ".smashcut", "vite"),
    clearScreen: false,
    logLevel: render ? "error" : "info",
    plugins: [smashcutPlugin(media, root)],
    oxc: { jsx: { runtime: "automatic" } },
    // A video folder can live anywhere: smashcut and React resolve from the folder's node_modules or the CLI's.
    resolve: { alias, dedupe: ["react", "react-dom"] },
    optimizeDeps: {
      // Discover dependencies up front so Vite never reloads the page mid-render.
      entries: ["timeline.ts", "lib/**/*.{ts,tsx}"],
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        ...(alias.three ? ["three"] : []),
      ],
      // smashcut's packages ship TypeScript sources; serve them as source, as in the monorepo, rather than
      // pre-bundling them (which, installed from npm, found `three` late and loaded a second React).
      exclude: Object.keys(alias).filter((name) => name.startsWith("@smashcut/")),
    },
    server: {
      port: opts.port ?? (render ? 0 : 3210),
      strictPort: false,
      hmr: !render,
      // The footage cache writes thousands of frames; don't watch it.
      watch: render ? null : { ignored: ["**/.smashcut/**", "**/out/**"] },
      fs: { allow: [root, ...Object.values(alias)] },
    },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite dev server did not report a URL");
  return { server, url, media, root, refreshVoices: () => refreshVoices(server) };
}
