#!/usr/bin/env bash
# Mainnet slice (build line 3.6, decision D25). Every step that sends a transaction shows the decoded call and the
# simulated fee and stops for an explicit human confirmation typed in this terminal. Nothing is sent otherwise.
# Keys: cs-mainnet-agent (agent key, fees of subscribe) and cs-mainnet-uploader (fees of the Wasm uploads) live only
# in the Stellar CLI keystore; their secrets are exported into this process only and never printed or written.
# The owner (GCMB...) and the test fund wallet (GCKZ...) sign in Freighter: the script writes the unsigned XDR, the
# human signs it (Stellar Lab, network Mainnet, "Sign transaction" with Freighter) and saves the signed XDR to a file.
# Usage: scripts/mainnet/run.sh <step> [args]   (scripts/mainnet/run.sh help)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
for id in cs-mainnet-agent cs-mainnet-uploader; do
  stellar keys address "$id" >/dev/null 2>&1 || { echo "missing CLI identity $id (stellar keys generate $id)" >&2; exit 1; }
done
export MAINNET_AGENT_SECRET="$(stellar keys secret cs-mainnet-agent)"
export MAINNET_UPLOADER_SECRET="$(stellar keys secret cs-mainnet-uploader)"
export NODE_OPTIONS="--dns-result-order=ipv4first"
exec "$ROOT/apps/api/node_modules/.bin/tsx" "$HERE/slice.ts" "$@"
