#!/usr/bin/env bash
#
# smoke-pots.sh — end-to-end smoke test for the Paadi pot-engine surface.
#
# Mock-signup to mint a Bearer token, then exercise the Pots module:
#
#   signup -> create bill_payment pot (3 splits) -> GET /pots/:id
#     -> GET /pay/:token (public payer view) -> idempotent re-create
#
# Prereqs:
#   - API running at $BASE_URL (default http://localhost:3001)
#   - NOMBA_DRIVER=mock, NODE_ENV != production (OTP dev bypass 000000)
#
# Usage: BASE_URL=http://localhost:3010 ./scripts/smoke-pots.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
OTP="000000"

STAMP="$(date +%s)$((RANDOM % 1000))"
SUBSCRIBER="80$(printf '%08d' $((RANDOM % 100000000)))"
PHONE="+234${SUBSCRIBER:0:10}"
USERNAME="pots${STAMP}"
PASSWORD="Sup3rSecret!${STAMP}"
PIN="1357"
IDEMPOTENCY_KEY="smoke-${STAMP}"
TOTAL_KOBO=900000

echo "== Paadi pots smoke =="
echo "   base:  ${BASE_URL}"
echo "   phone: ${PHONE}"
echo ""

jval() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2"; }

HTTP_CODE_FILE="$(mktemp -t paadi-pots-code.XXXXXX)"
trap 'rm -f "$HTTP_CODE_FILE"' EXIT
api() {
  local method="$1" path="$2" body="${3:-}" token="${4:-}" idem="${5:-}"
  local args=(-s -w '\n%{http_code}' -X "$method" "${BASE_URL}${path}" -H 'content-type: application/json')
  [[ -n "$token" ]] && args+=(-H "authorization: Bearer ${token}")
  [[ -n "$idem" ]] && args+=(-H "idempotency-key: ${idem}")
  [[ -n "$body" ]] && args+=(-d "$body")
  local out; out="$(curl "${args[@]}")"
  printf '%s' "${out##*$'\n'}" > "$HTTP_CODE_FILE"
  printf '%s' "${out%$'\n'*}"
}
http_code() { cat "$HTTP_CODE_FILE"; }
expect_2xx() {
  local name="$1" resp="$2" code; code="$(http_code)"
  if [[ "$code" =~ ^2 ]]; then echo "PASS  ${name}  (${code})"; else echo "FAIL  ${name}  (${code})"; echo "      ${resp}"; exit 1; fi
}
assert() { if [[ "$2" == "$3" ]]; then echo "PASS  $1  ($2)"; else echo "FAIL  $1  expected[$3] got[$2]"; exit 1; fi; }

# ---- 0. preflight ----
curl -s -o /dev/null --max-time 3 "${BASE_URL}/docs" || { echo "FAIL preflight — API not reachable at ${BASE_URL}"; exit 1; }
echo "PASS  preflight"

# ---- 1. signup -> token ----
RESP="$(api POST /auth/signup/start "{\"phone\":\"${PHONE}\"}")"; expect_2xx "signup/start" "$RESP"
ONB="$(jval "$RESP" 'd["onboardingToken"]')"
RESP="$(api POST /auth/signup/verify-phone "{\"onboardingToken\":\"${ONB}\",\"code\":\"${OTP}\"}")"; expect_2xx "verify-phone" "$RESP"
RESP="$(api POST /auth/signup/profile "{\"onboardingToken\":\"${ONB}\",\"firstName\":\"Ada\",\"lastName\":\"Okeke\"}")"; expect_2xx "profile" "$RESP"
RESP="$(api POST /auth/signup/username "{\"onboardingToken\":\"${ONB}\",\"username\":\"${USERNAME}\"}")"; expect_2xx "username" "$RESP"
RESP="$(api POST /auth/signup/password "{\"onboardingToken\":\"${ONB}\",\"password\":\"${PASSWORD}\"}")"; expect_2xx "password" "$RESP"
RESP="$(api POST /auth/signup/pin "{\"onboardingToken\":\"${ONB}\",\"pin\":\"${PIN}\"}")"; expect_2xx "pin" "$RESP"
ACCESS="$(jval "$RESP" 'd["accessToken"]')"
echo ""

# ---- 2. create a bill_payment pot (electricity, 3 equal splits) ----
POT_BODY="{\"title\":\"June NEPA - Flat 3B\",\"totalKobo\":${TOTAL_KOBO},\"settlementType\":\"bill_payment\",\"completionRule\":\"progressive\",\"billerCategory\":\"electricity\",\"billerProductCode\":\"phed\",\"billerCustomerId\":\"45678901234\",\"meterType\":\"PREPAID\",\"splits\":[{\"label\":\"Ada\",\"weight\":1},{\"label\":\"Tobi\",\"weight\":1},{\"label\":\"J\",\"weight\":1}]}"
RESP="$(api POST /pots "$POT_BODY" "$ACCESS" "$IDEMPOTENCY_KEY")"; expect_2xx "POST /pots" "$RESP"
POT_ID="$(jval "$RESP" 'd["id"]')"
assert "pot status open" "$(jval "$RESP" 'd["status"]')" "open"
assert "split count" "$(jval "$RESP" 'len(d["splits"])')" "3"
assert "shares sum to total" "$(jval "$RESP" 'sum(s["shareKobo"] for s in d["splits"])')" "$TOTAL_KOBO"
assert "every split has a payToken" "$(jval "$RESP" 'all(bool(s.get("payToken")) for s in d["splits"])')" "True"
assert "every split has a checkoutUrl" "$(jval "$RESP" 'all(bool(s.get("checkoutUrl")) for s in d["splits"])')" "True"
PAY_TOKEN="$(jval "$RESP" 'd["splits"][0]["payToken"]')"
SHARE0="$(jval "$RESP" 'd["splits"][0]["shareKobo"]')"
echo ""

# ---- 3. owner detail ----
RESP="$(api GET "/pots/${POT_ID}" "" "$ACCESS")"; expect_2xx "GET /pots/:id" "$RESP"
assert "detail status open" "$(jval "$RESP" 'd["status"]')" "open"

# ---- 4. public payer view (no auth, no PII) ----
RESP="$(api GET "/pay/${PAY_TOKEN}")"; expect_2xx "GET /pay/:token (public)" "$RESP"
assert "pay-view exposes organizerHandle" "$(jval "$RESP" 'bool(d.get("organizerHandle"))')" "True"
assert "pay-view shows this split amount" "$(jval "$RESP" 'd.get("amountKobo", d.get("shareKobo"))')" "$SHARE0"
assert "pay-view leaks NO phone" "$(jval "$RESP" '"phone" in json.dumps(d).lower()')" "False"
assert "pay-view leaks NO email" "$(jval "$RESP" '"email" in json.dumps(d).lower()')" "False"
echo ""

# ---- 5. idempotent re-create (same key + body) -> same pot ----
RESP="$(api POST /pots "$POT_BODY" "$ACCESS" "$IDEMPOTENCY_KEY")"; expect_2xx "POST /pots (replay)" "$RESP"
assert "idempotent replay returns same pot" "$(jval "$RESP" 'd["id"]')" "$POT_ID"
echo ""

echo "POT_ID=${POT_ID}"
echo "== ALL POT STEPS PASSED =="
