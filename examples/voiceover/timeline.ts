import { ambient, defineVideo, group, music, sfx, solid, subtitles, text, voice, type Node, type VoiceOptions } from "@smashcut/core";

// Voiceover: the narration drives the timing of everything else.
// Needs ELEVENLABS_API_KEY (in the environment or in this folder's .env). Each line is generated once into
// voiceovers/; until then it's silent and its timing is estimated. `smashcut voices .` lists the voices.
const VOICE: VoiceOptions = { voice: "Rachel", settings: { stability: 0.5 } };
const GAP = 0.6;

const l1 = voice("Meet smashcut. Videos you write in code.", { ...VOICE, at: 0.6 });
const l2 = voice("Every word is timed, so cuts and captions land on the beat.", { ...VOICE, at: l1.end + GAP });
const l3 = voice("Write the script. Render the video.", { ...VOICE, at: l2.end + GAP });
const END = l3.end + 1.5;

// Scenes cut halfway through the pause before each line.
const cuts = [0, l2.at - GAP / 2, l3.at - GAP / 2, END];

/** Scene `i`, with titles that pop in when a word is spoken (given in timeline seconds). */
const scene = (i: number, bg: string, titles: [string, number, string][]): Node =>
  group(
    [
      solid(bg),
      ...titles.map(([s, at, color], k) =>
        text(s, {
          at: at - cuts[i],
          y: (k - (titles.length - 1) / 2) * 150,
          style: { fontSize: 120, fontWeight: 800, color, letterSpacing: -2 },
          enter: "fade-up",
        }),
      ),
    ],
    { at: cuts[i], duration: cuts[i + 1] - cuts[i], enter: i ? "fade" : undefined },
  );

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  duration: END,
  layers: [
    scene(0, "#0f172a", [
      ["smashcut", l1.word("smashcut").start, "#f8fafc"],
      ["in code", l1.word("code").start, "#38bdf8"],
    ]),
    scene(1, "#1e1b4b", [["on the beat", l2.word("beat").start, "#f472b6"]]),
    scene(2, "#052e16", [
      ["Write.", l3.word("Write").start, "#f8fafc"],
      ["Render.", l3.word("Render").start, "#4ade80"],
    ]),
    // Captions are in timeline seconds, so they sit at the top level.
    subtitles([...l1.cues, ...l2.cues, ...l3.cues], { preset: "highlight" }),
  ],
  audio: [
    l1,
    l2,
    l3,
    sfx.tick({ at: l1.word("code").start }),
    sfx.swoosh({ at: cuts[1] - 0.3, length: 0.6 }),
    sfx.pop({ at: l2.word("beat").start }),
    sfx.swoosh({ at: cuts[2] - 0.3, length: 0.6 }),
    sfx.bell({ at: l3.word("Render").start }),
    // The bed dips while the narrator speaks.
    music(ambient({ seed: 4, mood: "pulse" }), { volume: 0.6, duck: 0.6, fadeIn: 1, fadeOut: 1.5 }),
  ],
});
