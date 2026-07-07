#!/usr/bin/env bash
#
# smoke-api-keys.sh — end-to-end smoke test for the Paadi API-key surface.
#
# Exercises the machine-access layer against a locally running API:
#
#   signup+login (session) -> mint scoped key -> read with key (200)
#     -> introspect key (/me/api-keys/current) -> mint-with-key (403)
#     -> out-of-scope withdraw (403) -> garbage JWT (401, not 500)
#     -> list keys (no secret) -> revoke -> revoked key rejected (401)
#     -> burst past RATE_LIMIT_API_KEY_LIMIT (429 + Retry-After)
#
# Prereqs:
#   - API running at $BASE_URL (default http://localhost:3001), e.g. `make api`
#   - OTP dev bypass enabled (NODE_ENV != production; OTP_DEV_BYPASS_CODE=000000)
#
# Usage:
#   ./scripts/smoke-api-keys.sh
#   BASE_URL=http://localhost:3001 ./scripts/smoke-api-keys.sh
#
# The rate-limit burst asserts against RATE_LIMIT_API_KEY_LIMIT (default 60);
# override RATE_BURST to match a custom limit.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
OTP="000000"
RATE_BURST="${RATE_BURST:-70}"

HEAD="$(printf '%01d' $((RANDOM % 2)))0$((RANDOM % 9))"
TAIL="$(printf '%07d' $((RANDOM % 10000000)))"
SUBSCRIBER="8${HEAD}${TAIL}"
PHONE="+234${SUBSCRIBER:0:10}"

STAMP="$(date +%s)$((RANDOM % 1000))"
USERNAME="keysmoke${STAMP}"
PASSWORD="Sup3rSecret!${STAMP}"
PIN="1357"

echo "== Paadi api-keys smoke =="
echo "   base:     ${BASE_URL}"
echo "   phone:    ${PHONE}"
echo "   username: ${USERNAME}"
echo ""

# ---- helpers (same pattern as smoke-auth.sh) ----------------------------------

jval() {
  python3 -c '
import json, sys
d = json.loads(sys.argv[1])
print(eval(sys.argv[2]))
' "$1" "$2"
}

HTTP_CODE_FILE="$(mktemp -t paadi-smoke-code.XXXXXX)"
trap 'rm -f "$HTTP_CODE_FILE"' EXIT
api() {
  local method="$1" path="$2" body="${3:-}" token="${4:-}"
  local args=(-s -w '\n%{http_code}' -X "$method" "${BASE_URL}${path}" -H 'content-type: application/json')
  [[ -n "$token" ]] && args+=(-H "authorization: Bearer ${token}")
  [[ -n "$body" ]] && args+=(-d "$body")
  local out
  out="$(curl "${args[@]}")"
  printf '%s' "${out##*$'\n'}" > "$HTTP_CODE_FILE"
  printf '%s' "${out%$'\n'*}"
}

http_code() {
  cat "$HTTP_CODE_FILE"
}

expect_2xx() {
  local name="$1" resp="$2"
  local HTTP_CODE
  HTTP_CODE="$(http_code)"
  if [[ "$HTTP_CODE" =~ ^2 ]]; then
    echo "PASS  ${name}  (${HTTP_CODE})"
  else
    echo "FAIL  ${name}  (${HTTP_CODE})"
    echo "      ${resp}"
    exit 1
  fi
}

# expect_status <expected-code> <step-name> <response-body>
expect_status() {
  local want="$1" name="$2" resp="$3"
  local HTTP_CODE
  HTTP_CODE="$(http_code)"
  if [[ "$HTTP_CODE" == "$want" ]]; then
    echo "PASS  ${name}  (${HTTP_CODE})"
  else
    echo "FAIL  ${name}  (wanted ${want}, got ${HTTP_CODE})"
    echo "      ${resp}"
    exit 1
  fi
}

# ---- 0. preflight ------------------------------------------------------------
if ! curl -s -o /dev/null --max-time 3 "${BASE_URL}/docs"; then
  echo "FAIL  preflight  — API not reachable at ${BASE_URL} (start it with: make api)"
  exit 1
fi
echo "PASS  preflight  — API reachable"
echo ""

# ---- 1. session bootstrap (signup + login) ------------------------------------
echo "-- session bootstrap --"
RESP="$(api POST /auth/signup/start "{\"phone\":\"${PHONE}\"}")"
expect_2xx "signup start" "$RESP"
ONBOARDING="$(jval "$RESP" 'd["onboardingToken"]')"

RESP="$(api POST /auth/signup/verify-phone "{\"onboardingToken\":\"${ONBOARDING}\",\"code\":\"${OTP}\"}")"
expect_2xx "verify phone" "$RESP"

RESP="$(api POST /auth/signup/profile "{\"onboardingToken\":\"${ONBOARDING}\",\"firstName\":\"Chidi\",\"lastName\":\"Nwosu\"}")"
expect_2xx "profile" "$RESP"

