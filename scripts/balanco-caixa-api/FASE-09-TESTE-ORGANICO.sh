#!/usr/bin/env bash
# FASE 09 — Teste Orgânico: Balanço de Caixa — API completa
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
PREFIX="/api/v1"
PASS=0; FAIL=0

ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

TOKEN_FULL=$(node scripts/auth-dev-token.js \
  finance.cash-balance.summary.read finance.cash-balance.banks.read \
  finance.cash-balance.banks.confirm finance.cash-balance.register.create)
AUTH="Authorization: Bearer $TOKEN_FULL"

check_http() {
  local label="$1" expected="$2"; shift 2
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@")
  [ "$actual" = "$expected" ] && ok "$label → $expected" || fail "$label → esperado $expected, obtido $actual"
}

echo ""
echo "=== FASE 09 — Balanço de Caixa (API) ==="
echo ""

# --- 1. summary sem date ---
check_http "GET /cash-balance/summary" 200 "$BASE_URL$PREFIX/cash-balance/summary" -H "$AUTH"

# --- 2. banks ---
BANKS_BODY=$(curl -s "$BASE_URL$PREFIX/cash-balance/banks" -H "$AUTH")
echo "$BANKS_BODY" | grep -q '"trio"' && ok "GET banks lista o banco trio" || fail "GET banks não lista trio"

# --- 3. history ---
check_http "GET history (intervalo válido)" 200 \
  "$BASE_URL$PREFIX/cash-balance/history?from=2026-08-01&to=2026-08-15" -H "$AUTH"
check_http "GET history (intervalo > 180 dias)" 400 \
  "$BASE_URL$PREFIX/cash-balance/history?from=2025-01-01&to=2026-08-15" -H "$AUTH"

# --- 4. trio/refresh sem captura ---
REFRESH_BODY=$(curl -s "$BASE_URL$PREFIX/cash-balance/trio/refresh?date=2099-01-01" -H "$AUTH")
echo "$REFRESH_BODY" | grep -q '"available":false' \
  && ok "trio/refresh sem captura → available:false" || fail "trio/refresh não sinalizou available:false"

# --- 5. confirm banco trio → 400 ---
check_http "POST confirm bank=trio" 400 -X POST \
  "$BASE_URL$PREFIX/cash-balance/suprema/banks/trio/confirm" \
  -H "$AUTH" -H "content-type: application/json" -d '{"balance": 100}'

# --- 6. confirm banco manual → 204 ---
check_http "POST confirm bank=caixa" 204 -X POST \
  "$BASE_URL$PREFIX/cash-balance/suprema/banks/caixa/confirm?date=2026-08-20" \
  -H "$AUTH" -H "content-type: application/json" -d '{"balance": 1000.50, "date": "2026-08-20"}'

# --- 7. register com campo extra → 400 ---
check_http "POST register com campo extra" 400 -X POST \
  "$BASE_URL$PREFIX/cash-balance/suprema/register" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-08-20", "balance": 999}'

# --- 8. register com bancos incompletos → 400 + pendingBanks ---
REGISTER_INCOMPLETE=$(curl -s -X POST "$BASE_URL$PREFIX/cash-balance/suprema/register" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-08-20"}')
echo "$REGISTER_INCOMPLETE" | grep -q "pendingBanks" \
  && ok "register incompleto devolve pendingBanks" || fail "register incompleto sem pendingBanks (ver GlobalExceptionFilter)"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 09 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 09 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
