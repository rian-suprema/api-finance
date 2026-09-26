# 🔐 Segurança & Governança — api-finance

> **📖 Documentação** · [Visão geral](./README.md) · **Segurança & Governança** (este arquivo) · [💻 Execução local](./LOCAL-EXECUTION-README.md) · [⚙️ CI/CD & Esteira](./CI-CD.md)

Este documento explica **como a segurança do módulo funciona de ponta a ponta**: a governança
que **nasce na SayPlus** e o escopo que **cada módulo plugado precisa resolver** — autenticação
e autorização. O módulo **não implementa** identidade: ele **consome** a da plataforma e
**prova** que confia nela de forma verificável.

> O isolamento de dados do Finance é por **marca** (até 3 por request, resolvida via
> `GET /auth/me`), não por tenant — não há RLS nas tabelas do Finance. Ver
> [`BrandAccessService`](./src/modules/finance-cash-balance/domain/services/brand-access.service.ts)
> e a decisão 5 em
> [APRENDIZADOS-DECISOES-FINANCE.md](./docs/migracao-finance/APRENDIZADOS-DECISOES-FINANCE.md).
> O esqueleto genérico do archetype trazia multi-tenancy com RLS+FORCE no PostgreSQL para o
> módulo de exemplo que já foi removido — esse mecanismo não existe mais neste repositório.

## 1 · O fluxo, de ponta a ponta — quem resolve o quê

A identidade **começa na SayPlus** (governança) e é **aplicada em cada módulo** (consumo).
A fronteira é nítida: a SayPlus decide *quem é* e *o que pode*; o módulo *verifica e obedece*.

```mermaid
flowchart TB
    subgraph SAYPLUS["☁️ SayPlus — GOVERNANÇA (fonte da verdade)"]
        direction TB
        CAT["Catálogo de permissões<br/>finance.cash-balance.summary.read, ..."]
        IDN["Autentica o usuário<br/>define marcas + permissões concedidas"]
        SIGN["Emite o JWT RS256<br/>ASSINA com a chave PRIVADA"]
        CAT --> IDN --> SIGN
    end

    subgraph MOD["🧩 Módulo (api-finance) — ESCOPO A RESOLVER (consumo)"]
        direction TB
        V1["1 · Valida a assinatura<br/>chave PÚBLICA · iss · aud · exp<br/>(offline, zero I/O)"]
        V2["2 · Autentica<br/>token inválido/ausente → 401"]
        V3["3 · Autoriza<br/>@Permissions × claim → 403"]
        V4["4 · Isola por marca<br/>GET /auth/me resolve as marcas do usuário"]
        V1 --> V2 --> V3 --> V4
    end

    SIGN ==>|"Bearer JWT<br/>(a cada requisição)"| V1
    PUB["🔑 chave PÚBLICA<br/>montada no pod (Secret)"] -.->|"confiança verificável"| V1
    SIGN -.->|"a SayPlus confia no módulo porque ele\nprova a posse de um token que SÓ ela assina"| PUB
```

**Escopo de cada lado, resumido:**

| Responsabilidade | SayPlus (plataforma) | Módulo (este serviço) |
|---|---|---|
| Cadastro de permissões (catálogo) | ✅ governa | consome os *codes* |
| Login / emissão de token | ✅ emite (assina com a privada) | **nunca** emite |
| Vínculo do usuário com marcas | ✅ expõe via `GET /auth/me` | resolve via `BrandAccessService`, nunca de body/header |
| Validação do token | — | ✅ offline, com a chave pública |
| Autorização por rota | concede em runtime | ✅ exige via `@Permissions` |
| Isolamento por marca | — | ✅ filtro na app (`BrandAccessService`), sem RLS |

## 2 · Modelo de confiança — como a SayPlus confia no módulo

Não há chamada de rede, sessão compartilhada nem banco comum entre a SayPlus e o módulo. A
confiança é **criptográfica e unidirecional**, no padrão de chave assimétrica (RS256):

- a **SayPlus** guarda a **chave privada** e é a única que consegue **assinar** um token;
- o **módulo** recebe só a **chave pública** e com ela **verifica** a assinatura — consegue
  provar que um token foi emitido pela SayPlus, mas **não consegue forjar** nenhum;
- por isso a validação é **offline e sem I/O**: verificar uma assinatura é CPU pura
  (microssegundos), não uma ida à rede. A SayPlus continua dona de todo o ciclo de identidade.

`RS256` é **requisito, não opção**: o algoritmo é fixado na strategy (`algorithms: ['RS256']`),
o que fecha o ataque clássico de **downgrade para HS256** — em que alguém usaria a chave
pública (que não é secreta) como segredo simétrico para forjar tokens. Ver a matriz na seção 7.

## 3 · O que vem no JWT

