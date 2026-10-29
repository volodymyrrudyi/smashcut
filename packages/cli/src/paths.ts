import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when smashcut runs from an npm install, false when it runs from the monorepo. Video folders made in the
 * monorepo resolve smashcut and React from it; installed, they get a package.json and resolve from node_modules.
 */
export const FROM_NPM = fileURLToPath(import.meta.url).split(path.sep).includes("node_modules");

/** The monorepo root (only meaningful when `FROM_NPM` is false). */
export const SMASHCUT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** The version this CLI was published as; video folders depend on the same one. */
export const VERSION: string = createRequire(import.meta.url)("../package.json").version;

const cliRequire = createRequire(import.meta.url);

/** A package's install directory. Uses its exported package.json when it has one, else its entry. */
function packageDir(require: NodeJS.Require, name: string): string {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    const entry = require.resolve(name);
    const marker = path.join("node_modules", name);
    return entry.slice(0, entry.lastIndexOf(marker) + marker.length);
  }
}

const REQUIRED = ["@smashcut/core", "@smashcut/runtime", "react", "react-dom"];
const OPTIONAL = ["@smashcut/three", "three"];

/**
 * Module ids a video's code imports, mapped to package directories. Each is looked up from the video folder first,
 * then from the CLI's own install, so a folder anywhere on disk works and `@smashcut/three` is picked up when the
 * folder installs it.
 */
export function aliases(root: string): Record<string, string> {
  const requires = [createRequire(path.join(path.resolve(root), "package.json")), cliRequire];
  const find = (name: string) => {
    for (const require of requires) {
      try {
        return packageDir(require, name);
      } catch {}
    }
  };
  const out: Record<string, string> = {};
  for (const name of [...REQUIRED, ...OPTIONAL]) {
    const dir = find(name);
    if (dir) out[name] = dir;
    else if (REQUIRED.includes(name)) throw new Error(`Cannot find ${name}. Run npm install in the video folder.`);
  }
  return out;
}

/** Type paths for a video folder made in the monorepo: smashcut's sources and the monorepo's React types. */
export function monorepoTypePaths(): Record<string, string[]> {
  const types = (name: string) => path.join(SMASHCUT_ROOT, "node_modules", "@types", name);
  return {
    "@smashcut/core": [cliRequire.resolve("@smashcut/core")],
    "@smashcut/runtime": [cliRequire.resolve("@smashcut/runtime")],
    "@smashcut/three": [path.join(SMASHCUT_ROOT, "packages", "three", "src", "index.tsx")],
    three: [types("three")],
    "three/*": [path.join(types("three"), "*")],
    react: [types("react")],
    "react/*": [path.join(types("react"), "*")],
    "react-dom": [types("react-dom")],
    "react-dom/*": [path.join(types("react-dom"), "*")],
  };
}

/** Ambient declarations (`?raw` imports) for video folders. */
export const ENV_TYPES = path.join(packageDir(cliRequire, "@smashcut/core"), "src", "env.d.ts");
