# 💻 Execução local — users-api

> **📖 Documentação** · [Visão geral](./README.md) · [🔐 Segurança & Governança](./SECURITY-README.md) · **Execução local** (este arquivo) · [⚙️ CI/CD & Esteira](./CI-CD.md)

Passo a passo para rodar o serviço na sua máquina — **100% offline, custo AWS zero**. No fim,
como empacotar e rodar a **imagem Docker** localmente, igual ao que o CI faz com o artefato.

Pré-requisitos: **Node 22** (`nvm use`) e **Docker**.

## 1 · Subir o serviço (hot-reload)

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL (+ cria os roles owner/app — ver seção 5)
npm ci                        # instala exatamente o lockfile
npm run migration:run         # cria o schema
npm run start:dev             # hot-reload
```

| Onde | O quê |
|---|---|
| `http://localhost:3000/docs` | Swagger UI (contrato code-first) |
| `http://localhost:3000/health/liveness` | Probe de vida (sem dependências) |
| `http://localhost:3000/health/readiness` | PostgreSQL: `"status":"ok"` |

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
curl -s -X POST localhost:3000/api/v1/user -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"username":"theUser","email":"john@email.com","password":"s3cret"}'
curl -s localhost:3000/api/v1/user/theUser -H "authorization: Bearer $TOKEN"   # password NUNCA aparece
curl -s -X POST localhost:3000/api/v1/user -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"username":"theUser"}'                     # duplicado → 409 { code, message }
curl -s localhost:3000/api/v1/user/theUser        # SEM token → 401
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

## 6 · Observabilidade local (opt-in)

A telemetria é desligada por padrão. Para ver traces/métricas/logs num Grafana local:

```bash
docker compose --profile observability up -d      # stack otel-lgtm (um container)
# no .env: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
npm run start:dev
```

Grafana em **`http://localhost:3300`** (3000 é a API): requests e queries do TypeORM aparecem
como spans, logs correlacionados por `trace_id`. Nada disso pesa o `up` padrão. O conceito
(o que é um span, os três estados do interruptor) está em [Visão geral › §7](./README.md).

## 7 · Setup padronizado de desenvolvimento

| Ferramenta | Papel |
|---|---|
| ESLint 9 (flat, type-aware) + Prettier 3 | Lint e formato únicos — o mesmo `quality-validation` do CI |
| Husky + lint-staged + commitlint | `pre-commit` lint/format nos staged; Conventional Commits |
| **Snyk + SonarQube for IDE** (`.vscode/extensions.json`) | **Shift-left**: alerta enquanto se edita, antes do commit |
| `.editorconfig` / `.nvmrc` / `engines` / `.gitattributes` | Mesmo editor, mesmo Node (22), LF em `*.sh`, em qualquer máquina |
| `.env.example` / `.env.test` / `.env.docker` | Contrato de ambiente versionado; `.env` real nunca versionado |

## 8 · Tudo containerizado — a imagem local via Dockerfile + docker-compose

Além do modo hot-reload (seção 1, app no host), você pode rodar **a aplicação também em
container**, e ir além: **construir a mesma imagem que o CI empacota** e rodá-la localmente.
Isso pega defeitos que só existem *dentro da imagem de produção* — o clássico "funciona no meu
`start:dev` mas o container não sobe".

### 8.1 App containerizada (compose faz o build)

```bash
docker compose --profile full up --build          # Postgres + API, tudo em container
curl -fsS http://localhost:3000/health/readiness   # "status":"ok"
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
curl -fsS http://localhost:3000/health/readiness

# 4. limpa
docker compose -f docker-compose.yml -f docker-compose.ci.yml --profile full down -v
```

Se o passo 3 responder `ok`, a imagem que iria para o registry sobe de verdade com a dependência
real. É o mesmo **smoke** que o CI roda no job `build-image` — o detalhe do pipeline está em
[⚙️ CI/CD](./CI-CD.md).

---

**Continue em:** [📖 Visão geral](./README.md) · [🔐 Segurança & Governança](./SECURITY-README.md) · [⚙️ CI/CD & Esteira](./CI-CD.md)
