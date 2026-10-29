import { createContext, useContext } from "react";
import type { FrameContext, ResolvedComposition } from "@smashcut/core";

export const ClipContext = createContext<FrameContext | null>(null);
export const CompositionContext = createContext<ResolvedComposition | null>(null);

/** Time information for the clip this component is rendered in. */
export function useClip(): FrameContext {
  const ctx = useContext(ClipContext);
  if (!ctx) throw new Error("useClip() must be called inside a smashcut clip");
  return ctx;
}

export function useVideoConfig(): Pick<ResolvedComposition, "width" | "height" | "fps" | "durationInFrames"> {
  const comp = useContext(CompositionContext);
  if (!comp) throw new Error("useVideoConfig() must be called inside a smashcut video");
  return comp;
}
