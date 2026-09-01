#!/usr/bin/env bash
# FASE 07 — Teste Orgânico: Persistência do Balanço de Caixa
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 07 — Persistência do Balanço de Caixa ==="
echo ""

JEST_JSON_FILE=$(mktemp)
npx jest src/modules/finance-cash-balance/infrastructure --json --outputFile="$JEST_JSON_FILE" >/dev/null 2>&1
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "npx jest infrastructure — exit 0" || fail "specs falharam — exit $STATUS"

TEST_NAMES=$(jq -r '.testResults[].assertionResults[].fullName' "$JEST_JSON_FILE" 2>/dev/null)
rm -f "$JEST_JSON_FILE"

echo "$TEST_NAMES" | grep -qi "atômic\|rollback" \
  && ok "teste de atomicidade do registerBrand presente" \
  || fail "teste de atomicidade ausente — risco de caixa meio gravado"

echo "$TEST_NAMES" | grep -qi "soma corrente\|acumulado" \
  && ok "teste de recálculo do acumulado mensal presente" \
  || fail "teste do acumulado mensal ausente"

npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas (controller não pode importar typeorm — ainda não há controller, mas confirma a regra ativa)" \
  || ok "architecture.spec.ts 100% verde"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 07 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 07 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
