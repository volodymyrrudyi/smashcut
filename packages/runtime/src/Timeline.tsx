import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { clipLabel, soundEnd, type AudioClip, type Composition, type ResolvedClip, type ResolvedComposition, type Stereo } from "@smashcut/core";

/** A review note pinned to a moment, saved to `.smashcut/notes.json` by the dev server. */
export interface Note {
  id: string;
  /** Seconds and frame on the timeline. */
  time: number;
  frame: number;
  text: string;
  /** What was on screen and audible at that moment, so the note can be understood without the preview. */
  context: string[];
  created: string;
}

interface Bar {
  key: string;
  start: number;
  end: number;
  label: string;
  color: string;
  details: [string, string][];
}

interface Row {
  key: string;
  label: string;
  depth: number;
  bars: Bar[];
  /** Clip path to expand / collapse, when the row has children. */
  toggle?: string;
  expanded?: boolean;
  group: "visual" | "sound" | "cues";
}

const LABEL_W = 240;
const ROW_H = 26;
const RULER_H = 26;
const WAVE_H = 46;
const NOTES_H = 22;
const PANEL_W = 320;
const MAX_PPS = 600;
const UI = {
  bg: "#18181b",
  panel: "#1f1f23",
  line: "#2e2e33",
  text: "#e4e4e7",
  muted: "#a1a1aa",
  playhead: "#f43f5e",
  note: "#fbbf24",
};
const KIND_COLORS: Record<string, string> = {
  solid: "#64748b",
  image: "#0ea5e9",
  video: "#06b6d4",
  text: "#a78bfa",
  react: "#22c55e",
  group: "#475569",
  series: "#334155",
  frame: "#f59e0b",
  subtitles: "#ec4899",
  decor: "#78716c",
  audio: "#f97316",
  music: "#eab308",
  cue: "#db2777",
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const short = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function clipDetails(clip: ResolvedClip, fps: number): [string, string][] {
  const { node } = clip;
  const start = clip.start / fps;
  const end = (clip.start + clip.duration) / fps;
  const d: [string, string][] = [
    ["kind", node.kind],
    ["path", clip.path],
    ["start", `${fmt(start)}  (frame ${clip.start})`],
    ["end", `${fmt(end)}  (frame ${clip.start + clip.duration})`],
    ["duration", `${(clip.duration / fps).toFixed(2)} s`],
  ];
  if (clip.transitionIn) d.push(["transition in", `${clip.transitionIn.spec.type} ${(clip.transitionIn.frames / fps).toFixed(2)} s`]);
  if (clip.transitionOut) d.push(["transition out", `${clip.transitionOut.spec.type} ${(clip.transitionOut.frames / fps).toFixed(2)} s`]);
  if (node.kind === "text" && typeof node.text === "string") d.push(["text", node.text]);
  if (node.kind === "image" || node.kind === "video") d.push(["src", node.src]);
  if (node.kind === "video" && node.trim) d.push(["trim", node.trim.join(" – ")]);
  if (node.kind === "react") d.push(["props", short(JSON.stringify(node.props, (_, v) => (typeof v === "function" ? "ƒ" : v)) ?? "", 200)]);
  if (node.enter) d.push(["enter", typeof node.enter === "string" ? node.enter : node.enter.type]);
  if (node.exit) d.push(["exit", typeof node.exit === "string" ? node.exit : node.exit.type]);
  return d;
}

interface TimelineProps {
  comp: ResolvedComposition;
  composition: Composition;
  frame: number;
  playing: boolean;
  /** Mixed soundtrack for the waveform: undefined while mixing, null when silent. */
  mix: Stereo | null | undefined;
  onSeek: (frame: number) => void;
  /** Bumped by the preview's N shortcut to focus the note box. */
  focusNote: number;
}

/** The dev preview's timeline: every clip, sound, subtitle cue and review note, with seeking and notes. */
export function Timeline({ comp, composition, frame, playing, mix, onSeek, focusNote }: TimelineProps) {
  const total = comp.durationInFrames / comp.fps;
  const scroller = useRef<HTMLDivElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  const [viewW, setViewW] = useState(800);
  const [pps, setPps] = useState<number | null>(null); // pixels per second; null = fit to width
  const [selected, setSelected] = useState<Bar | Note | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Open the top level and any series (scenes); keep deeper groups collapsed.
    const open = new Set<string>();
    const walk = (c: ResolvedClip, depth: number) => {
      if (c.children.length && (depth === 0 || c.node.kind === "series")) open.add(c.path);
      c.children.forEach((k) => walk(k, depth + 1));
    };
    comp.layers.forEach((c) => walk(c, 0));
    return open;
  });

  useLayoutEffect(() => {
    const el = scroller.current!;
    const measure = () => setViewW(Math.max(100, el.clientWidth - LABEL_W - 12));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch("/__smashcut/notes")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Note[]) => setNotes(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (focusNote) noteInput.current?.focus();
  }, [focusNote]);

  const fit = viewW / total;
  const scale = pps ?? Math.max(4, fit);
  const width = total * scale;
  const x = (seconds: number) => seconds * scale;

  const rows = useMemo(() => {
    const visual: Row[] = [];
    const cues: Row[] = [];
    const walk = (clip: ResolvedClip, depth: number) => {
      const label = clipLabel(clip.node);
      visual.push({
        key: clip.path,
        label,
        depth,
        group: "visual",
        toggle: clip.children.length ? clip.path : undefined,
        expanded: expanded.has(clip.path),
        bars: [
          {
            key: clip.path,
            start: clip.start / comp.fps,
            end: (clip.start + clip.duration) / comp.fps,
            label,
            color: KIND_COLORS[clip.node.kind] ?? "#64748b",
            details: clipDetails(clip, comp.fps),
          },
        ],
      });
      const node = clip.node;
      if (node.kind === "subtitles") {
        const t0 = clip.start / comp.fps;
        const t1 = (clip.start + clip.duration) / comp.fps;
        cues.push({
          key: `cues:${clip.path}`,
          label: `captions (${node.preset})`,
          depth: 0,
          group: "cues",
          bars: node.cues
            .map((cue, i) => ({ cue, i, start: Math.max(t0, t0 + cue.start - node.from), end: Math.min(t1, t0 + cue.end - node.from) }))
            .filter((c) => c.end > c.start)
            .map(({ cue, i, start, end }) => ({
              key: `cue:${clip.path}:${i}`,
              start,
              end,
              label: cue.text.replace(/\n/g, " "),
              color: KIND_COLORS.cue,
              details: [
                ["caption", cue.text],
                ["start", fmt(start)],
                ["end", fmt(end)],
                ["file time", `${cue.start.toFixed(2)} – ${cue.end.toFixed(2)} s`],
              ],
            })),
        });
      }
      if (expanded.has(clip.path)) clip.children.forEach((c) => walk(c, depth + 1));
    };
    comp.layers.forEach((c) => walk(c, 0));

    // One row per kind of sound, music first.
    const byLabel = new Map<string, AudioClip[]>();
    for (const clip of composition.audio ?? []) {
      const label = clip.label ?? "sound";
      byLabel.set(label, [...(byLabel.get(label) ?? []), clip]);
    }
    const labels = [...byLabel.keys()].sort((a, b) => (a === "music" ? -1 : b === "music" ? 1 : 0));
    const sounds: Row[] = labels.map((label) => ({
      key: `sound:${label}`,
      label: `♪ ${label} (${byLabel.get(label)!.length})`,
      depth: 0,
      group: "sound",
      bars: byLabel.get(label)!.map((clip, i) => {
        const details: [string, string][] = [
          ["sound", label],
          ["start", fmt(clip.at)],
          ["end", fmt(soundEnd(clip, total))],
          ["volume", String(clip.volume)],
        ];
        if (clip.duck) details.push(["duck", String(clip.duck)]);
        if (clip.fadeIn || clip.fadeOut) details.push(["fades", `in ${clip.fadeIn} s, out ${clip.fadeOut} s`]);
        return {
          key: `sound:${label}:${i}`,
          start: clip.at,
          end: soundEnd(clip, total),
          label,
          color: label === "music" ? KIND_COLORS.music : KIND_COLORS.audio,
          details,
        };
      }),
    }));
    return [...visual, ...cues, ...sounds];
  }, [comp, composition, expanded, total]);

  /** What's on screen and audible at `at` seconds; stored with a note so it reads on its own. */
  const contextAt = (at: number): string[] => {
    const f = Math.round(at * comp.fps);
    const seen: string[] = [];
    const walk = (clip: ResolvedClip, trail: string[]) => {
      if (f < clip.start || f >= clip.start + clip.duration) return;
      const here = [...trail, clipLabel(clip.node)];
      const active = clip.children.filter((c) => f >= c.start && f < c.start + c.duration);
      if (!active.length) seen.push(here.join(" › "));
      else active.forEach((c) => walk(c, here));
    };
    comp.layers.forEach((c) => walk(c, []));
    const sounds = (composition.audio ?? []).filter((a) => at >= a.at && at < soundEnd(a, total)).map((a) => `♪ ${a.label ?? "sound"}`);
    const captions = rows
      .filter((r) => r.group === "cues")
      .flatMap((r) => r.bars.filter((b) => at >= b.start && at < b.end).map((b) => `caption: ${b.label}`));
    return [...seen.slice(0, 16), ...captions, ...new Set(sounds)];
  };

  const save = (next: Note[]) => {
    setNotes(next);
    fetch("/__smashcut/notes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => {});
  };
  const addNote = () => {
    const text = draft.trim();
    if (!text) return;
    const at = frame / comp.fps;
    const note: Note = { id: `${Date.now()}`, time: Number(at.toFixed(3)), frame, text, context: contextAt(at), created: new Date().toISOString() };
    save([...notes, note].sort((a, b) => a.time - b.time));
    setDraft("");
    setSelected(note);
    noteInput.current?.blur();
  };

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const px = LABEL_W + x(frame / comp.fps);
    if (px > el.scrollLeft + el.clientWidth - 40 || px < el.scrollLeft + LABEL_W) el.scrollLeft = px - LABEL_W - 40;
  });

  // ⌘ / Ctrl + wheel zooms around the cursor. A native listener, because React's wheel handlers are passive and
  // can't stop the browser's own page zoom.
  const zoom = useRef({ scale, fit });
  zoom.current = { scale, fit };
  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const offset = e.clientX - rect.left - LABEL_W;
      const at = (offset + el.scrollLeft) / zoom.current.scale;
      const next = Math.min(MAX_PPS, Math.max(zoom.current.fit, zoom.current.scale * Math.exp(-e.deltaY * 0.002)));
      setPps(next);
      requestAnimationFrame(() => (el.scrollLeft = at * next - offset));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Click / drag anywhere on the tracks to seek.
  const dragging = useRef(false);
  const seekAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - LABEL_W;
    if (px < 0) return;
    onSeek(Math.max(0, Math.min(comp.durationInFrames - 1, Math.round((px / scale) * comp.fps))));
  };

  const now = frame / comp.fps;
  const step = tickStep(scale);
  const contentH = RULER_H + WAVE_H + NOTES_H + rows.length * ROW_H;
  const sticky: CSSProperties = { position: "sticky", left: 0, zIndex: 2, width: LABEL_W, flex: "none", boxSizing: "border-box", background: UI.panel, borderRight: `1px solid ${UI.line}` };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: UI.bg, color: UI.text, font: "12px system-ui, sans-serif", borderTop: `1px solid ${UI.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: `1px solid ${UI.line}` }}>
        <span style={{ color: UI.muted }}>Zoom</span>
        <button onClick={() => setPps(Math.max(fit, scale / 1.5))} style={buttonStyle}>
          −
        </button>
        <button onClick={() => setPps(Math.min(MAX_PPS, scale * 1.5))} style={buttonStyle}>
          +
        </button>
        <button onClick={() => setPps(null)} style={buttonStyle}>
          Fit
        </button>
        <span style={{ marginLeft: 12, color: UI.muted }}>Note at {fmt(now)}</span>
        <input
          ref={noteInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Typing a note must not trigger the player's shortcuts.
            e.stopPropagation();
            if (e.key === "Enter") addNote();
            if (e.key === "Escape") noteInput.current?.blur();
          }}
          placeholder="What's wrong here? (N to focus, Enter to save)"
          style={{ flex: 1, minWidth: 200, padding: "5px 8px", background: UI.bg, color: UI.text, border: `1px solid ${UI.line}`, borderRadius: 6 }}
        />
        <button onClick={addNote} style={{ ...buttonStyle, background: UI.note, color: "#111" }}>
          Add note
        </button>
        <span style={{ color: UI.muted }}>{notes.length} saved · .smashcut/notes.json</span>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div ref={scroller} style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <div
            style={{ position: "relative", width: LABEL_W + width + 12, height: contentH }}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              seekAt(e);
            }}
            onPointerMove={(e) => dragging.current && seekAt(e)}
            onPointerUp={() => (dragging.current = false)}
          >
            {/* Ruler */}
            <div style={{ display: "flex", height: RULER_H, position: "sticky", top: 0, zIndex: 3, background: UI.panel, borderBottom: `1px solid ${UI.line}` }}>
              <div style={{ ...sticky, zIndex: 4, padding: "5px 8px", color: UI.muted }}>
                {fmt(now)} · frame {frame}
              </div>
              <div style={{ position: "relative", width }}>
                {Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step).map((s) => (
                  <div key={s} style={{ position: "absolute", left: x(s), top: 0, height: RULER_H, borderLeft: `1px solid ${UI.line}`, paddingLeft: 3, color: UI.muted, fontSize: 11 }}>
                    {step >= 1 ? `${s}s` : s.toFixed(step >= 0.5 ? 1 : 2)}
                  </div>
                ))}
              </div>
            </div>

            {/* Mixed soundtrack */}
            <div style={{ display: "flex", height: WAVE_H, borderBottom: `1px solid ${UI.line}` }}>
              <div style={{ ...sticky, padding: "14px 8px", color: UI.muted }}>♫ mix</div>
              <Waveform mix={mix} width={width} height={WAVE_H} />
            </div>

            {/* Notes */}
            <div style={{ display: "flex", height: NOTES_H, borderBottom: `1px solid ${UI.line}` }}>
              <div style={{ ...sticky, padding: "3px 8px", color: UI.note }}>✎ notes</div>
              <div style={{ position: "relative", width }}>
                {notes.map((n) => (
                  <div
                    key={n.id}
                    title={n.text}
                    onPointerDown={() => setSelected(n)}
                    style={{ position: "absolute", left: x(n.time) - 6, top: 3, width: 12, height: 14, borderRadius: 3, background: UI.note, cursor: "pointer" }}
                  />
                ))}
              </div>
            </div>

            {rows.map((row) => (
              <div key={row.key} style={{ display: "flex", height: ROW_H, borderBottom: `1px solid ${UI.line}55` }}>
                <div
                  style={{
                    ...sticky,
                    padding: `5px 8px 0 ${8 + row.depth * 14}px`,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: row.group === "visual" ? UI.text : UI.muted,
                    cursor: row.toggle ? "pointer" : "default",
                  }}
                  onPointerDown={(e) => {
                    if (!row.toggle) return;
                    e.stopPropagation();
                    const path = row.toggle;
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    });
                  }}
                >
                  <span style={{ display: "inline-block", width: 12, color: UI.muted }}>{row.toggle ? (row.expanded ? "▾" : "▸") : ""}</span>
                  {row.label}
                </div>
                <div style={{ position: "relative", width }}>
                  {row.bars.map((bar) => (
                    <div
                      key={bar.key}
                      title={`${bar.label}  ${fmt(bar.start)} – ${fmt(bar.end)}`}
                      onPointerDown={() => setSelected(bar)}
                      style={{
                        position: "absolute",
                        left: x(bar.start),
                        width: Math.max(2, x(bar.end) - x(bar.start)),
                        top: 4,
                        height: ROW_H - 9,
                        borderRadius: 4,
                        background: bar.color,
                        opacity: 0.85,
                        outline: selected && "key" in selected && selected.key === bar.key ? `2px solid ${UI.text}` : "none",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        fontSize: 11,
                        lineHeight: `${ROW_H - 9}px`,
                        padding: "0 4px",
                        boxSizing: "border-box",
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {x(bar.end) - x(bar.start) > 40 ? bar.label : ""}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Playhead */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_W + x(now), width: 2, marginLeft: -1, background: UI.playhead, zIndex: 3, pointerEvents: "none" }} />
          </div>
        </div>

        <Details
          selected={selected}
          onSeek={(t) => onSeek(Math.round(t * comp.fps))}
          onDelete={(id) => {
            save(notes.filter((n) => n.id !== id));
            setSelected(null);
          }}
        />
      </div>
    </div>
  );
}

const buttonStyle: CSSProperties = { padding: "4px 10px", background: "#3f3f46", color: "inherit", border: 0, borderRadius: 5, cursor: "pointer" };

/** Ruler spacing that keeps labels about 80 px apart. */
function tickStep(pps: number) {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pps >= 80) return s;
  return 120;
}

function Waveform({ mix, width, height }: { mix: Stereo | null | undefined; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(1, Math.min(Math.round(width), 16000));
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !mix) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = "#60a5fa";
    const [l, r] = mix;
    const per = l.length / w;
    for (let px = 0; px < w; px++) {
      let peak = 0;
      const from = Math.floor(px * per);
      const to = Math.min(l.length, Math.floor((px + 1) * per));
      // ~200 samples per pixel is plenty for a peak meter.
      const step = Math.max(1, Math.floor((to - from) / 200));
      for (let i = from; i < to; i += step) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      const h = Math.max(1, peak * (height - 6));
      ctx.fillRect(px, (height - h) / 2, 1, h);
    }
  }, [mix, w, height]);
  if (mix === undefined) return <div style={{ width, padding: "14px 8px", color: UI.muted }}>Mixing soundtrack…</div>;
  if (mix === null) return <div style={{ width, padding: "14px 8px", color: UI.muted }}>Silent</div>;
  return <canvas ref={ref} width={w} height={height} style={{ width, height, display: "block" }} />;
}

function Details({ selected, onSeek, onDelete }: { selected: Bar | Note | null; onSeek: (t: number) => void; onDelete: (id: string) => void }) {
  const box: CSSProperties = { width: PANEL_W, flex: "none", borderLeft: `1px solid ${UI.line}`, background: UI.panel, padding: 10, overflow: "auto", boxSizing: "border-box" };
  if (!selected) {
    return (
      <div style={{ ...box, color: UI.muted, lineHeight: 1.6 }}>
        Click a bar for details. Click or drag on the tracks to seek, ⌘/Ctrl-scroll to zoom.
        <br />
        Press <b>N</b> to note what's wrong at the playhead.
      </div>
    );
  }
  if ("context" in selected) {
    return (
      <div style={box}>
        <div style={{ color: UI.note, fontWeight: 600, marginBottom: 6 }}>
          Note at {fmt(selected.time)} (frame {selected.frame})
        </div>
        <div style={{ fontSize: 13, marginBottom: 10 }}>{selected.text}</div>
        <div style={{ color: UI.muted, marginBottom: 4 }}>On screen / audible then:</div>
        {selected.context.map((c, i) => (
          <div key={i} style={{ color: UI.muted, fontSize: 11, marginBottom: 2 }}>
            {c}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button style={buttonStyle} onClick={() => onSeek(selected.time)}>
            Go to
          </button>
          <button style={buttonStyle} onClick={() => onDelete(selected.id)}>
            Delete
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style={box}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{selected.label}</div>
      {selected.details.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
          <span style={{ width: 90, flex: "none", color: UI.muted }}>{k}</span>
          <span style={{ wordBreak: "break-word" }}>{v}</span>
        </div>
      ))}
      <button style={{ ...buttonStyle, marginTop: 8 }} onClick={() => onSeek(selected.start)}>
        Go to start
      </button>
    </div>
  );
}
