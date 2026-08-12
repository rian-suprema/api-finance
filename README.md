# users-api — construído a partir do Archetype Backend NestJS (SUPREMA) · variante simples

**O que você está olhando:** o `users-api` é um **serviço de exemplo construído a partir da
variante simples do Archetype Backend NestJS** da SUPREMA: REST + regra de negócio +
PostgreSQL (TypeORM) — **sem cache distribuído e sem mensageria**. O archetype é o produto:
um esqueleto **não-funcional** (ambiente reprodutível, gates de qualidade e segurança, saúde,
padrões resolvidos). O módulo `users` existe para **provar e demonstrar** o esqueleto com um
domínio mínimo — você o apaga e implementa o seu.

**Como ler este documento:** a seção 1 explica de onde o desenho veio (ADRs); a seção 2 coloca
o serviço **rodando na sua máquina**; o restante aprofunda o que o archetype fornece e como
adotá-lo.

---

## 1 · De onde veio o desenho — ADRs → Archetype → users-api

O desenho de arquitetura foi **acordado em ADRs antes de o exemplo existir**:

```
ADRs acordadas  ──▶  Archetype (esqueleto + regras)  ──▶  users-api (exemplo executável)
```

| ADR | Decisão | Por quê |
|---|---|---|
| Natureza do archetype | **Não-funcional primeiro**: ambiente local, CI, saúde e padrões resolvidos; o funcional vem depois, sobre o esqueleto | Serviço nasce pronto para operar; o domínio é a única parte que varia |
| Composição por necessidade | Esta variante **não carrega** cache nem mensageria | Capacidade só entra quando o domínio precisa — infra ociosa é custo e superfície de ataque |
| Stack | Node 22 · NestJS 11 · TypeScript strict | Golden path único por categoria |
| Persistência | TypeORM → Aurora PostgreSQL; migrations em SQL explícito, `synchronize: false` | Migration é código de produção — revisável e determinística |
| Autenticação | **Fora do escopo do archetype** — sem guards na aplicação | AuthN/AuthZ entram como capacidade transversal da plataforma (Keycloak) |
| Saúde | Terminus: liveness sem dependências; readiness = PostgreSQL | Contrato com o Kubernetes; o chart aponta as probes para cá |
| Supply chain | Lockfile + `npm ci` + `--ignore-scripts` + gates (IDE → pre-commit → CI) + imagem sem toolchain | Defesa em camadas contra o vetor nº 1 do ecossistema npm |
| Empacotamento | CI **empacota e valida sem publicar**; publicação e deploy (GitOps/ArgoCD) são outra fase | Artefato validado antes de existir infraestrutura |
| Exemplo × esqueleto | O módulo de negócio é `[EXEMPLO]` demarcado e descartável | O dev apaga o exemplo e mantém o esqueleto — ver seção 7 |

## 2 · Como executar

Pré-requisitos: **Node 22** (`nvm use`) e **Docker**.

### 2.1 Subir o serviço

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL
npm ci                        # instala exatamente o lockfile
npm run migration:run         # cria o schema
npm run start:dev             # hot-reload
```

| Onde | O quê |
|---|---|
| `http://localhost:3000/docs` | Swagger UI (contrato code-first) |
| `http://localhost:3000/health/liveness` | Probe de vida (sem dependências) |
| `http://localhost:3000/health/readiness` | PostgreSQL: `"status":"ok"` |

### 2.2 Exercitar o CRUD

```bash
curl -s -X POST localhost:3000/api/v1/user -H 'content-type: application/json' \
  -d '{"username":"theUser","email":"john@email.com","password":"s3cret"}'
curl -s localhost:3000/api/v1/user/theUser        # password NUNCA aparece
curl -s -X POST localhost:3000/api/v1/user -H 'content-type: application/json' \
  -d '{"username":"theUser"}'                     # duplicado → 409 { code, message }
```

### 2.3 Tudo containerizado / testes / reproduzir o CI

