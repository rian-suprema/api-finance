#!/usr/bin/env bash
# FASE 16 — Teste Orgânico: Contrato do archetype (auditoria)
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
PREFIX="/api/v1"
PASS=0; FAIL=0

ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 16 — Contrato do archetype ==="
echo ""

TOKEN=$(node scripts/auth-dev-token.js finance.cash-balance.summary.read)
SUMMARY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$PREFIX/cash-balance/summary" \
  -H "Authorization: Bearer $TOKEN")
[ "$SUMMARY_STATUS" != "404" ] && ok "rota vive sob $PREFIX (não 404, status=$SUMMARY_STATUS)" || fail "rota não encontrada sob $PREFIX"

DOCS_BODY=$(curl -s "$BASE_URL/docs-json" 2>/dev/null || curl -s "$BASE_URL/api/docs-json" 2>/dev/null)
echo "$DOCS_BODY" | grep -qi "cash-balance" && ok "Swagger lista a tag cash-balance" \
  || fail "Swagger não lista cash-balance (confirmar caminho do JSON: /docs-json ou /api/docs-json)"
echo "$DOCS_BODY" | grep -qi "reconciliation" && ok "Swagger lista a tag reconciliation" \
  || fail "Swagger não lista reconciliation"

# Auditoria de decimalTransformer — contagem exata de colunas monetárias
MONEY_COLUMNS=$(grep -rc "type: 'numeric'" src/modules/finance-*/entities/*.entity.ts | \
  awk -F: '{sum+=$2} END {print sum}')
TRANSFORMED=$(grep -rc "transformer: decimalTransformer" src/modules/finance-*/entities/*.entity.ts | \
  awk -F: '{sum+=$2} END {print sum}')
[ "$MONEY_COLUMNS" = "$TRANSFORMED" ] \
  && ok "todas as $MONEY_COLUMNS colunas monetárias têm decimalTransformer" \
  || fail "$MONEY_COLUMNS colunas numeric vs $TRANSFORMED com transformer — divergência"

grep -n "clickhouse\|trio" src/health/health.controller.ts -i \
  && fail "health.controller.ts referencia ClickHouse/Trio — readiness deveria ser só Postgres" \
  || ok "readiness continua só Postgres"

# overrides.js-yaml — supply chain (js-yaml vulnerável nunca reintroduzido em @nestjs/swagger)
npm ls js-yaml 2>/dev/null | grep -q "js-yaml@5.2.3 overridden" \
  && ok "overrides.js-yaml intacto (@nestjs/swagger em 5.2.3)" \
  || fail "overrides.js-yaml não está aplicado a @nestjs/swagger"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 16 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 16 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
