import { rng } from "./audio/synth";
import { keyInfo } from "./keys";
import type { FrameContext } from "./types";

export interface TypingOptions {
  /** Clip-local seconds when the first key is pressed. Default 0. */
  at?: number;
  /** Average characters per second. Default 12 (a quick typist). */
  cps?: number;
  /** 0..1 random variation of each interval. Default 0.35. */
  jitter?: number;
  /** Seed for the timing variation; the same seed always types the same way. */
  seed?: number;
  /** Appended while the field is focused: solid while typing, blinking otherwise. Default none. */
  caret?: string;
  /** Clip-local seconds the caret shows from / until. Default: 0.4 s around the typing. */
  focus?: [from: number, to: number];
  /** Mistakes the typist makes and corrects with backspace. For a mistake that isn't caught, type the wrong text. */
  typos?: Typo[];
}

export interface Typo {
  /** Index in `content` where the wrong characters are typed instead of the right ones. */
  at: number;
  /** What gets typed by mistake, e.g. "4" for a fat-fingered 3. */
  wrong: string;
  /** Correct characters typed after the mistake before it's noticed (they get deleted too). Default 0. */
  notice?: number;
}

/** The backspace key, as it appears in `Keystroke.char`. */
export const BACKSPACE = "\b";

export interface Keystroke {
  /** Clip-local seconds. */
  time: number;
  char: string;
}

export interface Typing {
  /** The text as finally typed (mistakes corrected). */
  content: string;
  /** Clip-local seconds of the first and last keystroke. */
  at: number;
  end: number;
  /** Every key press in order, including mistakes and backspaces (`BACKSPACE`). */
  keystrokes: Keystroke[];
  /** Number of keys pressed `local` seconds into the clip. */
  count(local: number): number;
  /** True while the field is focused (caret shown). */
  focused(local: number): boolean;
  /** The field's text `local` seconds into the clip, without the caret. */
  value(local: number): string;
  /** Typed text plus caret: pass it straight to `text()`, or call it from a React component with `useClip()`. */
  text: (t: FrameContext) => string;
}

const SLOW_AFTER = /[\s.,;:!?@\-/]/;

/** How the finger travel between two keys changes the interval: alternating hands is fastest. */
function rhythm(prev: string, next: string): number {
  if (prev.toLowerCase() === next.toLowerCase()) return 0.85; // double letters are a quick re-tap
  const a = keyInfo(prev);
  const b = keyInfo(next);
  if (a.finger === 1 || b.finger === 1) return 1; // the thumb on space works independently
  if (a.hand !== b.hand) return 0.82;
  if (a.finger === b.finger) return 1.4; // same finger has to move to another key
  return 1.05;
}

/** A human-paced typing animation of `content`. Chain fields with `{ at: previous.end + 0.5 }`. */
export function typing(content: string, opts: TypingOptions = {}): Typing {
  const at = opts.at ?? 0;
  const base = 1 / (opts.cps ?? 12);
  const jitter = opts.jitter ?? 0.35;
  const random = rng(opts.seed ?? 1);
  const chars = [...content];
  const typos = new Map((opts.typos ?? []).map((t) => [t.at, t]));

  // The key sequence: every typo becomes wrong keys (plus any typed before noticing), backspaces, then a retype.
  const presses: { char: string; pause?: number; fast?: boolean }[] = [];
  chars.forEach((char, i) => {
    const typo = typos.get(i);
    if (typo) {
      const notice = Math.min(typo.notice ?? 0, chars.length - i - 1);
      const mistaken = [...typo.wrong, ...chars.slice(i + 1, i + 1 + notice)];
      mistaken.forEach((c) => presses.push({ char: c }));
      // A beat to notice, then quick backspaces and a slightly hesitant retype.
      mistaken.forEach((_, k) => presses.push({ char: BACKSPACE, pause: k === 0 ? 0.32 : 0, fast: true }));
      presses.push({ char, pause: 0.12 });
      return;
    }
    presses.push({ char });
  });

  const keystrokes: Keystroke[] = [];
  let time = at;
  presses.forEach((press, i) => {
    if (i > 0) {
      const prev = presses[i - 1].char;
      let gap = base * (press.fast ? 0.55 : rhythm(prev, press.char)) * (1 + jitter * (random() * 2 - 1));
      // People pause briefly at word and punctuation boundaries.
      if (SLOW_AFTER.test(prev)) gap *= 1.6;
      time += gap + (press.pause ?? 0);
    }
    keystrokes.push({ time, char: press.char });
  });
  const end = time;
  const [focusFrom, focusTo] = opts.focus ?? [at - 0.4, end + 0.4];

  const count = (local: number) => {
    let n = 0;
    while (n < keystrokes.length && keystrokes[n].time <= local) n++;
    return n;
  };
  const focused = (local: number) => local >= focusFrom && local <= focusTo;
  const caretOn = (local: number) => {
    if (!focused(local)) return false;
    // Solid while keys are going down, blinking at ~1 Hz while idle.
    if (local >= at - 0.05 && local <= end + 0.15) return true;
    return Math.floor((local - focusFrom) * 2) % 2 === 0;
  };

  const value = (local: number) => {
    const typed: string[] = [];
    for (const k of keystrokes.slice(0, count(local))) {
      if (k.char === BACKSPACE) typed.pop();
      else typed.push(k.char);
    }
    return typed.join("");
  };

  return {
    content,
    at,
    end,
    keystrokes,
    count,
    focused,
    value,
    text: (t) => (opts.caret && caretOn(t.local) ? value(t.local) + opts.caret : value(t.local)),
  };
}
