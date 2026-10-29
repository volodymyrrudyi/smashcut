import { asset, framed, video, type BaseProps, type FrameNode, type VideoNode } from "@smashcut/core";
import { TOUR } from "./tour";

/** Layout width of the browser window's content; scale the returned frame to resize it. */
const WIDTH = 1280;

type FootageOptions = Pick<VideoNode, "trim" | "playbackRate" | "loop" | "volume" | "muted">;

/** A slice of the task-board recording (assets/tour.mp4), playing inside a browser window. */
export function browser(footage: FootageOptions, opts: BaseProps & { url?: string } = {}): FrameNode {
  const { url = "example.com/board", ...props } = opts;
  return framed(
    // A window that outlasts its slice holds the last frame (or wraps around with `loop`).
    video(asset("tour.mp4"), { ...footage, duration: props.duration }),
    {
      chrome: "browser",
      url,
      width: WIDTH,
      height: (WIDTH * TOUR.viewport.height) / TOUR.viewport.width,
      radius: 16,
      ...props,
    },
  );
}
