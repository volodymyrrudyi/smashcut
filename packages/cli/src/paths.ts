import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The smashcut install (this monorepo). Video folders can live anywhere; they resolve smashcut and React from here. */
export const SMASHCUT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const require = createRequire(path.join(SMASHCUT_ROOT, "packages", "runtime", "package.json"));
/** A package's install directory. Resolves its entry, since not every package exports `./package.json`. */
function packageDir(name: string): string {
  const entry = require.resolve(name);
  const marker = path.join("node_modules", name);
  return entry.slice(0, entry.lastIndexOf(marker) + marker.length);
}

/** Module ids a video's code imports, mapped to directories / entry files inside the smashcut install. */
export const ALIASES: Record<string, string> = {
  "@smashcut/core": path.join(SMASHCUT_ROOT, "packages", "core", "src", "index.ts"),
  "@smashcut/runtime": path.join(SMASHCUT_ROOT, "packages", "runtime", "src", "index.ts"),
  "@smashcut/three": path.join(SMASHCUT_ROOT, "packages", "three", "src", "index.tsx"),
  three: packageDir("three"),
  react: packageDir("react"),
  "react-dom": packageDir("react-dom"),
};

/** Type declarations an editor needs for a video folder outside the monorepo. */
export const TYPE_PATHS = {
  "@smashcut/core": [ALIASES["@smashcut/core"]],
  "@smashcut/runtime": [ALIASES["@smashcut/runtime"]],
  "@smashcut/three": [ALIASES["@smashcut/three"]],
  three: [path.join(SMASHCUT_ROOT, "node_modules", "@types", "three")],
  "three/*": [path.join(SMASHCUT_ROOT, "node_modules", "@types", "three", "*")],
  react: [path.join(SMASHCUT_ROOT, "node_modules", "@types", "react")],
  "react/*": [path.join(SMASHCUT_ROOT, "node_modules", "@types", "react", "*")],
  "react-dom": [path.join(SMASHCUT_ROOT, "node_modules", "@types", "react-dom")],
  "react-dom/*": [path.join(SMASHCUT_ROOT, "node_modules", "@types", "react-dom", "*")],
};

/** Ambient declarations (`?raw` imports) for video folders. */
export const ENV_TYPES = path.join(SMASHCUT_ROOT, "packages", "core", "src", "env.d.ts");
