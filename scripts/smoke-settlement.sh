#!/usr/bin/env bash
#
# smoke-settlement.sh — thin wrapper for the Chunk-5 settlement live-e2e driver.
#
# Drives apps/api/scripts/settlement-e2e.cjs against a locally running API
# (NOMBA_DRIVER=mock) plus the docker Postgres on :5433. Exercises:
#
#   1. bill_payment electricity pot -> SETTLED + vendToken + balanced ledger
#   2. bank_payout pot (tier-1 user) -> SETTLED + pool.settled
#   3. all_or_nothing pot, past deadline, under target -> REFUNDED + Refund rows
#   4. replay settlement/refund webhook/job -> no second Settlement/Refund
#
# Prereqs:
#   - API running at $BASE_URL (default http://localhost:3010) with
#     NOMBA_DRIVER=mock and NOMBA_WEBHOOK_SIGNING_KEY=devsecret
#   - apps/api built (dist present — the driver requires the compiled dev signer)
#   - docker Postgres reachable via $DATABASE_URL (default :5433)
#   - psql on PATH (or PSQL_BIN pointing at it)
#
# Usage:
#   ./scripts/smoke-settlement.sh
#   BASE_URL=http://localhost:3010 DATABASE_URL=postgresql://paadi:paadi@localhost:5433/paadi ./scripts/smoke-settlement.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRIVER="${ROOT}/apps/api/scripts/settlement-e2e.cjs"
SIGNER="${ROOT}/apps/api/dist/integrations/nomba/dev/sign-nomba-webhook.js"

export BASE_URL="${BASE_URL:-http://localhost:3010}"
export NOMBA_WEBHOOK_SIGNING_KEY="${NOMBA_WEBHOOK_SIGNING_KEY:-devsecret}"
export DATABASE_URL="${DATABASE_URL:-postgresql://paadi:paadi@localhost:5433/paadi}"

if [[ ! -f "$SIGNER" ]]; then
  echo "FAIL  compiled signer missing at ${SIGNER} — build apps/api first (pnpm --filter @paadi/api build)" >&2
  exit 1
fi

if ! curl -s -o /dev/null --max-time 3 "${BASE_URL}/docs"; then
  echo "FAIL  preflight — API not reachable at ${BASE_URL}" >&2
  exit 1
fi

exec node "$DRIVER"
