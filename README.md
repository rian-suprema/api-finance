# api-finance — Balanço de Caixa e Conciliação Bancária

> **📖 Documentação** · **Visão geral** (este arquivo) · [🔐 Segurança & Governança](./SECURITY-README.md) · [💻 Execução local](./LOCAL-EXECUTION-README.md) · [⚙️ CI/CD & Esteira](./CI-CD.md) · [📊 Migração do Finance](./docs/migracao-finance/)

**O que você está olhando:** o `api-finance` é o serviço de **balanço de caixa** e
**conciliação bancária** (integração Trio) da SUPREMA: REST + regra de negócio + PostgreSQL
(TypeORM) + ClickHouse (data warehouse, leitura) — **sem cache distribuído e sem mensageria**.
Nasceu **construído a partir da variante simples do Archetype Backend NestJS** da SUPREMA (o
esqueleto não-funcional: ambiente reprodutível, gates de qualidade e segurança, saúde, padrões
resolvidos) — o módulo de exemplo que demonstrava esse esqueleto foi removido depois que o
Finance real foi migrado para dentro dele (17 fases, histórico completo em
[docs/migracao-finance/](./docs/migracao-finance/)). O que segue neste documento descreve o
esqueleto que sobrou e como o Finance o usa — não é mais um exemplo a apagar.

## Onde está cada coisa — os quatro documentos

Este README é a **visão geral**: o que o archetype é, o que entrega e como está organizado.
Os detalhes de cada dimensão vivem em documentos próprios, para leitura focada:

| Documento | Para quem / quando | O que cobre |
|---|---|---|
| **README.md** *(aqui)* | Primeiro contato; entender o produto | Stacks, arquitetura dos componentes, o que vem pronto (qualidade + arquitetura), estrutura, de onde o serviço veio |
| [🔐 **SECURITY-README.md**](./SECURITY-README.md) | Entender auth/autorização | Governança que **inicia na SayPlus**, o JWT e a chave pública, a fechadura em camadas, isolamento por marca (Finance) |
| [💻 **LOCAL-EXECUTION-README.md**](./LOCAL-EXECUTION-README.md) | Rodar na sua máquina | Passo a passo local, testes, observabilidade local, e a imagem via Dockerfile + docker-compose |
| [⚙️ **CI-CD.md**](./CI-CD.md) | Esteira e entrega | Os 5 jobs do CI, a esteira de qualidade (IDE → pre-commit → CI), fronteiras CI × CD e o handoff com o SRE |

---

## 1 · De onde veio o desenho — ADRs → Archetype → api-finance

O desenho de arquitetura foi **acordado em ADRs antes de o exemplo do archetype existir** —
o Finance chegou depois, sobre esse esqueleto já pronto:

```
ADRs acordadas  ──▶  Archetype (esqueleto + regras)  ──▶  api-finance (Finance real, migrado)
```

| ADR | Decisão | Por quê |
|---|---|---|
| Natureza do archetype | **Não-funcional primeiro**: ambiente local, CI, saúde e padrões resolvidos; o funcional vem depois, sobre o esqueleto | Serviço nasce pronto para operar; o domínio é a única parte que varia |
| Composição por necessidade | Esta variante **não carrega** cache nem mensageria | Capacidade só entra quando o domínio precisa — infra ociosa é custo e superfície de ataque |
| Stack | Node 22 · NestJS 11 · TypeScript strict | Golden path único por categoria |
| Persistência | TypeORM → Aurora PostgreSQL; migrations em SQL explícito, `synchronize: false` | Migration é código de produção — revisável e determinística |
| Autenticação | **Consumida da plataforma SayPlus** — o módulo valida o JWT (RS256, chave pública), nunca emite | AuthN/AuthZ são capacidade transversal da plataforma; cada serviço só declara o que cada rota exige (`@Permissions`). Detalhes em [SECURITY-README](./SECURITY-README.md) |
| Saúde | Terminus: liveness sem dependências; readiness = PostgreSQL | Contrato com o Kubernetes; o chart aponta as probes para cá |
| Supply chain | Lockfile + `npm ci` + `--ignore-scripts` + gates (IDE → pre-commit → CI) + imagem sem toolchain | Defesa em camadas contra o vetor nº 1 do ecossistema npm — ver [CI-CD](./CI-CD.md) |
| Empacotamento | CI **empacota e valida sem publicar**; publicação e deploy (GitOps/ArgoCD) são outra fase | Artefato validado antes de existir infraestrutura |

