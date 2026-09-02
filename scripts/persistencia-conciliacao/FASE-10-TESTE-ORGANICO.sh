#!/usr/bin/env bash
# FASE 10 — Teste Orgânico: Persistência da Conciliação
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 10 — Persistência da Conciliação ==="
echo ""

REPORT=$(mktemp)
# Jest 30 não lista mais nomes de teste que passaram no reporter --verbose (só
# detalha falhas) — e --json capturado via stdout vem contaminado quando o
# código sob teste usa Logger/console. --json --outputFile grava o relatório
# limpo em arquivo; os nomes saem de testResults[].assertionResults[].fullName
# via jq (mesmo padrão das Fases 01/03/05).
npx jest src/modules/finance-reconciliation/infrastructure --json --outputFile="$REPORT" >/dev/null 2>&1
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "npx jest infrastructure — exit 0" || fail "specs falharam — exit $STATUS"

NAMES=$(jq -r '.testResults[].assertionResults[].fullName' "$REPORT")
rm -f "$REPORT"

echo "$NAMES" | grep -qi "nunca sobrescreve\|nota human" \
  && ok "teste de preservação de nota humana presente" \
  || fail "teste de preservação de nota humana ausente — risco de apagar trabalho de operador"

echo "$NAMES" | grep -qi "idempotente" \
  && ok "teste de idempotência da baixa em lote presente" \
  || fail "teste de idempotência ausente"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 10 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 10 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
