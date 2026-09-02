#!/usr/bin/env bash
# FASE 12 — Teste Orgânico: Trio — movimentos por bisseção
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 12 — Trio — movimentos por bisseção ==="
echo ""

REPORT=$(mktemp)
# Jest 30 não lista nomes de teste que passaram no reporter --verbose (só
# detalha falhas, ver CLAUDE.md Aprendizados críticos) — --json --outputFile
# grava o relatório limpo em arquivo; os nomes saem via jq (mesmo padrão das
# Fases 01/03/05/08/10/11).
npx jest src/modules/finance-reconciliation/infrastructure/trio --json --outputFile="$REPORT" >/dev/null 2>&1
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "specs — exit 0" || fail "specs falharam — exit $STATUS"

NAMES=$(jq -r '.testResults[].assertionResults[].fullName' "$REPORT" 2>/dev/null)
rm -f "$REPORT"

echo "$NAMES" | grep -qi "payment_refund\|778446251\|estorno" \
  && ok "teste de regressão do estorno (Maxima 15/08) presente" \
  || fail "teste de regressão do estorno ausente"

echo "$NAMES" | grep -qi "mesmo microssegundo\|2 linhas\|cursor" \
  && ok "teste de regressão do bug de cursor presente" \
  || fail "teste de regressão do cursor ausente — risco de perder linha em empate de timestamp"

npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas (import cruzado entre módulos?)" \
  || ok "architecture.spec.ts 100% verde"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 12 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 12 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
