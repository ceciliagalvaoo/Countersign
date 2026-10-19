#!/usr/bin/env bash
# Compiles the investor tier circuit, runs the Groth16 setup and exports:
#  - apps/new_web/public/zk/investor_tier.{wasm,zkey}  (proof generation in the browser)
#  - keys/vk-soroban.json, keys/verification_key.json  (verification key for the BadgeVerifier contract; versioned)
# Requires circom >= 2.1.6 on PATH. Re-running it produces a NEW proving/verification key pair:
# the BadgeVerifier contract must then be redeployed with the new key.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"
mkdir -p build keys "$ROOT/apps/new_web/public/zk"

[ -d node_modules ] || npm ci

circom circuits/investor_tier.circom --r1cs --wasm -o build

# Phase 1: Perpetual Powers of Tau public ceremony by PSE / Ethereum Foundation (80 contributions).
# 2^10 constraints is enough for this circuit (~716 constraints).
PTAU=build/ppot_0080_10.ptau
[ -f "$PTAU" ] || curl -sSfL -o "$PTAU" https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_10.ptau
# Optional full check of all ceremony contributions (slow: can take over an hour)
if [ "${VERIFY_PTAU:-0}" = "1" ]; then
  npx snarkjs powersoftau verify "$PTAU" | tail -1
fi

# Phase 2 (circuit specific). For production, run a multi-party ceremony instead of a single contribution.
npx snarkjs groth16 setup build/investor_tier.r1cs "$PTAU" build/tier_0000.zkey
npx snarkjs zkey contribute build/tier_0000.zkey build/tier_final.zkey --name="countersign" -e="$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')"
npx snarkjs zkey export verificationkey build/tier_final.zkey keys/verification_key.json
node scripts/export-vk.mjs keys/verification_key.json keys/vk-soroban.json

cp build/investor_tier_js/investor_tier.wasm "$ROOT/apps/new_web/public/zk/investor_tier.wasm"
cp build/tier_final.zkey "$ROOT/apps/new_web/public/zk/investor_tier.zkey"
echo "Done. Verification key for the contract: zk/badge/keys/vk-soroban.json (redeploy the BadgeVerifier)"
