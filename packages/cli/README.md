# smashcut

Videos as TypeScript timelines. Describe a video in `timeline.ts` (text, React components, footage, three.js,
subtitles and generated music and sound effects), preview it live, and render a frame-exact MP4.

```sh
npx smashcut init my-video
cd my-video && npm install
npm run dev        # live preview with a timeline
npm run render     # → out/my-video.mp4
```

Requires Node 24+, `ffmpeg` on PATH, and a one-time `npx playwright install chromium-headless-shell`.

Documentation and ten example videos: https://github.com/volodymyrrudyi/smashcut