## 2 · Stacks disponíveis

O que esta variante traz de fábrica — o "golden path" desta categoria de serviço:

| Camada | Stack | Observação |
|---|---|---|
| Runtime | **Node 22** · **NestJS 11** · **TypeScript** strict | Um caminho único por categoria de serviço |
| API | REST + **Swagger** code-first (`/docs`) · `class-validator`/`class-transformer` · `ValidationPipe` global | Contrato gerado do código |
| Persistência | **TypeORM** → **RDS Aurora PostgreSQL** · migrations SQL explícito | `synchronize: false` sempre |
| AuthN/AuthZ | **passport-jwt** RS256 (consumo da SayPlus) · guards globais | Ver [SECURITY-README](./SECURITY-README.md) |
| Saúde | **@nestjs/terminus** (liveness/readiness) | Contrato com o K8s |
| Observabilidade | **OpenTelemetry** (OTLP) + logs JSON (pino) com `trace_id` | Interruptor fail-safe por env |
| Qualidade | **ESLint type-aware** + `eslint-plugin-sonarjs` + **jscpd** + **ArchUnitTS** | Gate local e no CI — seção 5 |
| Entrega | **Dockerfile** multi-stage non-root · **Helm** com hardening · CI 5 jobs | Ver [CI-CD](./CI-CD.md) |

> **Precisa de mais?** Cache (Redis/ElastiCache), mensageria (SNS→SQS) ou integração HTTP
> externa resiliente já estão resolvidos na **variante completa** (`petstore-api`): chaves de
> cache centralizadas com invalidação explícita, consumidor SQS idempotente com DLQ/backoff,
> cliente HTTP com timeout/retry/degradação. Importe de lá em vez de reinventar.

## 3 · Arquitetura dos componentes

```mermaid
flowchart LR
    subgraph app["api-finance"]
        direction TB
        CTRL["Controllers + DTOs<br/>(pipe/filter/interceptors globais)"]
        AUTH["Guards globais<br/>JWT → Permissões"]
        SVC["Services<br/>Balanço de Caixa · Conciliação"]
        HLT["/health/*<br/>liveness · readiness<br/>(fora do prefixo da API)"]
        AUTH --> CTRL --> SVC
    end

    CLIENT["Cliente HTTP<br/>/api/v1/cash-balance, /reconciliation<br/>(Bearer JWT da SayPlus)"] --> AUTH
    K8S["Kubernetes<br/>(probes do chart + CronJob)"] -.-> HLT
    SVC -->|"TypeORM<br/>migrations SQL"| PG[("RDS Aurora<br/>PostgreSQL")]
    SVC -->|leitura| CH[("ClickHouse<br/>data warehouse")]
    SVC -->|leitura point-in-time| TRIO["Trio banking-api"]
    HLT -.->|"readiness: ping"| PG
    OTEL["OpenTelemetry<br/>(OTLP, opt-in)"] -.->|traces/métricas| SVC
```

