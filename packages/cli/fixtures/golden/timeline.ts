import { asset, decor, defineVideo, framed, group, image, react, solid, subtitles, text } from "@smashcut/core";
import { createElement, useLayoutEffect } from "react";
import { delayRender } from "@smashcut/runtime";

function Fonts() {
  useLayoutEffect(() => {
    delayRender(document.fonts.load('600 20px "Golden Inter"'));
  }, []);
  return createElement("style", {}, '@font-face{font-family:"Golden Inter";src:url("/assets/inter.woff2");font-weight:100 900}');
}
function Square() {
  return createElement("div", { style: { width: 18, height: 18, background: "#f472b6" } });
}
export default defineVideo({
  size: [320, 180], fps: 10, duration: 1,
  layers: [
    react(Fonts, {}),
    solid("#172554"),
    framed(group([
      solid("#1e293b"),
      image(asset("mark.svg"), { width: 42, height: 42, x: -70 }),
      text("smashcut", { inset: 0, x: 20, style: { fontFamily: "Golden Inter", fontSize: 20, fontWeight: 600 } }),
      react(Square, {}, { x: 95, y: 25 }),
    ]), { chrome: "none", width: 260, height: 100, radius: 12, y: -15, shadow: false }),
    subtitles("1\n00:00:00,000 --> 00:00:01,000\nGolden captions", {
      inset: 12, preset: "boxed", style: { fontFamily: "Golden Inter", fontSize: 16, padding: "2px 8px", borderRadius: 4 },
    }),
    decor.border({ width: 4, color: "#38bdf8" }),
  ],
});
