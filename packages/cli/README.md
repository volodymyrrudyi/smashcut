# smashcut

Videos as TypeScript timelines. Describe a video in `timeline.ts` (text, React components, footage, three.js,
subtitles and generated music and sound effects), preview it live, and render a frame-exact MP4.

```sh
npx smashcut init my-video
cd my-video && npm install
npm run dev        # live preview with a timeline
npm run render     # → out/my-video.mp4
```

`npx smashcut sheet .` renders a contact sheet of frames and `npx smashcut inspect .` lists every clip with its
times, so coding agents can check their own work. Every folder made by `init` includes an agent skill
(`.claude/skills/smashcut/SKILL.md`) and an `AGENTS.md`. In Claude Code you can also install the skill directly:

```
/plugin install smashcut --marketplace volodymyrrudyi/smashcut
```

Requires Node 24+, `ffmpeg` on PATH, and a one-time `npx playwright install chromium-headless-shell`.

Website: https://getsmashcut.dev. Documentation and ten example videos: https://github.com/volodymyrrudyi/smashcut
