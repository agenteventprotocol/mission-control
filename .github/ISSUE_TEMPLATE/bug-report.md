---
name: Bug report
about: Report a bug in Mission Control
title: "[BUG] "
labels: bug
assignees: ''
---

## Component

Which component contains the bug? Check one:

- [ ] store / controller (`app/src/state`, `app/src/core`)
- [ ] views — fleet / inbox / events / session (`app/src/views`)
- [ ] attention dock + notifications
- [ ] connection / resume (relay attach)
- [ ] import / export capture
- [ ] vendored `@aep/sdk` (`vendor/aep-sdk/`) — a snapshot pinned by
      `SDK_VERSION`; if the defect is in the content (not the vendoring),
      report it on
      [typescript-sdk](https://github.com/agenteventprotocol/typescript-sdk/issues/new/choose)
- [ ] docs (`docs/testing` guides)
- [ ] other

## Reproduction

Steps to reproduce:

1. ...
2. ...

Minimal reproducing example (event, capture file, or steps in the UI):

```json
...
```

## Expected behavior

What should happen? If a spec section defines it, cite it (e.g. AEP-0003 §5).

## Actual behavior

What actually happens? Include relevant output, console errors, or a
screenshot (redact tokens and paths).

## Version and commit

- Mission Control commit hash:
- `SDK_VERSION` (repo root file):
- Browser and version:
- Node / pnpm versions:

## Additional context

Anything else that helps.
