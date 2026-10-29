import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { initProject } from "./init";
import { FROM_NPM } from "./paths";
import { MAX_FPS } from "./media";
import { formatTimeline } from "@smashcut/core";
import { inspectVideo, renderAudio, renderSheet, renderStill, renderVideo } from "./render";
import { startServer } from "./server";

const USAGE = `Usage:
  smashcut init <dir>                               Create a new video folder (anywhere on disk)
  smashcut dev <dir> [--port 3210]                  Preview the video in the browser
  smashcut still <dir> [--frame 0] [-o out.png]     Render a single frame to PNG
  smashcut sheet <dir> [--count 12 | --every 1] [--columns N] [-o out.png]
                                                Render a contact sheet: many frames, labelled, in one PNG
  smashcut inspect <dir> [--json]                   List every clip, caption and sound with its times
  smashcut render <dir> [-o out.mp4] [--concurrency N] [--from N] [--to N] [--crf 18]
                                                Render the video to MP4
  smashcut audio <dir> [-o out.wav]                 Export just the soundtrack

Options:
  --fps N         Override the timeline's frame rate (frames/ranges use this rate)
  --scale N       Pixel density, e.g. 2 renders a 1080p layout as 4K (default 1)
  -v, --verbose   Forward all browser console output`;

function int(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer, got "${value}"`);
  return n;
}

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      frame: { type: "string" },
      port: { type: "string" },
      concurrency: { type: "string", short: "c" },
      from: { type: "string" },
      to: { type: "string" },
      crf: { type: "string" },
      fps: { type: "string" },
      scale: { type: "string" },
      count: { type: "string" },
      every: { type: "string" },
      columns: { type: "string" },
      json: { type: "boolean" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, dir] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  if (!dir) throw new Error(`Missing video directory.\n\n${USAGE}`);
  const name = path.basename(path.resolve(dir));
  const fps = int(values.fps, "fps");
  if (fps !== undefined && (fps < 1 || fps > MAX_FPS)) throw new Error(`--fps must be between 1 and ${MAX_FPS}`);
  const scale = values.scale === undefined ? undefined : Number(values.scale);
  if (scale !== undefined && !(scale > 0)) throw new Error(`--scale must be a positive number, got "${values.scale}"`);
  const suffix = (fps ? `-${fps}fps` : "") + (scale && scale !== 1 ? `-${scale}x` : "");

  switch (command) {
    case "init": {
      const files = await initProject(dir);
      console.log(`Created ${path.resolve(dir)}:\n${files.map((f) => `  ${f}`).join("\n")}\n\nNext: ${FROM_NPM ? `cd ${dir} && npm install && npm run dev` : `smashcut dev ${dir}`}`);
      return;
    }
    case "dev": {
      const { url } = await startServer(dir, { mode: "dev", port: int(values.port, "port") });
      console.log(`\n  smashcut preview of "${name}": ${url}\n  space = play/pause, ←/→ = step (shift = 1s)\n`);
      return;
    }
    case "still": {
      const frame = int(values.frame, "frame") ?? 0;
      const output = values.output ?? path.join(dir, "out", `${name}${suffix}-${frame}.png`);
      await renderStill(dir, { frame, output, fps, scale, verbose: values.verbose });
      console.log(`Wrote ${output}`);
      return;
    }
    case "sheet": {
      const output = values.output ?? path.join(dir, "out", `${name}${suffix}-sheet.png`);
      const every = values.every === undefined ? undefined : Number(values.every);
      const { frames, fps: rate } = await renderSheet(dir, {
        output,
        count: int(values.count, "count"),
        every,
        columns: int(values.columns, "columns"),
        fps,
        verbose: values.verbose,
      });
      const times = frames.map((f) => `${(f / rate).toFixed(2)}s`).join(", ");
      console.log(`Wrote ${output}: ${frames.length} frames at ${times}`);
      return;
    }
    case "inspect": {
      const summary = await inspectVideo(dir, { fps, verbose: values.verbose });
      console.log(values.json ? JSON.stringify(summary, null, 2) : formatTimeline(summary));
      return;
    }
    case "audio": {
      const output = values.output ?? path.join(dir, "out", `${name}.wav`);
      const written = await renderAudio(dir, { frame: 0, output, verbose: values.verbose });
      console.log(written ? `Wrote ${output}` : "This video has no audio");
      return;
    }
    case "render": {
      const output = values.output ?? path.join(dir, "out", `${name}${suffix}.mp4`);
      const started = performance.now();
      await renderVideo(dir, {
        output,
        concurrency: int(values.concurrency, "concurrency") ?? Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2))),
        from: int(values.from, "from"),
        to: int(values.to, "to"),
        crf: int(values.crf, "crf") ?? 18,
        fps,
        scale,
        verbose: values.verbose,
      });
      console.log(`Wrote ${output} in ${((performance.now() - started) / 1000).toFixed(1)}s`);
      return;
    }
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`\nsmashcut: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
