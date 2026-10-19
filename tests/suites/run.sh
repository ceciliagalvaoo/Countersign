#!/usr/bin/env bash
# npm --prefix tests run suites [-- --only adversarial|benign]
# Disposable accounts are random keypairs created in process and funded by friendbot: no secret is stored or printed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# Public Wasm hash of the current mandate-wallet (read from apps/api/.env without printing other values)
export MANDATE_WALLET_WASM_HASH="$(grep '^MANDATE_WALLET_WASM_HASH=' "$ROOT/apps/api/.env" | cut -d= -f2 | tr -d '"' || true)"
# Disposable suites database (tests/.env, ignored by git); policy.ts refuses anything but localhost:55432/countersign_suites
export SUITES_DATABASE_URL="$(grep '^SUITES_DATABASE_URL=' "$ROOT/tests/.env" | cut -d= -f2- | tr -d '"' || true)"
NODE_OPTIONS="--dns-result-order=ipv4first" "$ROOT/tests/node_modules/.bin/tsx" "$HERE/index.ts" "$@"
