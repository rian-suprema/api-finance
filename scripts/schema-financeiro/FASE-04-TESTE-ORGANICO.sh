#!/usr/bin/env bash
# FASE 04 — Teste Orgânico: Schema TypeORM
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 04 — Schema TypeORM ==="
echo ""

docker compose up -d postgres >/dev/null 2>&1
sleep 2

npm run migration:run >/tmp/fase04-migrate.log 2>&1 \
  && ok "migration:run aplica sem erro" || fail "migration:run falhou (ver /tmp/fase04-migrate.log)"

FINANCE_TABLES="'cash_balance_days','cash_balance_daily','cash_balance_bank_entries','cash_balance_brand_snapshots','trio_closing_balances','finance_audit_logs','reconciliation_runs','reconciliation_items'"
TABLES=$(docker compose exec -T postgres psql -U users -d users -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ($FINANCE_TABLES);")
[ "${TABLES:-0}" -ge 8 ] && ok "8 tabelas do Finance existem" || fail "menos de 8 tabelas encontradas ($TABLES)"

docker compose exec -T postgres psql -U users -d users -c \
  "INSERT INTO cash_balance_days (reference_date) VALUES ('2026-08-15') RETURNING id;" \
  >/tmp/fase04-serial.log 2>&1 \
  && ok "INSERT sem id explícito funciona (SERIAL confirmado)" \
  || fail "INSERT sem id falhou — PK pode não ser SERIAL"

npm run migration:revert >/tmp/fase04-revert.log 2>&1 \
  && ok "migration:revert desfaz sem erro" || fail "migration:revert falhou (ver /tmp/fase04-revert.log)"

npm run migration:run >/dev/null 2>&1  # deixa aplicado para as próximas fases

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 04 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 04 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
