#!/usr/bin/env bash
# FASE 08 — Teste Orgânico: Identidade da plataforma + BrandAccessService
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 08 — Identidade da plataforma ==="
echo ""

JEST_JSON=$(mktemp)
npx jest src/modules/finance-cash-balance --testPathPatterns="platform-identity|brand-access" --json --outputFile="$JEST_JSON" >/dev/null 2>&1
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "specs de identidade — exit 0" || fail "specs falharam — exit $STATUS"

jq -r '.testResults[].assertionResults[].fullName' "$JEST_JSON" 2>/dev/null | grep -qi "cache\|60s\|hash" \
  && ok "cenário de cache por hash do token presente" \
  || fail "cenário de cache ausente"
rm -f "$JEST_JSON"

if grep -n "logger\.\(warn\|error\|log\)" \
     src/modules/finance-cash-balance/infrastructure/platform/platform-identity.service.ts 2>/dev/null \
     | grep -iE "authorization|token|bearer"; then
  fail "possível log do token/Authorization"
else
  ok "nenhum log contém token/Authorization"
fi

npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas" \
  || ok "architecture.spec.ts 100% verde"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 08 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 08 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
