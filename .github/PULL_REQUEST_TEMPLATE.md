## What and why

Brief description of what this PR changes and why.

## Checklist

- [ ] `./ci.sh` passes locally (typecheck, lint, unit + component tests,
      headless e2e, build)
- [ ] `vendor/aep-sdk/` is untouched (it's a snapshot synced from
      `typescript-sdk` at `SDK_VERSION`; the `vendor-sync` CI job diffs it)
- [ ] Behavior changes come with a unit, component, or e2e test
- [ ] Docs and a `CHANGELOG.md` entry added under Unreleased where behavior
      changed
