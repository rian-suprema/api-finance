# CLAUDE.md — users-api

> Guia operacional para sessões de IA neste repositório. Detalhes completos do produto/arquitetura
> do archetype → [README.md](./README.md) · segurança/RLS → [SECURITY-README.md](./SECURITY-README.md) ·
> execução local → [LOCAL-EXECUTION-README.md](./LOCAL-EXECUTION-README.md) · CI/CD →
> [CI-CD.md](./CI-CD.md). Detalhes completos da migração do Finance →
> [docs/migracao-finance/](./docs/migracao-finance/) (dados, infra, regras de negócio).

## Stack

Node 22 · NestJS 11 · TypeScript strict · TypeORM → RDS Aurora PostgreSQL · Jest (unit colocalizado
`*.spec.ts` + e2e via Testcontainers em `test/*.e2e-spec.ts`) · Joi (`src/config/env.validation.ts`,
fail-fast) · ArchUnitTS (`src/architecture.spec.ts`) · OpenTelemetry (opt-in por env) · Helm + CI 5 jobs.

## Arquitetura

```
Controller (fino) → Service/Use-case → Repositório (único a tocar TypeORM) → PostgreSQL
```

Guards globais: `JwtAuthGuard` (RS256, chave pública da SayPlus) → `PermissionsGuard`
(deny-by-default, `@Permissions(...)`/`@Public()`). RLS por `tenant_id` no banco (Step 5,
`src/database/tenant-context.ts`) — ver divergência do Finance (marca, não tenant) abaixo.

## Princípios de código

SOLID por camada + nomenclatura descritiva. Controller nunca importa `typeorm`/`@nestjs/typeorm`.
Service nunca importa controller. `joi` só em `src/config/`. Toda rota declara `@Permissions(...)`
ou `@Public()` (gate de build, `architecture.spec.ts`). Migrations em SQL explícito,
`synchronize: false`. Chave primária `SERIAL` por padrão. Dinheiro é sempre `numeric`/`decimal` com
transformer — nunca `float`.

## Protocolo de decisão

Dúvida arquitetural ou inconsistência detectada durante uma fase: **PARAR**, apresentar **3 opções**
no chat, aguardar escolha explícita do usuário antes de prosseguir. Nunca inventar contrato, regra de
negócio ou decisão arquitetural para preencher uma lacuna.

## Estado atual — Migração do módulo Finance

Trilha em `feature/migracao-finance` — 17 fases, dashboard em
[docs/migracao-finance/fases/dashboard.html](./docs/migracao-finance/fases/dashboard.html), progresso em
[docs/migracao-finance/fases/progress.json](./docs/migracao-finance/fases/progress.json).

**Fase atual: 05 — Integração ClickHouse.**

| Fase | Nome | Status |
|---|---|---|
| 01 | Domínio puro — Conciliação + golden dataset | ✅ concluída |
| 02 | Domínio puro — Balanço de Caixa | ✅ concluída |
| 03 | Esqueleto não-funcional + allowlist + contrato de erro | ✅ concluída |
| 04 | Schema TypeORM — 8 entidades + migration inicial | ✅ concluída |
| 05 | Integração ClickHouse — conexão global | pending |
| 06 | Integração Trio — client + adapter point-in-time | pending |
| 07 | Persistência do Balanço de Caixa (repositórios + read-service) | pending |
| 08 | Identidade da plataforma (/auth/me) + BrandAccessService | pending |
| 09 | Balanço de Caixa — use-cases + services + controller | pending |
| 10 | Persistência da Conciliação (repositório) | pending |
| 11 | ClickHouse da Conciliação (movimentos + busca de correção) | pending |
| 12 | Trio — movimentos por bisseção + regressão | pending |
| 13 | Conciliação — use-cases núcleo + controller | pending |
| 14 | Conciliação — evidência de correção de saldo | pending |
| 15 | Jobs — CronJob Helm + crons + 5 CLIs + RLS no caminho job | pending |
| 16 | Contrato do archetype (prefixo/Swagger/health/decimal) | pending |
| 17 | Fechamento — e2e completo, quality gates, cutover | pending |

### Decisões já fechadas para esta trilha (não reabrir sem novo ADR)

1. **Contrato de erro:** `GlobalExceptionFilter` será estendido para preservar campos extras do
   payload da exceção (ex.: `pendingBanks`) além de `{code, message}` — decisão da Fase 03.