```bash
docker compose --profile full up --build          # API inclusive
npm test                                          # unit — segundos, sem Docker
npm run test:e2e                                  # Testcontainers (exige Docker)

# o que o job build-image faz com o artefato:
docker build -t users-api:ci .
docker compose -f docker-compose.yml -f docker-compose.ci.yml --profile full up -d
curl -fsS http://localhost:3000/health/readiness
docker compose -f docker-compose.yml -f docker-compose.ci.yml --profile full down -v
```

Estratégia de testes em **[TESTING.md](./TESTING.md)**.

## 3 · O que o archetype fornece (capacidades estruturais)

| Capacidade | Implementação no esqueleto |
|---|---|
| API REST | Controllers finos + DTOs (`class-validator`/`class-transformer`) + `ValidationPipe` global (whitelist estrita) + Swagger code-first em `/docs` |
| Regra de negócio | Services por módulo; colaboração entre módulos **só via service exportado** |
| Persistência | **TypeORM** → **RDS Aurora PostgreSQL**; migrations versionadas em SQL explícito, `synchronize: false` |
| Erros | Exception filter global no contrato `{ code, message }` |
| Saúde | **`@nestjs/terminus`**: `/health/liveness` e `/health/readiness` (ver seção 6) |
| Config | `registerAs` tipado por namespace + schema **Joi fail-fast** no boot |
| Observabilidade mínima | Interceptors globais de logging (com duração) e timeout |
| **Arquitetura como teste** | **ArchUnitTS** em `src/architecture.spec.ts` — as regras da seção 5 rodam como gate no `npm test` (fronteira esqueleto×exemplo, camadas, ciclos, anti-contrabando de capacidades) |
| Entrega | Dockerfile multi-stage non-root **sem toolchain npm** · chart Helm com hardening (`deploy/helm/`) · CI com 5 jobs (seção 9) |

Precisa de cache, mensageria ou integração externa resiliente? Esses padrões já estão
resolvidos na variante completa do archetype (`petstore-api`) — importe-os de lá em vez de
reinventar: chaves de cache centralizadas com invalidação explícita, consumidor SQS idempotente
com DLQ/backoff, cliente HTTP com timeout/retry/degradação.

## 4 · Estrutura — o que é esqueleto, o que é exemplo

```
src/
├── main.ts                bootstrap: prefixo configurável, Swagger, shutdown hooks
├── app.module.ts          raiz: config validada + providers globais (APP_*)
├── config/                registerAs tipado + schema Joi (fail-fast)
├── common/                exception filter global, interceptors (log, timeout)
├── database/              TypeORM + data-source da CLI
│   └── migrations/        ← [EXEMPLO] a InitialSchema cria a tabela users
├── health/                probes liveness/readiness (Terminus)
└── modules/
    └── users/             ← [EXEMPLO]
deploy/
└── helm/users-api/        chart do serviço (fragment cd-helm)
```

Todo arquivo descartável carrega o marcador **`[EXEMPLO]`** no topo. O que não tem marcador é
esqueleto: fica.

## 5 · Regras de arquitetura (agnósticas ao domínio)

1. **Autenticação fora do escopo do archetype** — sem guards na camada de aplicação, por
   decisão. AuthN/AuthZ entram como capacidade transversal quando a organização definir o
   padrão (Keycloak).
2. **Upload binário fora do escopo** — quando o domínio exigir, S3 com presigned URL; arquivo
   nunca atravessa o pod.
3. **Colaboração entre módulos só via service exportado** — nunca importar repositório ou
   entidade de outro módulo.
4. **Migrations em SQL explícito, `synchronize: false`** — migration é código de produção,
   revisável em PR.
5. **Erro sai sempre no contrato `{ code, message }`** — o filter global garante; não invente
   formatos por módulo.
6. **Config nova = namespace `registerAs` + entrada no schema Joi** — variável sem validação
   não existe.
7. **Chaves primárias `SERIAL` por padrão**; coluna anulável declara `type` explícito
   (uniões TS refletem como `Object` e derrubam o boot).
8. **Ao adotar cache/mensageria/integração externa**, siga os padrões da variante completa
   (`petstore-api`): invalidação explícita, consumidor idempotente, degradação de terceiro.

### As regras como gate — testes de arquitetura (ArchUnitTS)

