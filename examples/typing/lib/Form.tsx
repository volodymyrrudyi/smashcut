import { clamp, spring, type Typing } from "@smashcut/core";
import { useClip } from "@smashcut/runtime";
import { font, paper } from "../../hello/lib/theme";

// Layout in frame pixels, shared with the timeline so the camera can aim at a field.
const CARD = { x: 460, y: 190, w: 1000, pad: 56 };
const FIELD_TOP = CARD.y + 150;
const FIELD_STEP = 132;
const LABEL_H = 34;
const INPUT_H = 66;
const INPUT_W = CARD.w - 2 * CARD.pad;
const ERROR = "#dc2626";

/** Frame-pixel point to aim the camera at for field `i`: where its text is being typed. */
export const fieldFocus = (i: number) => ({
  x: CARD.x + CARD.pad + INPUT_W * 0.36,
  y: FIELD_TOP + i * FIELD_STEP + LABEL_H + INPUT_H / 2,
});

export interface FormField {
  label: string;
  entry: Typing;
  placeholder?: string;
}

interface FormProps {
  title: string;
  fields: FormField[];
  /** Clip-local seconds the submit button is pressed. */
  submitAt?: number;
  /** Validation errors that appear on a field from `at` (clip-local seconds). */
  errors?: { field: number; at: number; message: string }[];
}

/** A form card whose fields fill in from `typing()` entries, with focus rings and a submit press. */
export function Form({ title, fields, submitAt, errors = [] }: FormProps) {
  const t = useClip();
  const press = submitAt === undefined ? 0 : clamp((t.local - submitAt) / 0.35);
  const done = submitAt !== undefined && t.local >= submitAt + 0.35;
  const rise = spring(t, { damping: 16, stiffness: 110 });
  return (
    <div style={{ position: "relative", width: t.width, height: t.height }}>
      <div
        style={{
          position: "absolute",
          left: CARD.x,
          top: CARD.y,
          width: CARD.w,
          boxSizing: "border-box",
          padding: CARD.pad,
          paddingBottom: 40,
          background: "#fff",
          borderRadius: 20,
          border: `1px solid ${paper.grid}`,
          boxShadow: "0 30px 80px rgba(15, 23, 42, 0.14)",
          fontFamily: font,
          opacity: clamp(rise * 1.5),
          transform: `translateY(${(1 - rise) * 60}px)`,
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 800, color: paper.text, letterSpacing: -0.8, height: 94 }}>{title}</div>
        {fields.map((field, i) => {
          const focused = field.entry.focused(t.local);
          const value = field.entry.text(t);
          const error = errors.find((e) => e.field === i && t.local >= e.at);
          const ring = error ? ERROR : focused ? paper.accent : undefined;
          return (
            <div key={field.label} style={{ height: FIELD_STEP }}>
              <div style={{ height: LABEL_H, display: "flex", gap: 14, fontSize: 21, fontWeight: 600, color: paper.muted }}>
                {field.label}
                {error && <span style={{ color: ERROR, opacity: clamp((t.local - error.at) / 0.2) }}>{error.message}</span>}
              </div>
              <div
                style={{
                  height: INPUT_H,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 22px",
                  borderRadius: 10,
                  border: `2px solid ${ring ?? paper.line}`,
                  boxShadow: ring ? `0 0 0 6px ${ring}22` : "none",
                  fontSize: 28,
                  whiteSpace: "pre",
                  color: value ? paper.text : "#94a3b8",
                }}
              >
                {value || field.placeholder || ""}
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 20, marginTop: 4 }}>
          {done && <span style={{ fontSize: 24, fontWeight: 600, color: paper.green }}>✓ Order created</span>}
          <div
            style={{
              padding: "16px 40px",
              borderRadius: 10,
              background: paper.accent,
              color: "#fff",
              fontSize: 24,
              fontWeight: 700,
              transform: `scale(${1 - 0.06 * Math.sin(Math.PI * press)})`,
              filter: `brightness(${1 - 0.15 * Math.sin(Math.PI * press)})`,
            }}
          >
            Create order
          </div>
        </div>
      </div>
    </div>
  );
}
