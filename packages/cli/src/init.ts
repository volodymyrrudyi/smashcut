import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENV_TYPES, FROM_NPM, VERSION, monorepoTypePaths } from "./paths";

const TIMELINE = `import { defineVideo, fade, group, modern, music, react, series, sfx, solid, spring, text } from "@smashcut/core";
import { Title } from "./lib/Title";

// Timing is in seconds. Run \`smashcut dev .\` to preview, \`smashcut render .\` to make an MP4.
export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  background: "#0f172a",
  layers: [
    series([
      group(
        [
          solid("#0f172a"),
          react(Title, { title: "__NAME__", subtitle: "made with smashcut" }),
        ],
        { duration: 3 },
      ),
      fade(0.6),
      group(
        [
          solid("#1e293b"),
          text("Edit timeline.ts to get started", {
            style: { fontSize: 72, fontWeight: 700 },
            scale: (t) => spring(t, { from: 0.9, damping: 14 }),
            enter: "fade-up",
          }),
        ],
        { duration: 3 },
      ),
    ]),
  ],
  audio: [
    music(modern({ seed: 1, mood: "bright", key: "C major" }), { volume: 0.7, fadeOut: 1.2 }),
    sfx.swoosh({ at: 2.3, length: 0.8 }),
  ],
});
`;

const TITLE = `import { spring } from "@smashcut/core";
import { useClip } from "@smashcut/runtime";

/** Any React component can be a clip. Read time with useClip(), never with timers. */
export function Title({ title, subtitle }: { title: string; subtitle: string }) {
  const t = useClip();
  const rise = spring(t, { damping: 14 });
  return (
    <div style={{ textAlign: "center", color: "#fff", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ fontSize: 140, fontWeight: 800, letterSpacing: -4, transform: \`translateY(\${(1 - rise) * 60}px)\`, opacity: rise }}>
        {title}
      </div>
      <div style={{ fontSize: 44, color: "#94a3b8", opacity: spring(t, { delay: 0.4 }) }}>{subtitle}</div>
    </div>
  );
}
`;

const GITIGNORE = `.smashcut/
out/
${FROM_NPM ? "node_modules/\n" : ""}`;

/** Installed from npm, a video folder is a small npm package that depends on smashcut. */
function packageJson(name: string): string {
  const pkg = {
    name: name.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    private: true,
    type: "module",
    scripts: { dev: "smashcut dev .", still: "smashcut still .", render: "smashcut render ." },
    devDependencies: {
      "@smashcut/core": `^${VERSION}`,
      "@smashcut/runtime": `^${VERSION}`,
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      smashcut: `^${VERSION}`,
    },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

function tsconfig(): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          isolatedModules: true,
          allowImportingTsExtensions: true,
          types: [],
          // In the monorepo, editor types come from its sources; installed, they come from node_modules.
          ...(FROM_NPM ? {} : { paths: monorepoTypePaths() }),
        },
        include: ["timeline.ts", "lib", FROM_NPM ? "smashcut-env.d.ts" : ENV_TYPES],
      },
      null,
      2,
    ) + "\n"
  );
}

/** Scaffold a video folder. Refuses to touch a folder that already has files in it. */
export async function initProject(dir: string): Promise<string[]> {
  const root = path.resolve(dir);
  if (existsSync(root) && (await readdir(root)).some((f) => f !== ".DS_Store" && f !== ".git")) {
    throw new Error(`${root} is not empty`);
  }
  const name = path.basename(root);
  const files: Record<string, string> = {
    "timeline.ts": TIMELINE.replace("__NAME__", name),
    "lib/Title.tsx": TITLE,
    "assets/.gitkeep": "",
    ".gitignore": GITIGNORE,
    "tsconfig.json": tsconfig(),
  };
  if (FROM_NPM) {
    files["package.json"] = packageJson(name);
    files["smashcut-env.d.ts"] = await readFile(ENV_TYPES, "utf8");
  }
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return Object.keys(files);
}
