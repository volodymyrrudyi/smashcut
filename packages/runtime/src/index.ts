export { mount, type SmashcutBridge, type VideoMeta } from "./mount";
export { useClip, useVideoConfig } from "./context";
export { delayRender } from "./ready";

/** Renderer bootstrap; normally called by the CLI before loading the timeline. */
export { prepareRender } from "./determinism";
