// Vite serves any file's text with a `?raw` suffix, e.g. `import srt from "./assets/talk.srt?raw"`.
declare module "*?raw" {
  const content: string;
  export default content;
}
