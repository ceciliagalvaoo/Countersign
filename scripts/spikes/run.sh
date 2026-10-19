#!/usr/bin/env bash
# Runs a spike with disposable Stellar CLI identities (created and funded by friendbot when missing).
# Secrets are exported only into this process environment; nothing is printed or written.
# Usage: scripts/spikes/run.sh s1-contract-address.ts | s2-failed-hash.ts [args]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
for id in cs-spike-admin cs-spike-holder cs-spike-issuer; do
  stellar keys address "$id" >/dev/null 2>&1 || stellar keys generate "$id" --network testnet --fund >/dev/null
  stellar keys fund "$id" --network testnet >/dev/null 2>&1 || true
done
export SPIKE_ADMIN_SECRET="$(stellar keys secret cs-spike-admin)"
export SPIKE_HOLDER_SECRET="$(stellar keys secret cs-spike-holder)"
export SPIKE_ISSUER_SECRET="$(stellar keys secret cs-spike-issuer)"
# Public Wasm hash of the current FundToken (read from apps/api/.env without printing other values)
export FUND_TOKEN_WASM_HASH="$(grep '^FUND_TOKEN_WASM_HASH=' "$ROOT/apps/api/.env" | cut -d= -f2 | tr -d '"')"
SCRIPT="$1"; shift
NODE_OPTIONS="--dns-result-order=ipv4first" "$ROOT/apps/api/node_modules/.bin/tsx" "$HERE/$SCRIPT" "$@"
