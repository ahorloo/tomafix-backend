#!/usr/bin/env bash
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-https://www.tomafix.com}"
API_BASE="${API_BASE:-https://tomafix-api.onrender.com/api/v1}"
EXPECT_CALLBACK_URL="${EXPECT_CALLBACK_URL:-https://tomafix.com/onboarding/payment-success}"

failures=0

pass() {
  echo "✅ $1"
}

fail() {
  echo "❌ $1"
  failures=$((failures + 1))
}

fetch() {
  local url="$1"
  local output
  output="$(mktemp)"
  local code
  code="$(curl -sS -L -o "$output" -w "%{http_code}" "$url" || true)"
  local body
  body="$(cat "$output")"
  rm -f "$output"
  printf '%s\n%s' "$code" "$body"
}

echo "[production-smoke] FRONTEND_URL=$FRONTEND_URL"
echo "[production-smoke] API_BASE=$API_BASE"
echo "[production-smoke] EXPECT_CALLBACK_URL=$EXPECT_CALLBACK_URL"

frontend_result="$(fetch "$FRONTEND_URL")"
frontend_code="$(printf '%s' "$frontend_result" | sed -n '1p')"
frontend_body="$(printf '%s' "$frontend_result" | sed '1d')"
if [[ "$frontend_code" == "200" && "$frontend_body" == *"TomaFix 3.0"* ]]; then
  pass "frontend root is live"
else
  fail "frontend root expected 200 + TomaFix shell, got $frontend_code"
fi

for route in /privacy /terms; do
  route_result="$(fetch "${FRONTEND_URL}${route}")"
  route_code="$(printf '%s' "$route_result" | sed -n '1p')"
  if [[ "$route_code" == "200" ]]; then
    pass "frontend route ${route} responds"
  else
    fail "frontend route ${route} expected 200, got $route_code"
  fi
done

health_result="$(fetch "$API_BASE/health")"
health_code="$(printf '%s' "$health_result" | sed -n '1p')"
health_body="$(printf '%s' "$health_result" | sed '1d')"
if [[ "$health_code" == "200" && "$health_body" == *'"ok":true'* ]]; then
  pass "api health route responds"
else
  fail "api health route expected 200 + ok=true, got $health_code"
fi

billing_result="$(fetch "$API_BASE/billing/health")"
billing_code="$(printf '%s' "$billing_result" | sed -n '1p')"
billing_body="$(printf '%s' "$billing_result" | sed '1d')"
if [[ "$billing_code" == "200" && "$billing_body" == *'"ok":true'* ]]; then
  pass "billing health responds"
else
  fail "billing health expected 200 + ok=true, got $billing_code"
fi

if [[ "$billing_body" == *'"mode":"live"'* && "$billing_body" == *'"configured":true'* ]]; then
  pass "billing is configured for live mode"
else
  fail "billing health did not report live configured Paystack"
fi

if [[ "$billing_body" == *"\"callbackUrl\":\"${EXPECT_CALLBACK_URL}\""* ]]; then
  pass "billing callback matches expected frontend success route"
else
  fail "billing callback did not match EXPECT_CALLBACK_URL"
fi

public_result="$(fetch "$API_BASE/public/workspaces/test/office/info")"
public_code="$(printf '%s' "$public_result" | sed -n '1p')"
public_body="$(printf '%s' "$public_result" | sed '1d')"
if [[ "$public_code" == "404" && "$public_body" == *"Workspace not available"* ]]; then
  pass "public office route is deployed and returns controller-level 404"
elif [[ "$public_body" == *"Cannot GET /api/v1/public/workspaces/test/office/info"* ]]; then
  fail "public office route is missing from the deployed backend"
else
  fail "public office route returned unexpected response ($public_code)"
fi

guard_result="$(fetch "$API_BASE/workspaces/test/operations/notices")"
guard_code="$(printf '%s' "$guard_result" | sed -n '1p')"
if [[ "$guard_code" == "401" || "$guard_code" == "403" ]]; then
  pass "protected operations route is blocked without auth"
else
  fail "protected operations route expected 401/403, got $guard_code"
fi

if [[ "$failures" -gt 0 ]]; then
  echo "[production-smoke] FAILURES=$failures"
  exit 1
fi

echo "[production-smoke] all checks passed"
