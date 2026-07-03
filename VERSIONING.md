# Versioning & release workflow

glyria.js publishes to npm straight from CI, triggered by git tags. There is no manual `npm publish` — pushing the right tag is what ships a release. This doc explains how the `main` and `dev` branches map to npm versions and dist-tags.

## Branches

- **`main`** — stable, production-ready code. Every tag on `main` is a real release under `npm install @glyria/bot`.
- **`dev`** — active development. Features land here first and get pre-release builds published under a separate npm dist-tag so they never reach users who just run `npm install @glyria/bot`.

## npm dist-tags

| Branch | Version format         | Tag pattern   | npm dist-tag | Install with                     |
|--------|-------------------------|---------------|--------------|-----------------------------------|
| `main` | `X.Y.Z`                 | `vX.Y.Z`      | `latest`     | `npm install @glyria/bot`         |
| `dev`  | `X.Y.Z-dev.N`           | `vX.Y.Z-dev.N`| `dev`        | `npm install @glyria/bot@dev`     |

Two workflows enforce this:

- `.github/workflows/publish.yml` — triggers on tags matching `v*`, verifies the tag is on `main`, publishes to the `latest` dist-tag.
- `.github/workflows/publish-dev.yml` — triggers on tags matching `v*-dev*`, verifies the tag is on `dev`, publishes to the `dev` dist-tag with `npm publish --tag dev`.

Both workflows require the pushed commit to already be an ancestor of the corresponding branch, so a tag can't accidentally publish code that never went through review on that branch.

## Cutting a dev pre-release

From an up-to-date `dev` branch:

```bash
npm version prerelease --preid=dev   # 1.4.1 -> 1.4.2-dev.0 (repeat to bump 1.4.2-dev.1, ...)
git push origin dev --follow-tags
```

This pushes the version-bump commit and its tag (`vX.Y.Z-dev.N`) together, which triggers `publish-dev.yml`.

## Cutting a stable release

Once `dev` is merged into `main`:

```bash
npm version patch   # or minor / major
git push origin main --follow-tags
```

This pushes the tag (`vX.Y.Z`), which triggers `publish.yml` and publishes to `latest`.

## Why dev builds are never `latest`

Publishing dev builds under the `dev` dist-tag instead of `latest` means:

- `npm install @glyria/bot` always resolves to the last stable release.
- Anyone who wants to try in-progress work can opt in explicitly with `npm install @glyria/bot@dev`.
- Semver ordering (`X.Y.Z-dev.N` sorts before `X.Y.Z`) means a stable release always supersedes its own pre-releases once cut.
