import type { Typing } from "@smashcut/core";
import { useClip } from "@smashcut/runtime";

// Layout in the editor's own pixels (the window's content box), shared with the timeline so the camera can
// follow the caret.
export const EDITOR = { padding: 48, gutter: 70, fontSize: 34, line: 54, char: 20.5 };

/** Editor-pixel centre of character `col` on line `line`. */
export const caretAt = (line: number, col: number) => ({
  x: EDITOR.padding + EDITOR.gutter + (col + 0.5) * EDITOR.char,
  y: EDITOR.padding + (line + 0.5) * EDITOR.line,
});

const COLORS = { keyword: "#f472b6", fn: "#22d3ee", string: "#a3e635", number: "#fbbf24", plain: "#e2e8f0", punct: "#94a3b8" };
const TOKEN = /("[^"\n]*"?)|\b(export|default|const|import|from)\b|([A-Za-z_]\w*)(?=\()|(\d+)|([{}[\](),:])/g;

/** One line with naive TypeScript colouring: enough for strings, keywords, calls and numbers. */
function Line({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const color = m[1] ? COLORS.string : m[2] ? COLORS.keyword : m[3] ? COLORS.fn : m[4] ? COLORS.number : COLORS.punct;
    out.push(
      <span key={m.index} style={{ color }}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** A code editor: fixed `before` and `after`, with `entry` typed in between. */
export function Editor({ before, entry, after }: { before: string; entry: Typing; after: string }) {
  const t = useClip();
  const lines = (before + entry.text(t) + after).split("\n");
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: EDITOR.padding,
        background: "#0b0d12",
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: EDITOR.fontSize,
        lineHeight: `${EDITOR.line}px`,
        color: COLORS.plain,
        whiteSpace: "pre",
      }}
    >
      {lines.map((line, i) => (
        <div key={i}>
          <span style={{ display: "inline-block", width: EDITOR.gutter, color: "#475569" }}>{i + 1}</span>
          <Line text={line} />
        </div>
      ))}
    </div>
  );
}