O token que chega em `Authorization: Bearer <jwt>` carrega o contrato de identidade da SayPlus.
O módulo lê estes campos (`src/auth/jwt-payload.interface.ts`) e **nada mais**:

| Claim | Exemplo | Uso no módulo |
|---|---|---|
| `sub` | `"user-42"` | Identificador do usuário (auditoria/log) |
| `email` | `"maria@empresa.com"` | Informativo |
| `tenantId` | `"tenant-a"` | Herdado do contrato do archetype; o Finance não usa como filtro de RLS — marca vem de `GET /auth/me` |
| `permissions[]` | `["finance.reconciliation.read", ...]` | Confrontado com o `@Permissions` de cada rota |
| `iss` | `"sayplus"` | Conferido: emissor esperado |
| `aud` | `["sayplus", "finance"]` | Conferido: o módulo pertence ao catálogo `finance` |
| `exp` | *(timestamp)* | Conferido: token expirado → 401 |
| *(header)* `alg` | `"RS256"` | **Fixo** — qualquer outro algoritmo é recusado |

```jsonc
// payload de um token válido (decodificado)
{
  "sub": "user-42",
  "email": "maria@empresa.com",
  "tenantId": "tenant-a",
  "permissions": ["finance.reconciliation.read", "finance.reconciliation.run"],
  "iss": "sayplus",
  "aud": ["sayplus", "finance"],
  "iat": 1735000000,
  "exp": 1735003600
}
```

## 4 · A fechadura — o caminho de uma requisição

Dois guards **globais** ([`src/auth/`](./src/auth/)) valem para toda rota que existir ou vier
a existir — na ordem em que executam:

```mermaid
flowchart LR
    REQ["Requisição<br/>Bearer JWT"] --> G1{"JwtAuthGuard<br/>assinatura + iss + aud + exp"}
    G1 -->|inválido/ausente| E401["401"]
    G1 -->|ok| G2{"PermissionsGuard<br/>@Permissions × permissions[]"}
    G2 -->|"falta code / rota sem declaração"| E403["403<br/>(deny-by-default)"]
    G2 -->|ok| H["Handler + Service<br/>BrandAccessService resolve as marcas via /auth/me"]
    H -->|"marca não reconhecida"| E400["400"]
    H -->|"marca reconhecida sem vínculo"| E403b["403"]
    H --> DB[("PostgreSQL<br/>8 tabelas do Finance, sem RLS")]
    PUB["@Public()<br/>(só health probes)"] -.->|dispensa token| H
```

| Guard | Pergunta | Falhou |
|---|---|---|
| `JwtAuthGuard` | Quem é? JWT **RS256** válido (assinatura contra a chave pública da SayPlus + `iss` + `aud` + expiração — zero I/O, criptografia pura) | **401** |
| `PermissionsGuard` | O que pode? `@Permissions('finance.reconciliation.read')` da rota × claim `permissions[]` do token | **403** |

O mesmo invariante falha FECHADO em três camadas, em momentos diferentes do ciclo de vida:

1. **Build/CI** — regra ArchUnitTS: rota sem `@Permissions`/`@Public` derruba o `npm test`
   (detalhe da regra em [Visão geral › §5.2](./README.md) e [CI/CD](./CI-CD.md));
2. **Runtime** — *deny-by-default*: rota sem declaração responde 403, sempre;
3. **Chave ausente** — o app SOBE (probes são `@Public`, readiness passa), grita no log e
   toda rota protegida responde 401 até a chave ser montada: deploy mal configurado vira
   alarme, nunca outage nem brecha.

## 5 · Governança — nova feature, zero código de segurança

**Nova feature = zero código de segurança**: registra-se o code no catálogo SayPlus,
adiciona-se 1 constante em [`permissions.constants.ts`](./src/auth/permissions.constants.ts)
e o decorator na rota — a concessão (quem tem o quê) é governada na SayPlus em runtime,
sem redeploy.

```typescript
@Permissions(FINANCE_RECONCILIATION.RUN)   // ← a única "mudança de segurança" numa rota nova
@Post('run')
runReconciliation() { ... }
```

Convenção canônica dos codes: `modulo.recurso.acao`, com verbos `read | create | edit | delete`
(é `edit`, nunca `update`). Os codes são **strings opacas** para o módulo — quem os concede é o
catálogo. Todo code precisa estar **registrado na SayPlus** antes de aparecer num token.

## 6 · Isolamento por marca (Finance) — sem RLS

O esqueleto genérico do archetype trazia multi-tenancy com RLS+FORCE no PostgreSQL (para o
módulo de exemplo, já removido). O Finance **não usa esse mecanismo**: nenhuma das 8 tabelas
tem RLS habilitada. O isolamento é só na camada de aplicação:

