#!/usr/bin/env bash
# Builds and deploys the contracts to Stellar testnet and writes their IDs into apps/api/.env:
#  - uploads the FundToken Wasm (each approved fund deploys its own FundToken instance from this hash)
#  - deploys a reference FundToken instance and the platform-wide ReceivableVault (admin = the identity below)
#  - deploys the BadgeVerifier (ZK investor tiers) with the circuit's verification key (zk/badge/keys)
#    and a fresh attestation key, whose secret goes only to apps/api/.env (BADGE_ATTESTER_SECRET)
#  - uploads the MandateWallet Wasm (each investor deploys her own agent wallet from this hash),
#    through contracts/scripts/upload-mandate-wallet.sh
# Run it again after every testnet reset.
#
# Usage: contracts/scripts/deploy-testnet.sh [identity]   (default: the admin CLI identity set in IDENTITY below)
#        contracts/scripts/deploy-testnet.sh --mandate-wallet-only [identity]
#          only uploads the MandateWallet Wasm and writes MANDATE_WALLET_WASM_HASH; nothing else is deployed or changed
# Optional env: FUND_NAME, FUND_SYMBOL, MAX_SUPPLY
set -euo pipefail

if [ "${1:-}" = "--mandate-wallet-only" ]; then
  shift
  exec "$(dirname "${BASH_SOURCE[0]}")/upload-mandate-wallet.sh" "$@"
fi

IDENTITY="${1:-cs-admin}"
NETWORK="testnet"
FUND_NAME="${FUND_NAME:-Reference Fund}"
FUND_SYMBOL="${FUND_SYMBOL:-REF}"
MAX_SUPPLY="${MAX_SUPPLY:-1000000000000000}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/apps/api/.env"

command -v stellar >/dev/null || { echo "stellar CLI not found (v25.2.0+ required)"; exit 1; }

# Create and fund the admin identity if it does not exist yet (stored by the CLI outside the repo)
if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  echo "Creating identity '$IDENTITY'..."
  stellar keys generate "$IDENTITY" --network "$NETWORK" --fund
else
  # After a testnet reset the account no longer exists; friendbot re-creates it
  stellar keys fund "$IDENTITY" --network "$NETWORK" >/dev/null 2>&1 || true
fi
ADMIN="$(stellar keys address "$IDENTITY")"

echo "Building contracts..."
(cd "$ROOT/contracts/fund-token" && stellar contract build >/dev/null)
(cd "$ROOT/contracts/receivable-vault" && stellar contract build >/dev/null)
(cd "$ROOT/contracts/badge-verifier" && stellar contract build >/dev/null)

echo "Uploading fund-token Wasm..."
FUND_TOKEN_WASM_HASH="$(stellar contract upload \
  --wasm "$ROOT/contracts/fund-token/target/wasm32v1-none/release/fund_token.wasm" \
  --source-account "$IDENTITY" --network "$NETWORK")"

echo "Deploying reference fund-token..."
FUND_TOKEN_ID="$(stellar contract deploy \
  --wasm "$ROOT/contracts/fund-token/target/wasm32v1-none/release/fund_token.wasm" \
  --source-account "$IDENTITY" --network "$NETWORK" --alias fund_token \
  -- --admin "$ADMIN" --name "$FUND_NAME" --symbol "$FUND_SYMBOL" --max_supply "$MAX_SUPPLY")"

# Payment asset (USDC) as a Stellar Asset Contract: the vault receives receivable payments and pays them out in it
PAYMENT_TOKEN_ID="$(cd "$ROOT/apps/api" && node -e "const S=require('@stellar/stellar-sdk'); console.log(new S.Asset(process.argv[1], process.argv[2]).contractId(S.Networks.TESTNET))" "${PAYMENT_ASSET_CODE:-USDC}" "${PAYMENT_ASSET_ISSUER:-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56}")"

echo "Deploying receivable-vault..."
VAULT_ID="$(stellar contract deploy \
  --wasm "$ROOT/contracts/receivable-vault/target/wasm32v1-none/release/receivable_vault.wasm" \
  --source-account "$IDENTITY" --network "$NETWORK" --alias receivable_vault \
  -- --admin "$ADMIN" --fund_token_address "$FUND_TOKEN_ID" --payment_token "$PAYMENT_TOKEN_ID")"

VK_FILE="$ROOT/zk/badge/keys/vk-soroban.json"
[ -f "$VK_FILE" ] || { echo "Missing $VK_FILE: run 'npm run build' in zk/badge first"; exit 1; }
# Attestation key: signs investors' commitments off-chain; the contract only stores its public key
# Reuse an existing key so BADGE_ATTESTER_SECRET in apps/api/.env keeps matching; generate only on a fresh machine
stellar keys address cs-badge-attester >/dev/null 2>&1 || stellar keys generate cs-badge-attester >/dev/null
ATTESTER_HEX="$(cd "$ROOT/apps/api" && node -e "console.log(require('@stellar/stellar-sdk').StrKey.decodeEd25519PublicKey(process.argv[1]).toString('hex'))" "$(stellar keys address cs-badge-attester)")"
VK_ARG="$(node -e "const v=require(process.argv[1]); console.log(JSON.stringify({alpha:v.alpha,beta:v.beta,gamma:v.gamma,delta:v.delta,ic:v.ic}))" "$VK_FILE")"

echo "Deploying badge-verifier..."
BADGE_ID="$(stellar contract deploy \
  --wasm "$ROOT/contracts/badge-verifier/target/wasm32v1-none/release/badge_verifier.wasm" \
  --source-account "$IDENTITY" --network "$NETWORK" --alias badge_verifier \
  -- --admin "$ADMIN" --attester "$ATTESTER_HEX" --vk "$VK_ARG")"

# Write the IDs into apps/api/.env (created from .env.example when missing)
[ -f "$ENV_FILE" ] || cp "$ROOT/apps/api/.env.example" "$ENV_FILE"
set_env() {
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i.bak "s|^$1=.*|$1=\"$2\"|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "$1=\"$2\"" >> "$ENV_FILE"
  fi
}
set_env FUND_TOKEN_CONTRACT_ID "$FUND_TOKEN_ID"
set_env FUND_TOKEN_WASM_HASH "$FUND_TOKEN_WASM_HASH"
set_env RECEIVABLE_VAULT_CONTRACT_ID "$VAULT_ID"
set_env STELLAR_ADMIN_ADDRESS "$ADMIN"
set_env BADGE_VERIFIER_CONTRACT_ID "$BADGE_ID"
set_env BADGE_ATTESTER_SECRET "$(stellar keys secret cs-badge-attester)"

# MandateWallet: upload only (no instance); writes MANDATE_WALLET_WASM_HASH
"$ROOT/contracts/scripts/upload-mandate-wallet.sh" "$IDENTITY"

echo
echo "Admin:            $ADMIN"
echo "fund_token Wasm:  $FUND_TOKEN_WASM_HASH"
echo "fund_token:       $FUND_TOKEN_ID"
echo "receivable_vault: $VAULT_ID"
echo "badge_verifier:   $BADGE_ID"
echo "Saved to $ENV_FILE (also update the API's environment variables on your hosting provider)."