| Capacidade | Implementação no esqueleto |
|---|---|
| API REST | Controllers finos + DTOs (`class-validator`/`class-transformer`) + `ValidationPipe` global (whitelist estrita) + Swagger code-first em `/docs` |
| Regra de negócio | Services por módulo; colaboração entre módulos **só via service exportado** |
| Persistência | **TypeORM** → **RDS Aurora PostgreSQL**; migrations versionadas em SQL explícito, `synchronize: false` |
| Segurança | Guards globais (JWT RS256 + permissões) — ver [SECURITY-README](./SECURITY-README.md) |
| Erros | Exception filter global no contrato `{ code, message }` |
| Saúde | **`@nestjs/terminus`**: `/health/liveness` e `/health/readiness` (seção 7) |
| Config | `registerAs` tipado por namespace + schema **Joi fail-fast** no boot |
| Observabilidade | **OpenTelemetry** (traces + métricas OTLP, interruptor fail-safe por env — seção 7) · logs **JSON estruturados** (pino) com trace_id · interceptors de logging/timeout |
| **Arquitetura como teste** | **ArchUnitTS** em `src/architecture.spec.ts` — as regras rodam como gate no `npm test` (seção 5) |
| Entrega | Dockerfile multi-stage non-root **sem toolchain npm** · chart Helm com hardening (`deploy/helm/`) · CI com 5 jobs (ver [CI-CD](./CI-CD.md)) |

## 4 · Estrutura — esqueleto do archetype vs. módulos de negócio do Finance

```
src/
├── main.ts                bootstrap: prefixo configurável, Swagger, shutdown hooks
├── app.module.ts          raiz: config validada + providers globais (APP_*)
├── auth/                  consumo da auth SayPlus (guards, strategy, decorators)
├── config/                registerAs tipado + schema Joi (fail-fast)
├── common/                exception filter global, interceptors (log, timeout)
├── clickhouse/            conexão global com o data warehouse (leitura)
├── database/              TypeORM + data-source da CLI + migrations
├── health/                probes liveness/readiness (Terminus)
├── cli/                   5 CLIs do Finance (conciliação, captura Trio, exportação, import)
└── modules/
    ├── finance-cash-balance/    balanço de caixa — 7 rotas
    └── finance-reconciliation/  conciliação bancária — 7 rotas
deploy/
├── helm/api-finance/       chart do serviço
└── infra/                 requirements.yaml — declaração de infraestrutura
```

O esqueleto (`auth/`, `config/`, `common/`, `database/`, `health/`) é genérico do archetype —
`src/architecture.spec.ts` garante, por teste, que ele nunca importa nada de `modules/`. Os
módulos de negócio do Finance vivem em `modules/finance-*`, sem RLS de tenant (marca ≠ tenant —
ver [CLAUDE.md](./CLAUDE.md) e
[APRENDIZADOS-DECISOES-FINANCE.md](./docs/migracao-finance/APRENDIZADOS-DECISOES-FINANCE.md),
decisão 5). Detalhe completo de rotas/regras de negócio em
[docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md](./docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md).

## 5 · Qualidade e arquitetura, prontas de fábrica

Duas coisas que o archetype **entrega junto com o código** — não como configuração que o time
precisa montar depois, mas como gate que já nasce verde e barra a regressão. Aqui está **o que
são**; onde o dev as vê rodando está em [💻 Execução local](./LOCAL-EXECUTION-README.md), e como
elas viram barreira de PR está em [⚙️ CI/CD](./CI-CD.md) — **um mesmo mecanismo, três pontos de
contato: IDE → pre-commit → CI.**

### 5.1 Quality gate — smells, complexidade, bloaters e duplicação

Sem servidor nenhum: as regras rodam no ESLint que já existe (+ um detector de duplicação),
com os limiares **calibrados contra esta base** (nascem verdes; mudar limiar é decisão
registrada em PR):

| O que pega | Mecanismo | Limiar |
|---|---|---|
| **Code smells** (funções idênticas, branches duplicados, ifs colapsáveis…) | `eslint-plugin-sonarjs` — as regras da própria SonarSource, sem servidor Sonar | ruleset recommended |
| **Complexidade cognitiva** (dificuldade de LER o fluxo) | `sonarjs/cognitive-complexity` | 15 |
| **Complexidade ciclomática** (caminhos independentes) | ESLint core `complexity` | 15 |
| **Bloaters** (função/arquivo grandes demais) | `max-lines-per-function` / `max-lines` / `max-depth` | 80 / 400 / 4 |
| **Lista longa de parâmetros** | `max-params` (limiar acomoda o padrão de DI do Nest; acima disso é sinal legítimo de SRP violado) | 5 |
| **Densidade de duplicação** | **`jscpd`** — step próprio no CI | **3%** (hoje: 0,53%) |

