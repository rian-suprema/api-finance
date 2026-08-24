# 💻 Execução local — users-api

> **📖 Documentação** · [Visão geral](./README.md) · [🔐 Segurança & Governança](./SECURITY-README.md) · **Execução local** (este arquivo) · [⚙️ CI/CD & Esteira](./CI-CD.md)

Passo a passo para rodar o serviço na sua máquina — **100% offline, custo AWS zero**. No fim,
como empacotar e rodar a **imagem Docker** localmente, igual ao que o CI faz com o artefato.

## 0 · Pré-requisitos e referência rápida

Projeto Node/NestJS padrão — se você já conhece o fluxo `npm ci` → `npm run start:dev`, pule
para a seção 1.

### Ferramentas

| Ferramenta  | Versão                                                 | Por quê / como conferir                                                                                                  |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Node.js** | **22.x** (`>=22 <23`, travado em `engines` + `.nvmrc`) | `nvm use` seleciona a versão do `.nvmrc`; `node -v` confere. Fora da faixa, o `npm ci` avisa                             |
| **npm**     | vem com o Node 22                                      | `npm -v`. Use **`npm ci`** (instala exatamente o `package-lock.json`), não `npm install` — reprodutível e idêntico ao CI |
| **Docker**  | daemon no ar                                           | Sobe a infra local (**Postgres**) e roda os testes e2e (Testcontainers). `docker info` confere                           |

### Os comandos do projeto (scripts do `package.json`)

| Comando                                           | O que faz                                                          | Infra? |
| ------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| `npm ci`                                          | Instala as dependências exatamente como no lockfile                | ❌     |
| `npm run start:dev`                               | Sobe a API com **hot-reload** (watch)                              | ✅     |
| `npm run build`                                   | Compila TypeScript → `dist/` (o que a imagem de produção roda)     | ❌     |
| `npm run start:prod`                              | Roda o build (`node dist/main`), como em produção                  | ✅     |
| `npm test`                                        | Unit + **regras de arquitetura** (ArchUnitTS) — rápido, sem Docker | ❌     |
| `npm run test:watch` / `test:cov`                 | Unit em watch / com cobertura                                      | ❌     |
| `npm run test:e2e`                                | Ponta a ponta com **infra real efêmera** (Testcontainers)          | ⚠️     |
| `npm run lint` / `lint:fix`                       | ESLint (type-aware + quality gate) — verifica / corrige            | ❌     |
| `npm run format` / `format:check`                 | Prettier — formata / verifica                                      | ❌     |
| `npm run dup:check` / `dup:report`                | jscpd — duplicação (gate 3%) / relatório HTML                      | ❌     |
| `npm run migration:run`                           | Aplica as migrations (cria/atualiza o schema)                      | ✅     |
| `npm run migration:generate` / `migration:revert` | Gera migration a partir do diff / reverte a última                 | ✅     |
| `npm run auth:keys` / `auth:token`                | Par RS256 de dev / Bearer token de dev (seção 2)                   | ❌     |

**Infra?** ✅ precisa da infra no ar (`docker compose up -d`: Postgres) — conecta de verdade ·
⚠️ precisa só do **Docker** (o Testcontainers sobe a própria infra efêmera, não usa o compose) ·
❌ não precisa de nada além do Node.

> Dica: `npm run` sozinho lista todos os scripts disponíveis — não precisa decorar.

## 1 · Subir o serviço (hot-reload)

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL (+ cria os roles owner/app — ver seção 5)
npm ci                        # instala exatamente o lockfile
npm run migration:run         # cria o schema
npm run start:dev             # hot-reload
```

| Onde                                     | O quê                            |
| ---------------------------------------- | -------------------------------- |
| `http://localhost:3005/docs`             | Swagger UI (contrato code-first) |
| `http://localhost:3005/health/liveness`  | Probe de vida (sem dependências) |
| `http://localhost:3005/health/readiness` | PostgreSQL: `"status":"ok"`      |

### Formas de subir — o que cada comando levanta

Os serviços opcionais ficam atrás de **profiles**: o `up -d` puro sobe só a infra; app, ferramentas e observabilidade são opt-in.

| Comando                                                  | Serviços que sobem → porta publicada no host                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `docker compose up -d`                                   | `postgres` → **5432**                                                   |
| `docker compose --profile full up -d`                    | `postgres` (5432) + `api` → **3005** (Swagger/health)                   |
| `docker compose --profile tools up -d`                   | `postgres` (5432) + `pgadmin` → **5050**                                |
| `docker compose --profile observability up -d`           | `postgres` (5432) + `otel-lgtm` → **3300** (Grafana) · 4317/4318 (OTLP) |
| `docker compose --profile tools up -d --no-deps pgadmin` | **só `pgadmin`** → **5050** (quando o Postgres já está no ar)           |

