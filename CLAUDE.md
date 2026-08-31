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

**Fase atual: 03 — Esqueleto não-funcional.**

| Fase | Nome | Status |
|---|---|---|
| 01 | Domínio puro — Conciliação + golden dataset | ✅ concluída |
| 02 | Domínio puro — Balanço de Caixa | ✅ concluída |
| 03 | Esqueleto não-funcional + allowlist + contrato de erro | pending |
| 04 | Schema TypeORM — 8 entidades + migration inicial | pending |
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
