#!/usr/bin/env bash
# Mission Control CI entry — the exact steps the ci workflow job runs, so
# contributors reproduce CI locally with one command. Everything is offline
# after `pnpm install`; the end-to-end beats run against the vendored relay
# fixture on loopback.
set -euo pipefail
cd "$(dirname "$0")"

echo "== install (frozen lockfile) =="
pnpm install --frozen-lockfile

echo "== build the vendored SDK (dist consumed by the app) =="
pnpm run build:sdk

echo "== typecheck (SDK contract + app) =="
pnpm run typecheck

echo "== lint =="
pnpm run lint

echo "== unit + component tests =="
pnpm run test

echo "== headless e2e: fixture relay + synthetic agents (live / resume / control) =="
pnpm run test:e2e

echo "== production build =="
pnpm run build

echo "mission-control: ALL GREEN"