- `GET /auth/me` (plataforma SayPlus) devolve os tenants/marcas do usuário, resolvidos pelo
  [`PlatformIdentityService`](./src/modules/finance-cash-balance/infrastructure/platform/platform-identity.service.ts)
  a partir do Bearer do próprio request — nunca de body/query;
- [`BrandAccessService.requireBrand`](./src/modules/finance-cash-balance/domain/services/brand-access.service.ts)
  confere a marca da URL contra essa lista: marca fora do catálogo → `400`; marca no catálogo
  mas sem vínculo do usuário → `403`;
- para as rotas de item da conciliação (`:id`, sem marca na URL), a autorização é **pelo dado**:
  o item é buscado por id e sua `brand` é conferida contra as marcas acessíveis — passar um id
  de marca alheia nunca vaza o registro, dá `403`.

**Por que não RLS:** com `FORCE ROW LEVEL SECURITY` ativo, toda leitura/escrita sem o GUC de
tenant setado passaria a ver zero linhas — inclusive as 14 rotas HTTP do Finance, que não usam
GUC nenhum. Decisão registrada (3 opções apresentadas, escolhida a defesa em aplicação) na
decisão 5 de
[APRENDIZADOS-DECISOES-FINANCE.md](./docs/migracao-finance/APRENDIZADOS-DECISOES-FINANCE.md). O
caminho job/CLI (sem guard HTTP nenhum) usa `assertKnownBrand()` como defesa em profundidade,
chamada antes de qualquer use-case resolver.

## 7 · Provado por teste — a matriz de forja

`test/security.e2e-spec.ts` transforma as garantias da strategy em comportamento travado por
teste — cada 401 é uma FORJA que precisa ser rejeitada. Se alguém relaxar `algorithms`, `issuer`
ou `audience` na strategy, o CI quebra antes do merge.

| Tentativa | Esperado |
|---|---|
| Chave certa + iss/aud/permissão corretos | passa a auth (o domínio responde) |
| Token assinado por **outra** chave privada RS256 | **401** |
| **Downgrade HS256** com a chave pública como segredo | **401** (algorithms fixo em RS256) |
| `alg: none` (sem assinatura) | **401** |
| `issuer` errado · `audience` errada · expirado | **401** |
| Assinatura válida, **sem** a permissão | **403** (deny-by-default) |

Nos testes, [`test/auth-helper.ts`](./test/auth-helper.ts) faz o papel da SayPlus com um par
RS256 efêmero em memória (o mesmo mecanismo do `npm run auth:token` local) — é ele que assina
os tokens válidos e as forjas da matriz acima. A rota-veículo é
`POST /reconciliation/items/:id/reopen` com um id inexistente — prova "auth OK" via `404` do
domínio sem precisar de dado de negócio real (e sem depender de ClickHouse/Trio, só do stub de
identidade). A autorização por marca (400 marca inválida, 403 sem vínculo) tem sua própria
matriz nos e2e do Finance (`test/finance-smoke.e2e-spec.ts`), não neste arquivo.

## 8 · Entrega da chave, rede e serviço-a-serviço

**Entrega da chave em produção:** o chart monta um Secret do namespace como o arquivo apontado
por `JWT_PUBLIC_KEY_PATH` (value `jwtPublicKey.existingSecret`). O Secret vive **fora** do
chart; trade-off registrado em `deploy/infra/requirements.yaml`: para uma chave **pública**
(sem requisito de confidencialidade, rotação rara), provisionamento direto/GitOps é
suficiente — o trilho ASM(+KMS)+ESO é opcional, só se paga como trilho único da operação.
Evolução registrada: quando o IdP federado (Keycloak) publicar **JWKS**, a troca fica
confinada ao `secretOrKeyProvider` da strategy (comentário no ponto exato) — guards,
decorators e claims não mudam.

**Rede (Leste/Oeste):** o chart traz uma **NetworkPolicy default-deny de ingress** que
**nasce habilitada** nos values de ambiente — por padrão, nenhum pod do cluster abre conexão
com este serviço; o único allow é o caminho do gateway, declarado pelo SRE
(`networkPolicy.ingress.gatewayNamespace`, marcador `[SRE]` — vazio = deny-all total).
Pré-requisito no `requirements.yaml`: o CNI do cluster precisa impor NetworkPolicy.
Egress default-deny é evolução futura registrada.

**Serviço-a-serviço:** decisão registrada — **não** existe guard interno nem rota de
serviço adormecida: toda rota exige JWT de usuário (`@Permissions`) ou é `@Public`.
Necessidade real de chamada serviço-a-serviço passa por avaliação de arquitetura
(mTLS/mesh, client-credentials da plataforma), caso a caso — nunca um default do archetype.

---

**Continue em:** [📖 Visão geral](./README.md) · [💻 Execução local](./LOCAL-EXECUTION-README.md) · [⚙️ CI/CD & Esteira](./CI-CD.md)
