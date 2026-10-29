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
3. Trust the release workflow, so GitHub Actions can publish without a stored token (each asks for 2FA):

   ```sh
   for p in smashcut @smashcut/core @smashcut/runtime @smashcut/three; do
     npm trust github "$p" --repo volodymyrrudyi/smashcut --file release.yml --env npm --allow-publish
   done
   ```

   `npm trust list <package>` shows what's configured. Optionally add required reviewers to the `npm` environment
   in the GitHub repo settings, so a release waits for an approval.

## Each release

```sh
git switch main && git pull
node scripts/set-version.mjs 0.2.0      # every package, their dependencies, and the plugin
npm install                             # updates package-lock.json
npm run typecheck && npm test
npm pack --workspaces --dry-run         # check each tarball's file list and size
git commit -am "Release 0.2.0" && git tag v0.2.0 && git push && git push --tags
```

The tag starts `.github/workflows/release.yml`. It checks that the tag matches every package's version, runs the
typecheck and tests, and runs `npm publish --workspaces` with a short-lived OIDC credential; npm adds provenance
(a link from each version back to the workflow run that built it).

To publish by hand instead: `npm publish --workspaces`, which asks for a one-time password.

`npm publish --workspaces` goes through the packages alphabetically, so the CLI goes first. That's fine: the
registry doesn't check dependencies at publish time. If one package fails, fix it and publish just that one with
`npm publish -w @smashcut/<name>`. A published version can't be replaced; publish a new patch version instead.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:
- typecheck and unit tests on Node 24 and 26;
- a still of every example, plus a full MP4 of `footage` (video, audio and footage decoding), uploaded as the
  `renders` artifact for a week;
- an install from the packed tarballs in a folder outside the repo: `smashcut init`, then a still.

## Checking a release before publishing

The real test is an install outside the repo, from the packed tarballs:

```sh
npm pack --workspaces --pack-destination /tmp/smashcut-pack
mkdir /tmp/try && cd /tmp/try && npm init -y
npm install -D /tmp/smashcut-pack/*.tgz
npx smashcut init vid && npx smashcut still vid --frame 60
```

To try the three.js clips there, copy `examples/three` next to `vid` and `npm install -D three@0.170.0` first.
