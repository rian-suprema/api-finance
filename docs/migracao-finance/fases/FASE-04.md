# FASE 04 — Schema TypeORM — 8 entidades + migration inicial
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 40**
> Limite: _10 arquivos (fase de schema — exceção ao limite de 15, permitida pela skill) · risco: FK errada, enum divergente do TypeScript, transformer de Decimal ausente numa coluna monetária_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, as 8 entidades TypeORM do Finance existem com `SERIAL` como PK (regra 7 do
archetype — decisão desta trilha, diferente da origem que usava UUID), os 10 enums nativos do
Postgres, o transformer `Decimal↔string↔number` aplicado em **toda** coluna monetária, e a migration
`FinanceInitialSchema` aplica o schema completo num Postgres limpo.

## Pré-requisito

Fase 03 concluída — módulos `CashBalanceModule`/`ReconciliationModule` existem (ainda vazios) para as
entidades serem registradas via `TypeOrmModule.forFeature()` nas Fases 07/10.

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/modules/users/entities/user.entity.ts` — o padrão de entidade do archetype (`@PrimaryGeneratedColumn()` sem argumento = SERIAL, `name:` explícito em cada `@Column`, coluna anulável com `type` explícito)
- `src/database/migrations/1754560000000-InitialSchema.ts` — o padrão de migration SQL explícito
- `docs/migracao-finance/DADOS-FINANCE.md` (seções 3, 4, 6) — as 8 tabelas, os 10 enums, as colunas exatas

### Prompt para Haiku

> Leia os 3 arquivos. Esta fase cria 8 entidades TypeORM com PK `SERIAL` (não UUID — decisão desta
> trilha, diferente da origem Prisma) e uma migration SQL explícita.
>
> Verifique:
> 1. `@PrimaryGeneratedColumn()` sem argumento produz `SERIAL` — não `@PrimaryGeneratedColumn('uuid')`.
> 2. Toda coluna `DECIMAL(18,2)` do `DADOS-FINANCE.md` precisa de `type: 'numeric', precision: 18,
>    scale: 2` mais um `transformer` — nenhuma pode ficar como `number` puro (o driver `pg` devolve
>    `numeric` como string).
> 3. `cash_balance_daily.tenant_id` é mantida como coluna de **rastreabilidade** (varchar), não como
>    chave de RLS — não criar policy de RLS para ela nesta fase (isso é decisão registrada em
>    `CLAUDE.md`, RLS entra só no caminho job, Fase 15).
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **Migration aplica em Postgres limpo:** `migration:run` contra um Postgres efêmero cria as 10
   enums + 8 tabelas + 3 FKs + os índices únicos, sem erro.
2. **Migration é reversível:** `migration:revert` remove tudo na ordem inversa, sem erro de FK pendente.
3. **`SERIAL` confirmado:** inserir uma linha em `cash_balance_days` sem informar `id` — o Postgres
   gera o valor.
4. **Transformer de Decimal ida e volta:** salvar `CashBalanceBrandSnapshot.totalBalanco = 1234.56`
   via TypeORM e reler do banco — o valor volta como `number` `1234.56` (não `string`, não
   `1234.5600000001`).
5. **Enum rejeita valor fora do domínio:** inserir `status = 'INVALID'` em `cash_balance_days` falha
   no banco (constraint de enum nativo do Postgres).
6. **Chave única por chave natural:** inserir duas linhas com o mesmo `(reference_date, brand)` em
   `cash_balance_daily` viola a `UNIQUE` — prova que o upsert das Fases 07/10 tem em que se apoiar.
7. **FK `reconciliation_items.run_id` → `reconciliation_runs.id`:** inserir item com `run_id`
   inexistente falha por violação de FK.
8. **Coluna camelCase da origem corrigida:** confirmar que `reconciliation_runs.match_key` nasce
   `snake_case` nesta migration (decisão registrada — a origem tinha `"matchKey"` sem `@map`, ver
   `docs/migracao-finance/DADOS-FINANCE.md` §2.1; aqui recriamos do zero, então padronizamos).

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/schema-financeiro/FASE-04-TESTE-ORGANICO.sh` agora. Resultado esperado: RED — a
> migration ainda não existe, `migration:run` não encontra nada novo para aplicar / as tabelas não
> existem.

## Arquivos a criar

### `src/common/transformers/decimal.transformer.ts`
**Motivo:** toda coluna monetária do Finance (18 colunas ao todo, somando as 8 tabelas) precisa do
mesmo transformer — centralizar evita 18 implementações levemente diferentes.
```ts
import type { ValueTransformer } from 'typeorm';

export const decimalTransformer: ValueTransformer = {
  to: (value?: number | null): number | null => value ?? null,
  from: (value?: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};
```
Uso em toda coluna monetária: `@Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: decimalTransformer })`.

### As 8 entidades (todas com `@PrimaryGeneratedColumn() id: number`, `name:` explícito em cada `@Column`, coluna anulável com `type` explícito — regra do archetype)