Exceções calibradas: testes ficam fora dos *bloaters* (`describe()` é longo por natureza) e
podem repetir literais (fixtures legíveis); o rigor de type-safety continua valendo neles.

> **Sonar e afins:** a publicação destas métricas em ferramentas como **SonarQube é possível**
> (mesma família de regras), mas os archetypes **ainda não estão plugados** a Sonar via CI
> (`.github/workflows`) — exige servidor/token de organização. Hoje o gate é local + CI, e
> um limite conhecido dessa escolha: sem servidor não existe o escopo "código novo" (baseline);
> o `jscpd` mede o repositório inteiro — para um archetype, que nasce limpo, isso é até mais
> estrito.

### 5.2 Arquitetura como teste — ArchUnitTS

Regra de arquitetura em prosa vale até o primeiro import errado — humano ou **gerado por IA**.
Por isso as regras verificáveis estão codificadas em
[`src/architecture.spec.ts`](./src/architecture.spec.ts) com **ArchUnitTS** e rodam no
`npm test` — dentro do `quality-validation` do CI, sem job novo:

| Regra executável | O que garante |
|---|---|
| Esqueleto (`common/`, `config/`, `database/`, `health/`) ⊬ `modules/**` | Trocar/apagar um módulo de negócio **provadamente** não quebra o esqueleto |
| Sem ciclos de dependência | Proteção que nenhum outro gate dava |
| `entities/` só `*.entity.ts`, `dto/` só `*.dto.ts` | Organização NestJS pelo nome |
| Controller não importa `typeorm` · service não importa controller | Camadas finas e direção única (padrão NestJS) |
| `joi` só em `config/` | Validação de ambiente num único lugar |
| **Pilares de segurança**: toda rota declara `@Permissions(...)` ou `@Public()` | O deny-by-default do runtime antecipado para o build — rota nova sem declaração não compila o PR (funciona também para código gerado por IA) |
| **Anti-contrabando**: nenhum arquivo importa `@aws-sdk/*`, `cache-manager`, `@nestjs/axios`, `@ssut/nestjs-sqs`, `@keyv/*` | A ADR da variante ("capacidade só entra quando o domínio precisa") como gate — cache/mensageria/HTTP externo não entram por acidente |

**Exemplo de resultado real** — violação plantada de propósito (import de cache na variante
simples) e capturada pelo gate:

```
× sem contrabando de capacidades: cache, mensageria e HTTP externo não existem nesta variante
  Architecture rule failed with 1 violation:
     path: "src/modules/finance-cash-balance/violacao-temporaria.ts"
     rule: "variante simples não usa cache/mensageria/HTTP externo —
            adote a variante completa se precisar"
```

A mensagem já diz o caminho certo: precisa da capacidade? É decisão consciente — remove-se a
regra e importam-se os padrões prontos do `petstore-api`, nunca um import solto.

## 6 · Regras de arquitetura (agnósticas ao domínio)

1. **Autenticação é da plataforma; o módulo CONSOME** — nenhum serviço emite token, guarda
   senha ou chama a SayPlus para validar: o JWT (RS256) é verificado offline com a chave
   PÚBLICA da plataforma, e cada rota declara o code de permissão que exige
   (`@Permissions`). Detalhes em [🔐 SECURITY-README](./SECURITY-README.md).
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

## 7 · Saúde e telemetria (o que o componente expõe)

| Rota | Pergunta | Verifica |
|---|---|---|
| `GET /health/liveness` | o processo responde? | nada externo |
| `GET /health/readiness` | posso receber tráfego? | **PostgreSQL** (ping TypeORM) |

As probes ficam **fora do prefixo da API**: contrato com o orquestrador não é endpoint de
negócio versionado. O chart em `deploy/helm/` já as referencia.

