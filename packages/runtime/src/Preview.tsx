import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Composition, ResolvedComposition, Stereo } from "@smashcut/core";
import { Stage } from "./Stage";
import { frameStore } from "./store";
import { Timeline } from "./Timeline";

const formatTime = (frame: number, fps: number) => {
  const s = frame / fps;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
};

const SAMPLE_RATE = 48_000;
/** Height of the timeline panel under the stage. */
const TIMELINE_H = 360;

interface AudioPlayer {
  ctx: AudioContext;
  buffer: AudioBuffer;
}

/** Dev player: scaled stage, play/pause with sound, scrubber, keyboard stepping, and the timeline with notes. */
export function Preview({
  comp,
  composition,
  audio,
}: {
  comp: ResolvedComposition;
  composition: Composition;
  audio: (sampleRate: number) => Promise<Stereo | null>;
}) {
  const frame = useSyncExternalStore(frameStore.subscribe, frameStore.get);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  // The soundtrack is mixed once on load: for the waveform and for playback. undefined while mixing, null if silent.
  const [mix, setMix] = useState<Stereo | null | undefined>(undefined);
  const player = useRef<AudioPlayer | null>(null);
  const [focusNote, setFocusNote] = useState(0);
  const [scale, setScale] = useState(1);
  const last = comp.durationInFrames - 1;

  useEffect(() => {
    let cancelled = false;
    audio(SAMPLE_RATE)
      .then((m) => {
        if (cancelled) return;
        if (m) {
          // Created before any click, so it starts suspended; playing resumes it.
          const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
          const buffer = ctx.createBuffer(2, m[0].length, SAMPLE_RATE);
          buffer.copyToChannel(m[0], 0);
          buffer.copyToChannel(m[1], 1);
          player.current = { ctx, buffer };
        }
        setMix(m);
      })
      .catch((err) => {
        console.error("[smashcut] failed to mix audio", err);
        if (!cancelled) setMix(null);
      });
    return () => {
      cancelled = true;
    };
  }, [audio]);

  useEffect(() => {
    const fit = () =>
      setScale(Math.min((window.innerWidth - 48) / comp.width, (window.innerHeight - 110 - TIMELINE_H) / comp.height, 1));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [comp.width, comp.height]);

  useEffect(() => {
    if (!playing) history.replaceState(null, "", `#${frame}`);
  }, [playing, frame]);

  useEffect(() => {
    // Wait for the mix before starting, so picture and sound start together.
    if (!playing || mix === undefined) return;
    const startFrame = frameStore.get() >= last ? 0 : frameStore.get();

    // With sound, the audio clock drives the picture so they never drift apart.
    const p = !muted ? player.current : null;
    let source: AudioBufferSourceNode | undefined;
    let clock = () => performance.now() / 1000;
    if (p) {
      void p.ctx.resume();
      source = p.ctx.createBufferSource();
      source.buffer = p.buffer;
      source.connect(p.ctx.destination);
      source.start(0, startFrame / comp.fps);
      clock = () => p.ctx.currentTime;
    }
    const startTime = clock();
    let raf = 0;
    const tick = () => {
      const f = startFrame + Math.floor((clock() - startTime) * comp.fps);
      if (f >= last) {
        frameStore.set(last);
        setPlaying(false);
        return;
      }
      frameStore.set(f);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source?.stop();
    };
  }, [playing, muted, comp, last, mix]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave keys alone while typing (e.g. a note).
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const step = e.shiftKey ? comp.fps : 1;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        setPlaying(false);
        frameStore.set(Math.min(last, frameStore.get() + step));
      } else if (e.key === "ArrowLeft") {
        setPlaying(false);
        frameStore.set(Math.max(0, frameStore.get() - step));
      } else if (e.key === "Home") {
        frameStore.set(0);
      } else if (e.key === "End") {
        frameStore.set(last);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setPlaying(false);
        setFocusNote((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comp.fps, last]);

  const seek = (f: number) => {
    setPlaying(false);
    frameStore.set(f);
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#18181b",
        color: "#e4e4e7",
        font: "13px system-ui, sans-serif",
      }}
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <div style={{ width: comp.width * scale, height: comp.height * scale, boxShadow: "0 8px 32px #0008" }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
            <Stage comp={comp} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: Math.max(comp.width * scale, 480) }}>
          <button
            onClick={() => setPlaying((p) => !p)}
            style={{ width: 64, padding: "6px 0", background: "#3f3f46", color: "inherit", border: 0, borderRadius: 6 }}
          >
            {playing && mix === undefined ? "…" : playing ? "Pause" : "Play"}
          </button>
          <button
            onClick={() => setMuted((m) => !m)}
            style={{ width: 72, padding: "6px 0", background: "#3f3f46", color: "inherit", border: 0, borderRadius: 6 }}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <input type="range" min={0} max={last} value={frame} onChange={(e) => seek(Number(e.target.value))} style={{ flex: 1 }} />
          <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {formatTime(frame, comp.fps)} · {frame}/{last}
          </span>
        </div>
      </div>
      <div style={{ height: TIMELINE_H, flex: "none" }}>
        <Timeline comp={comp} composition={composition} frame={frame} playing={playing} mix={mix} onSeek={seek} focusNote={focusNote} />
      </div>
    </div>
  );
}
