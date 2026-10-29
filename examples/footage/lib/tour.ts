// The scripted walk through site/index.html (a made-up task board) that capture.ts records into
// assets/tour.mp4. The timeline cuts the recording with `trim` and times its sound effects from these numbers.

export const TOUR = {
  page: "site/index.html",
  viewport: { width: 1600, height: 1000 },
  /** Device pixel ratio: the 1600×1000 layout is recorded at 2400×1500. */
  scale: 1.5,
  fps: 30,
  duration: 15.0,
};

/** Seconds into the recording at which each `window.tour.<step>()` of the page is called. */
export const STEPS = [
  { at: 2.2, step: "newTask" }, // "+ New task": the drawer slides in, title and label are typed
  { at: 6.8, step: "create" }, // "Create task": the card lands on top of "To do"
  { at: 8.2, step: "advance" }, // the card moves to "In progress", then to "Done" 1.5 s later
  { at: 11.4, step: "insights" }, // the Insights tab: views slide, bars and counters grow
] as const;

/**
 * When the page's typing starts and stops, for the key sounds: the drawer opens (650 ms), then ~1.5 s of title,
 * a short pause and ~0.45 s of label (site/index.html types at ~14 characters a second).
 */
export const TYPED = { from: STEPS[0].at + 0.85, to: STEPS[0].at + 3.25 };
/** The page's view and drawer transitions: 700 ms / 600 ms, cubic-bezier(0.65, 0, 0.35, 1). */
export const VIEW_MS = 700;
