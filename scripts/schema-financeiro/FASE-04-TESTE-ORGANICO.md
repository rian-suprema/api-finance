# Teste Orgânico — Fase 04 (Schema TypeORM — 8 entidades + migration inicial)

## Como executar

```bash
docker compose up -d postgres
cp .env.example .env   # se ainda não existir localmente (gitignorado)
npm run migration:run  # ou deixe o script orgânico aplicar
bash scripts/schema-financeiro/FASE-04-TESTE-ORGANICO.sh
```

Saída esperada: `exit 0`, zero `❌`.

## Pré-requisitos

- Fase 03 concluída.
- Docker disponível para `docker compose up -d postgres`.
- `.env` local com as variáveis de `DB_*` (copiar de `.env.example`) — sem ele, `migration:run`
  falha com `SASL: ... client password must be a string` (dotenv não encontra `.env`, só
  `.env.test`).

## O que o script verifica

1. `migration:run` aplica a migration `FinanceInitialSchema` sem erro.
2. As 8 tabelas do Finance existem (lista explícita das 8, não `LIKE '%cash_balance%'` — ver nota
   técnica sobre o bug do próprio template do `FASE-04.md`).
3. `INSERT` em `cash_balance_days` sem informar `id` funciona — confirma `SERIAL`.
4. `migration:revert` desfaz o schema completo sem erro de FK pendente.

## Notas técnicas

- **Bug no script orgânico do próprio `FASE-04.md`:** a query de contagem de tabelas usava
  `table_name LIKE '%cash_balance%' OR table_name LIKE '%reconciliation%' OR table_name =
  'finance_audit_logs'` sem parênteses (precedência `AND`/`OR` errada) **e** o padrão
  `%cash_balance%` não cobre `trio_closing_balances` — o resultado dava 7, nunca 8. Corrigido para
  uma lista `IN (...)` com os 8 nomes exatos. Mesma categoria de defeito já visto nos scripts das
  Fases 01/03 (o template nasce com um detalhe não testado contra a implementação real).
- **`.env` não existia no checkout** (só `.env.example`/`.env.test`) — `npm run migration:run` só
  funciona com `.env` real. Criado localmente via `cp .env.example .env` (gitignorado, não commitado).
- **Ciclo de dependência real entre entidades irmãs:** `CashBalanceDay↔CashBalanceDaily` e
  `ReconciliationRun↔ReconciliationItem` têm relação bidirecional (`@OneToMany`+`@ManyToOne`) exigida
  pelo `FASE-04.md`. `haveNoCycles()` do ArchUnitTS não distingue `import type` de import de valor,
  então um ciclo aparecia mesmo com um lado só de tipo. Resolvido com decisão do usuário (3 opções
  apresentadas): as 2 pastas `entities/` do Finance saem do escopo da regra geral, e 2 regras novas
  (`ADR-FINANCE-3`) garantem que o lado "pai" (`CashBalanceDay`, `ReconciliationRun`) só importa a
  classe "filha" como `import type` — nunca como valor. Testado plantando uma regressão real
  (trocando `import type` por import normal) e confirmando que a regra nova falha.
- **Enums não podem morar em `entities/`:** a regra existente "entities/ só contém `*.entity.ts`"
  rejeitou `cash-balance.enums.ts`/`reconciliation.enums.ts` dentro da pasta — movidos para a raiz de
  cada módulo (`src/modules/finance-cash-balance/cash-balance.enums.ts`).
- **`up()` da migration excede `max-lines-per-function` (80 linhas):** dividido em 5 métodos privados
  por sub-domínio (`createEnums`, `createCashBalanceCore`, `createCashBalanceEntriesAndSnapshots`,
  `createTrioAndAuditTables`, `createReconciliationTables`) — continua sendo **uma migration/classe
  só** (decisão de `MIGRACAO-FINANCE.md` §5.4), só a função ficou menor.
- **4ª FK além das "3" citadas na seção de validação do `FASE-04.md`:**
  `cash_balance_brand_snapshots.daily_id → cash_balance_daily.id` é uma FK real (1:1), especificada
  na própria entidade do plano e em `DADOS-FINANCE.md` §3.4. A lista de "3 FKs" da seção "Validação
  no banco" do `FASE-04.md` é uma omissão do texto, não uma decisão de excluir essa FK — implementada
  como FK de fato, confirmada via `psql`.
- **`sonarjs/todo-tag` falso-positivo de novo** (mesma causa da Fase 03): comentários com "todo" como
  pronome em português ("todo upsert", "mudam todo valor") — reescritos.
- As 18 colunas monetárias (`DADOS-FINANCE.md` §3–4) todas com `type: 'numeric'` +
  `transformer: decimalTransformer` na mesma declaração `@Column` — confirmado por contagem (grep) e
  por roundtrip real via TypeORM (`1234.56` salvo e lido de volta como `number` exato, sem drift).

## Resultado da última execução

```text
=== FASE 04 — Schema TypeORM ===

  ✅  migration:run aplica sem erro
  ✅  8 tabelas do Finance existem
  ✅  INSERT sem id explícito funciona (SERIAL confirmado)
  ✅  migration:revert desfaz sem erro

✅  FASE 04 — PASSOU (4 testes)
```

`npm test`: 10 suítes / 58 testes, 100% verde. `npm run build`: exit 0. Regressão: Fase 03
(`FASE-03-TESTE-ORGANICO.sh`) PASSOU 5/5; `npm run test:e2e -- --testPathPatterns=users` 21/21 verde
— a migration `InitialSchema` do módulo `users` [EXEMPLO] não regrediu. Verificação Adversarial de
Aceite: CONFIRMADO (contagem manual das 18 colunas monetárias, as 4 FKs e os 7 índices únicos
confirmados via `psql`, quebra de regressão testada ativamente no ciclo de import).