RESP="$(api POST /auth/signup/username "{\"onboardingToken\":\"${ONBOARDING}\",\"username\":\"${USERNAME}\"}")"
expect_2xx "username" "$RESP"

RESP="$(api POST /auth/signup/password "{\"onboardingToken\":\"${ONBOARDING}\",\"password\":\"${PASSWORD}\"}")"
expect_2xx "password" "$RESP"

RESP="$(api POST /auth/signup/pin "{\"onboardingToken\":\"${ONBOARDING}\",\"pin\":\"${PIN}\"}")"
expect_2xx "pin -> session" "$RESP"
ACCESS="$(jval "$RESP" 'd["accessToken"]')"
echo ""

# ---- 2. mint a scoped key ------------------------------------------------------
echo "-- mint --"
RESP="$(api POST /me/api-keys '{"name":"smoke key","scopes":["pots:read","wallet:read","profile:read"]}' "$ACCESS")"
expect_2xx "mint scoped key" "$RESP"
KEY="$(jval "$RESP" 'd["key"]')"
KEY_ID="$(jval "$RESP" 'd["id"]')"
PREFIX="$(jval "$RESP" 'd["prefix"]')"
if [[ "$KEY" == pk_test_* ]]; then
  echo "PASS  key has pk_test_ prefix (${PREFIX}...)"
else
  echo "FAIL  key prefix unexpected: ${KEY:0:12}"
  exit 1
fi
echo ""

# ---- 3. use the key -------------------------------------------------------------
echo "-- key usage --"
RESP="$(api GET /me/wallet "" "$KEY")"
expect_2xx "GET /me/wallet with key (wallet:read)" "$RESP"

RESP="$(api GET /pots "" "$KEY")"
expect_2xx "GET /pots with key (pots:read)" "$RESP"

RESP="$(api GET /me/api-keys/current "" "$KEY")"
expect_2xx "introspect key (/me/api-keys/current)" "$RESP"
MODE="$(jval "$RESP" 'd["mode"]')"
[[ "$MODE" == "test" ]] && echo "PASS  introspection reports mode=test" || { echo "FAIL mode=${MODE}"; exit 1; }
echo ""

# ---- 4. scope + management boundaries -------------------------------------------
echo "-- boundaries --"
RESP="$(api POST /me/api-keys '{"name":"nope","scopes":["pots:read"]}' "$KEY")"
expect_status 403 "key cannot mint keys" "$RESP"

RESP="$(api POST /me/wallet/withdraw '{"amountKobo":1000,"pin":"1357"}' "$KEY")"
expect_status 403 "withdraw without wallet:withdraw scope" "$RESP"

RESP="$(api GET /me/kyc "" "$KEY")"
expect_status 403 "unannotated route default-denies keys" "$RESP"

RESP="$(api GET /me/wallet "" "garbage.jwt.here")"
expect_status 401 "garbage JWT is 401, not 500" "$RESP"

RESP="$(api GET /me/wallet "" "notajwt")"
expect_status 401 "dotless garbage token is 401, not 500" "$RESP"
echo ""

# ---- 5. list + revoke ------------------------------------------------------------
echo "-- lifecycle --"
RESP="$(api GET /me/api-keys "" "$ACCESS")"
expect_2xx "list keys (session)" "$RESP"
if echo "$RESP" | grep -q "$KEY"; then
  echo "FAIL  plaintext key leaked in list response"
  exit 1
else
  echo "PASS  list response never contains the secret"
fi

RESP="$(api DELETE "/me/api-keys/${KEY_ID}" "" "$ACCESS")"
expect_2xx "revoke key" "$RESP"

RESP="$(api GET /me/wallet "" "$KEY")"
expect_status 401 "revoked key rejected immediately" "$RESP"
echo ""

# ---- 6. rate limit ---------------------------------------------------------------
echo "-- rate limit --"
RESP="$(api POST /me/api-keys '{"name":"burst key","scopes":["pots:read"]}' "$ACCESS")"
expect_2xx "mint burst key" "$RESP"
BURST_KEY="$(jval "$RESP" 'd["key"]')"

GOT_429=""
for i in $(seq 1 "$RATE_BURST"); do
  api GET /pots "" "$BURST_KEY" > /dev/null
  if [[ "$(http_code)" == "429" ]]; then
    GOT_429="yes"
    break
  fi
done
if [[ "$GOT_429" == "yes" ]]; then
  echo "PASS  429 returned after burst (request ${i})"
else
  echo "FAIL  no 429 after ${RATE_BURST} requests — rate limiting not enforcing"
  exit 1
fi

RETRY_AFTER="$(curl -s -o /dev/null -D - -H "authorization: Bearer ${BURST_KEY}" "${BASE_URL}/pots" | tr -d '\r' | awk -F': ' 'tolower($1)=="retry-after" {print $2}')"
if [[ -n "$RETRY_AFTER" ]]; then
  echo "PASS  Retry-After header present (${RETRY_AFTER}s)"
else
  echo "FAIL  Retry-After header missing on 429"
  exit 1
fi

echo ""
echo "== ALL STEPS PASSED =="