> As portas acima são as **padrão** (do `docker-compose.yml` + `.env.example`). Nesta máquina, se
> houver um `docker-compose.override.yml` remapeando a `5432` (ver a nota logo abaixo), o Postgres
> é publicado na porta remapeada — a `api` (3005), `pgadmin` (5050) e Grafana (3300) não mudam.

> **Só o pgAdmin:** `docker compose --profile tools up -d pgadmin` sobe o pgAdmin **e** o Postgres
> (dependência); para subir **apenas** o container do pgAdmin — com o banco já rodando de um
> `up -d` anterior — use `--no-deps`.

> **⚠️ Para derrubar, repita o profile do `up`.** `docker compose down` **puro NÃO derruba**
> serviços de profile (pgAdmin, api, otel) — eles continuam rodando ("presos"), e
> `--remove-orphans` não ajuda (não são órfãos, só estão num profile inativo). Use o mesmo
> profile: `docker compose --profile tools down`; ou, para remover **tudo** de qualquer profile
> sem precisar lembrar quais subiu: `docker compose --profile "*" down`.

> **⚠️ Porta 5432 já ocupada na sua máquina?** Se você já tem um Postgres (ou outra stack)
> usando a `5432`, o `docker compose up -d` falha ao publicar a porta — ou, pior, o
> `migration:run` conecta no **banco errado** e você vê `password authentication failed for
user "users"` (o outro Postgres respondeu, mas não tem esse usuário). Solução: crie um
> `docker-compose.override.yml` (gitignorado) remapeando a **porta publicada** e ajuste o
> `DB_PORT` do `.env` para a mesma porta — a rede interna do compose não muda. Exemplo:
>
> ```yaml
> # docker-compose.override.yml (local, não versionado)
> services:
>   postgres:
>     ports: !override
>       - '15432:5432' # publica em 15432; no .env: DB_PORT=15432
> ```
>
> Em máquina **sem** esse conflito, o `5432` padrão do `.env.example` funciona sem ajuste —
> por isso o override e o `.env` são gitignorados. Lembre: recriar o `.env` a partir do
> `.env.example` traz o `5432` de volta; reaplique a porta remapeada se estiver nesse cenário.

## 2 · Autenticar localmente (sem a SayPlus real)

Toda rota de negócio exige um JWT (deny-by-default — ver [🔐 Segurança](./SECURITY-README.md)).
Localmente você faz o papel da SayPlus com um par RS256 efêmero:

```bash
npm run auth:keys    # gera keys/{private,public}.pem (gitignorado)
npm run auth:token   # imprime um Bearer token de dev com as permissões do módulo
```

O `.env.example` já aponta `JWT_PUBLIC_KEY_PATH=keys/public.pem`. Guarde o token numa variável
para as chamadas seguintes:

```bash
TOKEN=$(npm run auth:token --silent)
```

## 3 · Exercitar o CRUD

```bash
curl -s -X POST localhost:3005/api/v1/user -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"username":"theUser","email":"john@email.com","password":"s3cret"}'
curl -s localhost:3005/api/v1/user/theUser -H "authorization: Bearer $TOKEN"   # password NUNCA aparece
curl -s -X POST localhost:3005/api/v1/user -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"username":"theUser"}'                     # duplicado → 409 { code, message }
curl -s localhost:3005/api/v1/user/theUser        # SEM token → 401
```

## 4 · Testes — e os ganhos de qualidade que você vê na hora

```bash
npm test             # unit + architecture.spec (ArchUnitTS) — segundos, sem Docker
npm run test:e2e     # Testcontainers: Postgres real e efêmero (exige Docker)
```

O mesmo **gate de qualidade** do CI roda aqui, com feedback imediato — é a primeira das três
paradas do mecanismo (IDE → **pre-commit/local** → CI; ver [Visão geral › §5](./README.md) e
[⚙️ CI/CD](./CI-CD.md)):

```bash
npm run lint         # ESLint type-aware + sonarjs (smells, complexidade, bloaters)
npm run dup:check    # jscpd — densidade de duplicação (gate 3%)
npm run dup:report   # relatório HTML navegável em report/jscpd (gitignorado)
npm run format:check # Prettier
```

O que o `npm test` inclui de graça: as **regras de arquitetura** viram teste (fronteira
esqueleto×exemplo, camadas, ciclos, **pilares de segurança** e anti-contrabando). Uma rota nova
sem `@Permissions`/`@Public`, ou um import proibido, **quebra aqui** — antes do commit, não no
PR. O detalhe de cada regra está em [Visão geral › §5.2](./README.md).

Estratégia de testes completa em **[TESTING.md](./TESTING.md)**.

## 5 · Exercitar a RLS de verdade localmente (opcional)

Por padrão, o app local conecta como o superusuário do Postgres — cômodo, mas a RLS fica
**inerte** (superusuário dribla policy). Para ver a **rede de segurança do banco** agindo, use
os dois roles não-super que o `scripts/initdb/01-roles.sql` cria na 1ª subida do volume:

