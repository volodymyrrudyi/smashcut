// Sets one version on every published package and on their dependencies on each other.
// Usage: node scripts/set-version.mjs 0.2.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  console.error("Usage: node scripts/set-version.mjs <x.y.z>");
  process.exit(1);
}
const OURS = ["smashcut", "@smashcut/core", "@smashcut/runtime", "@smashcut/three"];
for (const dir of ["cli", "core", "runtime", "three"]) {
  const file = new URL(`../packages/${dir}/package.json`, import.meta.url);
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = version;
  for (const name of OURS) if (pkg.dependencies?.[name]) pkg.dependencies[name] = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`${pkg.name}@${version}`);
}
// The Claude Code plugin ships the CLI's skill, so it carries the same version.
const plugin = new URL("../packages/cli/.claude-plugin/plugin.json", import.meta.url);
const manifest = JSON.parse(readFileSync(plugin, "utf8"));
manifest.version = version;
writeFileSync(plugin, JSON.stringify(manifest, null, 2) + "\n");
console.log(`plugin smashcut@${version}`);
