# Vendored `@agenteventprotocol/sdk`

This directory is a byte-identical snapshot of
[`agenteventprotocol/typescript-sdk`](https://github.com/agenteventprotocol/typescript-sdk)
(`src/`, `tsconfig.json`, `tsconfig.build.json`, `package.json`, `LICENSE`)
at the commit recorded in [`../../SDK_VERSION`](../../SDK_VERSION).

## Why it exists

`@agenteventprotocol/sdk` is not published to npm yet. Until it is, Mission Control vendors
the SDK at a pinned ref and consumes it as a pnpm workspace package: the
root `build:sdk` script compiles it to `dist/` with the SDK's own compiler
settings, and the app imports `@agenteventprotocol/sdk` through the package's regular
`exports` — exactly the surface npm consumers will get.

The `vendor-sync` CI job re-clones the SDK repo at the pinned commit and
diffs this snapshot, so drift is impossible to miss.

## Rules

- **Never edit files here.** Fixes belong in the SDK repo; then re-vendor
  and bump `SDK_VERSION`.
- Once `@agenteventprotocol/sdk` is on npm: replace the app's `workspace:*` dependency
  with the published version, delete this directory, `SDK_VERSION`, and the
  `vendor-sync` job.