2. **Readiness:** verifica só PostgreSQL. ClickHouse/Trio **não entram** no readiness — o módulo
   degrada de propósito quando eles caem (tela de balanço continua editável sem KPI); indisponibilidade
   de dependência de outro time nunca deve remover o pod do tráfego.
3. **Crons:** **nunca portamos `@nestjs/schedule`/`@Cron` in-process.** A execução agendada é só
   **CronJob do Kubernetes** invocando os CLIs (`reconcile`, `trio:capture` — Fase 15) — evita, por
   construção, a duplicação de trabalho contra a Trio que `@Cron` in-process teria com
   `replicaCount: 2`.
4. **PK das 8 tabelas novas:** `SERIAL` (regra 7 do archetype), não UUID. Nenhuma garantia de negócio
   depende do tipo — todo upsert é por chave natural (`reference_date`+`brand`, etc.).
5. **Marca ≠ tenant:** as tabelas do Finance **não** usam a RLS de tenant único do esqueleto — o
   isolamento por marca (até 3 simultâneas por request) vive inteiramente na camada de aplicação
   (`BrandAccessService`), sem RLS nenhuma nas tabelas do Finance. A ideia original (RLS com o slug
   da marca como GUC, só no caminho job) foi **reavaliada na Fase 15** e descartada: com `FORCE ROW
   LEVEL SECURITY` ativo, toda leitura/escrita sem o GUC setado — inclusive as 14 rotas HTTP, que não
   usam GUC nenhum — passaria a ver zero linhas. A defesa em profundidade do caminho job (jobs/CLIs
   sem guard nenhum hoje) é uma asserção de aplicação (`assertKnownBrand`), não RLS — ver Fase 15.
6. **`TRIO_AMOUNT_DIVISOR`** (1 ou 100 — centavos vs reais) é ambíguo na documentação de origem e
   **não pode ser resolvido por leitura de código** — é PARADA HUMANA na Fase 06.
7. **Fail-fast em tudo, sem exceção — convenção consolidada na Fase 03:** nenhuma das 14 variáveis
   novas do Finance tem default de valor perigoso no Joi. Em particular `TRIO_AMOUNT_DIVISOR` é
   `.required()` (`Joi.number().valid(1, 100)`), nunca `.default(1)` — mesmo já validado como "ambíguo,
   PARADA HUMANA" no item 6, o boot cai sem ela em vez de assumir silenciosamente. Vale para toda
   variável nova das Fases 04–17: default só quando o valor for inócuo (ex.: `CLICKHOUSE_DATABASE`),
   nunca quando errar o valor custa 100× o valor real.
8. **`match_key` padronizado como `snake_case` — convenção consolidada na Fase 04.** A origem tinha
   `reconciliation_runs."matchKey"` sem `@map` (pegadinha real, `DADOS-FINANCE.md` §2.1); nesta
   trilha a coluna nasce `match_key` desde o início. Vale como padrão para qualquer coluna nova: nome
   de coluna é sempre `snake_case` explícito via `name:`, sem excecão "porque a origem fez diferente".
9. **ADR-FINANCE-3 — `haveNoCycles()` não distingue `import type` de import de valor
   (`architecture.spec.ts`, Fase 04):** as 2 pastas `entities/` do Finance
   (`finance-cash-balance/entities/**`, `finance-reconciliation/entities/**`) ficam de fora do escopo
   da regra geral de ciclos, porque o TypeORM exige relação bidirecional real
   (`@OneToMany`+`@ManyToOne`) entre `CashBalanceDay↔CashBalanceDaily` e
   `ReconciliationRun↔ReconciliationItem`, o que sempre cria um ciclo de ARQUIVO (mesmo quando um dos
   lados importa a classe irmã só como tipo). Duas regras adicionais garantem que o lado "pai" nunca
   importa a classe "filha" como valor (só `import type`) — o ciclo real de valor continua proibido.
   Decisão do usuário entre 3 opções (as outras eram remover as relações inversas, ou tipar sem
   importar a classe irmã). Se um par de entidades novo (Fases 07+) tiver o mesmo padrão bidirecional,
   este é o precedente a seguir — adicionar a pasta à exclusão + as 2 regras de `import type`, não
   inventar uma solução nova.

## Aprendizados críticos

