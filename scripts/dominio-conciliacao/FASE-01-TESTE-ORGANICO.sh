#!/usr/bin/env bash
# FASE 01 — Teste Orgânico: Domínio puro da Conciliação
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 01 — Domínio puro da Conciliação ==="
echo ""

JSON_OUT=$(mktemp)
# O reporter --verbose do Jest 30 não imprime mais o nome de testes que
# passaram (só de falhas) — --json expõe fullName de cada teste independente
# disso, e é o que este script usa para confirmar que cada cenário rodou.
npx jest src/modules/finance-reconciliation/domain --json > "$JSON_OUT" 2>/tmp/fase01-jest.log
STATUS=$?
NAMES=$(jq -r '.testResults[].assertionResults[].fullName' "$JSON_OUT" 2>/dev/null)
rm -f "$JSON_OUT"

echo "$NAMES" | grep -q "casamento 1:1 por externalKey" \
  && ok "cenário de casamento 1:1 presente e executado" \
  || fail "cenário de casamento 1:1 ausente do relatório do Jest"

echo "$NAMES" | grep -q "estorno" \
  && ok "cenário de liquidação de estorno presente e executado" \
  || fail "cenário de estorno ausente do relatório do Jest"

echo "$NAMES" | grep -qi "PARTIAL" \
  && ok "cenário de correção PARTIAL presente e executado" \
  || fail "cenário PARTIAL ausente do relatório do Jest"

[ "$STATUS" -eq 0 ] && ok "npx jest domain — exit 0" || fail "npx jest domain — exit $STATUS"

# Estrutural: nenhum import de infraestrutura no domínio puro
if grep -rlE "from '(typeorm|@nestjs/typeorm|axios|@clickhouse/client)'" \
     src/modules/finance-reconciliation/domain/ 2>/dev/null | grep -q .; then
  fail "domain/ importa infraestrutura — não é lógica pura"
else
  ok "domain/ sem import de typeorm/axios/@clickhouse/client"
fi

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 01 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 01 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
