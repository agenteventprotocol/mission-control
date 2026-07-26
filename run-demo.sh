#!/usr/bin/env bash
# One-command Mission Control demo: boots the vendored relay fixture, serves
# the production build, and keeps a small synthetic fleet emitting so the
# lanes are always live when you connect. Ctrl-C tears everything down.
#
#   ./run-demo.sh                interactive: prints the URLs, runs until Ctrl-C
#   ./run-demo.sh --once         scripted verification: boots everything,
#                                checks the app answers 200, each relay serves
#                                its discovery document, and one synthetic
#                                session completes end to end per relay;
#                                tears down; exit 0/1
#   ./run-demo.sh --two-relays   boots a SECOND relay + its own fleet so the
#                                app can show the multi-relay topology (add
#                                the second URL in the relay settings dialog);
#                                combines with --once
#
# Ports: relay on AEP_PORT (default 8787 — the app's built-in default relay
# URL, so the connect form needs no editing), second relay on AEP_PORT2
# (default 8790), app on AEP_MC_PORT (default 8788). Control flows only on
# authenticated bindings (AEP-0004 §4.1), so the demo generates a session
# token, boots the relays with it, and prints it — paste it into the token
# field to answer attention requests (override with AEP_DEMO_TOKEN).
set -euo pipefail
cd "$(dirname "$0")"

ONCE=0
TWO=0
for arg in "$@"; do
  case "$arg" in
    --once) ONCE=1 ;;
    --two-relays) TWO=1 ;;
    *) echo "run-demo: unknown argument $arg" >&2; exit 2 ;;
  esac
done

RELAY_PORT="${AEP_PORT:-8787}"
RELAY2_PORT="${AEP_PORT2:-8790}"
APP_PORT="${AEP_MC_PORT:-8788}"
RELAY="http://127.0.0.1:${RELAY_PORT}"
RELAY2="http://127.0.0.1:${RELAY2_PORT}"
APP="http://127.0.0.1:${APP_PORT}"
FIXTURES="app/test/fixtures/reference"
DEMO_TOKEN="${AEP_DEMO_TOKEN:-demo-$(od -An -N4 -tx4 /dev/urandom | tr -d " \n")}"

probe() { # probe <url> -> 0 if something answers HTTP there
  node -e '
    fetch(process.argv[1], { signal: AbortSignal.timeout(1500) })
      .then((r) => process.exit(r.status < 500 ? 0 : 1))
      .catch(() => process.exit(1));
  ' "$1" 2>/dev/null
}

