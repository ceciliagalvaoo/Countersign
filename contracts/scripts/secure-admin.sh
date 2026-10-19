#!/usr/bin/env bash
# Turns the contracts' admin account into a native Stellar multisig account.
#
# After this runs, every admin action on the contracts (admin.require_auth()) needs signatures
# reaching the threshold, and the local CLI key (master key) loses all signing power.
# Recommended: 3 team wallets (e.g. Freighter / hardware wallets) with threshold 2.
#
# Usage: contracts/scripts/secure-admin.sh --threshold 2 G...SIGNER1 G...SIGNER2 G...SIGNER3 [--identity NAME] [--network testnet] [--yes]
#
# WARNING: double-check the signer addresses. With a wrong signer set the admin account is locked forever
# (on testnet you can recover by redeploying with deploy-testnet.sh; on mainnet you cannot).
set -euo pipefail

IDENTITY="cs-admin"
NETWORK="testnet"
THRESHOLD=""
CONFIRMED="no"
SIGNERS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="$2"; shift 2 ;;
    --network) NETWORK="$2"; shift 2 ;;
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --yes) CONFIRMED="yes"; shift ;;
    G*) SIGNERS+=("$1"); shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

[ -n "$THRESHOLD" ] || { echo "--threshold is required"; exit 1; }
[ "${#SIGNERS[@]}" -ge "$THRESHOLD" ] || { echo "Need at least $THRESHOLD signers, got ${#SIGNERS[@]}"; exit 1; }
[ "$THRESHOLD" -ge 2 ] || { echo "Use a threshold of at least 2 (otherwise a single key still controls the admin)"; exit 1; }

ADMIN="$(stellar keys address "$IDENTITY")"
for s in "${SIGNERS[@]}"; do
  [ "$s" != "$ADMIN" ] || { echo "A signer cannot be the admin account itself"; exit 1; }
done

echo "Admin account: $ADMIN ($NETWORK)"
echo "Signers (weight 1 each): ${SIGNERS[*]}"
echo "Threshold: $THRESHOLD of ${#SIGNERS[@]} | local master key weight: 0"
if [ "$CONFIRMED" != "yes" ]; then
  read -r -p "Type 'secure' to apply: " answer
  [ "$answer" = "secure" ] || { echo "Aborted"; exit 1; }
fi

# 1. Add each signer while the master key still has full control (one set-options per signer)
for s in "${SIGNERS[@]}"; do
  stellar tx new set-options --source-account "$IDENTITY" --network "$NETWORK" \
    --signer "$s" --signer-weight 1 >/dev/null
  echo "Added signer $s"
done

# 2. Raise thresholds and remove the master key's weight in a single, final transaction
stellar tx new set-options --source-account "$IDENTITY" --network "$NETWORK" \
  --low-threshold 1 --med-threshold "$THRESHOLD" --high-threshold "$THRESHOLD" --master-weight 0 >/dev/null

echo "Done: $ADMIN is now a $THRESHOLD-of-${#SIGNERS[@]} multisig account. The local key can no longer sign for it."
