# FASE 07 — Persistência do Balanço de Caixa (repositórios + read-service)
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 35**
> Limite: _4 arquivos · risco: transação incompleta no `registerBrand` (grava um caixa que não existiu) e recálculo de acumulado mensal fora de transação_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `CashBalanceRepository` (TypeORM, único ponto que toca as entidades do balanço),
`TrioClosingBalanceRepository` e `ClickHouseReadService` (leitura tipada dos 3 marts usados pelo
balanço) existem, com as transações multi-tabela do `registerBrand` e do `recomputeMonthlyAccumulated`
íntegras.

## Pré-requisito

Fase 04 concluída (entidades + migration aplicada) e Fase 05 concluída (`ClickHouseService`).

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/modules/finance-cash-balance/entities/*.entity.ts` (as 6 entidades da Fase 04) — nomes exatos das colunas TypeScript
- `src/clickhouse/clickhouse.service.ts` — assinatura de `query<T>`
- `docs/migracao-finance/DADOS-FINANCE.md` (seção 8.3) — os 7 blocos transacionais que não podem regredir

### Prompt para Haiku

> Leia os arquivos. Esta fase escreve `cash-balance.repository.ts` usando `Repository<CashBalanceDay>`,
> `Repository<CashBalanceDaily>` etc., e `clickhouse-read.service.ts` usando `ClickHouseService.query()`.
>
> Verifique:
> 1. Os nomes de propriedade TypeScript das 6 entidades (`referenceDate`, `dayId`, `tenantId`, etc.)
>    batem com o que o repositório vai referenciar em `where`/`create`.
> 2. `ClickHouseService.query<T>(query, params)` aceita `params: Record<string, string | readonly
>    string[]>` — os parâmetros de data/marca do balanço (`data_referencia`, `data_inicio`,
>    `data_final`) são sempre `string`.
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

_(unitários com TypeORM `DataSource` de teste — Testcontainers já entra na Fase 17; aqui, testes
unitários do repositório usam um Postgres efêmero simples via `@testcontainers/postgresql`, já
dependência do projeto)_

1. **`registerBrand` é atômico:** forçar uma falha no meio da transação (ex.: violar constraint em
   `bank_entries`) e confirmar que **nenhuma** linha ficou gravada (nem `cash_balance_days`, nem
   `cash_balance_daily`) — rollback completo.
2. **`registerBrand` fecha o dia só com as 3 marcas confirmadas:** registrar 2 marcas → `dayClosed:
   false`; registrar a 3ª → `dayClosed: true`, `cash_balance_days.status = 'CLOSED'`.
3. **`recomputeMonthlyAccumulated` é soma corrente, em ordem de data:** 3 dias do mesmo mês/marca,
   inserir fora de ordem, recalcular → cada dia recebe a soma de si mesmo + dias anteriores (não
   posteriores).
4. **`findLastKnownBalances`:** 2 consultas fixas, nunca uma por marca (contar chamadas ao
   `DataSource.query`/spy no `Repository` confirma número constante independente da quantidade de
   marcas).
5. **`reopenBrand`:** reabre a marca (`DRAFT`) e o dia (`OPEN`) na mesma transação — nunca um sem o
   outro.
6. **ClickHouse read-service — `fetchPlayersBalances`:** parseia `saldo_financeiro_total_disponivel_apostadores`
   como `number` (via `toNumber`), nunca como string crua.
7. **ClickHouse read-service — normalização de marca:** `marca = 'Suprema'` (capitalizado, como o
   mart devolve) mapeia para a chave `'suprema'` (minúscula, como o domínio usa).

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/persistencia-balanco-caixa/FASE-07-TESTE-ORGANICO.sh` agora. Resultado esperado:
> RED — os repositórios ainda não existem.

## Arquivos a criar

### `src/modules/finance-cash-balance/cash-balance.constants.ts`
**Motivo:** catálogo de marcas e bancos, consumido pelo repositório (nesta fase) e por todo o resto do
módulo dali para frente. Portar literalmente: `BRAND_KEYS`, `BrandKey`, `BrandConfig`, `BRANDS` (3
marcas com `tenantSlug`/`trioAccountEnvKey` — **ajustar** `trioAccountEnvKey` para o formato de
`trioConfig.accountIds` da Fase 03, já que não lemos mais `process.env` direto), `BankType`,
`BankConfig`, `BANKS` (8 bancos), `TRIO_BANK_KEY`, `HISTORY_DEFAULT_RANGE_DAYS = 15`,
`HISTORY_MAX_RANGE_DAYS = 180`, `MANUAL_BANKS`, `findBrand`, `findBank`. **Ajustar** o
`ClosingBalanceSource` port (Fase 06) e `kpi-card.util.ts` (Fase 02) para importar `BrandKey` deste
arquivo em vez do `type BrandKey = string` provisório — atualizar os 2 imports como parte desta fase.

### `src/modules/finance-cash-balance/infrastructure/cash-balance.repository.ts`
**Motivo:** único ponto que toca TypeORM para as 4 tabelas do balanço. Portar literalmente da origem,
traduzindo Prisma → `Repository`/`QueryBuilder`: `findDay`, `findLastKnownBalances` (2 queries fixas),
`findRegisteredRange`, `findRegisteredKeys`, `findTenantIdsByBrand`, `importBrandBalance` (transação),
`recomputeMonthlyAccumulated` (transação, ordem de data), `closeCompleteDays`, `confirmBank`,
`registerBrand` (a transação mais importante — 6 operações, ver
`docs/migracao-finance/DADOS-FINANCE.md` §8.3), `reopenBrand` (transação de 2 updates),
`sumMonthlyBalances`, `ensureDaily`. Usa `@InjectDataSource()` + `DataSource.transaction()` — **não**
`tenantManager()`/RLS do esqueleto (decisão registrada: Finance não usa a RLS de tenant único, ver
`CLAUDE.md`).

### `src/modules/finance-cash-balance/infrastructure/trio-closing-balance.repository.ts`
**Motivo:** persistência do fechamento capturado. Portar `findByDate`, `save` (com o `create` +
tratamento de violação de unicidade — no TypeORM/`pg`, código `23505`, não `P2002` do Prisma —
quando `overwrite = false`).

### `src/modules/finance-cash-balance/infrastructure/clickhouse/clickhouse-read.service.ts`
**Motivo:** leitura tipada dos 3 marts que o balanço consome. Portar literalmente as 4 queries
(`DAILY_KPI_QUERY`, `MONTHLY_KPI_QUERY`, `DAILY_KPI_BY_BRAND_RANGE_QUERY`, `PLAYERS_BALANCE_QUERY`),
a normalização de marca (`BRAND_NORMALIZATION`, `toBrandKey`), e os métodos `fetchDailyKpis`,
`fetchMonthlyKpis`, `fetchKpisByDayAndBrand`, `fetchPlayersBalances`. **`FINAL`** obrigatório na query
de saldo de jogadores (`fct_sigap_saldo_diario FINAL`) — sem ele, linha não deduplicada infla o saldo.

## Atualizar arquivo de registro de rotas/servidor

`src/modules/finance-cash-balance/cash-balance.module.ts` — registrar `TypeOrmModule.forFeature([
CashBalanceDay, CashBalanceDaily, CashBalanceBankEntry, CashBalanceBrandSnapshot, TrioClosingBalance,
FinanceAuditLog])` e os 4 providers desta fase, exportando os repositórios/serviços para as Fases 08/09.

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/persistencia-balanco-caixa/FASE-07-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 07 — Teste Orgânico: Persistência do Balanço de Caixa
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 07 — Persistência do Balanço de Caixa ==="
echo ""

OUTPUT=$(npx jest src/modules/finance-cash-balance/infrastructure --verbose 2>&1)
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "npx jest infrastructure — exit 0" || fail "specs falharam — exit $STATUS"

echo "$OUTPUT" | grep -qi "atômic\|rollback" \
  && ok "teste de atomicidade do registerBrand presente" \
  || fail "teste de atomicidade ausente — risco de caixa meio gravado"

echo "$OUTPUT" | grep -qi "soma corrente\|acumulado" \
  && ok "teste de recálculo do acumulado mensal presente" \
  || fail "teste do acumulado mensal ausente"

npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas (controller não pode importar typeorm — ainda não há controller, mas confirma a regra ativa)" \
  || ok "architecture.spec.ts 100% verde"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 07 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 07 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/persistencia-balanco-caixa/FASE-07-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/trio-integracao/FASE-06-TESTE-ORGANICO.sh
bash scripts/dominio-balanco-caixa/FASE-02-TESTE-ORGANICO.sh   # BrandKey passou a vir de cash-balance.constants.ts
```

### 3. Validação no banco
Rodar `registerBrand` de teste e confirmar via `psql` que `cash_balance_brand_snapshots.acumulado_mensal`
bate com a soma manual dos `total_balanco` do mês.

### 4. Criar documento de teste
`scripts/persistencia-balanco-caixa/FASE-07-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/persistencia-balanco-caixa/FASE-07-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fases 02 e 06 passam 100%
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] `registerBrand` é atômico — falha no meio não deixa linha parcial
- [ ] `recomputeMonthlyAccumulated` soma em ordem de data, nunca inclui dias posteriores
- [ ] `findLastKnownBalances` usa exatamente 2 queries, nunca uma por marca
- [ ] `fetchPlayersBalances` usa `FINAL` na query
- [ ] `BrandKey` centralizado em `cash-balance.constants.ts`; os 2 imports provisórios das Fases 02/06 ajustados
- [ ] Invariantes de sessão verificados com Haiku — zero violações
- [ ] Verificação Adversarial de Aceite — CONFIRMADO
- [ ] `CLAUDE.md` atualizado
- [ ] `progress.json` atualizado
- [ ] `dashboard.html` EMBEDDED sincronizado
- [ ] Custo real registrado via `update-phase-cost.js`
- [ ] Dashboard aberto no browser — best-effort
- [ ] Commit e push para `feature/migracao-finance`

## ✅ Invariantes de Sessão — Haiku antes de finalizar

> **Invocar Agent com `model: claude-haiku-4-5-20251001`.**

### Comandos de inspeção
```bash
grep -n "dataSource.transaction\|manager.transaction" \
  src/modules/finance-cash-balance/infrastructure/cash-balance.repository.ts
grep -n "type BrandKey = string" src/modules/finance-cash-balance/domain/ports/closing-balance-source.port.ts \
  src/modules/finance-cash-balance/domain/kpi-card.util.ts 2>/dev/null
```

### Prompt para Haiku

> Execute os comandos. Confirme:
> 1. `registerBrand` e `reopenBrand` estão dentro de `dataSource.transaction(...)`.
> 2. O segundo comando devolve **zero linhas** — os dois imports provisórios de `BrandKey` foram
>    substituídos pelo import real de `cash-balance.constants.ts`.
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco: ler `registerBrand` linha a
> linha e listar as 6 operações que precisam estar na mesma transação — confirmar que nenhuma delas
> ficou fora.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **08 — Balanço de Caixa: use-cases + controller**. Marcar Fase 07 concluída.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-cash-balance/cash-balance.constants.ts \
        src/modules/finance-cash-balance/infrastructure/ \
        src/modules/finance-cash-balance/cash-balance.module.ts \
        src/modules/finance-cash-balance/domain/ports/closing-balance-source.port.ts \
        src/modules/finance-cash-balance/domain/kpi-card.util.ts \
        scripts/persistencia-balanco-caixa/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-cash-balance): repositórios TypeORM + read-service ClickHouse

Fase 07/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 07 concluída, validada e enviada para `feature/migracao-finance`.**
`registerBrand` e `recomputeMonthlyAccumulated` são atômicos; o read-service do ClickHouse usa
`FINAL` onde precisa. Responder "sim" para iniciar a **Fase 08**.
