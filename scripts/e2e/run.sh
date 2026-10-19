#!/usr/bin/env bash
# End to end proof of build lines 1.4 and 1.5 on Stellar testnet, without a browser wallet:
# disposable Stellar CLI identities play the investor (owner) and the fund wallet (issuer); the API runs locally
# against the disposable Postgres (countersign-pg-test, URL from tests/.env), never the Supabase database.
# Secrets are exported only into this process environment; nothing secret is printed or written.
# Usage: scripts/e2e/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
API="$ROOT/apps/api"
PORT="${E2E_PORT:-3101}"

# cs-e2e-owner plays the investor; cs-demo-<symbol> are the fund wallets of the demo catalog (one per fund)
for id in cs-e2e-owner cs-demo-csagri cs-demo-cshlth cs-demo-cslogi; do
  stellar keys address "$id" >/dev/null 2>&1 || stellar keys generate "$id" --network testnet --fund >/dev/null
  stellar keys fund "$id" --network testnet >/dev/null 2>&1 || true
done
export E2E_OWNER_SECRET="$(stellar keys secret cs-e2e-owner)"
export DEMO_CSAGRI_SECRET="$(stellar keys secret cs-demo-csagri)"
export DEMO_CSHLTH_SECRET="$(stellar keys secret cs-demo-cshlth)"
export DEMO_CSLOGI_SECRET="$(stellar keys secret cs-demo-cslogi)"
export E2E_FUND_SECRET="$DEMO_CSAGRI_SECRET"
export FUND_TOKEN_WASM_HASH="$(grep '^FUND_TOKEN_WASM_HASH=' "$ROOT/apps/api/.env" | cut -d= -f2 | tr -d '"')"

# Disposable database only (tests/.env); the shell variables win over apps/api/.env (dotenv never overrides)
set -a; . "$ROOT/tests/.env"; set +a
if ! [[ "$DATABASE_URL" =~ @(localhost|127\.0\.0\.1):55432/ ]]; then echo "tests/.env must point to the disposable Postgres on 55432" >&2; exit 1; fi
export DIRECT_URL="$DATABASE_URL"
# Ephemeral server secrets for this run (the test database never sees the real ones)
export JWT_SECRET="e2e-$(openssl rand -hex 24)"
export AGENT_KEY_ENCRYPTION_SECRET="$(openssl rand -hex 32)"
export PORT CORS_ORIGIN='*' TRUST_PROXY=false
export NODE_OPTIONS="--dns-result-order=ipv4first"

(cd "$API" && npx prisma migrate deploy >/dev/null)

# Demo catalog on testnet: fund wallets with a USDC trustline and one FundToken each, then the seed (55432 only)
"$API/node_modules/.bin/tsx" "$HERE/setup-demo-funds.ts"

LOG="$(mktemp -t cs-e2e-api.XXXXXX.log)"
(cd "$API" && exec ./node_modules/.bin/tsx src/index.ts) >"$LOG" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
for i in $(seq 1 240); do
  curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -s "http://127.0.0.1:$PORT/health" >/dev/null || { echo "API did not start; log at $LOG" >&2; exit 1; }

export E2E_API="http://127.0.0.1:$PORT"
export E2E_API_LOG="$LOG"
"$API/node_modules/.bin/tsx" "$HERE/e2e.ts" "$@"
