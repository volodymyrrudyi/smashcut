import { frameStore } from "./store";

// Save the real clock before render mode replaces it. Readiness deadlines must keep advancing.
export const realNow = Date.now;
const EPOCH = Date.UTC(2025, 0, 1);
let installed = false;
let frameRate = 30;
let random = mulberry32(1);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reset for every seek, including repeated captures of the same frame and frame zero. */
export function resetFrameRandom(frame: number): void {
  random = mulberry32(frame + 1);
}

/** Called before importing timeline.ts, then updated with the resolved frame rate when mounted. */
export function prepareRender(fps = 30): void {
  frameRate = fps;
  if (installed) return;
  installed = true;
  const now = () => (frameStore.get() / frameRate) * 1000;
  Date.now = () => EPOCH + now();
  performance.now = now;
  Math.random = () => random();
  frameStore.subscribe(() => resetFrameRandom(frameStore.get()));
}
