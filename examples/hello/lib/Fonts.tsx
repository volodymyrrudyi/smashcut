import { useLayoutEffect } from "react";
import { asset } from "@smashcut/core";
import { delayRender } from "@smashcut/runtime";

const css = `@font-face {
  font-family: "Smashcut Inter";
  src: url("${asset("fonts/inter.woff2")}") format("woff2");
  font-weight: 100 900;
  font-display: block;
}`;

/** Registers Inter from the video's assets/fonts/inter.woff2 and holds the first frame until it has loaded. */
export function Fonts() {
  useLayoutEffect(() => {
    delayRender(Promise.all([400, 600, 800].map((w) => document.fonts.load(`${w} 32px "Smashcut Inter"`))));
  }, []);
  return <style>{css}</style>;
}
