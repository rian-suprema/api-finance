# Estratégia de testes — Archetype NestJS (variante simples)

> A **estratégia** (2 níveis, fronteiras de mock, o que cada nível não cobre) é do esqueleto e
> vale para qualquer módulo seu. Os **specs citados** exercitam o módulo `[EXEMPLO]` users —
> ao substituí-lo pelo seu domínio, replique o padrão, não os casos.

A estratégia cobre as regras implementadas em **dois níveis complementares**, seguindo a
pirâmide de testes: muitos testes rápidos e isolados na base, poucos testes largos e realistas
no topo. Não há nível intermediário separado porque o e2e já usa infraestrutura real
descartável (Testcontainers) — um terceiro nível só adicionaria manutenção sem cobrir risco novo.

## Nível 1 — Unit (`npm test`)

Specs colocalizadas com o código (`src/**/*.spec.ts`), services isolados com dublês
(repositório mockado via DI do Nest — `Test.createTestingModule`). Rodam em segundos, sem
Docker; são o feedback de cada save e o grosso da cobertura.

Além dos specs de negócio, o nível unit inclui **`architecture.spec.ts` (ArchUnitTS)**: as
regras de arquitetura do README §5 como testes executáveis — fronteira esqueleto×exemplo,
ciclos, camadas NestJS, organização de pastas e o anti-contrabando de capacidades. É esqueleto,
não exemplo: permanece quando o módulo `[EXEMPLO]` for apagado.

| Spec `[EXEMPLO]` | Regras cobertas |
|---|---|
| `users.service.spec.ts` | Unicidade de username (409 sem persistir); criação em lote na ordem; 404 de usuário inexistente (consulta e remoção, sem efeito colateral); update aplica patch sobre a entidade carregada |

## Nível 2 — E2E (`npm run test:e2e`)

`test/users.e2e-spec.ts` sobe a **aplicação inteira** (AppModule real, com pipes, filters e
interceptors globais) contra **infra real efêmera** via Testcontainers:

- **Postgres** — o schema é criado executando as **migrations reais** (a migration também é testada).

Fluxos cobertos:

1. probes de saúde fora do prefixo: liveness sem dependências; readiness com Postgres `up`;
2. usuário criado e consultado; `password` **nunca** aparece na resposta (serialização `@Exclude`);
3. criação em lote com validação item a item (`ParseArrayPipe`);
4. username duplicado → 409 no contrato de erro `{ code, message }`;
5. payload inválido → 400 do ValidationPipe; propriedade fora do DTO → 400 (whitelist estrita);
6. update e remoção; recurso removido → 404 no contrato de erro.

Requisitos: Docker em execução. O container sobe/cai dentro do teste (`--runInBand`).


**Telemetria no e2e:** a suíte roda com o OpenTelemetry LIGADO contra um Collector
propositalmente morto (`test/otel-failopen.setup.ts`, via jest setupFiles) — verde =
fail-open provado: observabilidade nunca derruba a aplicação.

## O que cada nível NÃO cobre (e por quê)

- Unit não pega erro de SQL, mapeamento TypeORM ou wiring de módulo → por isso o e2e roda
  migrations e módulos reais.
- E2E não explora combinações de regra (explosão de casos, lento) → por isso as regras variam
  nos units.

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
