import { chromium, type Browser, type Page } from "playwright";
import type { VideoMeta } from "@smashcut/runtime";

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    args: ["--hide-scrollbars", "--font-render-hinting=none", "--force-color-profile=srgb", "--ignore-gpu-blocklist"],
  });
}

export interface RenderPage {
  page: Page;
  meta: VideoMeta;
}

/** Open the video in render mode and wait until the runtime is mounted. */
export async function openVideo(
  browser: Browser,
  url: string,
  opts: { verbose?: boolean; fps?: number; scale?: number } = {},
): Promise<RenderPage> {
  const page = await browser.newPage({ deviceScaleFactor: opts.scale ?? 1 });
  page.on("console", (msg) => {
    if (msg.type() === "error" || opts.verbose) console.error(`[page:${msg.type()}] ${msg.text()}`);
  });
  await page.goto(new URL(opts.fps ? `/?render&fps=${opts.fps}` : "/?render", url).href);
  await page.waitForFunction(() => window.__smashcut?.ready || window.__smashcut_error, null, { timeout: 60_000 });
  const error = await page.evaluate(() => window.__smashcut_error);
  if (error) throw new Error(`Video failed to load:\n${error}`);
  const meta = await page.evaluate(() => window.__smashcut!.meta());
  await page.setViewportSize({ width: meta.width, height: meta.height });
  return { page, meta };
}

export async function captureFrame(page: Page, frame: number): Promise<Buffer> {
  await page.evaluate((f) => window.__smashcut!.seek(f), frame);
  return page.screenshot({ type: "png" });
}
