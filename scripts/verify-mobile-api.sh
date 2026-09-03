#!/usr/bin/env bash
# Verifies every /api/v1 endpoint the mobile app calls actually answers.
#
# Run it after deploying the backend. A route that is missing returns 404 with
# Express's HTML error page, which is exactly what this catches — the failure
# mode that had IB, copy trading, charts, KYC and signup dead in the app while
# the same features worked on the web.
#
#   ./scripts/verify-mobile-api.sh                      # unauthenticated (401 = route exists)
#   ./scripts/verify-mobile-api.sh <email> <password>   # authenticated (200 = feature works)
#
# Exit code is the number of missing routes, so CI can gate on it.

set -uo pipefail

BASE="${VXNESS_API:-https://api.vxness.in}/api/v1"
EMAIL="${1:-}"
PASSWORD="${2:-}"
TOKEN=""
ACCOUNT=""

if [ -n "$EMAIL" ]; then
  echo "Signing in as $EMAIL ..."
  LOGIN=$(curl -s -m 30 -X POST "$BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
  TOKEN=$(printf '%s' "$LOGIN" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
  if [ -z "$TOKEN" ]; then echo "  login FAILED: $LOGIN"; exit 99; fi
  ACCOUNT=$(curl -s -m 30 -H "Authorization: Bearer $TOKEN" "$BASE/accounts" \
    | sed -n 's/.*"account_id":"\([^"]*\)".*/\1/p' | head -1)
  echo "  ok — account $ACCOUNT"
fi

MISSING=0

check() { # verb path label
  local verb="$1" path="$2" label="$3" code
  if [ -n "$TOKEN" ]; then
    code=$(curl -s -o /dev/null -m 30 -w '%{http_code}' -X "$verb" \
      -H "Authorization: Bearer $TOKEN" "$BASE$path")
  else
    code=$(curl -s -o /dev/null -m 30 -w '%{http_code}' -X "$verb" "$BASE$path")
  fi

  # 404 is the only real failure: it means no such route. 400/401/403 mean the
  # route exists and merely rejected this particular unauthenticated/empty call.
  if [ "$code" = "404" ]; then
    printf '  \033[31mMISSING\033[0m  %-3s %-46s (%s)\n' "$verb" "$path" "$label"
    MISSING=$((MISSING + 1))
  else
    printf '  ok %-4s  %-3s %-46s (%s)\n' "$code" "$verb" "$path" "$label"
  fi
}

echo
echo "== auth & signup =="
check POST /auth/login              "sign in"
check POST /auth/register/start     "signup step 1"
check POST /auth/register/verify    "signup step 2"
check POST /auth/register/resend    "resend code"

echo
echo "== accounts & trading =="
check GET  /accounts                "account list"
check GET  /accounts/available-groups "open new account"
check POST /accounts/open           "open account"
check GET  "/positions/?account_id=$ACCOUNT"        "open positions"
check GET  "/orders?account_id=$ACCOUNT"            "pending orders"
check GET  "/portfolio/trades?account_id=$ACCOUNT"  "trade history"
check GET  /portfolio/summary       "portfolio"
check GET  /portfolio/performance   "equity curve"

echo
echo "== market data =="
check GET  /instruments/            "instrument list"
check GET  /instruments/prices/all  "live prices"
check GET  /instruments/EURUSD/price          "single quote"
check GET  "/instruments/EURUSD/bars?resolution=60&limit=24" "chart bars"

echo
echo "== wallet & funding =="
check GET  /wallet/summary          "wallet balance"
check GET  /wallet/transactions     "transactions"
check GET  /wallet/deposits         "deposit history"
check GET  /wallet/withdrawals      "withdrawal history"
check POST /wallet/deposit/bank-details  "bank details"
check POST /wallet/deposit/manual        "manual deposit"
check POST /wallet/withdraw/manual       "manual withdrawal"
check POST /wallet/deposit/local-banking "local banking"
check POST /wallet/transfer-internal     "account to account"
check POST /wallet/transfer-main-to-trading "wallet to account"
check POST /wallet/transfer-trading-to-main "account to wallet"

echo
echo "== profile & KYC =="
check GET  /profile                 "profile"
check GET  /profile/documents       "KYC status"
check POST /profile/kyc/submit      "KYC submit"

echo
echo "== IB programme =="
check GET  /business/status         "IB status"
check POST /business/apply          "IB apply"
check GET  /business/ib/dashboard   "IB dashboard"
check GET  /business/ib/referrals   "IB referrals"
check GET  /business/ib/commissions "IB commissions"
check GET  /business/ib/tree        "IB downline"

echo
echo "== copy trading =="
check GET  /social/leaderboard      "masters list"
check GET  /social/my-copies        "my subscriptions"
check GET  /social/providers/1      "master detail"
check POST /social/copy             "start copying"
check POST /social/become-provider  "become master"

echo
echo "== prop challenges =="
check GET  /prop/status             "challenge mode"
check GET  /prop/challenges         "challenges list"
check GET  /prop/accounts           "my challenges"
check POST /prop/buy                "buy challenge"

echo
if [ "$MISSING" -eq 0 ]; then
  echo "All routes present."
else
  echo "$MISSING route(s) MISSING — the backend deploy is incomplete or out of date."
fi
exit "$MISSING"