O esqueleto emite **traces + métricas via OTLP** (`src/telemetry/otel.ts`) e **logs JSON
estruturados** (pino) com `trace_id` injetado, governados por **um interruptor de ambiente** —
a mesma imagem nos três estados:

| Estado | Como | Quem vê o quê |
|---|---|---|
| **Desligado** *(padrão)* | Sem `OTEL_EXPORTER_OTLP_ENDPOINT` — o SDK **nem inicia** | Dev local, unit e CI rodam sem custo nenhum |
| **Ligado local** *(opt-in do dev)* | Profile `observability` do compose + endpoint no `.env` | **Grafana em `localhost:3300`** — ver [💻 Execução local](./LOCAL-EXECUTION-README.md) |
| **Ligado no cluster** | `OTEL_*` nos `values-<env>.yaml`, preenchidos pelo **SRE** | Collector do cluster; backend, dashboards e sampling são do SRE — ver [⚙️ CI/CD](./CI-CD.md) |

Nesta variante a auto-instrumentação cobre HTTP de entrada (sem `/health/*` — probe não é
sinal) e **TypeORM/pg**.

> **O que é um span:** a unidade do trace — **uma operação com início, fim, duração e
> atributos**, encadeada em árvore pai→filho. O trace é a árvore inteira; olhar para ela
> responde "onde foi o tempo?" e "onde quebrou?" sem caçar log. Nesta variante:
>
> ```
> trace: POST /cash-balance/:brand/register  (span raiz)
> ├── span: SELECT cash_balance_bank_entries FOR UPDATE  (TypeORM/pg — trava sob transação)
> └── span: INSERT INTO cash_balance_brand_snapshots      (TypeORM/pg)
> ```

**Fail-open provado por teste:** o e2e roda com a telemetria **ligada contra um Collector
propositalmente morto** (`test/otel-failopen.setup.ts`) — suíte verde = observabilidade nunca
derruba a aplicação. **O app só fala OTLP; tudo após o Collector é do SRE.**

## 8 · Os módulos de negócio — Finance

Dois módulos, 14 rotas de negócio (7 + 7), migrados em 17 fases de um serviço em Prisma para
este archetype em TypeORM — histórico completo (decisões, aprendizados, dados, infraestrutura)
em [docs/migracao-finance/](./docs/migracao-finance/).

- **`finance-cash-balance`** — o balanço de caixa diário por marca: confirmação de bancos
  manuais, releitura do fechamento point-in-time da Trio, registro do balanço (`saldoTransacional
  - saldoJogadores = totalBalanco`) e histórico.
- **`finance-reconciliation`** — a conciliação entre a plataforma e o extrato bancário: casamento
  1:1 por chave do gateway (nunca por valor), liquidação de estornos, evidência de correção de
  saldo para pagamentos manuais, e o tratamento (nota) de pendências pelo operador.

Nenhum dos dois usa RLS de tenant do esqueleto — isolamento por marca vive na camada de
aplicação (`BrandAccessService`). Regras de negócio rota a rota, com os 25 invariantes que
viraram teste, em
[docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md](./docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md).

## 9 · De onde este serviço veio

Este repositório nasceu como cópia da variante simples do **Archetype Backend NestJS** (esqueleto
não-funcional, seções 1-7 acima) e recebeu o módulo Finance por cima, em 17 fases — o módulo de
exemplo (`users`/petshop) que demonstrava o esqueleto foi removido depois que o Finance estava
completo e testado. Se precisar comparar contra o template original ou trazer uma atualização
dele, o remote `upstream` aponta para o archetype:

```bash
git remote -v   # origin → api-finance · upstream → o archetype original
git fetch upstream
```

Rode `npm run lint && npm test && npm run test:e2e && npm run build` — os gates são os mesmos
do CI (ver [⚙️ CI/CD](./CI-CD.md)).

---

**Continue em:** [🔐 Segurança & Governança](./SECURITY-README.md) · [💻 Execução local](./LOCAL-EXECUTION-README.md) · [⚙️ CI/CD & Esteira](./CI-CD.md) · [🧪 Estratégia de testes](./TESTING.md)
