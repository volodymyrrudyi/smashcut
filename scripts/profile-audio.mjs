import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { launchBrowser, openVideo } from "../packages/cli/src/browser.ts";
import { startServer } from "../packages/cli/src/server.ts";

// Renderer RSS is measured independently of the browser main thread on Linux, including typed-array backing
// storage and transport allocations. Each duration runs in a new browser to avoid retaining earlier heaps.
const { values, positionals } = parseArgs({ options: { legacy: { type: "boolean" } }, allowPositionals: true });
const durations = positionals.map(Number);
if (!durations.length) durations.push(10, 30, 60);
if (durations.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error("Durations must be positive seconds");
const results = [];
for (const duration of durations) {
  const root = await mkdtemp(path.join(os.tmpdir(), "smashcut-audio-profile-"));
  let server;
  let browser;
  try {
    await writeFile(path.join(root, "timeline.ts"), `
      import { defineVideo, solid, sound } from "@smashcut/core";
      export default defineVideo({ size:[64,64], duration:${duration}, loudness:false, layers:[solid("black")],
        audio:[sound({render(sr, length) {
          const left = new Float32Array(Math.round(sr*length));
          const right = new Float32Array(left.length);
          for (let i=0;i<left.length;i++) left[i]=right[i]=0.1*Math.sin(i*2*Math.PI*440/sr);
          return [left,right];
        }})] });`);
    const startedServer = await startServer(root, { mode: "render" });
    server = startedServer.server;
    browser = await launchBrowser();
    const { page } = await openVideo(browser, startedServer.url);
    const cdp = await browser.newBrowserCDPSession();
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    const pids = processInfo.filter((p) => p.type === "renderer").map((p) => p.id);
    const rendererRss = async () => {
      if (process.platform !== "linux") return null;
      const values = await Promise.all(pids.map(async (pid) => {
        const status = await readFile(`/proc/${pid}/status`, "utf8");
        return Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024;
      }));
      return values.reduce((a, b) => a + b, 0);
    };
    await server.waitForRequestsIdle();
    const baseline = { renderer: await rendererRss(), node: process.memoryUsage().rss };
    const peak = { ...baseline };
    let sampling = false;
    let sampleJob = Promise.resolve();
    const timer = setInterval(() => {
      if (sampling) return;
      sampling = true;
      sampleJob = (async () => {
        try {
          const rss = await rendererRss();
          if (rss !== null) peak.renderer = Math.max(peak.renderer ?? 0, rss);
          peak.node = Math.max(peak.node, process.memoryUsage().rss);
        } finally { sampling = false; }
      })();
    }, 10);
    const started = performance.now();
    let bytes;
    let mode;
    try {
      const hasStreaming = !values.legacy && await page.evaluate(() => typeof window.__smashcut.prepareAudio === "function");
      mode = hasStreaming ? "chunked" : "whole-payload";
      if (hasStreaming) {
        // Use this same page: a fresh renderer would escape the RSS sampler above.
        const meta = await page.evaluate(() => window.__smashcut.prepareAudio(48000));
        bytes = 0;
        for (let offset = 0; meta && offset < meta.samples; offset += 32768) {
          const chunk = await page.evaluate(({ offset }) => window.__smashcut.audioChunk(offset, 32768), { offset });
          bytes += Buffer.from(chunk, "base64").length;
        }
        await page.evaluate(() => window.__smashcut.releaseAudio());
      } else {
        const audio = await page.evaluate(() => window.__smashcut.audio(48000));
        bytes = Buffer.from(audio ?? "", "base64").length;
      }
      peak.renderer = Math.max(peak.renderer ?? 0, await rendererRss() ?? 0);
      peak.node = Math.max(peak.node, process.memoryUsage().rss);
    } finally { clearInterval(timer); await sampleJob; }
    results.push({ mode, duration, pcmBytes: bytes, elapsedMs: Math.round(performance.now() - started), baselineRss: baseline, peakRss: peak,
      additionalRss: { renderer: peak.renderer === null ? null : peak.renderer - baseline.renderer, node: peak.node - baseline.node } });
  } finally {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ platform: process.platform, node: process.version, sampleRate: 48000, samplingIntervalMs: 10, results }, null, 2));
