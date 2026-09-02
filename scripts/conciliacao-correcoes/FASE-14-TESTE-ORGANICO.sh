#!/usr/bin/env bash
# FASE 14 — Teste Orgânico: Conciliação — evidência de correção de saldo
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
PREFIX="/api/v1"
PASS=0; FAIL=0

ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

TOKEN=$(node scripts/auth-dev-token.js \
  finance.reconciliation.read finance.reconciliation.run finance.reconciliation.resolve)
AUTH="Authorization: Bearer $TOKEN"

echo ""
echo "=== FASE 14 — Conciliação: evidência de correção de saldo ==="
echo ""

# 0. Dispara a conciliação real (stub) para popular reconciliation_items —
# corrections search lê só o Postgres, precisa de um run concluído antes.
curl -s -o /dev/null -X POST "$BASE_URL$PREFIX/reconciliation/run" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-06-15"}'
for _ in $(seq 1 20); do
  STATUS_BODY=$(curl -s "$BASE_URL$PREFIX/reconciliation?date=2026-06-15" -H "$AUTH")
  echo "$STATUS_BODY" | grep -q '"brand":"suprema","status":"DONE"' && break
  sleep 0.5
done

# 1. Marca sem pendência de saque com CPF (nunca rodou conciliação) → searchedCount:0
ULTRA_BODY=$(curl -s "$BASE_URL$PREFIX/reconciliation/ultra/corrections?date=2026-06-15" -H "$AUTH")
echo "$ULTRA_BODY" | grep -q '"searchedCount":0' && ok "GET corrections (ultra, sem pendência) → searchedCount:0" \
  || fail "GET corrections (ultra) esperado searchedCount:0, obtido: $ULTRA_BODY"

# 2. Busca real na Suprema: 4 pendências candidatas (as 4 do lado banco, saque, CPF preenchido)
SEARCH_BODY=$(curl -s "$BASE_URL$PREFIX/reconciliation/suprema/corrections?date=2026-06-15" -H "$AUTH")
echo "$SEARCH_BODY" | grep -q '"searchedCount":4' && ok "GET corrections (suprema) → searchedCount:4" \
  || fail "GET corrections (suprema) esperado searchedCount:4, obtido: $SEARCH_BODY"

# 3. Pendência sem client_id conhecido (HELIO, CPF 88888888888) → clientResolved:false, candidates:[]
echo "$SEARCH_BODY" | grep -q '"clientResolved":false' && ok "há item com clientResolved:false (CPF não identificado)" \
  || fail "nenhum item com clientResolved:false"

# 4. Candidato exato (FABIO/IVONE, EXACT_SAME_BRAND, exact:true)
echo "$SEARCH_BODY" | grep -q '"confidence":"EXACT_SAME_BRAND"' && echo "$SEARCH_BODY" | grep -q '"exact":true' \
  && ok "há candidato EXACT_SAME_BRAND com exact:true" \
  || fail "nenhum candidato EXACT_SAME_BRAND/exact:true encontrado"

# 5. Candidato PARTIAL (GISELE, valor diferente) → exact:false
echo "$SEARCH_BODY" | grep -q '"confidence":"PARTIAL"' && ok "há candidato PARTIAL (evidência parcial)" \
  || fail "nenhum candidato PARTIAL encontrado"

# 6. POST apply → 201, resolvedCount:2 (FABIO + IVONE), partialCount:1 (GISELE), withoutCandidateCount:1 (HELIO)
APPLY_STATUS=$(curl -s -o /tmp/apply-body.json -w "%{http_code}" -X POST \
  "$BASE_URL$PREFIX/reconciliation/suprema/corrections/apply?date=2026-06-15" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-06-15"}')
[ "$APPLY_STATUS" = "201" ] && ok "POST corrections/apply → 201" \
  || fail "POST corrections/apply → esperado 201, obtido $APPLY_STATUS"

APPLY_BODY=$(cat /tmp/apply-body.json)
echo "$APPLY_BODY" | grep -q '"resolvedCount":2' && ok "apply resolveu 2 pendências (correção exata)" \
  || fail "apply esperado resolvedCount:2, obtido: $APPLY_BODY"
echo "$APPLY_BODY" | grep -q '"partialCount":1' && ok "apply manteve 1 pendência aberta (PARTIAL nunca dá baixa)" \
  || fail "apply esperado partialCount:1, obtido: $APPLY_BODY"
echo "$APPLY_BODY" | grep -q '"withoutCandidateCount":1' && ok "apply reporta 1 sem candidato (CPF não identificado)" \
  || fail "apply esperado withoutCandidateCount:1, obtido: $APPLY_BODY"

# 7. Idempotência: segunda chamada de apply → resolvedCount:0
APPLY_BODY_2=$(curl -s -X POST "$BASE_URL$PREFIX/reconciliation/suprema/corrections/apply?date=2026-06-15" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-06-15"}')
echo "$APPLY_BODY_2" | grep -q '"resolvedCount":0' && ok "segunda chamada de apply é idempotente (resolvedCount:0)" \
  || fail "segunda chamada de apply não foi idempotente: $APPLY_BODY_2"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 14 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 14 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
