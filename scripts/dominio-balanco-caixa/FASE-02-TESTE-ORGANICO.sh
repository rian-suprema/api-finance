#!/usr/bin/env bash
# FASE 02 — Teste Orgânico: Domínio puro do Balanço de Caixa
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 02 — Domínio puro do Balanço de Caixa ==="
echo ""

JSON_OUT=$(mktemp)
# Jest 30 não imprime nomes de teste que passaram no reporter --verbose (só de
# falhas) — --json expõe fullName de cada teste independente disso (ver
# CLAUDE.md, Aprendizados críticos — Fase 01).
npx jest src/modules/finance-cash-balance/domain --json > "$JSON_OUT" 2>/tmp/fase02-jest.log
STATUS=$?
NAMES=$(jq -r '.testResults[].assertionResults[].fullName' "$JSON_OUT" 2>/dev/null)
rm -f "$JSON_OUT"

echo "$NAMES" | grep -qi "sinal\|transacional menos jogadores" \
  && ok "teste nomeado pelo sinal do Total do Balanço presente" \
  || fail "nenhum teste nomeado explicitamente pelo sinal — risco de regressão silenciosa"

[ "$STATUS" -eq 0 ] && ok "npx jest domain — exit 0" || fail "npx jest domain — exit $STATUS"

if grep -rlE "from '(typeorm|@nestjs/typeorm|axios|@clickhouse/client)'" \
     src/modules/finance-cash-balance/domain/ 2>/dev/null | grep -q .; then
  fail "domain/ importa infraestrutura"
else
  ok "domain/ sem import de infraestrutura"
fi

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 02 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 02 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
