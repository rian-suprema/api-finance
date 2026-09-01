#!/usr/bin/env bash
# FASE 05 — Teste Orgânico: Integração ClickHouse
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 05 — Integração ClickHouse ==="
echo ""

JEST_JSON_FILE=$(mktemp)
npx jest src/clickhouse --json --outputFile="$JEST_JSON_FILE" >/dev/null 2>&1
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "npx jest src/clickhouse — exit 0" || fail "specs falharam — exit $STATUS"

TEST_NAMES=$(jq -r '.testResults[].assertionResults[].fullName' "$JEST_JSON_FILE" 2>/dev/null)
rm -f "$JEST_JSON_FILE"
echo "$TEST_NAMES" | grep -qi "query_params\|nunca interpola" \
  && ok "cenário de query_params (nunca interpolação) presente" \
  || fail "cenário de query_params ausente do relatório"

# Estrutural: nenhuma interpolação de template literal dentro de clickhouse.service.ts na query
if [ -f src/clickhouse/clickhouse.service.ts ] && grep -nE '\`[^\`]*\$\{[^}]*\}[^\`]*\`' src/clickhouse/clickhouse.service.ts | grep -qi "select\|SELECT"; then
  fail "possível interpolação de SQL dentro de clickhouse.service.ts"
else
  ok "nenhuma interpolação de SQL encontrada em clickhouse.service.ts"
fi

# Regra de allowlist do architecture.spec.ts continua verde
npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas" \
  || ok "architecture.spec.ts 100% verde (allowlist ClickHouse respeitada)"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 05 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 05 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
