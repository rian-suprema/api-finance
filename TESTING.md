# Estratégia de testes — api-finance

> A **estratégia** (2 níveis, fronteiras de mock, o que cada nível não cobre) vem do esqueleto
> do Archetype NestJS e continua valendo tal como está — só os specs citados mudaram, do módulo
> de exemplo (já removido) para os módulos reais do Finance.

A estratégia cobre as regras implementadas em **dois níveis complementares**, seguindo a
pirâmide de testes: muitos testes rápidos e isolados na base, poucos testes largos e realistas
no topo. Não há nível intermediário separado porque o e2e já usa infraestrutura real
descartável (Testcontainers) — um terceiro nível só adicionaria manutenção sem cobrir risco novo.

## Nível 1 — Unit (`npm test`)

Specs colocalizadas com o código (`src/**/*.spec.ts`), services/use-cases isolados com dublês
(repositório mockado via DI do Nest — `Test.createTestingModule`) ou, para domínio puro
(matcher, correction-matcher, refund-settlement, totals/kpi-card util), testados direto contra
as funções, sem DI nenhuma. Rodam em segundos, sem Docker; são o feedback de cada save e o
grosso da cobertura (48 suítes, ~290 testes).

Além dos specs de negócio, o nível unit inclui **`architecture.spec.ts` (ArchUnitTS)**: as
regras de arquitetura do [README §5](./README.md) como testes executáveis — fronteira
esqueleto×módulos de negócio, ciclos, camadas NestJS, organização de pastas e o
anti-contrabando de capacidades.

Alguns repositórios do Finance (`cash-balance.repository.spec.ts`,
`reconciliation-item.repository.spec.ts`, `reconciliation-run.repository.spec.ts`) rodam contra
**Postgres real via Testcontainers**, não mock — decisões de lock/transação/upsert (ex.:
`SELECT ... FOR UPDATE` em `registerBrand`) só se provam contra o banco de verdade.

## Nível 2 — E2E (`npm run test:e2e`)

4 suítes sobem a **aplicação inteira** (`AppModule` real, com pipes, filters e interceptors
globais) contra **infra real efêmera** via Testcontainers (Postgres) + os stubs locais de
`scripts/finance-dev-stubs.js` (identidade SayPlus, ClickHouse, Trio — `node
scripts/finance-dev-stubs.js &` antes de rodar):

| Suíte | Cobre |
|---|---|
| `finance-cash-balance.e2e-spec.ts` | as 7 rotas do balanço de caixa, fluxo completo (confirmar 8 bancos → registrar → reabrir → registrar de novo) |
| `finance-reconciliation.e2e-spec.ts` | as 7 rotas da conciliação, golden dataset travado, correções de saldo, nota do operador sobrevivendo a reexecução |
| `finance-smoke.e2e-spec.ts` | superfície comum das 14 rotas (401/403/400 de whitelist/marca inválida/data inválida), parametrizada via `it.each` contra o catálogo de `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §6 |
| `security.e2e-spec.ts` | matriz de forja de JWT (RS256, downgrade HS256, `alg: none`, issuer/audience/expiração), usando uma rota do Finance como veículo |

Requisitos: Docker em execução. Os containers Postgres sobem/caem dentro de cada teste
(`--runInBand`).

**Telemetria no e2e:** a suíte roda com o OpenTelemetry LIGADO contra um Collector
propositalmente morto (`test/otel-failopen.setup.ts`, via jest setupFiles) — verde =
fail-open provado: observabilidade nunca derruba a aplicação.

## O que cada nível NÃO cobre (e por quê)

- Unit não pega erro de SQL, mapeamento TypeORM ou wiring de módulo → por isso os repositórios
  sensíveis a lock/transação e o e2e rodam migrations e módulos reais.
- E2E não explora combinações de regra (explosão de casos, lento) → por isso as regras variam
  nos units (domínio puro tem golden dataset próprio, `test/fixtures/reconciliation-maxima-2026-08-15.json`).

## CI (implementado em `.github/workflows/ci.yml`)

```
quality-validation: lint → format:check → test:cov → build
security:           npm audit --audit-level=high
e2e-testing:        test:e2e (job com Docker, após o quality-validation)
build-image:        docker build (push: false) → scan Trivy 3 camadas → smoke via compose
                    (GET /health/readiness) — nada é publicado
helm-validate:      helm lint → helm template → kubeconform — zero cluster
```

`quality-validation` e `security` são os required status checks do golden path; o e2e roda em
PR e na main. `npm ci --ignore-scripts` sempre (lockfile exato — ver README, §Segurança de
dependências).
