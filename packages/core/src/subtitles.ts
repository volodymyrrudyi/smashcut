import type { BaseProps, SubtitlesNode, SubtitlePreset, TextStyle } from "./types";

export interface Word {
  text: string;
  /** Seconds in subtitle-file time. */
  start: number;
  end: number;
  /** A line break follows this word. */
  br?: boolean;
}

export interface Cue {
  /** Seconds in subtitle-file time. */
  start: number;
  end: number;
  text: string;
  /** Word timings: from VTT inline timestamps (`<00:00:01.200>`), otherwise estimated from word length. */
  words: Word[];
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(stamp: string): number {
  const m = TIME.exec(stamp);
  if (!m) throw new Error(`Invalid subtitle timestamp "${stamp}"`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/** Spread a cue's duration over its words by length (plus a beat for each gap), like natural speech. */
function estimateWords(lines: string[], start: number, end: number): Word[] {
  const words = lines.flatMap((line) => {
    const parts = line.split(/\s+/).filter(Boolean);
    return parts.map((text, i) => ({ text, br: i === parts.length - 1 }));
  });
  if (!words.length) return [];
  words[words.length - 1].br = false;
  const weight = (w: string) => w.length + 2;
  const total = words.reduce((sum, w) => sum + weight(w.text), 0);
  let t = start;
  return words.map((w) => {
    const d = ((end - start) * weight(w.text)) / total;
    const word = { ...w, start: t, end: t + d };
    t += d;
    return word;
  });
}

/** Words with timings from VTT inline timestamps: `Hello <00:00:01.400>there`. */
function timedWords(lines: string[], start: number, end: number): Word[] {
  const words: Word[] = [];
  let at = start;
  lines.forEach((line, li) => {
    for (const part of line.split(/(<\d[\d:.]*>)/)) {
      if (/^<\d/.test(part)) {
        at = seconds(part);
        continue;
      }
      for (const text of part.split(/\s+/).filter(Boolean)) words.push({ text, start: at, end: end });
    }
    if (li < lines.length - 1 && words.length) words[words.length - 1].br = true;
  });
  // Each word lasts until the next one starts.
  words.forEach((w, i) => (w.end = i + 1 < words.length ? Math.max(w.start, words[i + 1].start) : end));
  return words;
}

/** Strip styling tags (<i>, <b>, <c.x>, <v Speaker>, {\an8}) but keep inline timestamps. */
const clean = (line: string) => line.replace(/<(?!\d)[^>]*>/g, "").replace(/\{\\[^}]*\}/g, "");

/** Parse SRT or WebVTT (detected automatically) into cues sorted by start time. */
export function parseSubtitles(source: string): Cue[] {
  const blocks = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const timing = lines.findIndex((l) => l.includes("-->"));
    // Headers (WEBVTT), NOTE / STYLE / REGION blocks and stray ids have no timing line.
    if (timing < 0) continue;
    const [from, to] = lines[timing].split("-->");
    const start = seconds(from);
    const end = seconds(to);
    const textLines = lines.slice(timing + 1).map(clean);
    const timed = textLines.some((l) => /<\d/.test(l));
    const words = timed ? timedWords(textLines, start, end) : estimateWords(textLines, start, end);
    const text = textLines.map((l) => l.replace(/<\d[\d:.]*>/g, "").replace(/\s+/g, " ").trim()).join("\n");
    cues.push({ start, end, text, words });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cue showing at `time` (subtitle-file seconds), if any. */
export function cueAt(cues: readonly Cue[], time: number): Cue | undefined {
  return cues.find((c) => time >= c.start && time < c.end);
}

export interface SubtitlesOptions extends BaseProps {
  /** Default "boxed". */
  preset?: SubtitlePreset;
  /** Subtitle-file seconds shown at the clip's start, like a footage trim. Default 0. */
  from?: number;
  /** Overrides on top of the preset. */
  style?: TextStyle;
  /** Colour of the current word in the "highlight" preset. */
  highlight?: string;
}

/**
 * Subtitles from SRT / WebVTT text (import a file with `?raw`) or parsed cues. Without a `duration` the
 * clip lasts until the last cue ends.
 */
export function subtitles(source: string | Cue[], opts: SubtitlesOptions = {}): SubtitlesNode {
  const { preset = "boxed", from = 0, style, highlight, ...props } = opts;
  const cues = typeof source === "string" ? parseSubtitles(source) : source;
  return { position: "bottom", inset: 72, ...props, kind: "subtitles", cues, preset, from, style, highlight };
}
