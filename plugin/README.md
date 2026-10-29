# smashcut Claude Code plugin

The smashcut skill, packaged for Claude Code and Claude Desktop:

```
/plugin install smashcut --marketplace volodymyrrudyi/smashcut
```

`skills/smashcut/SKILL.md` is a copy of `packages/cli/skills/smashcut/SKILL.md`, the one that ships in the npm
package. Edit that one and copy it here; a test fails while the two differ. The plugin lives in its own folder
because Claude Desktop rejects plugins with a top-level `bin/` directory, which the CLI package has.