`src/modules/finance-cash-balance/entities/cash-balance-day.entity.ts` — `CashBalanceDay`:
`referenceDate` (`date`, `unique`), `status` (`enum: CashBalanceDayStatus`, default `OPEN`),
`closedAt`/`closedBy` (nullable), `createdAt`/`updatedAt`, `deletedAt` (soft delete — `@DeleteDateColumn`),
`@OneToMany(() => CashBalanceDaily, (d) => d.day) brands`.

`.../cash-balance-daily.entity.ts` — `CashBalanceDaily`: `@ManyToOne(() => CashBalanceDay) @JoinColumn({name:'day_id'}) day`,
`tenantId` (varchar — rastreabilidade, não RLS), `brand` (varchar), `referenceDate`, `depositsTotal`/
`withdrawalsTotal`/`netDeposit` (decimal, snapshot informativo — nunca fonte primária, ver
`docs/migracao-finance/DADOS-FINANCE.md` §3.2), `status` (enum `CashBalanceBrandStatus`),
`confirmedAt`/`confirmedBy`, timestamps + `deletedAt`. `@Unique(['referenceDate','brand'])`.
`@OneToMany bankEntries`, `@OneToOne snapshot`.

`.../cash-balance-bank-entry.entity.ts` — `CashBalanceBankEntry`: `@ManyToOne CashBalanceDaily daily`,
`bank` (varchar), `type` (enum `CashBalanceBankType`), `source` (enum `CashBalanceBankSource`),
`balance` (decimal), `confirmed` (boolean), `confirmedAt`/`confirmedBy`, timestamps.
`@Unique(['dailyId','bank'])`.

`.../cash-balance-brand-snapshot.entity.ts` — `CashBalanceBrandSnapshot`: `@OneToOne(() =>
CashBalanceDaily) @JoinColumn({name:'daily_id'})`, **`@Column({unique:true}) dailyId`** (a FK 1:1),
`saldoTransacional`/`saldoJogadores`/`totalBalanco`/`acumuladoMensal` (decimal), timestamps.

`.../trio-closing-balance.entity.ts` — `TrioClosingBalance`: sem FK. `referenceDate`, `brand`,
`bankAccountId` (varchar), `balance` (decimal), `cutoffAt`/`capturedAt` (timestamptz), `exact`
(boolean), `method` (enum `TrioClosingBalanceMethod`), timestamps. `@Unique(['referenceDate','brand'])`.

`.../finance-audit-log.entity.ts` — `FinanceAuditLog`: sem FK. `userId`, `tenantId` (nullable),
`action`, `entity`, `entityId` (nullable), `after` (`jsonb`, nullable), `ip`/`userAgent` (nullable),
`createdAt`.

`src/modules/finance-reconciliation/entities/reconciliation-run.entity.ts` — `ReconciliationRun`:
sem FK. `referenceDate`, `brand`, `bank`, `status` (enum `ReconciliationRunStatus`), **`matchKey`**
com `@Column({ name: 'match_key', type: 'enum', enum: ReconciliationMatchKey })` (snake_case desde o
início — ver Teste 8), `startedAt`/`finishedAt` (nullable), `error` (nullable), os **16 campos de
totais** (8 pares `Total`/`Count`, todos decimal+transformer para o total, integer para o count),
`matchedCount`/`pendingCount` (integer). `@Unique(['referenceDate','brand','bank'])`.
`@OneToMany(() => ReconciliationItem, (i) => i.run) items`.

`.../reconciliation-item.entity.ts` — `ReconciliationItem`: `@ManyToOne(() => ReconciliationRun)
@JoinColumn({name:'run_id'})`, `referenceDate`, `brand`, `bank`, `flow` (enum `ReconciliationFlow`),
`side` (enum `ReconciliationSide`), `itemKey` (varchar), `amount` (decimal), `occurredAt` (nullable),
`externalKey`/`endToEndId` (nullable), `counterpartyName`/`counterpartyTaxNumber` (nullable — PII, ver
`docs/migracao-finance/DADOS-FINANCE.md` §4.3), `status` (enum `ReconciliationItemStatus`), `note`
(nullable), `resolvedAt`/`resolvedBy` (nullable), `stillPending` (boolean, default `true`),
`platformReprocessPending` (boolean, default `false`), timestamps.
`@Unique(['referenceDate','brand','bank','side','itemKey'])`. Índice não-único
`(referenceDate, brand, status)`.

### Os 10 enums TypeScript (um arquivo por módulo ou agrupados em `*.enums.ts` por módulo — decisão de
organização do implementador; nomear exatamente como a origem para bater com `docs/migracao-finance/DADOS-FINANCE.md`
§6): `CashBalanceDayStatus`, `CashBalanceBrandStatus`, `CashBalanceBankType`, `CashBalanceBankSource`,
`TrioClosingBalanceMethod` (`POINT_IN_TIME`/`SNAPSHOT`/`RECONSTRUCTED` — os dois últimos só existem
para o enum aceitar dado histórico se algum dia for portado; nenhum código nesta trilha os escreve),
`ReconciliationRunStatus`, `ReconciliationMatchKey` (`AMOUNT`/`EXTERNAL_KEY` — só `EXTERNAL_KEY` é
gravado, ver Fase 13), `ReconciliationFlow`, `ReconciliationSide`, `ReconciliationItemStatus`.

