#!/usr/bin/env bash
# 3.4 tamper check: copies the disposable e2e database (countersign_test) to countersign_tamper, alters ONE decision
# log row in the copy (trigger disabled only in the copy), runs the evidence export against the copy into a scratch
# folder, and expects it to FAIL. The real databases and evidence/ are never written. No secret is printed.
# Usage: npm --prefix tests run evidence:tamper-check
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
URL="$(grep '^DATABASE_URL=' "$ROOT/tests/.env" | cut -d= -f2- | tr -d '"')"
PGUSER_="$(python3 -c 'import sys;from urllib.parse import urlparse;print(urlparse(sys.argv[1]).username)' "$URL")"
TAMPER_URL="$(python3 -c 'import sys;from urllib.parse import urlparse;u=urlparse(sys.argv[1]);print(u._replace(path="/countersign_tamper").geturl())' "$URL")"
[[ "$URL" =~ @(localhost|127\.0\.0\.1):55432/countersign_test ]] || { echo "tests/.env DATABASE_URL must be the disposable countersign_test on 55432" >&2; exit 2; }
PSQL=(docker exec countersign-pg-test psql -U "$PGUSER_" -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS countersign_tamper" -c "CREATE DATABASE countersign_tamper TEMPLATE countersign_test"
trap '"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS countersign_tamper" >/dev/null 2>&1 || true' EXIT
SEQ="$("${PSQL[@]}" -d countersign_tamper -At -c "SELECT seq FROM decision_logs WHERE payload LIKE '%\"rule\":\"subscribe\"%' ORDER BY seq LIMIT 1")"
"${PSQL[@]}" -d countersign_tamper -c "ALTER TABLE decision_logs DISABLE TRIGGER USER" \
  -c "UPDATE decision_logs SET payload = replace(payload, '\"amountUnits\":\"', '\"amountUnits\":\"9') WHERE seq = $SEQ"
echo "tampered row $SEQ of the copy (amount changed); running the export against the copy"
SCRATCH="$(mktemp -d)"
set +e
EVIDENCE_E2E_DATABASE_URL="$TAMPER_URL" EVIDENCE_OUT_DIR="$SCRATCH" "$ROOT/apps/api/node_modules/.bin/tsx" "$ROOT/scripts/evidence/export.ts" > "$SCRATCH/out.txt" 2>&1
CODE=$?
set -e
grep -E "log e2e|FAILED|chain" "$SCRATCH/out.txt" | head -5
if [ "$CODE" -ne 0 ]; then echo "TAMPER CHECK PASSED: the export failed (exit $CODE) on the altered copy"; exit 0; fi
echo "TAMPER CHECK FAILED: the export accepted an altered log" >&2; exit 1
