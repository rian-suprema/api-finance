#!/usr/bin/env bash
# FASE 11 — Teste Orgânico: ClickHouse da Conciliação
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 11 — ClickHouse da Conciliação ==="
echo ""

REPORT=$(mktemp)
# Jest 30 não lista nomes de teste que passaram no reporter --verbose (só
# detalha falhas, ver CLAUDE.md Aprendizados críticos) — --json --outputFile
# grava o relatório limpo em arquivo; os nomes saem via jq (mesmo padrão das
# Fases 01/03/05/08/10).
npx jest src/modules/finance-reconciliation/infrastructure/clickhouse --json --outputFile="$REPORT" >/dev/null 2>&1
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "specs — exit 0" || fail "specs falharam — exit $STATUS"

NAMES=$(jq -r '.testResults[].assertionResults[].fullName' "$REPORT" 2>/dev/null)
rm -f "$REPORT"

echo "$NAMES" | grep -qi "transaction_date\|deposit_ts" \
  && ok "teste do instante correto por fluxo presente" \
  || fail "teste do instante por fluxo ausente — risco de diferença de caixa sem pendência (caso real R\$5.755,00)"

grep -c "FINAL" src/modules/finance-reconciliation/infrastructure/clickhouse/*.ts 2>/dev/null | \
  awk -F: '{sum+=$2} END {exit (sum>=4)?0:1}' \
  && ok "FINAL presente nas queries de fct_deposit/fct_withdrawal/fct_correction" \
  || fail "FINAL ausente em alguma query — risco de linha duplicada"

# O grep literal do FASE-11.md também casava com o comentário JSDoc que
# EXPLICA por que source_system não é filtrado (mesma categoria de defeito de
# template já documentada nas Fases 01/03/04/05/08/10) — restrito às linhas de
# dentro das template strings SQL (entre as duas linhas de crase por query),
# nunca a comentários de código.
grep -n "source_system" src/modules/finance-reconciliation/infrastructure/clickhouse/platform-movements.service.ts \
  | grep -v '^\s*[0-9]*: \?\*' \
  && fail "filtro de source_system encontrado — abriria pendência falsa" \
  || ok "sem filtro de source_system"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 11 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 11 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