### `src/database/migrations/<timestamp>-FinanceInitialSchema.ts`
**Motivo:** schema completo em uma migration só (decisão do `docs/migracao-finance/MIGRACAO-FINANCE.md`
§5.4 — módulo novo dentro de serviço novo, sem histórico de 7 migrations a replicar). SQL explícito,
`up()`/`down()` completos, criando os 10 `CREATE TYPE ... AS ENUM`, as 8 `CREATE TABLE` (com `SERIAL
PRIMARY KEY`, `REFERENCES` para as 3 FKs), os 7 índices únicos e os índices não-únicos que sobrevivem
à revisão (**não** replicar `cash_balance_days(status)` nem
`cash_balance_daily(tenant_id, brand, reference_date)` — sem consumidor, ver `DADOS-FINANCE.md` §9.2).
`down()` desfaz na ordem inversa (drop tables antes de drop types).

## Atualizar arquivo de registro de rotas/servidor

Não aplicável a rotas. Registrar as entidades novas não exige tocar `app.module.ts` (o
`DatabaseModule` já usa `autoLoadEntities: true`) — cada módulo registra via `TypeOrmModule.forFeature([...])`
nas Fases 07/10, quando os repositórios existirem.

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/schema-financeiro/FASE-04-TESTE-ORGANICO.sh`

```bash
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

TABLES=$(docker compose exec -T postgres psql -U users -d users -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%cash_balance%' OR table_name LIKE '%reconciliation%' OR table_name = 'finance_audit_logs';")
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
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/schema-financeiro/FASE-04-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/esqueleto-financeiro/FASE-03-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPattern=users   # a migration InitialSchema do [EXEMPLO] não pode ter regredido
```

### 3. Validação no banco
Confirmar via `psql` que as 3 FKs (`cash_balance_daily.day_id`, `cash_balance_bank_entries.daily_id`,
`reconciliation_items.run_id`) e os 7 índices únicos existem (`\d+ <tabela>`).

### 4. Criar documento de teste
`scripts/schema-financeiro/FASE-04-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/schema-financeiro/FASE-04-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 03 passa 100%; e2e do `users` [EXEMPLO] continua verde
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] Toda coluna `DECIMAL(18,2)` usa `decimalTransformer` — grep confirma zero coluna monetária sem `transformer:`
- [ ] `SERIAL` confirmado nas 8 entidades (`@PrimaryGeneratedColumn()` sem argumento)
- [ ] `match_key` nasce `snake_case` (não `matchKey` sem `@map`, como na origem)
- [ ] `migration:revert` desfaz sem erro de FK pendente
- [ ] Zero índice sem consumidor replicado (`cash_balance_days(status)`,
      `cash_balance_daily(tenant_id, brand, reference_date)` **não existem** nesta migration)
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
grep -rLn "transformer" src/modules/finance-*/entities/*.entity.ts | xargs -r grep -n "type: 'numeric'"
grep -rn "@PrimaryGeneratedColumn('uuid')" src/modules/finance-*/entities/
```

### Prompt para Haiku

> Execute os comandos e leia as 8 entidades.
>
> Verifique:
> 1. Toda coluna `type: 'numeric'` tem `transformer: decimalTransformer` na mesma declaração — nenhuma
>    coluna monetária escapou.
> 2. Nenhuma entidade usa `@PrimaryGeneratedColumn('uuid')` — todas usam `SERIAL` (sem argumento).
> 3. `ReconciliationRun` declara a coluna do banco como `name: 'match_key'`, não `matchKey` implícito.
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [arquivo:linha — descrição]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN + o log de `migration:run` real
> contra Postgres efêmero. Instrução: tentar refutar contando manualmente as 18 colunas monetárias do
> `DADOS-FINANCE.md` §3–4 contra o `git diff` das entidades — cada uma precisa aparecer com
> `transformer`. Não aceitar "a maioria tem".
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **05 — Integração ClickHouse**. Marcar Fase 04 concluída. Registrar a
decisão de padronizar `match_key` como convenção consolidada (evita a pegadinha camelCase documentada
em `DADOS-FINANCE.md` §2.1).

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-*/entities/ src/common/transformers/ src/database/migrations/ \
        scripts/schema-financeiro/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance): schema TypeORM — 8 entidades + migration inicial

Fase 04/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 04 concluída, validada e enviada para `feature/migracao-finance`.**
O schema completo aplica e reverte sem erro num Postgres limpo, com `SERIAL`, enums nativos e
transformer de Decimal em todas as 18 colunas monetárias. Responder "sim" para iniciar a **Fase 05**.
