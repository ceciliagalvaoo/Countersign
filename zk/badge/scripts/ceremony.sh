#!/usr/bin/env bash
# Multi-party Groth16 phase 2 ceremony for the investor tier circuit.
# The proving key is secure as long as at least ONE participant destroys their entropy, so run it with several
# independent people (team members, auditors, partners), each on their own machine.
#
#   1. Coordinator:  scripts/ceremony.sh init                       -> ceremony/tier_0000.zkey
#   2. Participant N (in turn, passing the previous file along):
#                    scripts/ceremony.sh contribute ceremony/tier_000{N-1}.zkey ceremony/tier_000N.zkey "Name"
#                    (snarkjs asks for random text; type it, then forget it. Publish the printed contribution hash)
#   3. Anyone:       scripts/ceremony.sh verify ceremony/tier_000N.zkey   (checks the whole contribution chain)
#   4. Coordinator:  scripts/ceremony.sh finalize ceremony/tier_000N.zkey <beacon-hex>
#                    <beacon-hex>: a public value fixed before the ceremony ends, e.g. a future Stellar ledger hash
#                    -> keys/vk-soroban.json + browser artifacts; then redeploy the BadgeVerifier
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"
PTAU=build/ppot_0080_10.ptau
R1CS=build/investor_tier.r1cs

need_circuit() {
  [ -d node_modules ] || npm ci
  [ -f "$R1CS" ] || circom circuits/investor_tier.circom --r1cs --wasm -o build
  [ -f "$PTAU" ] || curl -sSfL -o "$PTAU" https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_10.ptau
}

case "${1:-}" in
  init)
    need_circuit
    mkdir -p ceremony
    npx snarkjs groth16 setup "$R1CS" "$PTAU" ceremony/tier_0000.zkey
    echo "Send ceremony/tier_0000.zkey to the first participant."
    ;;
  contribute)
    [ $# -eq 4 ] || { echo "Usage: $0 contribute <in.zkey> <out.zkey> <name>"; exit 1; }
    [ -d node_modules ] || npm ci
    # No -e flag: snarkjs prompts for the participant's own entropy
    npx snarkjs zkey contribute "$2" "$3" --name="$4"
    echo "Publish the contribution hash above, then pass $3 to the next participant."
    ;;
  verify)
    [ $# -eq 2 ] || { echo "Usage: $0 verify <zkey>"; exit 1; }
    need_circuit
    npx snarkjs zkey verify "$R1CS" "$PTAU" "$2"
    ;;
  finalize)
    [ $# -eq 3 ] || { echo "Usage: $0 finalize <last.zkey> <beacon-hex>"; exit 1; }
    need_circuit
    npx snarkjs zkey verify "$R1CS" "$PTAU" "$2"
    npx snarkjs zkey beacon "$2" build/tier_final.zkey "$3" 10 -n="Final beacon"
    npx snarkjs zkey verify "$R1CS" "$PTAU" build/tier_final.zkey
    npx snarkjs zkey export verificationkey build/tier_final.zkey keys/verification_key.json
    node scripts/export-vk.mjs keys/verification_key.json keys/vk-soroban.json
    mkdir -p "$ROOT/apps/new_web/public/zk"
    cp build/investor_tier_js/investor_tier.wasm "$ROOT/apps/new_web/public/zk/investor_tier.wasm"
    cp build/tier_final.zkey "$ROOT/apps/new_web/public/zk/investor_tier.zkey"
    echo "Done. Redeploy the BadgeVerifier with keys/vk-soroban.json (contracts/scripts/deploy-testnet.sh)"
    echo "and regenerate the contract test fixture: npm run fixture"
    ;;
  *)
    sed -n '2,16p' "$0"
    exit 1
    ;;
esac
