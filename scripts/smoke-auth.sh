#!/usr/bin/env bash
#
# smoke-auth.sh — end-to-end smoke test for the Paadi auth surface.
#
# Runs the full happy path against a locally running API using the dev OTP
# bypass (000000) and the GOOGLE/KYC mock drivers:
#
#   signup -> login(phone) -> login(username) -> refresh -> /me
#     -> email start+verify -> kyc bvn+selfie -> /transfers/banks
#     -> payout lookup+create -> notification-preferences GET -> logout
#
# Prereqs:
#   - API running at $BASE_URL (default http://localhost:3001), e.g. `make api`
#   - Dojah driver = mock, Google driver = mock (defaults in configuration.ts)
#   - OTP dev bypass enabled (NODE_ENV != production; OTP_DEV_BYPASS_CODE=000000)
#
# Usage:
#   ./scripts/smoke-auth.sh                 # random-ish phone suffix
#   ./scripts/smoke-auth.sh 8123456789      # explicit 10-digit NG subscriber number
#   BASE_URL=http://localhost:3001 ./scripts/smoke-auth.sh
#
# JSON is parsed with python3 (stdlib only). Each step prints a PASS/FAIL line;
# any non-2xx / missing field aborts the run with a non-zero exit code.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
OTP="000000"

# ---- phone: explicit arg, else random-ish NG mobile subscriber number --------
if [[ "${1:-}" != "" ]]; then
  SUBSCRIBER="$1"
else
  # 70/80/81/90/91 prefixes are valid NG mobile ranges; pad to 10 digits.
  HEAD="$(printf '%01d' $((RANDOM % 2)))0$((RANDOM % 9))"
  TAIL="$(printf '%07d' $((RANDOM % 10000000)))"
  SUBSCRIBER="8${HEAD}${TAIL}"
  SUBSCRIBER="${SUBSCRIBER:0:10}"
fi
PHONE="+234${SUBSCRIBER}"

# unique-ish handles/emails so re-runs don't collide
STAMP="$(date +%s)$((RANDOM % 1000))"
USERNAME="smoke${STAMP}"
EMAIL="smoke${STAMP}@example.com"
PASSWORD="Sup3rSecret!${STAMP}"
PIN="1357"
ACCOUNT_NUMBER="0123456789"

# mock Dojah test BVN whose record name must match the signup profile name
# (see apps/api/src/integrations/dojah/mock-kyc.provider.ts)
BVN="11111111111"
FIRST_NAME="Chidi"
LAST_NAME="Nwosu"

echo "== Paadi auth smoke =="
echo "   base:     ${BASE_URL}"
echo "   phone:    ${PHONE}"
echo "   username: ${USERNAME}"
echo "   email:    ${EMAIL}"
echo ""

# ---- helpers -----------------------------------------------------------------

# jval <json> <python-expression-on-d>   ->   prints extracted value
jval() {
  python3 -c '
import json, sys
d = json.loads(sys.argv[1])
print(eval(sys.argv[2]))
' "$1" "$2"
}

# api METHOD PATH [BODY] [BEARER]  -> echoes response body, records HTTP_CODE
#
# Callers invoke this as `RESP="$(api ...)"`, which runs in a command-
# substitution subshell. A plain global assignment would be lost when that
# subshell exits, so the status code is stashed in a temp file that the
# parent shell reads back via http_code().
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

# http_code  -> prints the status code recorded by the most recent api() call
http_code() {
  cat "$HTTP_CODE_FILE"
}

# expect_2xx <step-name> <response-body>
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

# ---- 0. preflight ------------------------------------------------------------
if ! curl -s -o /dev/null --max-time 3 "${BASE_URL}/docs"; then
  echo "FAIL  preflight  — API not reachable at ${BASE_URL} (start it with: make api)"
  exit 1
fi
echo "PASS  preflight  — API reachable"
echo ""

# ---- 1. signup ---------------------------------------------------------------
echo "-- signup --"
RESP="$(api POST /auth/signup/start "{\"phone\":\"${PHONE}\"}")"
expect_2xx "signup/start" "$RESP"
ONBOARDING="$(jval "$RESP" 'd["onboardingToken"]')"

RESP="$(api POST /auth/signup/verify-phone "{\"onboardingToken\":\"${ONBOARDING}\",\"code\":\"${OTP}\"}")"
expect_2xx "signup/verify-phone" "$RESP"

RESP="$(api POST /auth/signup/profile "{\"onboardingToken\":\"${ONBOARDING}\",\"firstName\":\"${FIRST_NAME}\",\"lastName\":\"${LAST_NAME}\"}")"
expect_2xx "signup/profile" "$RESP"

RESP="$(api GET "/auth/username/available?u=${USERNAME}")"
expect_2xx "username/available" "$RESP"
AVAILABLE="$(jval "$RESP" 'd["available"]')"
echo "      available=${AVAILABLE}"

RESP="$(api POST /auth/signup/username "{\"onboardingToken\":\"${ONBOARDING}\",\"username\":\"${USERNAME}\"}")"
expect_2xx "signup/username" "$RESP"