Regra de arquitetura em prosa vale até o primeiro import errado — humano ou **gerado por IA**.
Por isso as regras verificáveis por grafo de imports estão codificadas em
[`src/architecture.spec.ts`](./src/architecture.spec.ts) com **ArchUnitTS** e rodam no
`npm test` — dentro do `quality-validation` do CI, sem job novo:

| Regra executável | O que garante |
|---|---|
| Esqueleto (`common/`, `config/`, `database/`, `health/`) ⊬ `[EXEMPLO]` | Apagar o módulo de exemplo **provadamente** não quebra o esqueleto |
| Sem ciclos de dependência | Proteção que nenhum outro gate dava |
| `entities/` só `*.entity.ts`, `dto/` só `*.dto.ts` | Organização NestJS pelo nome |
| Controller não importa `typeorm` · service não importa controller | Camadas finas e direção única (padrão NestJS) |
| `joi` só em `config/` | Validação de ambiente num único lugar |
| **Anti-contrabando**: nenhum arquivo importa `@aws-sdk/*`, `cache-manager`, `@nestjs/axios`, `@ssut/nestjs-sqs`, `@keyv/*` | A ADR da variante ("capacidade só entra quando o domínio precisa") como gate — cache/mensageria/HTTP externo não entram por acidente |

**Exemplo de resultado real** — violação plantada de propósito (import de cache na variante
simples) e capturada pelo gate:

```
× sem contrabando de capacidades: cache, mensageria e HTTP externo não existem nesta variante
  Architecture rule failed with 1 violation:
     path: "src/modules/users/violacao-temporaria.ts"
     rule: "variante simples não usa cache/mensageria/HTTP externo —
            adote a variante completa se precisar"
```

A mensagem já diz o caminho certo: precisa da capacidade? É decisão consciente — remove-se a
regra e importam-se os padrões prontos do `petstore-api`, nunca um import solto.

## 6 · Probes de saúde

| Rota | Pergunta | Verifica |
|---|---|---|
| `GET /health/liveness` | o processo responde? | nada externo |
| `GET /health/readiness` | posso receber tráfego? | **PostgreSQL** (ping TypeORM) |

As probes ficam **fora do prefixo da API**: contrato com o orquestrador não é endpoint de
negócio versionado. O chart em `deploy/helm/` já as referencia.

## 7 · Os módulos de exemplo — users

O exemplo demonstra a arquitetura funcionando de ponta a ponta antes de você escrever o seu
domínio (a sequência executável está na seção 2.2):

```mermaid
flowchart LR
    subgraph app["users-api (construído a partir do archetype)"]
        direction TB
        CTRL["Controllers + DTOs<br/>(pipe/filter/interceptors globais)"]
        SVC["Services<br/>[EXEMPLO] Users"]
        HLT["/health/*<br/>liveness · readiness<br/>(fora do prefixo da API)"]
        CTRL --> SVC
    end

    CLIENT["Cliente HTTP<br/>/api/v1/user"] --> CTRL
    K8S["Kubernetes<br/>(probes do chart)"] -.-> HLT
    SVC -->|"TypeORM<br/>migrations SQL"| PG[("RDS Aurora<br/>PostgreSQL")]
    HLT -.->|"readiness: ping"| PG
```

O que o CRUD de usuários (insumo: o agregado `User` da spec Swagger Petstore) exercita: DTOs
com validação (inclusive em lote, via `ParseArrayPipe`), unicidade com `409` no contrato de
erro, `@Exclude` garantindo que `password` **nunca** sai numa resposta (aplicado pelo
`ClassSerializerInterceptor` global — vale até com serialização indireta), e `404`
padronizado. Endpoints de autenticação (`/user/login`, `/user/logout`) não existem — regra 1.

## 8 · Adotando o archetype no seu serviço

1. **Execute o exemplo** (seção 2) para ver os padrões vivos.
2. **Crie seu módulo** em `modules/<seu-dominio>/` com controller fino + DTOs validados +
   entities + service (+ spec colocalizada) — as regras da seção 5 são o contrato.
3. **Apague o exemplo** — tudo que tem `[EXEMPLO]` no topo: `modules/users/` e a migration
   `InitialSchema` (substitua pela sua).
