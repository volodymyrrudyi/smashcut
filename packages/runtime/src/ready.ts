const pending = new Set<Promise<unknown>>();
// Captured before render mode freezes Date.now to the current frame's time.
const realNow = Date.now;

/**
 * Hold the current frame until `promise` settles. The renderer only captures a frame once
 * every pending promise is done, so use this for anything loaded asynchronously.
 */
export function delayRender<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  const done = () => pending.delete(promise);
  promise.then(done, done);
  return promise;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function waitUntilReady(timeoutMs = 30_000): Promise<void> {
  const deadline = realNow() + timeoutMs;
  await document.fonts.ready;
  while (pending.size > 0) {
    const remaining = deadline - realNow();
    const timedOut = await Promise.race([
      Promise.allSettled([...pending]).then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), Math.max(0, remaining))),
    ]);
    if (timedOut) throw new Error(`[smashcut] ${pending.size} delayRender() call(s) timed out after ${timeoutMs}ms`);
  }
  // Let the browser lay out and paint the committed frame.
  await nextFrame();
  await nextFrame();
}