- **Fase 01:** Jest 30 não imprime mais nomes de teste que passaram no reporter `--verbose` (só
  detalha testes que falham) — qualquer script de teste orgânico que faça `grep` na saída
  `--verbose` esperando nomes de cenário precisa usar `--json` + `jq` (`testResults[].assertionResults[].fullName`)
  em vez disso. Ver `scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.sh`.
- **Fase 01:** os artefatos de planejamento (os 17 `FASE-*.md`, este `CLAUDE.md` e
  `scripts/update-phase-cost.js`) referenciavam `docs/backend/fases/` — diretório que nunca existiu.
  Os artefatos reais sempre estiveram em `docs/migracao-finance/fases/`. Corrigido nos 19 arquivos
  na Fase 01; se algum documento novo copiar o padrão antigo, o path certo é
  `docs/migracao-finance/fases/`.
- **Fase 01:** `BrandKey` (tipo definido em `cash-balance.constants.ts`, só criado na Fase 07) foi
  removido do escopo do `reconciliation.types.ts` portado nesta fase — só os tipos efetivamente
  exercitados pelo domínio testado (`Movement`, `SettledMovement`, `SideTotals`, `FlowMatch`,
  `RunTotals`, `CorrectionConfidence`) foram portados agora. As views que dependem de `BrandKey`
  (`ReconciliationBrandView`, `ReconciliationHistoryView`, `RunOutcome`, `CorrectionApplyView`,
  `CorrectionSearchView`) devem ser portadas só quando a fase que as consome (13/14) rodar, quando
  `BrandKey` já existir.
- **Fase 02:** `scripts/update-phase-cost.js` recalcula `totalCostUsd`/`projectedTotalCostUsd`/
  `summary.completed`/`summary.pending`, mas **não** recalcula `summary.percentComplete` nem
  `summary.hoursCompleted`/`hoursRemaining` — ficam presos no valor anterior se não forem ajustados
  à mão. O comentário no topo do arquivo pede para não editar a lógica compartilhada (fonte única no
  skill `criar-fase`), então o ajuste é manual a cada fase: `percentComplete = completed/17*100` e
  `hoursCompleted = soma de estimatedHours das fases completed` (não há tracking de `actualHours`
  real). Repetir esse ajuste manual nas fases 03–17.
- **Fase 02:** o mesmo padrão de tipo provisório da Fase 01 (`BrandKey`) se repetiu — `BrandKey` e
  `BankType` foram declarados localmente em `cash-balance.types.ts` (`BrandKey = string`) em vez de
  importados de `cash-balance.constants.ts`, que só existe na Fase 07. `buildKpiCard` usa a própria
  chave da marca como `label` (sem lookup em `BRANDS`) até lá.
- **Fase 03:** o script orgânico do próprio `FASE-03.md` tinha o mesmo defeito documentado na Fase 01
  (`grep` na saída `--verbose` do Jest 30, que não lista testes que passaram) — o template da fase não
  herdou a correção já registrada. Corrigido para `--json` + `jq` no
  `scripts/esqueleto-financeiro/FASE-03-TESTE-ORGANICO.sh`; qualquer novo script orgânico deve nascer
  já usando esse padrão, não copiar o texto literal do `FASE-*.md` sem revisar.
- **Fase 03:** Jest 30 também renomeou a flag de filtro de suíte: `--testPathPattern` (citada nos
  comandos de regressão dos `FASE-*.md`) não existe mais — é `--testPathPatterns`. Mesma família do
  problema do `--verbose`; usar a flag nova em qualquer comando de regressão futuro.
- **Fase 03:** a regra `sonarjs/todo-tag` do ESLint dá falso positivo em comentários em português que
  usam a palavra "Todo"/"todo" como pronome ("todo o módulo", "todo valor monetário") — o linter casa
  com o token em inglês `TODO` case-insensitive. Ao portar comentários literalmente da origem
  (`date.util.ts`, `env.validation.ts`), reescrever a frase preservando o sentido em vez de suprimir a
  regra.
- **Fase 03:** 15 erros de `npm run lint` já existiam em código das Fases 01/02
  (`finance-cash-balance/domain/**`, `finance-reconciliation/domain/**`) antes desta fase — nenhum
  arquivo tocado pela Fase 03 tem erro de lint. Ficam registrados aqui como débito conhecido, não
  corrigido (fora do escopo desta fase); decisão do usuário sobre quando limpar.
