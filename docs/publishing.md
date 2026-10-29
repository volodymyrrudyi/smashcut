# Publishing to npm

Four packages are published together, always at the same version:

| Package | Folder | What it is |
|---|---|---|
| `smashcut` | `packages/cli` | The CLI (`smashcut init / dev / still / render / audio`) |
| `@smashcut/core` | `packages/core` | Builders, animation, typing, subtitles, audio |
| `@smashcut/runtime` | `packages/runtime` | The React renderer that runs in the browser |
| `@smashcut/three` | `packages/three` | Optional three.js clips |

They ship TypeScript sources (`src/`), not a build: Vite compiles them for the browser and the CLI runs through
`tsx`. Each package's `files` field decides what goes in the tarball; npm adds its `package.json`, `README.md` and
`LICENSE`.

## Once

1. An npm account with two-factor authentication: `npm login`, then `npm whoami` to check.
2. Membership of the `smashcut` organisation on npmjs.com (it owns the `@smashcut` scope). The scoped packages
   publish as public through `publishConfig.access`.

## Each release

```sh
git switch main && git pull
node scripts/set-version.mjs 0.2.0      # every package and their dependencies on each other
npm install                             # updates package-lock.json
npm run typecheck && npm test
npm pack --workspaces --dry-run         # check each tarball's file list and size
npm publish --workspaces --dry-run
npm publish --workspaces                # asks for a one-time password
git commit -am "Release 0.2.0" && git tag v0.2.0 && git push && git push --tags
```

`npm publish --workspaces` goes through the packages alphabetically, so the CLI goes first. That's fine: the
registry doesn't check dependencies at publish time. If one package fails, fix it and publish just that one with
`npm publish -w @smashcut/<name>`. A published version can't be replaced; publish a new patch version instead.

## Checking a release before publishing

The real test is an install outside the repo, from the packed tarballs:

```sh
npm pack --workspaces --pack-destination /tmp/smashcut-pack
mkdir /tmp/try && cd /tmp/try && npm init -y
npm install -D /tmp/smashcut-pack/*.tgz
npx smashcut init vid && npx smashcut still vid --frame 60
```

To try the three.js clips there, copy `examples/three` next to `vid` and `npm install -D three@0.170.0` first.
