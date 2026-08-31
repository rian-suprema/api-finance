#!/usr/bin/env bash
# FASE 03 — Teste Orgânico: Esqueleto não-funcional
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 03 — Esqueleto não-funcional ==="
echo ""

# 1. Lint + build compilam com os módulos vazios registrados
npx tsc -p tsconfig.json --noEmit >/tmp/fase03-tsc.log 2>&1 \
  && ok "typecheck sem erros" || fail "typecheck falhou (ver /tmp/fase03-tsc.log)"

# 2. Boot falha sem TRIO_AMOUNT_DIVISOR (fail-fast)
ENV_MISSING=$(NODE_ENV=test DB_HOST=x DB_USERNAME=x DB_PASSWORD=x DB_NAME=x \
  CLICKHOUSE_URL=http://x CLICKHOUSE_USER=x CLICKHOUSE_PASSWORD=x \
  TRIO_BASE_URL=http://x TRIO_CLIENT_ID=x TRIO_CLIENT_SECRET=x \
  TRIO_ACCOUNT_ID_SUPREMA=x TRIO_ACCOUNT_ID_ULTRA=x TRIO_ACCOUNT_ID_MAXIMA=x \
  SAYPLUS_API_URL=http://x \
  node -e "require('./src/config/env.validation.ts')" 2>&1 || echo "FALHOU_COMO_ESPERADO")
echo "$ENV_MISSING" | grep -q "FALHOU_COMO_ESPERADO\|required" \
  && ok "boot falha sem TRIO_AMOUNT_DIVISOR (fail-fast confirmado)" \
  || fail "boot NÃO falhou sem TRIO_AMOUNT_DIVISOR — risco de valor errado por 100×"

# 3. architecture.spec.ts — as 2 regras novas existem e passam
# Jest 30 não imprime nomes de teste que passaram no reporter --verbose (só
# detalha falhas) — usar --json + jq (ver Aprendizados críticos da Fase 01).
JSON_OUT=/tmp/fase03-arch.json
npx jest src/architecture.spec.ts --json > "$JSON_OUT" 2>/tmp/fase03-arch.log
NAMES=$(jq -r '.testResults[].assertionResults[].fullName' "$JSON_OUT" 2>/dev/null)
echo "$NAMES" | grep -q "axios cru só existe" \
  && ok "regra allowlist axios presente" || fail "regra allowlist axios ausente"
echo "$NAMES" | grep -q "@clickhouse/client só existe" \
  && ok "regra allowlist @clickhouse/client presente" || fail "regra allowlist ClickHouse ausente"
jq -e '.success == true' "$JSON_OUT" >/dev/null 2>&1 \
  && ok "architecture.spec.ts 100% verde" \
  || fail "architecture.spec.ts com falhas — ver $JSON_OUT"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 03 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 03 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
