// Where a key sits on a QWERTY board and which finger presses it (standard touch typing).
// Shared by the typing schedule (rhythm) and the keyboard synth (force, strike, stereo position).

export type Hand = "left" | "right";
/** 1 = thumb, 2 = index, 3 = middle, 4 = ring, 5 = pinky. */
export type Finger = 1 | 2 | 3 | 4 | 5;

export interface KeyInfo {
  hand: Hand;
  finger: Finger;
  /** 0 = number row … 3 = bottom row, 4 = space / other. */
  row: number;
  /** -0.35 (left edge of the board) .. 0.35 (right edge), as heard from the typist's seat. */
  pan: number;
}

const ROWS = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];
const SHIFTED = ['~!@#$%^&*()_+', "QWERTYUIOP{}|", 'ASDFGHJKL:"', "ZXCVBNM<>?"];
// Finger per column, left pinky to right pinky. Index fingers cover two columns each.
const COLUMN_FINGERS: [Hand, Finger][] = [
  ["left", 5], ["left", 5], ["left", 4], ["left", 3], ["left", 2], ["left", 2],
  ["right", 2], ["right", 2], ["right", 3], ["right", 4], ["right", 5], ["right", 5], ["right", 5],
];

export function keyInfo(char: string): KeyInfo {
  if (char === " ") return { hand: "right", finger: 1, row: 4, pan: 0 };
  if (char === "\n") return { hand: "right", finger: 5, row: 2, pan: 0.3 };
  // Backspace: top-right corner of the board.
  if (char === "\b") return { hand: "right", finger: 5, row: 0, pan: 0.35 };
  for (let r = 0; r < ROWS.length; r++) {
    let col = ROWS[r].indexOf(char);
    if (col < 0) col = SHIFTED[r].indexOf(char);
    if (col < 0) continue;
    // Letter rows are staggered half a key right of the number row, so their column 0 is the number row's column 1.
    const [hand, finger] = COLUMN_FINGERS[Math.min(COLUMN_FINGERS.length - 1, col + (r === 0 ? 0 : 1))];
    return { hand, finger, row: r, pan: ((col + r * 0.4) / 12 - 0.5) * 0.7 };
  }
  // Anything else (accents, symbols off the main block): treat as a right-hand index key.
  return { hand: "right", finger: 2, row: 2, pan: 0.1 };
}
