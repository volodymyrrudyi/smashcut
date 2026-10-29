import { clamp, framed, image, react, spring, type BaseProps, type FrameNode } from "@smashcut/core";
import { useClip } from "@smashcut/runtime";

/** A box in source-image pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Callout {
  /** Box drawn around something on the screenshot. */
  box: Box;
  /** Seconds into the clip. */
  at: number;
  /** Button pressed `CLICK_DELAY` after the box appears. */
  click?: Box;
}

interface ScreenOptions extends BaseProps {
  src: string;
  url: string;
  /** Source screenshot size in px: the frame's viewport, so call-outs are measured in these pixels. */
  imageSize: [width: number, height: number];
  /** Display width of the screenshot. Default 1400. */
  width?: number;
  callout?: Callout;
  color?: string;
}

/** Seconds between a call-out appearing and its button being clicked. */
export const CLICK_DELAY = 0.45;

/**
 * A screenshot in a browser frame whose viewport is the image's own pixel size, with an optional call-out box
 * and click ripple. Children lay out in source pixels and the frame scales them to `width`.
 */
export function screen({ src, url, imageSize, width = 1400, callout, color = "#7c3aed", ...props }: ScreenOptions): FrameNode {
  return framed([image(src), ...(callout ? [react(CalloutView, { callout, color, scale: width / imageSize[0] })] : [])], {
    chrome: "browser",
    url,
    width,
    viewport: imageSize,
    radius: 16,
    shadow: "0 30px 80px rgba(15, 23, 42, 0.2)",
    ...props,
  });
}

/**
 * Sits in the frame's source-pixel viewport but draws in display pixels (scaled back up by 1/scale), so line
 * widths and the ripple don't depend on the screenshot's resolution.
 */
function CalloutView({ callout, color, scale: k }: { callout: Callout; color: string; scale: number }) {
  const t = useClip();
  const show = spring(t, { delay: callout.at, damping: 12, stiffness: 140 });
  const click = clamp((t.local - callout.at - CLICK_DELAY) / 0.45);
  const { box, click: button } = callout;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: t.width * k, height: t.height * k, transform: `scale(${1 / k})`, transformOrigin: "0 0" }}>
      <div
        style={{
          position: "absolute",
          left: box.x * k - 8,
          top: box.y * k - 8,
          width: box.w * k + 16,
          height: box.h * k + 16,
          borderRadius: 12,
          border: `3px solid ${color}`,
          boxShadow: `0 0 0 8px ${color}22`,
          opacity: clamp(show),
          transform: `scale(${1.15 - 0.15 * show})`,
        }}
      />
      {button && click > 0 && click < 1 && (
        <div
          style={{
            position: "absolute",
            left: (button.x + button.w / 2) * k - 40,
            top: (button.y + button.h / 2) * k - 40,
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: `${color}55`,
            opacity: 1 - click,
            transform: `scale(${0.3 + click})`,
          }}
        />
      )}
    </div>
  );
}
