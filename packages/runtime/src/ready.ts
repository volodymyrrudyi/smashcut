import { realNow } from "./determinism";

const pending = new Set<Promise<unknown>>();
let failure: unknown;
let failed = false;
const failureListeners = new Set<() => void>();

/** Hold capture until this work finishes. A failed asset makes subsequent captures fail too. */
export function delayRender<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  promise.then(
    () => pending.delete(promise),
    (error) => {
      pending.delete(promise);
      if (!failed) failure = error;
      failed = true;
      failureListeners.forEach((listener) => listener());
    },
  );
  return promise;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function waitUntilReady(timeoutMs = 30_000): Promise<void> {
  const deadline = realNow() + timeoutMs;
  const checkFailure = () => {
    if (failed) throw new Error(`[smashcut] Asynchronous render failed: ${failure instanceof Error ? failure.message : String(failure)}`, { cause: failure });
  };
  const withinDeadline = async (work: Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onFailure: () => void = () => {};
    const rejection = new Promise<never>((_, reject) => {
      onFailure = () => {
        try { checkFailure(); } catch (error) { reject(error); }
      };
      failureListeners.add(onFailure);
    });
    try {
      await Promise.race([
        work,
        rejection,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`[smashcut] Render readiness timed out after ${timeoutMs}ms (${pending.size} pending delayRender call(s))`)), Math.max(0, deadline - realNow()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
      failureListeners.delete(onFailure);
    }
    checkFailure();
  };
  checkFailure();
  await withinDeadline(document.fonts.ready);
  // Painting can schedule more asynchronous work. Drain it before declaring the frame ready.
  do {
    while (pending.size > 0) await withinDeadline(Promise.allSettled([...pending]));
    await withinDeadline(nextFrame());
    await withinDeadline(nextFrame());
  } while (pending.size > 0);
  checkFailure();
}