PIDS=()
CLEANED=0
cleanup() {
  [ "$CLEANED" = 1 ] && return
  CLEANED=1
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -- -"$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "demo: torn down"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# -- build --------------------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "demo: installing (frozen lockfile)…"
  pnpm install --frozen-lockfile
fi
echo "demo: building the SDK + app…"
pnpm run build >/dev/null

# -- relay (vendored snapshot of the reference relay) --------------------------
if probe "$RELAY/.well-known/aep"; then
  echo "demo: something already answers on port ${RELAY_PORT} — set AEP_PORT to a free port" >&2
  exit 1
fi
setsid env AEP_PORT="$RELAY_PORT" AEP_TOKEN="$DEMO_TOKEN" node "$FIXTURES/server.cjs" >/dev/null 2>&1 &
RELAY_PID=$!
PIDS+=("$RELAY_PID")
for _ in $(seq 1 50); do
  probe "$RELAY/.well-known/aep" && break
  sleep 0.2
done
probe "$RELAY/.well-known/aep" || { echo "demo: relay did not come up" >&2; exit 1; }
kill -0 "$RELAY_PID" 2>/dev/null || { echo "demo: relay child died after boot" >&2; exit 1; }

# -- optional second relay (the multi-relay topology) ---------------------------
if [ "$TWO" = 1 ]; then
  if probe "$RELAY2/.well-known/aep"; then
    echo "demo: something already answers on port ${RELAY2_PORT} — set AEP_PORT2 to a free port" >&2
    exit 1
  fi
  setsid env AEP_PORT="$RELAY2_PORT" AEP_TOKEN="$DEMO_TOKEN" node "$FIXTURES/server.cjs" >/dev/null 2>&1 &
  RELAY2_PID=$!
  PIDS+=("$RELAY2_PID")
  for _ in $(seq 1 50); do
    probe "$RELAY2/.well-known/aep" && break
    sleep 0.2
  done
  probe "$RELAY2/.well-known/aep" || { echo "demo: second relay did not come up" >&2; exit 1; }
  kill -0 "$RELAY2_PID" 2>/dev/null || { echo "demo: second relay child died after boot" >&2; exit 1; }
fi

# -- app (production build via vite preview) -----------------------------------
if probe "$APP"; then
  echo "demo: something already answers on port ${APP_PORT} — set AEP_MC_PORT to a free port" >&2
  exit 1
fi
setsid bash -c "cd app && exec ./node_modules/.bin/vite preview --port '$APP_PORT' --strictPort" >/dev/null 2>&1 &
APP_PID=$!
PIDS+=("$APP_PID")
for _ in $(seq 1 50); do
  probe "$APP" && break
  sleep 0.2
done
probe "$APP" || { echo "demo: app preview did not come up on ${APP_PORT}" >&2; exit 1; }

agent_batch() { # one fleet batch: two quick sessions + one attention session
  local n="$1" timeout_ms="$2"
  setsid node "$FIXTURES/synthetic-agent.cjs" --relay "$RELAY" --token "$DEMO_TOKEN" \
    --session "s_demo_${n}a" --mode http --tools 3 --agent sim-alpha >/dev/null 2>&1 &
  PIDS+=("$!")
  setsid node "$FIXTURES/synthetic-agent.cjs" --relay "$RELAY" --token "$DEMO_TOKEN" \
    --session "s_demo_${n}b" --mode ws --tools 2 --agent sim-beta >/dev/null 2>&1 &
  PIDS+=("$!")
  setsid node "$FIXTURES/synthetic-agent.cjs" --relay "$RELAY" --token "$DEMO_TOKEN" \
    --session "s_demo_${n}c" --mode ws --tools 1 --attention --timeout "$timeout_ms" \
    --agent sim-gamma >/dev/null 2>&1 &
  PIDS+=("$!")
  if [ "$TWO" = 1 ]; then
    setsid node "$FIXTURES/synthetic-agent.cjs" --relay "$RELAY2" --token "$DEMO_TOKEN" \
      --session "s_demo_${n}d" --mode ws --tools 2 --agent sim-delta >/dev/null 2>&1 &
    PIDS+=("$!")
    setsid node "$FIXTURES/synthetic-agent.cjs" --relay "$RELAY2" --token "$DEMO_TOKEN" \
      --session "s_demo_${n}e" --mode ws --tools 1 --attention --timeout "$timeout_ms" \
      --agent sim-epsilon >/dev/null 2>&1 &
    PIDS+=("$!")
  fi
}

if [ "$ONCE" = 1 ]; then
  # Scripted check: one agent runs a full session against the relay, and the
  # served app answers 200 at the root.
  node "$FIXTURES/synthetic-agent.cjs" --relay "$RELAY" --token "$DEMO_TOKEN" \
    --session s_demo_once --mode http --tools 2 --agent sim-once >/dev/null 2>&1 \
    || { echo "demo: synthetic session failed against the relay" >&2; exit 1; }
  if [ "$TWO" = 1 ]; then
    node "$FIXTURES/synthetic-agent.cjs" --relay "$RELAY2" --token "$DEMO_TOKEN" \
      --session s_demo_once2 --mode http --tools 2 --agent sim-once >/dev/null 2>&1 \
      || { echo "demo: synthetic session failed against the second relay" >&2; exit 1; }
  fi
  node -e '
    fetch(process.argv[1])
      .then(async (r) => {
        const body = await r.text();
        const ok = r.status === 200 && body.includes("<div id=\"root\">");
        process.exit(ok ? 0 : 1);
      })
      .catch(() => process.exit(1));
  ' "$APP/" || { echo "demo: app preview did not serve the page" >&2; exit 1; }
  if [ "$TWO" = 1 ]; then
    echo "demo: ONCE OK — both relays up, one synthetic session completed on each, app served"
  else
    echo "demo: ONCE OK — relay discovery up, synthetic session completed, app served"
  fi
  exit 0
fi

cat <<EOF

Mission Control demo is up:

  app    ${APP}         ← open this in your browser
  relay  ${RELAY}         (the app's default relay URL$( [ "$RELAY_PORT" = 8787 ] || printf ' — NOT the default; add it under Connections → Manage relays'))$( [ "$TWO" = 1 ] && printf '\n  relay2 %s         (add it under Connections → Manage relays to watch both)' "$RELAY2")
  token  ${DEMO_TOKEN}   ← paste under Connections → Manage relays (needed to answer)

A synthetic fleet emits a fresh batch of three sessions every ~30 s; each
batch raises one attention request (10-minute window) — answer it from the
inbox to watch the control round-trip land on the stream.

Ctrl-C tears everything down.
EOF

n=1
while true; do
  agent_batch "$n" 600000
  n=$((n + 1))
  # `sleep` runs backgrounded + `wait`ed so a Ctrl-C/SIGTERM tears down
  # immediately (a foreground sleep would defer the trap until it finishes).
  sleep 30 & wait $! || true
done
