#!/usr/bin/env bash
# FASE 13 — Teste Orgânico: Conciliação — use-cases núcleo + API
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
PREFIX="/api/v1"
PASS=0; FAIL=0

ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

TOKEN=$(node scripts/auth-dev-token.js \
  finance.reconciliation.read finance.reconciliation.run finance.reconciliation.resolve)
AUTH="Authorization: Bearer $TOKEN"

check_http() {
  local label="$1" expected="$2"; shift 2
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@")
  [ "$actual" = "$expected" ] && ok "$label → $expected" || fail "$label → esperado $expected, obtido $actual"
}

echo ""
echo "=== FASE 13 — Conciliação (API) ==="
echo ""

# --- 1. sem execução ---
READ_BODY=$(curl -s "$BASE_URL$PREFIX/reconciliation?date=2099-01-01" -H "$AUTH")
echo "$READ_BODY" | grep -q '"NOT_RUN"' && ok "GET reconciliation sem execução → NOT_RUN" \
  || fail "GET reconciliation não sinalizou NOT_RUN"

# --- 2. run responde rápido (202) ---
START=$(date +%s%3N)
RUN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL$PREFIX/reconciliation/run" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-06-15"}')
END=$(date +%s%3N)
ELAPSED=$((END - START))
[ "$RUN_STATUS" = "202" ] && ok "POST run → 202" || fail "POST run → esperado 202, obtido $RUN_STATUS"
[ "$ELAPSED" -lt 2000 ] && ok "POST run respondeu em ${ELAPSED}ms (não bloqueou no request)" \
  || fail "POST run demorou ${ELAPSED}ms — pode estar bloqueando no request"

# --- 3. history cobre todo dia (mesmo sem execução) ---
HISTORY_BODY=$(curl -s "$BASE_URL$PREFIX/reconciliation/history?from=2026-08-01&to=2026-08-15" -H "$AUTH")
echo "$HISTORY_BODY" | grep -q '"rangeDays":15' && ok "GET history cobre os 15 dias do intervalo" \
  || fail "GET history não cobriu o intervalo inteiro"

# --- 4. resolve com nota curta → 400 ---
# `:id` é SERIAL (int), não UUID — ver decisão da Fase 13 (ParseIntPipe, não
# ParseUUIDPipe: o FASE-13.md original citava UUID, incompatível com a PK
# inteira da entidade ReconciliationItem, decisão 4 do CLAUDE.md).
check_http "POST resolve nota curta" 400 -X POST \
  "$BASE_URL$PREFIX/reconciliation/items/999999999/resolve" \
  -H "$AUTH" -H "content-type: application/json" -d '{"note": "curta"}'

# --- 5. resolve de item inexistente com nota válida → 404 ---
check_http "POST resolve item inexistente" 404 -X POST \
  "$BASE_URL$PREFIX/reconciliation/items/999999999/resolve" \
  -H "$AUTH" -H "content-type: application/json" \
  -d '{"note": "Nota de teste com mais de dez caracteres."}'

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 13 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 13 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
