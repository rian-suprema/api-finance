#!/usr/bin/env bash
# FASE 15 — Teste Orgânico: Jobs (CronJob + CLIs)
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 15 — Jobs ==="
echo ""

npm run build >/tmp/fase15-build.log 2>&1 && ok "build compila os CLIs" || fail "build falhou (ver /tmp/fase15-build.log)"

# Reusa um stub já rodando (porta 3100 ocupada) em vez de falhar com EADDRINUSE.
STUB_PID=""
if ! curl -s -o /dev/null --max-time 1 http://localhost:3100/auth/me; then
  node scripts/finance-dev-stubs.js &
  STUB_PID=$!
  sleep 1
fi

node dist/cli/run-reconciliation.js >/tmp/fase15-reconcile.log 2>&1
[ $? -eq 0 ] && ok "CLI run-reconciliation.js executa sem data explícita (default: ontem BRT)" \
  || fail "CLI run-reconciliation.js falhou (ver /tmp/fase15-reconcile.log)"

node dist/cli/export-trio-statement.js --from=2026-08-01 --to=2026-08-02 --out=- \
  >/tmp/fase15-statement.csv 2>/tmp/fase15-statement.log
[ -s /tmp/fase15-statement.csv ] && ok "CLI export-trio-statement escreve em stdout" \
  || fail "CLI export-trio-statement não escreveu em stdout"

[ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null

helm template deploy/helm/api-finance --set image.tag=test >/tmp/fase15-helm.log 2>&1 \
  && ok "helm template renderiza sem erro" || fail "helm template falhou (ver /tmp/fase15-helm.log)"

grep -q "CronJob" /tmp/fase15-helm.log && ok "cronjob.yaml renderizado no output do helm template" \
  || fail "nenhum CronJob encontrado no output do helm template"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 15 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 15 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
