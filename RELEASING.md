# Releasing

How Mission Control ships. The versioning **policy** is the organization's
canonical
[VERSIONING.md](https://github.com/agenteventprotocol/agent-event-protocol/blob/main/VERSIONING.md)
(§5, repositories that are not packages); this page is the procedure.

## Tagged whole, no registry artifacts

Mission Control releases as a **tagged whole** on its own SemVer line,
alongside protocol releases. Nothing here is published to a registry: the
app manifest carries the shared `0.1.0-dev` pre-release core for
consistency only, and the vendored `@agenteventprotocol/sdk` under `vendor/aep-sdk/` is a
pinned snapshot, not a publishable package. The tag is the release.

## Cutting a release

1. Verify the pin is current: `SDK_VERSION` names the TypeScript SDK
   commit the vendored `vendor/aep-sdk/` snapshot comes from, and the
   `vendor-sync` CI job is green against it (pre-publication, the local
   dir-diff against a clone at that pin is the equivalent gate).
2. `./ci.sh` passes at the release commit — typecheck, lint, unit +
   component tests, headless e2e, production build.
3. Roll `CHANGELOG.md`: retitle **Unreleased** to the version and date;
   open a fresh Unreleased section.
4. Update the manifest version core from `-dev` to the release version in
   the same commit as the changelog roll.
5. Annotated tag on the repository as a whole (`git tag -a vX.Y.Z`), then
   push the tag. No build artifacts, no package publishes.
6. Open the next `-dev` version core in a follow-up commit.

Once `@agenteventprotocol/sdk` publishes to a registry, step 1 becomes an ordinary
dependency bump (see `vendor/aep-sdk/VENDORED.md`). Releases track protocol
releases; there is no calendar.
