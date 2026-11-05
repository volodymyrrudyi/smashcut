import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)),
  "run", "packages/cli/src/render.integration.test.ts",
], { cwd: root, stdio: "inherit", env: { ...process.env, SMASHCUT_E2E: "1" } });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
