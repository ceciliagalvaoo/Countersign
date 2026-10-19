#!/usr/bin/env bash
# Builds the MandateWallet contract, uploads its Wasm to Stellar testnet and writes MANDATE_WALLET_WASM_HASH
# into apps/api/.env. Each investor deploys her own wallet instance from this hash (like funds do with FundToken).
#
# Isolated on purpose: it only uploads code (no contract instance, no admin) and only touches
# MANDATE_WALLET_WASM_HASH, so it can run without redeploying the FundToken, the ReceivableVault or the BadgeVerifier.
# The source account only pays the upload fee; it gets no rights over any wallet.
#
# Usage: contracts/scripts/upload-mandate-wallet.sh [identity]   (default identity: cs-wasm-uploader)
set -euo pipefail

IDENTITY="${1:-cs-wasm-uploader}"
NETWORK="testnet"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/apps/api/.env"
WASM="$ROOT/contracts/mandate-wallet/target/wasm32v1-none/release/mandate_wallet.wasm"

command -v stellar >/dev/null || { echo "stellar CLI not found (v25.2.0+ required)"; exit 1; }

# Fee payer identity, stored by the CLI outside the repo; friendbot (re)creates the account on testnet
if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  echo "Creating identity '$IDENTITY'..."
  stellar keys generate "$IDENTITY" --network "$NETWORK" --fund
else
  stellar keys fund "$IDENTITY" --network "$NETWORK" >/dev/null 2>&1 || true
fi

echo "Testing and building mandate-wallet..."
(cd "$ROOT/contracts/mandate-wallet" && cargo test --quiet >/dev/null && stellar contract build >/dev/null)

echo "Uploading mandate-wallet Wasm..."
MANDATE_WALLET_WASM_HASH="$(stellar contract upload --wasm "$WASM" --source-account "$IDENTITY" --network "$NETWORK")"

# Write only this variable into apps/api/.env (created from .env.example when missing)
[ -f "$ENV_FILE" ] || cp "$ROOT/apps/api/.env.example" "$ENV_FILE"
if grep -q "^MANDATE_WALLET_WASM_HASH=" "$ENV_FILE"; then
  sed -i.bak "s|^MANDATE_WALLET_WASM_HASH=.*|MANDATE_WALLET_WASM_HASH=\"$MANDATE_WALLET_WASM_HASH\"|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
else
  [ -z "$(tail -c1 "$ENV_FILE")" ] || echo >> "$ENV_FILE"
  echo "MANDATE_WALLET_WASM_HASH=\"$MANDATE_WALLET_WASM_HASH\"" >> "$ENV_FILE"
fi

echo
echo "mandate_wallet Wasm: $MANDATE_WALLET_WASM_HASH"
echo "Saved MANDATE_WALLET_WASM_HASH to $ENV_FILE (also update the API's environment variables on your hosting provider)."
