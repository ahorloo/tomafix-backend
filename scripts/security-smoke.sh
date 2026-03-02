#!/usr/bin/env bash
set -euo pipefail

API_BASE="${1:-https://tomafix-api.onrender.com/api/v1}"

echo "[security-smoke] API_BASE=$API_BASE"

check() {
  local name="$1"
  local expected="$2"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$3")
  if [[ "$code" == "$expected" ]]; then
    echo "✅ $name => $code"
  else
    echo "❌ $name => got $code expected $expected"
  fi
}

check "billing health" "200" "$API_BASE/billing/health"
check "unauth notices blocked" "403" "$API_BASE/workspaces/test/operations/notices"
check "unauth tenant dashboard blocked" "403" "$API_BASE/workspaces/test/tenant/dashboard"

reconcile_code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_BASE/billing/reconcile/run" -H 'content-type: application/json' -d '{}')
if [[ "$reconcile_code" == "200" ]]; then
  echo "✅ reconcile admin endpoint responds"
else
  echo "❌ reconcile admin endpoint => got $reconcile_code expected 200"
fi

otp_code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_BASE/auth/login/otp/send" -H 'content-type: application/json' -d '{}')
if [[ "$otp_code" == "400" || "$otp_code" == "429" ]]; then
  echo "✅ otp validation/rate-limit guard => $otp_code"
else
  echo "❌ otp validation/rate-limit guard => got $otp_code expected 400/429"
fi