```bash
# migrations como OWNER (não-super); a app como RUNTIME (não-owner)
DB_MIGRATION_USERNAME=users_owner DB_MIGRATION_PASSWORD=users_owner_dev \
  DB_APP_ROLE=users_app npm run migration:run

# rode a app apontando para o role de runtime
DB_USERNAME=users_app DB_PASSWORD=users_app_dev npm run start:dev
```

Agora uma query sem o contexto de tenant vê **zero linhas** (fail-safe), e cada requisição só
enxerga o seu tenant — o mecanismo em [🔐 Segurança › §6](./SECURITY-README.md). Os testes
`test/rls.e2e-spec.ts` e `test/rls-app.e2e-spec.ts` provam isso automaticamente.

## 6 · Ferramentas locais (opt-in)

Além da infra do dia a dia, o compose traz ferramentas opcionais em **profiles** — não pesam o
`up` padrão e não fazem parte da infra de produção (por isso ficam fora do `requirements.yaml`).

### 6.1 Administração do banco — pgAdmin

```bash
docker compose --profile tools up -d                     # Postgres + pgAdmin
docker compose --profile tools up -d --no-deps pgadmin   # só o pgAdmin (Postgres já no ar)
```

Abra **`http://localhost:5050`** — login `admin@example.com` / `admin`. O servidor
**`users (local)`** já vem **pré-cadastrado** (via `scripts/pgadmin/servers.json`): host
`postgres`, porta `5432` (a rede interna do compose — independe do remapeamento de porta do
host). Na primeira conexão o pgAdmin pede a senha do banco: **`users`**.

> Prefere uma ferramenta instalada na sua máquina (DBeaver, psql, DataGrip)? O Postgres também
> está publicado no host — conecte em `localhost:5432` (ou na porta remapeada pelo
> `docker-compose.override.yml`, se existir nesta máquina). O pgAdmin em container é só a opção
> "zero instalação".

### 6.2 Observabilidade — Grafana/OTel

A telemetria é desligada por padrão. Para ver traces/métricas/logs num Grafana local:

```bash
docker compose --profile observability up -d      # stack otel-lgtm (um container)
# no .env: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
npm run start:dev
```

Grafana em **`http://localhost:3300`** (a API usa 3005): requests e queries do TypeORM aparecem
como spans, logs correlacionados por `trace_id`. O conceito (o que é um span, os três estados
do interruptor) está em [Visão geral › §7](./README.md).

## 7 · Setup padronizado de desenvolvimento

| Ferramenta                                                | Papel                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| ESLint 9 (flat, type-aware) + Prettier 3                  | Lint e formato únicos — o mesmo `quality-validation` do CI       |
| Husky + lint-staged + commitlint                          | `pre-commit` lint/format nos staged; Conventional Commits        |
| **Snyk + SonarQube for IDE** (`.vscode/extensions.json`)  | **Shift-left**: alerta enquanto se edita, antes do commit        |
| `.editorconfig` / `.nvmrc` / `engines` / `.gitattributes` | Mesmo editor, mesmo Node (22), LF em `*.sh`, em qualquer máquina |
| `.env.example` / `.env.test` / `.env.docker`              | Contrato de ambiente versionado; `.env` real nunca versionado    |

## 8 · Tudo containerizado — a imagem local via Dockerfile + docker-compose

Além do modo hot-reload (seção 1, app no host), você pode rodar **a aplicação também em
container**, e ir além: **construir a mesma imagem que o CI empacota** e rodá-la localmente.
Isso pega defeitos que só existem _dentro da imagem de produção_ — o clássico "funciona no meu
`start:dev` mas o container não sobe".

### 8.1 App containerizada (compose faz o build)

```bash
docker compose --profile full up --build          # Postgres + API, tudo em container
curl -fsS http://localhost:3005/health/readiness   # "status":"ok"
docker compose --profile full down
```

### 8.2 Construir e rodar a imagem exatamente como o CI (smoke local)

O `Dockerfile` é multi-stage, roda **non-root** (`USER node`) e tem o **toolchain removido** do
estágio final (só `node dist/main`). Reproduza o job `build-image` na sua máquina:

```bash
# 1. constrói a imagem de produção
docker build -t users-api:ci .

# 2. sobe a IMAGEM recém-construída contra o Postgres real (override de smoke)
docker compose -f docker-compose.yml -f docker-compose.ci.yml --profile full up -d

# 3. o smoke: a imagem empacotada boota e responde o mínimo?
curl -fsS http://localhost:3005/health/readiness

# 4. limpa
docker compose -f docker-compose.yml -f docker-compose.ci.yml --profile full down -v
```

Se o passo 3 responder `ok`, a imagem que iria para o registry sobe de verdade com a dependência
real. É o mesmo **smoke** que o CI roda no job `build-image` — o detalhe do pipeline está em
[⚙️ CI/CD](./CI-CD.md).

---

**Continue em:** [📖 Visão geral](./README.md) · [🔐 Segurança & Governança](./SECURITY-README.md) · [⚙️ CI/CD & Esteira](./CI-CD.md)