RESP="$(api POST /auth/signup/password "{\"onboardingToken\":\"${ONBOARDING}\",\"password\":\"${PASSWORD}\"}")"
expect_2xx "signup/password" "$RESP"

RESP="$(api POST /auth/signup/pin "{\"onboardingToken\":\"${ONBOARDING}\",\"pin\":\"${PIN}\"}")"
expect_2xx "signup/pin" "$RESP"
ACCESS="$(jval "$RESP" 'd["accessToken"]')"
echo "      session issued (TIER_0)"
echo ""

# ---- 2. login by phone -------------------------------------------------------
echo "-- login --"
RESP="$(api POST /auth/login "{\"identifier\":\"${PHONE}\",\"password\":\"${PASSWORD}\"}")"
expect_2xx "login(phone)" "$RESP"
ACCESS="$(jval "$RESP" 'd["accessToken"]')"
REFRESH="$(jval "$RESP" 'd["refreshToken"]')"

# ---- 3. login by username ----------------------------------------------------
RESP="$(api POST /auth/login "{\"identifier\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")"
expect_2xx "login(username)" "$RESP"
ACCESS="$(jval "$RESP" 'd["accessToken"]')"
REFRESH="$(jval "$RESP" 'd["refreshToken"]')"
echo ""

# ---- 4. refresh --------------------------------------------------------------
echo "-- refresh --"
RESP="$(api POST /auth/refresh "{\"refreshToken\":\"${REFRESH}\"}")"
expect_2xx "refresh" "$RESP"
ACCESS="$(jval "$RESP" 'd["accessToken"]')"
REFRESH="$(jval "$RESP" 'd["refreshToken"]')"
echo ""

# ---- 5. /me ------------------------------------------------------------------
echo "-- me --"
RESP="$(api GET /me "" "$ACCESS")"
expect_2xx "GET /me" "$RESP"
echo "      tier=$(jval "$RESP" 'd["tier"]')  username=$(jval "$RESP" 'd["profile"]["username"]')"
echo ""

# ---- 6. email start + verify -------------------------------------------------
echo "-- email --"
RESP="$(api POST /me/email/start "{\"email\":\"${EMAIL}\"}" "$ACCESS")"
expect_2xx "email/start" "$RESP"

RESP="$(api POST /me/email/verify "{\"code\":\"${OTP}\"}" "$ACCESS")"
expect_2xx "email/verify" "$RESP"
echo "      email verified: $(jval "$RESP" 'd["email"]')"
echo ""

# ---- 7. kyc bvn + selfie -----------------------------------------------------
echo "-- kyc --"
RESP="$(api POST /me/kyc/bvn "{\"bvn\":\"${BVN}\"}" "$ACCESS")"
expect_2xx "kyc/bvn" "$RESP"
echo "      $(jval "$RESP" 'd["status"]')"

RESP="$(api POST /me/kyc/selfie "{\"image\":\"data:image/jpeg;base64,SMOKE\"}" "$ACCESS")"
expect_2xx "kyc/selfie" "$RESP"
echo "      status=$(jval "$RESP" 'd["status"]')  tier=$(jval "$RESP" 'd["tier"]')"

RESP="$(api GET /me/kyc "" "$ACCESS")"
expect_2xx "GET /me/kyc" "$RESP"
echo ""

# ---- 8. banks ----------------------------------------------------------------
echo "-- payout --"
RESP="$(api GET /transfers/banks "" "$ACCESS")"
expect_2xx "transfers/banks" "$RESP"
BANK_CODE="$(jval "$RESP" 'd["banks"][0]["code"]')"
echo "      using bank code ${BANK_CODE}"

# ---- 9. payout lookup + create ----------------------------------------------
RESP="$(api POST /me/payout-accounts/lookup "{\"bankCode\":\"${BANK_CODE}\",\"accountNumber\":\"${ACCOUNT_NUMBER}\"}" "$ACCESS")"
expect_2xx "payout/lookup" "$RESP"
echo "      accountName=$(jval "$RESP" 'd["accountName"]')"

RESP="$(api POST /me/payout-accounts "{\"bankCode\":\"${BANK_CODE}\",\"accountNumber\":\"${ACCOUNT_NUMBER}\",\"pin\":\"${PIN}\"}" "$ACCESS")"
expect_2xx "payout/create" "$RESP"
echo "      payout account $(jval "$RESP" 'd["id"]')  primary=$(jval "$RESP" 'd["isPrimary"]')"
echo ""

# ---- 10. notification preferences -------------------------------------------
echo "-- notifications --"
RESP="$(api GET /me/notification-preferences "" "$ACCESS")"
expect_2xx "notification-preferences" "$RESP"
echo "      preferences=$(jval "$RESP" 'len(d["preferences"])')"
echo ""

# ---- 11. logout --------------------------------------------------------------
echo "-- logout --"
RESP="$(api POST /auth/logout "" "$ACCESS")"
expect_2xx "logout" "$RESP"
echo ""

echo "== ALL STEPS PASSED =="