4. **Limpe os pontos acoplados ao exemplo**: `POSTGRES_*`/nomes de container no
   `docker-compose.yml`, `DB_NAME` nos `.env*`, título do Swagger no `main.ts`, values do
   chart (`deploy/helm/users-api/values.yaml`) e `catalog-info.yaml`.
5. Rode `npm run lint && npm test` — os gates são os mesmos do CI.

## 9 · Plataforma — catálogo e CI

| Artefato | Papel |
|---|---|
| `catalog-info.yaml` | Registro no catálogo do Backstage (Component, ownership, tags). Dois `PLACEHOLDER`s: `spec.owner` e `github.com/project-slug`. |
| `.github/workflows/ci.yml` | Cinco jobs, todos **sem publicar nada**: **`quality-validation`** (lint → format → unit+cobertura → build) e **`security`** (`npm audit --audit-level=high`) — required status checks; **`e2e-testing`** (Testcontainers); **`build-image`** (build `push: false` → scan Trivy em 3 camadas → smoke compose + readiness); **`helm-validate`** (helm lint → template → kubeconform, zero cluster). |
| `deploy/helm/users-api/` | Chart: Deployment com probes, `securityContext` endurecido (non-root, rootfs read-only, drop ALL), `resources`, ConfigMap + `existingSecret`. `image.repository`/`tag` parametrizados (GHCR×ECR é decisão da fase de publicação). |
| `docker-compose.ci.yml` | Override do smoke: usa a imagem `users-api:ci` recém-construída. |

> **Evolução do job `security`:** ferramentas dedicadas (socket.dev — análise de
> comportamento de pacote; Snyk; SonarQube) plugam neste job; exigem credencial de org.
> O canal SARIF→aba Security é opt-in via variável `TRIVY_SARIF_UPLOAD=true` (exige GHAS
> em repositório privado).

Fora do escopo desta fase: publicação da imagem/chart, Terraform e ArgoCD.

## 10 · Setup padronizado de desenvolvimento

| Ferramenta | Papel |
|---|---|
| ESLint 9 (flat, type-aware) + Prettier 3 | Lint e formato únicos — o mesmo `quality-validation` do CI |
| Husky + lint-staged + commitlint | `pre-commit` lint/format nos staged; Conventional Commits |
| **Snyk + SonarQube for IDE** (`.vscode/extensions.json`) | **Shift-left**: alerta enquanto se edita, antes do commit |
| `.editorconfig` / `.nvmrc` / `engines` / `.gitattributes` | Mesmo editor, mesmo Node (22), LF em `*.sh`, em qualquer máquina |
| `.env.example` / `.env.test` / `.env.docker` | Contrato de ambiente versionado; `.env` real nunca versionado |

## 11 · Segurança de dependências (supply chain)

- **`package-lock.json` versionado + `npm ci` sempre** (local, Docker e CI);
- **`overrides` para transitiva vulnerável sem fix no pai** — ex.: `js-yaml` forçado a `5.2.3`
  sob `@nestjs/swagger`, escopado;
- **`--ignore-scripts` em toda instalação** — bloqueia pós-install de terceiros;
- **`npm audit --audit-level=high` como gate** (job `security`) + **scan Trivy da imagem**
  (job `build-image`) — o audit cobre o lockfile do app; o Trivy cobre a imagem inteira;
- **Imagem final sem toolchain**: npm/corepack/yarn removidos após o `npm ci` — o runtime é
  só `node dist/main`.

### Quando o scan de imagem quebrar — runbook de triagem

O relatório completo vai para o **Job Summary** do run; o **gate** derruba o job em
HIGH/CRITICAL. Três destinos, todos com dono:

| Onde está o achado | Ação |
|---|---|
| `app/node_modules/...` — dependência da aplicação | Corrigir: bump, pin ou `overrides` (o `Fixed Version` do relatório diz o alvo) |
| SO base ou software embutido na base | Atualizar a base **ou** hardening (remover o que o runtime não usa) |
| Risco aceito / não explorável | **Somente** via [`.trivyignore`](./.trivyignore): CVE + justificativa + dono + expiração + aprovação do time de segurança |

O que **não** existe como opção: baixar a severidade do gate, remover o step, ou mergear com
o scan vermelho sem registro.
