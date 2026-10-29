import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("agent skill", () => {
  it("is the same in the npm package and the Claude Code plugin", () => {
    // If this fails, copy packages/cli/skills/smashcut/SKILL.md to plugin/skills/smashcut/SKILL.md.
    expect(read("../../../plugin/skills/smashcut/SKILL.md")).toBe(read("../skills/smashcut/SKILL.md"));
  });

  it("has the name and description Claude Code needs", () => {
    expect(read("../skills/smashcut/SKILL.md")).toMatch(/^---\nname: smashcut\ndescription: .+\n---\n/);
  });
});
