import type { CSSProperties } from "react";
import { clamp, cueAt, type FrameContext, type SubtitlePreset, type SubtitlesNode, type TextStyle, type Word } from "@smashcut/core";

/** Seconds a cue takes to fade in and out. */
const FADE = 0.12;
const FONT = "Inter, system-ui, -apple-system, sans-serif";

const PRESETS: Record<SubtitlePreset, CSSProperties> = {
  clean: {
    fontSize: 52,
    fontWeight: 600,
    color: "#fff",
    textShadow: "0 0 3px #000, 0 2px 8px rgba(0,0,0,0.85), 0 0 24px rgba(0,0,0,0.5)",
    lineHeight: 1.3,
  },
  boxed: { fontSize: 46, fontWeight: 600, color: "#fff", lineHeight: 1.65 },
  bold: {
    fontSize: 78,
    fontWeight: 900,
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: -1,
    lineHeight: 1.12,
    WebkitTextStroke: "12px #000",
    paintOrder: "stroke fill",
  },
  highlight: {
    fontSize: 78,
    fontWeight: 900,
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: -1,
    // The outline and the active word's pop both eat into the gaps between words.
    wordSpacing: "0.14em",
    lineHeight: 1.12,
    WebkitTextStroke: "10px #000",
    paintOrder: "stroke fill",
  },
};

/** The text-level parts of a style override; box properties are applied separately. */
function overrides({ maxWidth: _w, background: _b, padding: _p, borderRadius: _r, ...text }: TextStyle = {}): CSSProperties {
  return text as CSSProperties;
}

/** A subtitles node: the cue at the current time, faded at its edges, in the chosen preset. */
export function SubtitlesView({ node, t }: { node: SubtitlesNode; t: FrameContext }) {
  const time = t.local + node.from;
  const cue = cueAt(node.cues, time);
  if (!cue) return null;
  const opacity = clamp(Math.min((time - cue.start) / FADE, (cue.end - time) / FADE));
  const social = node.preset === "bold" || node.preset === "highlight";
  // Social captions pop in a little as each cue lands.
  const pop = social ? 0.92 + 0.08 * clamp((time - cue.start) / FADE) : 1;
  const style: CSSProperties = {
    fontFamily: FONT,
    textAlign: "center",
    maxWidth: node.style?.maxWidth ?? t.width * 0.8,
    whiteSpace: "pre-wrap",
    opacity,
    transform: `scale(${pop})`,
    ...PRESETS[node.preset],
    ...overrides(node.style),
  };

  if (node.preset === "highlight") {
    return (
      <div style={style}>
        {cue.words.map((w, i) => (
          <HighlightWord key={i} word={w} time={time} color={node.highlight ?? "#facc15"} last={i === cue.words.length - 1} />
        ))}
      </div>
    );
  }
  if (node.preset === "boxed") {
    const box: CSSProperties = {
      background: node.style?.background ?? "rgba(10, 12, 18, 0.78)",
      padding: node.style?.padding ?? "6px 18px",
      borderRadius: node.style?.borderRadius ?? 8,
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
    };
    return (
      <div style={style}>
        {cue.text.split("\n").map((line, i) => (
          <div key={i}>
            <span style={box}>{line}</span>
          </div>
        ))}
      </div>
    );
  }
  return <div style={style}>{cue.text}</div>;
}

function HighlightWord({ word, time, color, last }: { word: Word; time: number; color: string; last: boolean }) {
  const active = time >= word.start && time < word.end;
  const enter = clamp((time - word.start) / 0.08);
  return (
    <>
      <span
        style={{
          display: "inline-block",
          color: active ? color : undefined,
          transform: `scale(${active ? 1 + 0.06 * enter : 1})`,
        }}
      >
        {word.text}
      </span>
      {word.br ? "\n" : last ? "" : " "}
    </>
  );
}
