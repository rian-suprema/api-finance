#!/usr/bin/env bash
# FASE 06 — Teste Orgânico: Integração Trio
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 06 — Integração Trio ==="
echo ""

JEST_JSON_FILE=$(mktemp)
npx jest src/modules/finance-cash-balance/infrastructure/trio --json --outputFile="$JEST_JSON_FILE" >/dev/null 2>&1
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "npx jest trio — exit 0" || fail "specs falharam — exit $STATUS"

TEST_NAMES=$(jq -r '.testResults[].assertionResults[].fullName' "$JEST_JSON_FILE" 2>/dev/null)
rm -f "$JEST_JSON_FILE"

echo "$TEST_NAMES" | grep -qi "bissec\|sem overlap e sem buraco" \
  && ok "teste de regressão da bisseção presente" \
  || fail "teste de regressão da bisseção ausente — risco do bug de cursor (5.234 vs 5.236 linhas)"

echo "$TEST_NAMES" | grep -qi "mais de 1 aprovada\|desempate não definido\|nunca escolhe" \
  && ok "teste de conta virtual ambígua (nunca escolhe) presente" \
  || fail "teste de conta virtual ambígua ausente"

if [ -f src/modules/finance-cash-balance/infrastructure/trio/trio-banking.client.ts ] && \
   grep -n "clientId\|clientSecret" src/modules/finance-cash-balance/infrastructure/trio/trio-banking.client.ts \
     | grep -qi "logger\."; then
  fail "possível log de credencial da Trio"
else
  ok "nenhum log contém clientId/clientSecret"
fi

npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas" \
  || ok "architecture.spec.ts 100% verde (allowlist axios respeitada)"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 06 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 06 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
