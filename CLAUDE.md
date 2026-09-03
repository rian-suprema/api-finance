# CLAUDE.md — api-finance

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

## Migração do módulo Finance — trilha concluída

Trilha `feature/migracao-finance` — **17/17 fases concluídas em 2026-09-03**. As 14 rotas de negócio
(7 do balanço de caixa + 7 da conciliação), o schema de 8 tabelas, as 3 integrações externas
(ClickHouse, Trio, identidade SayPlus), o `CronJob` K8s + 5 CLIs e os 12 gates do CI (localmente)
passam de ponta a ponta. Dashboard/progresso completos em
[docs/migracao-finance/fases/dashboard.html](./docs/migracao-finance/fases/dashboard.html) /
[progress.json](./docs/migracao-finance/fases/progress.json). Histórico fase a fase (decisões +
aprendizados completos) em
[docs/migracao-finance/APRENDIZADOS-DECISOES-FINANCE.md](./docs/migracao-finance/APRENDIZADOS-DECISOES-FINANCE.md)
— a versão que qualquer sessão precisa carregar por padrão é a seção abaixo.

## Convenções consolidadas — Migração Finance

**Arquitetura/RLS:** Finance tem 8 tabelas próprias, PK `SERIAL`, **sem RLS** (marca ≠ tenant —
isolamento por marca vive só em `BrandAccessService`, app layer; defesa do caminho job/CLI é
`assertKnownBrand()`, chamada antes de qualquer use-case resolver). Readiness verifica só Postgres —
ClickHouse/Trio nunca entram nele (degradação deliberada). Nunca existiu `@Cron` in-process — execução
agendada é só `CronJob` do K8s invocando os 5 CLIs. Não existe rate limit (`ThrottlerGuard`) em
nenhuma camada — divergência conhecida da documentação, não implementado por decisão (Fase 17).

**Padrões de módulo:** reuso cruzado entre `finance-cash-balance`/`finance-reconciliation` é sempre
provider exportado + módulo importado, nunca import direto de arquivo interno do outro módulo.
Enhancer (`@UseInterceptors` etc.) que depende de repositório TypeORM de outro módulo precisa que o
módulo de origem reexporte o próprio `TypeOrmModule`, não só a classe do enhancer. `:id` das rotas de
mutação de item usa `ParseIntPipe` (SERIAL), nunca `ParseUUIDPipe`. Coluna nova é sempre `snake_case`
explícito via `name:`. Variável de ambiente nova do Finance nunca tem default perigoso no Joi
(fail-fast).

**Gotchas de plataforma (TypeORM/Postgres):** `repo.create({...})` grava `undefined` explícito em
toda coluna omitida (`useDefineForClassFields`) — `decimalTransformer` converte isso em `NULL`,
ignorando `default` da coluna; sempre passar valor explícito para colunas com `default`. Coluna
`type: 'date'` via `repo.find()`/`QueryBuilder` volta `string 'YYYY-MM-DD'`, mas `dataSource.query()`
(raw SQL) devolve `Date` do driver `pg` puro — usar `::text` no `SELECT` ao agrupar/comparar por data
em query raw. Lock real de concorrência em teste precisa de `QueryRunner` mantendo a transação aberta
de propósito — `Promise.all` de chamadas de alto nível termina rápido demais para gerar contenção
genuína (dá falso-positivo de "lock funcionando").

**Gotchas de tooling (Jest 30/ESLint):** `--verbose` não lista teste que passou — usar `--json
--outputFile=<tmp>` + `jq` (nunca capturar `--json` do stdout direto quando o código usa
`Logger`/`console`, que contamina o blob). Flag de filtro é `--testPathPatterns` (plural). `@typescript-eslint/unbound-method`
em `expect(objeto.metodo)` — corrigir com `jest.spyOn`, não extrair para `const`. `sonarjs/todo-tag`
dá falso positivo em "todo"/"toda" como pronome em português — reescrever a frase, nunca suprimir.

**Verificação:** um `FASE-*.md`/plano pode ter prosa desatualizada ou script de teste com bug —
confirmar contra o código/infra real (Pre-flight Haiku, grep, ou execução) antes de assumir. Testes
verdes não substituem `/code-review` em fases que tocam permissões/isolamento por marca — já achou
achados reais (lost update em `registerBrand`) que os testes não pegavam. Um gate do CI nunca rodado
de ponta a ponta durante a trilha é um gate DESCONHECIDO, não um gate verde (Fase 17 achou 3 débitos
pré-existentes só ao rodar os 12 gates de verdade pela primeira vez — ver
`scripts/fechamento-financeiro/FASE-17-TESTE-ORGANICO.md`).

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