- **Fase 03:** `scripts/finance-dev-stubs.js` e `src/common/utils/{date,tax-number}.util.ts` foram
  portados literalmente de `/home/feh/sayplus-modules/finance` (`finance-api` + `scripts/dev-stubs.js`
  da origem, presentes no disco local) — não havia cópia desses arquivos dentro deste repositório
  antes da Fase 03.
- **Fase 04:** o script orgânico do próprio `FASE-04.md` tinha um bug de contagem de tabelas —
  `table_name LIKE '%cash_balance%' OR ... OR table_name = 'finance_audit_logs'` sem parênteses
  (precedência `AND`/`OR` errada) e o padrão `%cash_balance%` não cobre `trio_closing_balances`,
  então a contagem real dava 7, nunca 8. Corrigido para uma lista `IN (...)` com os 8 nomes exatos.
  Mesma categoria de defeito já visto em scripts orgânicos anteriores — o template de um `FASE-*.md`
  não é confiável sem rodar contra a implementação real.
- **Fase 04:** não existia `.env` no checkout (só `.env.example`/`.env.test`) — `npm run
  migration:run` só funciona com `.env` real (`data-source.ts` carrega `.env` quando `NODE_ENV !==
  'test'`). Criado localmente via `cp .env.example .env` (gitignorado). Qualquer fase futura que
  precise rodar migration precisa desse `.env` local.
- **Fase 04:** entidades TypeORM com relação bidirecional real entre arquivos-irmãos colidem com
  `haveNoCycles()` do `architecture.spec.ts`, porque a regra não distingue `import type` de import de
  valor. Ver decisão 9 (ADR-FINANCE-3) acima — é o precedente para qualquer par de entidades novo com
  o mesmo padrão.
- **Fase 04:** enums de coluna (`CashBalanceDayStatus` etc.) não podem morar dentro de `entities/` —
  a regra "entities/ só contém `*.entity.ts`" (já existente, não é do Finance) rejeita qualquer outro
  arquivo ali. Ficam na raiz do módulo (`cash-balance.enums.ts`, `reconciliation.enums.ts`).
- **Fase 04:** `up()` de uma migration com muitas tabelas bate no limite de 80 linhas por função do
  ESLint (`max-lines-per-function`) — não há exceção para migrations no `eslint.config.mjs` (só para
  `*.spec.ts`/`test/**`). Resolvido dividindo `up()` em métodos privados por sub-domínio, mantendo
  uma migration/classe só (a decisão de "migration única" é sobre o arquivo, não sobre o tamanho da
  função).
- **Fase 04:** `sonarjs/todo-tag` deu falso positivo de novo (mesma causa da Fase 03: "todo" como
  pronome em português, ex. "cada upsert" tinha sido escrito como "todo upsert").
- **Fase 04:** a seção "Validação no banco" do `FASE-04.md` cita "as 3 FKs" mas o próprio texto de
  `cash-balance-brand-snapshot.entity.ts` (mesma fase) e `DADOS-FINANCE.md` §3.4 exigem uma 4ª FK
  (`cash_balance_brand_snapshots.daily_id → cash_balance_daily.id`, 1:1). Implementada como FK real —
  a contagem "3" no texto de validação é omissão, não decisão de excluir. Mesma categoria do
  "8 permissões" vs. 7 reais da Fase 03: quando a prosa de um `FASE-*.md` diverge do código
  explicitamente especificado na mesma fase, o código vale.

## Convenções de teste

- Unitário: colocalizado, `*.spec.ts`, `npm test`.
- E2E: `test/*.e2e-spec.ts`, Testcontainers (Postgres efêmero real — sem mock de infra), `npm run test:e2e`.
- Domínio puro (sem NestJS/HTTP/DB): teste unitário direto contra as funções, sem DI.
- Golden dataset da conciliação (Maxima, 2026-08-15) é o oráculo dos testes de integração — não altera
  entre fases; se algum teste precisar mudá-lo, é sinal de que a tradução mudou comportamento.
- Autenticação em teste: `test/auth-helper.ts` (`setupTestAuth()` gera par RS256 efêmero e assina
  tokens `sign({ permissions, tenantId })`).

## Comandos essenciais

```bash
npm run lint && npm test && npm run test:e2e && npm run build   # gates locais = gates do CI
npm run auth:keys && npm run auth:token                          # par RS256 + bearer de dev
npm run migration:run                                            # aplica migrations pendentes
docker compose up -d                                              # Postgres local
```
