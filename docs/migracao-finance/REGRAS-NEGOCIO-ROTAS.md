# Regras de negócio por rota — módulo Finance

**Origem analisada:** `/home/feh/sayplus-modules/finance/finance-api/src`
**Método:** cada rota foi lida de ponta a ponta — controller → DTO → service → use-case → repositório /
adapter de integração. As regras abaixo descrevem **o comportamento do código**, não a especificação.
Onde código e documentação da origem divergem, o código prevalece e a divergência está marcada.
**Escopo:** somente regras de negócio das rotas HTTP (+ jobs, §5). Dados em
[`DADOS-FINANCE.md`](./DADOS-FINANCE.md); infraestrutura em
[`INFRA-FINANCE.md`](./INFRA-FINANCE.md); plano de migração em
[`MIGRACAO-FINANCE.md`](./MIGRACAO-FINANCE.md).

---

## 0 · Mapa das rotas

15 rotas: 14 de negócio + `/health`. Prefixo `api` na origem, `api/v1` no destino.

| # | Método | Rota | Permissão | Status OK | Escreve? | Chama serviço externo em tempo de request? |
|---|---|---|---|---|---|---|
| 1 | GET | `/cash-balance/summary` | `finance.cash-balance.summary.read` | 200 | não | ClickHouse (2 queries) |
| 2 | GET | `/cash-balance/banks` | `finance.cash-balance.banks.read` | 200 | não | ClickHouse (1 query) |
| 3 | GET | `/cash-balance/history` | `finance.cash-balance.summary.read` | 200 | não | ClickHouse (1 query) |
| 4 | GET | `/cash-balance/trio/refresh` | `finance.cash-balance.banks.read` | 200 | não | **nenhum** — ver §2.4 |
| 5 | POST | `/cash-balance/:brand/banks/:bank/confirm` | `finance.cash-balance.banks.confirm` | **204** | sim | não |
| 6 | POST | `/cash-balance/:brand/register` | `finance.cash-balance.register.create` | **201** | sim | ClickHouse (2 queries) |
| 7 | POST | `/cash-balance/:brand/reopen` | `finance.cash-balance.register.create` | **204** | sim | não |
| 8 | GET | `/reconciliation` | `finance.reconciliation.read` | 200 | não | não |
| 9 | GET | `/reconciliation/history` | `finance.reconciliation.read` | 200 | não | não |
| 10 | POST | `/reconciliation/run` | `finance.reconciliation.run` | **202** | sim (assíncrono) | ClickHouse + **Trio** (em background) |
| 11 | GET | `/reconciliation/:brand/corrections` | `finance.reconciliation.read` | 200 | não | ClickHouse (2–3 queries) |
| 12 | POST | `/reconciliation/:brand/corrections/apply` | `finance.reconciliation.resolve` | **201** | sim | ClickHouse (2–3 queries) |
| 13 | POST | `/reconciliation/items/:id/resolve` | `finance.reconciliation.resolve` | **204** | sim | não |
| 14 | POST | `/reconciliation/items/:id/reopen` | `finance.reconciliation.resolve` | **204** | sim | não |
| 15 | GET | `/health` | `@Public()` | 200 | não | não |

> **Correção ao `MIGRACAO-FINANCE.md` §3.1:** aquele documento descreve
> `GET /cash-balance/trio/refresh` como "o único endpoint que de fato chama a Trio na hora". **Não
> chama.** `RefreshTrioUseCase` lê `trio_closing_balances` no Postgres, e o comentário do próprio
> arquivo é explícito: *"Lê do Postgres, não da Trio"*. **Nenhuma das 14 rotas HTTP toca a API da
> Trio de forma sincronizada** — só os crons, os CLIs e o processamento em background disparado pela
> rota 10 fazem isso. É uma decisão de projeto importante (nenhuma tela paga latência de integração),
> e descrever errado convida alguém a "otimizar" removendo a captura agendada.

---

## 1 · Regras transversais (valem para todas as rotas)

### 1.1 · Cadeia de guardas

Ordem de execução, todos globais (`APP_GUARD` em `app.module.ts`/`auth.module.ts`):

```
JwtAuthGuard  →  PermissionsGuard  →  Controller
```

> **Correção (Fase 17, §8):** um `ThrottlerGuard` (100 req/min) chegou a ser documentado aqui como
> parte da cadeia — **não existe** em nenhuma camada (nem `src/`, nem Helm/ingress). Divergência
> registrada em §8; decisão do usuário foi documentar, não implementar, nesta trilha.

| Guarda | Regra | Erro |
|---|---|---|
| `JwtAuthGuard` | Bearer RS256 validado **só com a chave pública** — o módulo nunca emite token. `@Public()` isenta | `401` |
| `PermissionsGuard` | deny-by-default: sem permissão declarada na rota, passa; com permissão declarada, exige que o **claim do JWT** contenha **ao menos uma** das declaradas (`required.some(...)`) | `403` |

Duas consequências que importam:

1. **As permissões vêm do JWT, não de `GET /auth/me`.** A fonte de verdade é `role_permissions` no
   banco da plataforma, refletida no token. Se os 8 códigos não estiverem registrados no catálogo da
   plataforma, **tudo é negado** — comportamento correto, e bloqueio de lançamento.
2. **A semântica é OR, não AND.** Nenhuma rota declara mais de uma permissão hoje, então isso não tem
   efeito prático — mas é uma diferença real caso o destino use AND.

### 1.2 · Escopo por marca — o isolamento de tenant deste módulo

**A marca nunca vem do body nem da query.** Ela vem sempre da associação do usuário na plataforma,
resolvida por `GET /auth/me` (`PlatformIdentityService`), com cache de 60s em memória chaveado por
hash SHA-256 do token. Passar `:brand` na URL **não concede acesso**.

Dois padrões distintos, e a diferença muda o código de erro:

| Padrão | Rotas | Comportamento com marca não acessível |
|---|---|---|
| `resolveBrands()` — **filtra** | 1, 2, 3, 4, 8, 9, 10 | a marca simplesmente **não aparece** na resposta. Usuário sem marca nenhuma recebe `200` com lista vazia |
| `requireBrand(:brand)` — **exige** | 5, 6, 7, 11, 12 | `400` se a marca não existe no catálogo; **`403`** se existe mas o usuário não tem vínculo |
| Escopo pelo dado | 13, 14 | a marca é lida do **item** e conferida contra as acessíveis → `403` |

O mapeamento marca → tenant é por slug, no catálogo em código (`cash-balance.constants.ts`):

| `brand` | `label` | `tenantSlug` na plataforma |
|---|---|---|
| `suprema` | Suprema | `suprema-bet` |
| `ultra` | Ultra | `ultra-bet` |
| `maxima` | Maxima | `maxima-bet` |

`GET /auth/me` devolve `data.tenants[]` com `{id, slug}`; o serviço cruza `slug` com `tenantSlug` e
devolve `{brand, tenantId}`. Um usuário pode ter **até 3 marcas simultâneas** num mesmo request — é
por isso que o recorte vive na aplicação e não numa RLS de tenant único.

**Se `/auth/me` falhar:** `503 Não foi possível validar as marcas do usuário`, em **todas** as 14
rotas. É a dependência mais crítica do módulo.

### 1.3 · Data de referência — o default é "ontem em BRT"

| Regra | Detalhe |
|---|---|
| Parâmetro | `date` (rotas de um dia) ou `from`/`to` (rotas de intervalo), sempre `YYYY-MM-DD` |
| Validação de formato | `@Matches(/^\d{4}-\d{2}-\d{2}$/)` no DTO → `400` com mensagem específica |
| Default de `date` | `yesterdayInBrt()` — o dia anterior no fuso `America/Sao_Paulo` |
| Default de `to` | `yesterdayInBrt()` |
| Default de `from` | `to − 14 dias` (`HISTORY_DEFAULT_RANGE_DAYS = 15`, com os dois extremos incluídos) |
| Teto de intervalo | `HISTORY_MAX_RANGE_DAYS = 180` dias → `400` acima disso |
| `from > to` | `400 A data inicial não pode ser posterior à final` |
| Sem paginação | nenhuma rota pagina; os tetos (180 dias, 500 itens) substituem paginação |
| Data futura | **aceita** — não há validação de limite superior. Devolve tela vazia |

Por que "ontem": o balanço fecha o dia anterior, o `fct_kpi_daily` só tem o dia consolidado, e a
captura do fechamento da Trio acontece depois da meia-noite. Pedir hoje devolveria dado incompleto,
por isso o default nunca é hoje.

**Não há validação de limite superior de data.** `date=2099-01-01` responde `200` com tudo vazio. É
inofensivo, mas é comportamento que um teste de contrato no destino deve fixar de propósito, em vez de
descobrir.

### 1.4 · Validação de corpo — `forbidNonWhitelisted` é regra de negócio aqui

O `ValidationPipe` global é `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`. Isso
não é só higiene: é o **mecanismo de imposição** de uma regra de negócio real.

`RegisterBrandDto` declara **apenas** `date`. Enviar `{"date":"2026-08-15","balance":123}` para
`POST /:brand/register` retorna **`400`**, não é silenciosamente ignorado. É assim que "o registro não
aceita saldo no corpo" deixa de ser convenção e passa a ser garantia — o único jeito de um saldo entrar
é pela confirmação banco a banco.

Se o destino relaxar `forbidNonWhitelisted`, essa garantia desaparece sem que nenhum teste de negócio
falhe. Vale um teste nomeado explicitamente por isso.

### 1.5 · Contratos de resposta e de erro (e o que muda no destino)

| | Origem | Archetype (destino) |
|---|---|---|
| Sucesso | envelope `{ data, timestamp, path }` (`TransformInterceptor`) | sem envelope — o DTO direto |
| Erro | `{ statusCode, ...payload }` | `{ code, message }` |
| 500 | `{ statusCode: 500, message: 'Erro interno do servidor.' }` — **nunca** stack trace | idem, sem stack |

**O detalhe que a migração de contrato pode destruir:** o `GlobalExceptionFilter` da origem espalha o
payload da exceção na resposta (`{ statusCode, ...payload }`), com comentário explícito de que isso é
proposital *"(ex.: pendingBanks)"*. A rota 6 usa isso para devolver **quais** bancos faltam confirmar:

```json
{ "statusCode": 400,
  "message": "Todos os bancos da marca precisam ser confirmados antes de registrar",
  "pendingBanks": ["onekey", "zro", "celcoin"] }
```

Um contrato `{ code, message }` estrito **perde `pendingBanks`**, e a tela deixa de poder destacar os
bancos pendentes. Ao adotar o contrato do archetype, preservar o campo (ou equivalente em `details`) é
requisito funcional, não capricho. Este é o único payload de erro estruturado do módulo.

### 1.6 · Auditoria automática

Toda mutação autenticada (`POST`/`PATCH`/`PUT`/`DELETE`) gera linha em `finance_audit_logs`, via
`AuditInterceptor`, com `action` derivada do último segmento da URL (`REGISTER`, `CONFIRM`, `REOPEN`,
`CLOSE`) e `after` = corpo da resposta. Fire-and-forget: falha de auditoria nunca afeta a resposta.
Para as rotas `204`, `after` é nulo — o log registra que aconteceu, não o quê. Detalhes e limitações
em `DADOS-FINANCE.md` §5.

### 1.7 · Aritmética monetária

- Tudo passa por `roundCurrency()` (2 casas, com correção de `Number.EPSILON`) antes de sair ou de ser
  gravado.
- Comparações de valor entre sistemas são feitas em **centavos inteiros** (`Math.round(x * 100)`),
  nunca em `float`.
- Nenhuma coluna monetária é `float` (`DECIMAL(18,2)` em todas).

---

## 2 · Módulo Balanço de Caixa — 7 rotas

### 2.1 · `GET /cash-balance/summary` — KPIs do topo da tela

```
GET /cash-balance/summary?date=2026-08-15
Permissão: finance.cash-balance.summary.read      →  200
```

**O que faz:** devolve 6 cards de KPI (total + quebra por marca) lidos do data warehouse.

| Card | Fórmula | Fonte |
|---|---|---|
| `depositsYesterday` | `sum(deposit_total)` do dia | `fct_kpi_daily` |
| `withdrawalsYesterday` | `sum(saque_total)` do dia | idem |
| `netDepositYesterday` | depósito − saque, **marca a marca** | derivado |
| `depositsMonth` | `sum(deposit_total)` do 1º do mês até `date` | `fct_kpi_daily` |
| `withdrawalsMonth` | `sum(saque_total)` do mês | idem |
| `netDepositMonth` | depósito − saque do mês, marca a marca | derivado |

**Passo a passo:**

1. Resolve `referenceDate` (default: ontem em BRT).
2. Resolve as marcas acessíveis via `/auth/me`.
3. Se o ClickHouse **não está configurado**, devolve imediatamente o summary vazio com
   `available: false` — sem erro.
4. Dispara as duas queries em paralelo (dia e mês).
5. Monta os 6 cards com `buildKpiCard(brands, amounts)`: cada card tem `total` (soma das marcas
   acessíveis) e `byBrand[]` na ordem do catálogo, com `label`.

**Regras que não são óbvias:**

- **Depósito e saque nunca são persistidos como fonte primária.** São lidos do warehouse a cada
  request. As colunas `cash_balance_daily.deposits_total`/`withdrawals_total` existem, mas são cópia
  informativa do momento do registro — somá-las para relatório é errado por construção.
- **`net_deposit` é subtraído marca a marca, não no total.** `subtractByBrand` percorre a união das
  chaves dos dois mapas. O total do card é a soma dos resultados por marca. Aritmeticamente equivale
  ao total-a-total, mas a quebra por marca fica correta mesmo quando uma marca tem depósito e não tem
  saque.
- **Falha do warehouse não é erro.** `try/catch` loga `warn` e devolve o summary vazio com
  `available: false`. É deliberado: *"KPI indisponível não bloqueia a tela: o bloco de bancos segue
  editável"*. A tela precisa saber ler `available: false` e mostrar "indisponível", não "R$ 0,00" —
  senão a degradação vira mentira.
- O total considera **só as marcas acessíveis** ao usuário. Dois usuários com vínculos diferentes veem
  totais diferentes para o mesmo dia, e isso é correto.

**Erros:** `401`, `403`, `429`, `400` (formato de data), `503` (`/auth/me` fora).

---

### 2.2 · `GET /cash-balance/banks` — a tela de trabalho do operador

```
GET /cash-balance/banks?date=2026-08-15
Permissão: finance.cash-balance.banks.read      →  200
```

**O que faz:** devolve o estado editável do dia: 8 bancos × cada marca acessível, com os agregados.

**Passo a passo:**

1. Resolve data e marcas.
2. Cinco leituras **em paralelo**: o dia (`findDay`), o último saldo conhecido por banco
   (`findLastKnownBalances`), o acumulado do mês (`sumMonthlyBalances`), o fechamento da Trio
   (`RefreshTrioUseCase` → Postgres) e o saldo de jogadores (ClickHouse).
3. Para cada marca, monta o estado dos 8 bancos na **ordem do catálogo** (`caixa`, `trio`, `onekey`,
   `zro`, `celcoin`, `okto`, `topazio`, `genial`).
4. Calcula os agregados da marca.

**Como o estado de cada banco é decidido:**

| Caso | `balance` | `confirmed` | `suggested` | `readOnly` |
|---|---|---|---|---|
| Banco `trio` | fechamento capturado; se não houver, o entry gravado; senão `0` | `true` só se houver captura | `true` se **não** houver captura | **`true`** |
| Banco manual já confirmado no dia | o valor confirmado | `true` | `false` | `false` |
| Banco manual não confirmado | entry do dia, senão **último saldo conhecido antes da data**, senão `0` | `false` | `true` | `false` |

A **sugestão** é a peça de usabilidade central: o operador abre a tela com o saldo do último dia
registrado já preenchido e só ajusta o que mudou. Vem de `findLastKnownBalances`, que faz duas
queries (um `groupBy` para achar a data máxima anterior por marca, e um `findMany` para carregar os
entries daquelas datas) — nunca uma query por marca.

**Agregados por marca:**

```
saldoTransacional  =  soma dos balances dos 8 bancos (inclui a Trio)
saldoJogadores     =  fct_sigap_saldo_diario FINAL → saldo_financeiro_total_disponivel_apostadores
totalBalanco       =  saldoTransacional − saldoJogadores        ← o sinal
acumuladoMensal    =  soma dos total_balanco confirmados do mês
```

**Regras que não são óbvias:**

- **O sinal de `totalBalanco` é `transacional − jogadores`.** Positivo = excedente a transferir da
  conta transacional; negativo = a transacional está abaixo do que se deve aos jogadores, que é
  situação de alerta. Corrigido em 30/07/2026 — a especificação original tinha o inverso. Inverter de
  novo é regressão.
- **`saldoJogadores` e `totalBalanco` vêm `null`, não `0`, quando o warehouse está fora.** `null` e
  zero significam coisas opostas aqui, e a tela precisa distinguir.
- **A Trio é read-only nesta tela** (`readOnly: true`) — a confirmação individual dela é recusada com
  `400` pela rota 5.
- **`confirmed` do card da Trio significa "há captura", não "alguém confirmou".** Não existe operador
  no fluxo da Trio.
- **`exact: false`** no card da Trio dispara a mensagem *"Fechamento sem convergência, conferir"* — é o
  rótulo das linhas antigas escritas por reconstrução, das quais 8 de 18 estavam erradas.
- **`allBanksConfirmed`** considera os 8 bancos, incluindo a Trio — portanto **sem captura da Trio o
  botão da marca não libera**, mesmo com os 7 manuais confirmados.
- **`allBrandsConfirmed`** conta marcas `CONFIRMED` do dia contra `BRANDS.length` (3) — e conta as **3
  do catálogo**, não as acessíveis ao usuário. Um usuário com uma marca só vê corretamente que o
  **dia** não fechou porque as outras duas faltam.
- **`pendingBanks`** é a lista de bancos não confirmados — é o que a tela usa para destacar o que falta.

**Desempenho:** ~135 ms medidos na origem, e é assim porque **nenhuma leitura chama a Trio**. Trocar
isso por leitura direta na Trio degradaria a tela de 135 ms para segundos e reintroduziria o problema
que a captura agendada resolveu (a API da Trio não tem saldo histórico).

---

### 2.3 · `GET /cash-balance/history` — histórico e fechamento de período

```
GET /cash-balance/history?from=2026-08-01&to=2026-08-15
Permissão: finance.cash-balance.summary.read      →  200
```

**O que faz:** tabela de dias registrados + KPIs do período + totais.

**Passo a passo:**

1. `resolveRange(from, to)`: defaults, validação de formato, `from ≤ to`, teto de 180 dias.
2. Duas leituras em paralelo: os balanços registrados do intervalo (`findRegisteredRange`) e os KPIs
   por dia+marca do warehouse.
3. Agrupa por data, **mais recente primeiro**, e ordena as marcas dentro de cada dia pela ordem do
   catálogo (Suprema, Ultra, Maxima) — não pela ordem do banco.
4. Monta KPIs do período, subtotais por dia e totais.

**A regra mais importante desta rota — duas fontes, dois recortes:**

| Bloco | Fonte | Cobre |
|---|---|---|
| Tabela (`days[]`) | snapshots do **próprio módulo** | **só dias registrados** (`CONFIRMED` **e** com snapshot) |
| KPIs do topo | **data warehouse** | **o intervalo inteiro**, registrado ou não |

Os dois podem — e vão — divergir quando algum dia do intervalo não foi registrado. É por isso que a
resposta traz `rangeDays` (dias corridos do intervalo) e `registeredDays` (dias com registro): **a tela
precisa exibir "X de Y dias"**, senão o usuário compara um KPI de 15 dias com uma soma de 11 e conclui
que o sistema está errado.

**Duas médias, dois divisores — de propósito:**

```
netDepositDailyAverage    = netDeposit    / rangeDays     ← warehouse tem dado TODO dia
totalBalancoDailyAverage  = totalBalanco  / days.length   ← balanço só existe em dia registrado
```

Usar o mesmo divisor nos dois dilui a média do balanço pelos dias em que ninguém registrou nada.
`divideByBrand` devolve mapa vazio quando o divisor é `≤ 0` — nunca `NaN`.

**Outras regras:**

- Rascunho (`DRAFT`) **não** aparece na tabela: o histórico mostra só o que foi registrado.
- Dia `CONFIRMED` sem snapshot é descartado (`flatMap` filtra) — proteção contra estado impossível.
- `totals.lastDay` traz os saldos do dia mais recente do intervalo (não a soma), porque saldo é
  posição e não fluxo: somar `saldoTransacional` de 15 dias não significa nada.
- `kpisAvailable: false` quando o warehouse falha — a tabela continua respondendo.
- Sem paginação: o teto de 180 dias × 3 marcas = no máximo 540 linhas.

**Erros:** `400` (formato, `from > to`, intervalo > 180 dias), `401`, `403`, `429`, `503`.

---

### 2.4 · `GET /cash-balance/trio/refresh` — releitura do fechamento capturado

```
GET /cash-balance/trio/refresh?date=2026-08-15
Permissão: finance.cash-balance.banks.read      →  200
```

**O que faz:** devolve o fechamento da Trio por marca, para a tela atualizar só aquele card sem
recarregar tudo.

**Lê do Postgres (`trio_closing_balances`), NÃO da Trio.** Duas razões, ambas registradas no código:
a API da Trio não tem saldo histórico (o fechamento só existe porque um job o capturou no instante do
corte), e nenhuma consulta de tela deve pagar latência de integração.

**Resposta por marca:**

| Situação | `balance` | `available` | `exact` | `message` |
|---|---|---|---|---|
| Sem captura para o dia | `null` | `false` | `false` | "Saldo de fechamento da Trio não capturado para este dia" |
| Captura `POINT_IN_TIME` | valor | `true` | `true` | ausente |
| Captura antiga não convergida | valor | `true` | `false` | "Fechamento sem convergência, conferir" |

**Regra de negócio:** `available: false` é o sinal de que **o dia não pode ser registrado** — a rota 6
falhará com `503`. É o gate mais importante da tela, e é por isso que este endpoint existe separado.

---

### 2.5 · `POST /cash-balance/:brand/banks/:bank/confirm` — confirmação individual

```
POST /cash-balance/suprema/banks/onekey/confirm
Body: { "balance": 1234567.89, "date"?: "2026-08-15" }
Permissão: finance.cash-balance.banks.confirm      →  204 No Content
```

**Passo a passo:**

1. Valida o corpo: `balance` obrigatório, numérico, **máximo 2 casas decimais**; `date` opcional no
   formato ISO. Campo extra → `400`.
2. Resolve `referenceDate`.
3. `requireBrand(:brand)` → `400` se a marca não existe no catálogo, **`403`** se o usuário não tem
   vínculo. Devolve `{brand, tenantId}`.
4. `findBank(:bank)` → `400 Banco não reconhecido` se fora do catálogo de 8.
5. Se o banco é `trio` → **`400 Saldo da Trio é somente leitura`**.
6. `roundCurrency(balance)`.
7. `ensureDaily`: upsert de `cash_balance_days` (cria o dia se não existir) + upsert de
   `cash_balance_daily` (cria a marca em `DRAFT`, gravando `tenant_id`).
8. Upsert de `cash_balance_bank_entries` por `(daily_id, bank)` com `confirmed = true`,
   `confirmed_at = now`, `confirmed_by = userId`, `type = MANUAL`, `source = MANUAL`.

**Regras que não são óbvias:**

- **Cada confirmação é atômica e independente.** Confirmar 7 bancos são 7 requisições. Não existe
  endpoint em lote — a granularidade *é* a regra: cada banco tem um responsável e um instante.
- **Reconfirmar é permitido**, e sobrescreve valor, autor e instante. Não há trava por marca já
  `CONFIRMED`: é possível confirmar um banco de uma marca já registrada, e o valor novo **não** entra
  no snapshot até um novo `register`. Não é bug — reabrir e registrar de novo é o caminho —, mas é
  estado intermediário que a tela precisa saber representar (banco confirmado divergindo do snapshot).
- **A chamada cria o dia.** A primeira confirmação do dia é o que faz `cash_balance_days` existir, com
  `status = OPEN`.
- **`balance` aceita negativo.** `@IsNumber({maxDecimalPlaces: 2})` não impõe mínimo. Saldo bancário
  negativo é possível na vida real (conta a descoberto), então aceitar é defensável — mas não há
  nenhum limite superior tampouco: `999999999999.99` passa. Vale decidir no destino se entra
  `@Min`/`@Max`, e a decisão é de negócio, não técnica.
- `confirmed_by` fica com o `userId` do JWT — é o rastro de quem afirmou o número.

**Erros:** `400` (corpo inválido, campo extra, marca inexistente, banco inexistente, banco Trio),
`401`, `403` (sem vínculo com a marca), `429`, `503` (`/auth/me`).

---

### 2.6 · `POST /cash-balance/:brand/register` — o botão "OK" da marca

```
POST /cash-balance/suprema/register
Body: { "date"?: "2026-08-15" }        ← NÃO aceita saldo, ver §1.4
Permissão: finance.cash-balance.register.create      →  201 + corpo
```

A rota mais rica em regras do módulo. **Escrita transacional que grava o fato imutável do dia.**

**Passo a passo:**

1. Valida o corpo: só `date`. Qualquer outro campo → `400` (é a imposição de "não aceita saldo").
2. Resolve `referenceDate` e `requireBrand` (→ `400`/`403`).
3. **Saldos manuais** (`resolveManualBalances`): lê o dia, coleta os entries `confirmed = true` que
   **não** são `trio`, e compara com `MANUAL_BANKS` (7). Se faltar algum:
   ```
   400 { message: "Todos os bancos da marca precisam ser confirmados antes de registrar",
         pendingBanks: [...] }
   ```
4. **Fechamento da Trio** (`resolveTrioBalance`): lê `trio_closing_balances`. Se não houver captura ou
   o saldo for `null`:
   ```
   503 "Saldo de fechamento da Trio não capturado para este dia — não é possível registrar o balanço"
   ```
5. **Saldo de jogadores** (`resolvePlayersBalance`): exige ClickHouse configurado (`503` se não) e o
   valor da marca presente (`503 Saldo de jogadores não encontrado para a data informada`).
6. **KPIs do dia** (`resolveDailyKpis`): lê `fct_kpi_daily`. **Falha aqui não bloqueia** — cai para
   `{0, 0}` com `warn`, porque é snapshot informativo, não fonte primária.
7. Calcula:
   ```
   saldoTransacional = trioBalance + soma(manualBalances)
   totalBalanco      = saldoTransacional − saldoJogadores
   ```
8. **Em uma transação** (`registerBrand`):
   - upsert `cash_balance_days` (cria se não existir);
   - upsert `cash_balance_daily` → `status = CONFIRMED`, `confirmed_at/by`, e grava
     `deposits_total`/`withdrawals_total`/`net_deposit` do KPI;
   - upsert de um `bank_entry` por banco manual (`confirmed = true`);
   - upsert do `bank_entry` da **Trio** com `type = API`, `source = TRIO`, `confirmed = true` e
     **sem** `confirmed_by` (não há operador);
   - calcula `acumuladoMensal` = soma dos `total_balanco` dos snapshots `CONFIRMED` do mês até a data,
     **excluindo o próprio `daily_id`**, mais o `totalBalanco` atual;
   - upsert do `cash_balance_brand_snapshots`;
   - conta marcas `CONFIRMED` da data; se `≥ 3` e o dia não estava `CLOSED`, fecha o dia
     (`closed_at`, `closed_by = userId`).
9. Responde `201` com `{brand, referenceDate, saldoTransacional, saldoJogadores, totalBalanco,
   acumuladoMensal, dayStatus, allBrandsConfirmed}`.

**As sete regras de negócio embutidas, em ordem de importância:**

1. **O saldo nunca vem do corpo.** A fonte é sempre o que foi confirmado banco por banco. Sem isso, a
   exigência de confirmação individual seria contornável por uma chamada direta à API.
2. **Todos os 7 bancos manuais confirmados, ou nada.** E o erro **diz quais faltam**.
3. **Sem fechamento capturado da Trio, não registra.** O comentário no código é a justificativa:
   *"gravar o saldo do instante como se fosse o fechamento é justamente o erro que a captura veio
   corrigir"* — o erro que estragou 8 de 18 fechamentos.
4. **Sem saldo de jogadores, não registra.** `totalBalanco` sem `saldoJogadores` não existe; gravar
   zero seria gravar um número errado numa tabela que não se corrige com `UPDATE`.
5. **O sinal é `transacional − jogadores`.**
6. **O dia só fecha com as 3 marcas** — e o gate conta as 3 do catálogo, não as do usuário.
7. **`acumuladoMensal` é soma corrente** e exclui o próprio registro antes de somar, o que torna o
   re-registro do mesmo dia idempotente. **Mas:** re-registrar um dia **passado** deixa os dias
   posteriores do mês com acumulado defasado — só o CLI de importação chama
   `recomputeMonthlyAccumulated`. É débito conhecido do modelo (`DADOS-FINANCE.md` §3.4), não da
   tradução.

**Erros:** `400` (corpo com campo extra, marca inexistente, bancos pendentes com `pendingBanks`),
`401`, `403`, `429`, `503` (Trio não capturada / jogadores indisponível / `/auth/me`).

> **Observação de projeto:** esta rota devolve `201` porque é o default do Nest para `POST`, mas
> semanticamente é um *upsert* — re-registrar o mesmo dia atualiza. Se o destino padronizar
> `200` para upsert, é mudança de contrato para a tela.

---

### 2.7 · `POST /cash-balance/:brand/reopen` — reabertura

```
POST /cash-balance/suprema/reopen
Body: { "date"?: "2026-08-15" }
Permissão: finance.cash-balance.register.create      →  204 No Content
```

**Passo a passo:**

1. Valida o corpo (`CashBalanceQueryDto`: só `date` — **a data vem no corpo, não na query**).
2. `requireBrand` → `400`/`403`.
3. `reopenBrand(referenceDate, brand)`: busca o `daily` por `(reference_date, brand)`. Se não existir
   ou estiver soft-deleted → **`404 Não há balanço registrado para esta marca na data`**.
4. **Em transação:** `daily` → `status = DRAFT`, `confirmed_at = null`, `confirmed_by = null`; e `day`
   → `status = OPEN`, `closed_at = null`, `closed_by = null`.

**Regras que não são óbvias:**

- **Reabrir uma marca reabre o dia inteiro.** Correto: o dia só é final com as 3 marcas confirmadas.
- **O snapshot NÃO é apagado.** `cash_balance_brand_snapshots` continua com os valores antigos, e os
  `bank_entries` continuam `confirmed = true`. O que muda é o `status` do `daily` — e como o histórico
  filtra `status = 'CONFIRMED'`, o dia **desaparece da tabela do histórico** imediatamente, mesmo com
  o snapshot ainda gravado. Ao registrar de novo, o snapshot é sobrescrito.
- **A permissão é a mesma do registro** (`register.create`), não uma permissão própria. Quem pode
  registrar pode reabrir. Se o destino quiser separar (reabrir é operação mais sensível: destrava um
  dia fechado), é um código de permissão novo a criar — decisão de produto.
- **Não há trava temporal.** Um dia de três meses atrás pode ser reaberto. Combinado com o débito do
  `acumuladoMensal` (§2.6, regra 7), reabrir um dia antigo e registrar de novo deixa o acumulado do
  mês inconsistente até alguém recalcular. É o cenário que mais merece um teste no destino.
- **Reabrir uma marca já em `DRAFT`** funciona e é praticamente no-op (zera campos já nulos e reabre o
  dia). Não há `409`.

**Erros:** `400`, `401`, `403`, `404`, `429`, `503`.

---

## 3 · Módulo Conciliação Bancária — 7 rotas

Contexto necessário para ler todas: a conciliação compara, por dia e marca, o que a **plataforma de
apostas** registrou (depósito e saque aprovados) com o que o **extrato do banco** mostra (crédito e
débito). O que sobra de um lado só é **pendência**, e pendência só sai da lista com uma **nota** de um
operador — nunca com um botão de esconder.

### 3.0 · O casamento — a regra que governa 4 rotas

Vale descrever uma vez, porque é a lógica que as rotas 8, 9, 10 e 12 apenas expõem.

#### Chave única, casamento 1:1

O casamento é por **`gateway_external_id`** (lado plataforma, em `fct_deposit`/`fct_withdrawal`)
contra **`external_id`** (lado banco, extrato da Trio). É o mesmo número, gerado pelo PayBrokers
(`payment_system_id = 3295`) ao criar a cobrança ou o pagamento.

**Não existe mais casamento por valor.** Removido em 13/08/2026, e a razão é um evento real: o
casamento por valor funcionava por multiconjunto, então sabia que *um* lançamento sobrou, mas não
*qual*. Em 12/08/2026 isso colocou **37 saques legítimos** na lista de pendências, com nome e CPF de
jogadores que nada tinham com o caso, porque pagamentos de outro canal com o mesmo valor ocuparam o
lugar deles. Um mesmo jogador tinha dois saques de R$ 10.000,00 com **2,181 s** de diferença: nem
valor nem instante separam esse par — a chave separa.

**Lançamento sem chave vira pendência, direto**, com `warn` no log e contagem em `withoutKey`.
Inventar casamento aproximado para ele é exatamente o defeito que acabou de sair. Chave **repetida**
do mesmo lado (`duplicateKeys`) também gera `warn` — costuma ser cobrança paga duas vezes.

Validação da chave: dia 12/08/2026 da Suprema, preenchimento de 100%, **3.708 chaves distintas para
3.708 lançamentos e 3.707 pares 1:1**.

#### Janelas assimétricas e a virada do dia

| Lado | Janela | Por quê |
|---|---|---|
| Banco | **só o dia de referência** `[00:00, 24:00)` BRT | varrer o extrato é caríssimo (~2 min por marca) |
| Plataforma | **`D−1` a `D+1`** (`PLATFORM_NEIGHBOUR_DAYS = 1`) | consulta barata; é ela que cobre a meia-noite |

Quando o banco postou hoje e a plataforma registrou no dia vizinho, a chave casa igual e o par entra
em `depositsCrossover`/`withdrawalsCrossover`, cujo `total` é **o quanto isso desloca** a diferença
`banco − plataforma`. Par com os **dois** lados fora do dia é ignorado (pertence ao dia vizinho, e
será contado quando aquele dia for conciliado).

**Invariante:** `diferença (banco − plataforma) = virada + pendências`.

#### Qual instante define "o dia"

- **Depósito:** `deposit_ts` (aprovação do pagamento).
- **Saque:** `transaction_date` — o `allow_ts` da **liberação**, não o pedido. Usar `withdrawal_ts`
  (o `request_ts`) abre diferença de caixa sem pendência para explicar: caso real de R$ 5.755,00 na
  ULTRA, com saques pedidos às 23:53 de um dia e liberados às 00:05 do seguinte.

#### Classificação do lado do banco

| Condição | Fluxo |
|---|---|
| Contraparte no CNPJ próprio (`OWN_TAX_NUMBERS`) | **`TREASURY`** — retirada de excedente, **nunca é pendência** (não tem contrapartida na plataforma, por definição) |
| `ref_type` termina em `_refund` | herda o fluxo da operação original: `payment_refund` → `WITHDRAWAL`, `collection_refund` → `DEPOSIT` |
| `amount < 0` (convenção da Trio: negativo é dinheiro entrando) | `DEPOSIT` |
| `amount > 0` | `WITHDRAWAL` |
| `transaction_type = 'fee'` | sai do casamento, entra só em `feesTotal` |

#### Estorno liquida, não abre pendência

Roda **antes** do casamento (`settleRefunds`). Quando o banco devolve um pagamento, o extrato ganha um
**crédito** com o mesmo `external_id` do débito original e `ref_type = payment_refund`. Classificado só
pelo sinal, esse crédito procuraria um *depósito* com a chave de um *saque* e abriria pendência falsa
(aconteceu em 15/08/2026 na Maxima, chave 778446251, saque de R$ 1.000,00 pago às 06:55 UTC e
devolvido às 07:10).

A liquidação remove **as três linhas** da chave estornada — o estorno, o débito original do banco e o
saque da plataforma — **juntas ou nenhuma**:

- tirar só o estorno deixaria o débito casado com um saque que não aconteceu;
- tirar só as duas do banco deixaria o saque da plataforma órfão, virando pendência nova.

Consequência deliberada nos totais: `bankWithdrawals` e `platformWithdrawals` passam a significar *o
que de fato saiu para jogadores*, não o bruto do extrato.

O item de estorno é gravado **`RESOLVED` com `resolved_by = 'sistema'`** e nota automática (estorno
que desaparece sem rastro seria pior que pendência falsa). Se a operação **continuar `APPROVED`** na
plataforma, ganha `platformReprocessPending = true` — o jogador teve saldo movimentado por um pagamento
que o banco desfez. **Não é pendência de caixa**: é cobrança para o time de pagamentos, e o dia fecha
mesmo assim. O valor é recalculado a cada execução, então desaparece sozinho quando pagamentos
reprocessar.

**Estorno sem chave não liquida nada** — sem `external_id` não há como saber qual operação foi
desfeita, e adivinhar é o defeito que acabou de sair. Segue para o casamento como qualquer lançamento
sem chave.

---

### 3.1 · `GET /reconciliation` — o resultado do dia

```
GET /reconciliation?date=2026-08-15
Permissão: finance.reconciliation.read      →  200
```

**O que faz:** devolve o resultado **já calculado** (pelo cron ou por reexecução) do dia, por marca,
com as pendências. **Nunca dispara varredura** — a tela precisa abrir instantânea. Lê **só o Postgres**
do módulo: nada de ClickHouse, nada de Trio.

**Passo a passo:**

1. Resolve data e marcas acessíveis.
2. Três leituras em paralelo: execuções do dia, itens (teto de 500 por marca) e contagens agregadas.
3. Monta uma view por marca, na ordem do catálogo, filtrada pelas acessíveis.

**Status por marca — e `NOT_RUN` não é valor de banco:**

| `status` | Significado | `message` |
|---|---|---|
| `NOT_RUN` | **não existe linha** de execução para o dia+marca | "Conciliação deste dia ainda não foi executada" |
| `RUNNING` | execução em andamento | "Conciliação em andamento — o resultado aparece ao terminar" |
| `FAILED` | falhou | a mensagem do erro (nunca contém credencial) |
| `DONE` | concluída | ausente |

**Campos derivados:**

```
depositsDifference    = bankDeposits.total    − platformDeposits.total
withdrawalsDifference = bankWithdrawals.total − platformWithdrawals.total
reconciled            = status === 'DONE' && openCount === 0
allReconciled         = brands.length > 0 && todas reconciled
```

**Regras que não são óbvias:**

- **Estorno pendente de reprocessamento não impede `reconciled`.** O caixa do dia fecha; o que falta é
  trabalho na plataforma. `reprocessPendingCount` é exposto separadamente.
- **Pendência tratada (`RESOLVED`) não bloqueia** — sai de `openCount`, fica em `resolvedCount`.
- **`allReconciled` é `false` para usuário sem marca nenhuma** (`brands.length > 0` na condição). Não
  se declara "tudo conciliado" com base em zero informação.
- **As contagens vêm do banco, não da lista devolvida.** A lista tem teto de 500 por marca; contar em
  memória mentiria num dia ruim. `itemsTruncated = count.total > items.length` avisa a tela.
- **`running` vem de um `Set` em memória do processo** (`RunReconciliationUseCase.inFlight`). Com mais
  de uma réplica, a réplica que responde o GET **não vê** a varredura que a outra está fazendo →
  `running: false` durante uma execução real. O `status = 'RUNNING'` no banco continua correto; o flag
  `running` é o que fica impreciso. Vale conhecer antes de a tela depender dele (ver
  `INFRA-FINANCE.md` §6).
- **Ordenação dos itens:** `OPEN` antes de `RESOLVED`, `still_pending` primeiro, maior valor primeiro,
  mais antigo primeiro — o que precisa de ação no topo.
- **CPF/CNPJ sai formatado e completo** (`formatTaxNumber`): `123.456.789-01`. Ver §3.7.
- **Nota de eficiência:** `findItems` traz **todas** as linhas do dia para as marcas pedidas e trunca
  em memória. Num dia com milhares de pendências isso carrega tudo para devolver 500. Candidato a
  `LIMIT` por marca na tradução.

---

### 3.2 · `GET /reconciliation/history` — fechamento de período

```
GET /reconciliation/history?from=2026-08-01&to=2026-08-15
Permissão: finance.reconciliation.read      →  200
```

**O que faz:** um dia por linha, com a situação de cada marca, para decidir se o período pode fechar.

**A regra que diferencia esta rota do histórico de balanços: TODO dia do intervalo aparece**, mesmo
sem execução.

O raciocínio está no código, e é bom: no balanço, dia sem registro é o normal de um dia que ninguém
fechou ainda. Aqui é o contrário — **o dia que não foi conciliado é exatamente o que impede o mês de
fechar**. Se a tabela mostrasse só dias com execução, o buraco ficaria invisível e o mês pareceria
fechado.

**Severidade — o dia herda o pior status entre suas marcas:**

```
NOT_RUN (4)  >  FAILED (3)  >  RUNNING (2)  >  PENDING (1)  >  RECONCILED (0)
```

`NOT_RUN` é pior que `PENDING` porque `PENDING` é pendência **conhecida** e `NOT_RUN` é pendência
**desconhecida**. Um dia com duas marcas conciliadas e uma sem execução não está fechado — está sem
execução.

**Status por marca:**

| Condição | Status |
|---|---|
| não existe run | `NOT_RUN` |
| `run.status = FAILED` | `FAILED` |
| `run.status = RUNNING` | `RUNNING` |
| `openCount > 0` | `PENDING` |
| senão | `RECONCILED` |

**Totais do período:**

| Campo | Composição |
|---|---|
| `reconciledDays` | dias `RECONCILED` |
| `pendingDays` | dias `PENDING` |
| `missingDays` | dias `NOT_RUN` **+** `FAILED` — **`RUNNING` não entra** (é estado transitório, não buraco) |
| `openCount` / `openAmount` | soma das pendências abertas (contagem e valor) |
| `resolvedCount` | pendências tratadas |

**Outras regras:**

- Reaproveita `resolveRange` do balanço: mesmos defaults, mesmo teto de 180 dias, mesmas mensagens.
- Itera do `to` para o `from` (mais recente primeiro), preenchendo dia a dia.
- Marcas na ordem do catálogo, não na ordem do parâmetro.
- **Nunca carrega itens** — agrega no banco (`groupBy` por `reference_date, brand, status,
  still_pending`). Um mês ruim tem milhares de pendências e esta tela exibe zero.
- `allReconciled` exige `days.length > 0` e todos `RECONCILED`.

---

### 3.3 · `POST /reconciliation/run` — dispara a conciliação

```
POST /reconciliation/run
Body: { "date"?: "2026-08-15" }
Permissão: finance.reconciliation.run      →  202 Accepted + { referenceDate }
```

**Por que 202 e não 200:** a varredura do extrato leva perto de **2 minutos por marca**, porque o
cursor da Trio perde linhas e a única varredura confiável é por bisseção. Deixar o request aberto só
garantiria timeout no proxy. A tela acompanha pelo `status` do GET.

**Passo a passo (síncrono, o que o request faz):**

1. Resolve data e marcas acessíveis.
2. Dispara `runReconciliation.execute()` **sem `await`** (`void ... .catch(log)`).
3. Responde `202 { referenceDate }`.

**Passo a passo (assíncrono, por marca, em paralelo):**

1. **Guarda de reentrância:** se `${date}:${brand}` já está em `inFlight`, devolve outcome com
   `error: 'Conciliação desta marca já está em andamento'` e não faz nada. É um `Set` **em memória do
   processo** — não é lock distribuído: com duas réplicas, as duas calculam o mesmo resultado e a
   última gravação vale.
2. Se a Trio não está configurada ou a marca não tem `TRIO_ACCOUNT_ID_*` → outcome com
   `error: 'Integração com o banco não configurada para esta marca'`, **sem** criar run.
3. `startRun` (upsert por `(date, brand, bank)`) → `status = RUNNING`, `started_at = now`,
   `finished_at = null`, `error = null`, **preservando o `id`**.
4. Resolve a janela: núcleo `[meia-noite BRT, meia-noite BRT do dia seguinte)`; plataforma de `D−1` a
   `D+1`.
5. Busca os lançamentos da plataforma (ClickHouse, 2 queries paralelas com `FINAL` e
   `state_normalized = 'APPROVED'`).
6. Busca os lançamentos do banco (Trio, varredura por bisseção do dia).
7. **`settleRefunds`** — liquidação de estorno, antes do casamento.
8. `matchFlow('DEPOSIT', ...)` e `matchFlow('WITHDRAWAL', ...)`.
9. Monta os 8 pares de totais (`platformDeposits`, `bankDeposits`, `platformWithdrawals`,
   `bankWithdrawals`, `treasury`, `fees`, `depositsCrossover`, `withdrawalsCrossover`) — só
   lançamentos do dia (`core`) entram nas somas.
10. **`saveResult` em transação:** apaga pendência `OPEN` que sumiu, marca `still_pending = false` na
    que sumiu **com** nota, faz upsert das pendências atuais **sem tocar** em nota/status/autor, faz
    upsert dos estornos liquidados (respeitando nota humana já existente), recalcula `pending_count` e
    fecha o run com `status = DONE`.
11. Em caso de exceção: `failRun(runId, message)` → `status = FAILED` com a mensagem, e **as outras
    marcas seguem**.

**Regras que não são óbvias:**

- **O job das 04:00 concilia as 3 marcas do catálogo; a rota concilia só as marcas do usuário.** Não
  há usuário no cron; na rota, o recorte de acesso vale.
- **Uma marca que falha não derruba as outras** (`Promise.all` de `runBrand`, cada um com try/catch
  interno).
- **`202` é devolvido mesmo quando a marca não tem conta configurada** — o erro aparece depois, no
  `status`/`message` do GET. A rota nunca falha por causa de configuração de integração.
- **Reexecutar é idempotente no resultado e preserva trabalho humano** — é o que o upsert por chave
  natural garante (`DADOS-FINANCE.md` §4.2).
- **`matchKey` gravado é sempre `EXTERNAL_KEY`** (fixo no código). O valor `AMOUNT` do enum é herança
  de um algoritmo que não existe mais.
- **`bank` é sempre `'trio'`** — o único banco conciliado por integração. Os outros virão por CSV.
- **Nenhum retorno de progresso.** Não há percentual nem ETA: a tela sabe `RUNNING` ou não. O
  callback `onBrand` existe no use-case e é usado pelo CLI, não pela rota.

---

### 3.4 · `GET /reconciliation/:brand/corrections` — busca de evidência

```
GET /reconciliation/suprema/corrections?date=2026-08-15
Permissão: finance.reconciliation.read      →  200
```

**O cenário de negócio, que é o que explica a rota toda:** jogador autoexcluído ou bloqueado **não
consegue sacar** pela plataforma. O setor financeiro paga na mão, pela conta da Trio. Antes de pagar, o
backoffice tira o saldo dele com uma **correção para baixo**. Resultado: o pagamento aparece no
extrato e **não tem saque para casar** — vira pendência do lado `BANK`. A correção de saldo é a prova
de que o dinheiro era do jogador.

**Só leitura. Não dá baixa em nada.** A baixa continua sendo do operador, com nota — porque a correção
**não carrega nenhuma referência** ao pagamento que ela provocou, e ligar os dois é inferência
(jogador, valor, proximidade no tempo).

**Passo a passo:**

1. `requireBrand` → `400`/`403`. **Uma marca por chamada**, não todas as acessíveis: a busca custa 2–3
   queries ao warehouse, uma delas varrendo o histórico de saques. É um botão que o operador aperta,
   não parte da leitura da tela.
2. ClickHouse não configurado → **`503 Integração com o data warehouse não configurada`** (aqui **não**
   degrada, ao contrário das rotas de balanço).
3. Janela: `D−7` a `D` (`CORRECTION_LOOKBACK_DAYS = 7`).
4. Seleciona as pendências candidatas — os 5 filtros **são o recorte do problema**:
   `side = BANK` **e** `flow = WITHDRAWAL` **e** `status = OPEN` **e** `still_pending = true` **e**
   `counterparty_tax_number IS NOT NULL`. Ordena por valor desc.
5. Se nenhuma, devolve view vazia com contagens em zero.
6. Busca as correções por CPF, de **duas fontes unidas por `correctionId`** (§3.4.1).
7. Para cada pendência, `findCorrectionCandidates` produz os candidatos ordenados por confiança.
8. Loga contagens (**nunca o CPF**).

#### 3.4.1 · Duas fontes de correção — e por que as duas existem

| Fonte | Como | Cobertura |
|---|---|---|
| **`fct_correction.cpf`** (caminho definitivo) | CPF na própria linha da correção, sem junção | **0,8%** das linhas em 14/08/2026 (506 de 64.516) — o gatilho lê `dim_player_profile.cpf`, que cobre 96 mil de 4,2 milhões de jogadores |
| **Ponte por `pix_key`** (paliativo) | CPF → `client_id` via `fct_withdrawal` com `pix_key_type = 'CPF'`, sem filtro de data → correções daquele `client_id` | **37%** das pendências (120 de 231 CPFs em 12/08/2026) |

As duas convivem porque nenhuma basta. A união é por `correctionId`, então a mesma correção alcançada
pelos dois caminhos entra **uma vez só** e nunca infla soma. **O custo da ponte:** ela só alcança quem
**já sacou** pela plataforma — e o jogador autoexcluído que nunca sacou é justamente o público desta
pendência. Quando a coluna `cpf` for repopulada (pedido em aberto com o time de dados), a ponte
desaparece e a cobertura vai a 100% **sem mudança de código**.

A ponte é confiável onde alcança: nenhum caso de dois `client_id` para o mesmo CPF na mesma marca, e o
`pix_key` de tipo CPF confere com o `counterparty_tax_number` da Trio em **488 de 488** saques
conferidos.

#### 3.4.2 · Os 4 níveis de confiança

| Confiança | Regra | `exact`? | Dá baixa automática (rota 12)? |
|---|---|---|---|
| `EXACT_SAME_BRAND` | correção com valor **idêntico**, na **mesma marca** do pagamento | sim | sim |
| `EXACT_OTHER_BRAND` | valor idêntico, **outra marca** do grupo | sim | sim |
| `SUM` | **2 a 3** correções somando exatamente o valor | sim | sim |
| `PARTIAL` | mesmo jogador, **valor diferente** | **não** | **nunca** |

Ordem de saída: `EXACT_SAME_BRAND` → `EXACT_OTHER_BRAND` → `SUM` → `PARTIAL`, cortada em
`MAX_CORRECTION_CANDIDATES = 5`. **A ordem importa**: o primeiro candidato é o que a tela destaca e o
único que a rota 12 considera.

Detalhes das regras:

- **`SUM` existe por causa da licença de 3 marcas:** o mesmo CPF pode ter saldo corrigido em até três e
  receber um pagamento só pela soma. Em 12/08/2026 **não** foi o que aconteceu (os 104 CPFs com saldo
  em mais de uma marca receberam um pagamento por marca), mas o caso é possível e a cobertura de
  identidade (37%) não permite afirmar que nunca ocorre. Também cobre o mesmo jogador com duas
  correções na mesma marca (visto: R$ 0,32 + R$ 0,27 = R$ 0,59).
- **`SUM` tem corte de custo:** se o CPF tiver mais de `MAX_CORRECTIONS_FOR_COMBINATION = 12`
  correções na janela, **não tenta somar** — combinação é exponencial, e CPF com mais de uma dúzia de
  correções é caso para investigar à mão. A busca também poda quando a soma parcial passa do alvo (só
  valores positivos).
- **`PARTIAL` é fio para investigar, não explicação.** Aconteceu 38 vezes em 12/08/2026, quase sempre
  com a correção **menor** que o pagamento (pendência de R$ 25,00 com correção de R$ 15,09). Ordenado
  pela menor diferença absoluta.
- **Pendência sem jogador identificado sai sem candidato**, e a resposta distingue dois casos que
  parecem iguais: `clientResolved: false` (CPF sem conta conhecida — a ponte não alcançou) e
  `clientResolved: true` com `candidates: []` (conta conhecida, sem correção na janela). São
  diagnósticos diferentes para quem lê a tela.
- **A janela de 7 dias foi medida, não escolhida:** contra as 375 pendências de saque de 12/08/2026,
  82 pares com defasagem de 6 dias, 11 com 2 dias, **nenhum par fora dos 7 dias** e nenhum depois do
  pagamento — a correção sempre vem antes. As correções saem em batelada, poucos dias por mês, o que
  explica a defasagem irregular.
- **Por que a identidade do jogador é obrigatória:** sem `client_id`, sobraria casar por valor — e
  valor sozinho erra. Das 375 pendências, **127 achariam par no próprio dia do pagamento**, e nenhum
  dos 93 pares confirmados por jogador tem defasagem zero. Ou seja, esses 127 casariam com correções
  de centavos do dia, sem relação alguma com o pagamento.

**Resposta:** `{referenceDate, brand, from, to, searchedCount, withEvidenceCount, withoutClientCount,
items[]}`, cada item com `{itemId, clientResolved, candidates[]}` e cada candidato com `{confidence,
amount, difference, exact, note, corrections[]}`.

**A `note` do candidato vem do domínio, não do frontend** — e isso é decisão de projeto: ela tem
**dois consumidores** (a tela usa como rascunho editável no modal; a rota 12 grava exatamente este
texto). Duplicar geraria duas versões da mesma justificativa contábil, uma delas errada com o tempo.
A nota de `PARTIAL` começa com "Conferir:" e diz explicitamente que o valor **não** confere.

---

### 3.5 · `POST /reconciliation/:brand/corrections/apply` — baixa automática do exato

```
POST /reconciliation/suprema/corrections/apply
Body: { "date"?: "2026-08-15" }
Permissão: finance.reconciliation.resolve      →  201 + resumo
```

**Por que existe** (decisão de 14/08/2026, olhando o Histórico de Conciliação): enquanto a busca só
mostrava evidência, **96 itens já explicados continuavam somando** no total do dia, e a tela não
distinguia o que estava resolvido do que era divergência real. Com a baixa, sobra na lista **só o que
ainda tem diferença**.

**Passo a passo:**

1. `requireBrand` → `400`/`403`. Exige `resolve` (a busca exige só `read`) — porque escreve.
2. **Reusa a busca inteira** da rota 11 (`this.search.execute(params)`) — nunca repete a consulta ao
   warehouse com outro critério. *O que a tela mostrou e o que recebe baixa têm de ser a mesma coisa.*
3. Filtra as pendências cujo **primeiro** candidato tem `exact === true`.
4. `resolveItems({ids, noteById, userId})` em transação: filtra `status = OPEN AND still_pending`,
   grava `status = RESOLVED`, a nota do candidato, `resolved_at` e `resolved_by = userId`; depois
   recalcula `pending_count` **uma vez por dia+marca+banco**, não por item.
5. Responde com `{referenceDate, brand, searchedCount, resolvedCount, partialCount,
   withoutCandidateCount}`.

**Regras que não são óbvias:**

- **Só o candidato de maior confiança conta.** Se o primeiro não é exato, a pendência fica aberta
  **mesmo que exista um exato mais abaixo na lista** — a ordem é a da força da evidência, e furar essa
  ordem seria escolher a evidência que dá o resultado desejado.
- **`PARTIAL` nunca entra.** Valor diferente não explica o pagamento; dar baixa nele seria esconder
  divergência.
- **`SUM` entra** — soma de correções entre marcas também fecha no centavo.
- **Idempotente por construção:** o filtro `status = 'OPEN'` no `resolveItems` garante que pendência
  **já tratada à mão não tem a nota sobrescrita** por texto automático. Chamar duas vezes resolve zero
  na segunda.
- **`resolvedCount` é quantas de fato mudaram de estado**, não quantas foram tentadas — e é esse número
  que a tela mostra.
- **Baixa automática também tem autor:** `resolved_by` é o `userId` de quem apertou o botão, não
  `'sistema'` (`'sistema'` é reservado para a liquidação de estorno, onde nenhum humano olhou a linha).
- **`503` se o ClickHouse estiver fora** — herdado da busca.

---

### 3.6 · `POST /reconciliation/items/:id/resolve` — a nota do operador

```
POST /reconciliation/items/8f2c.../resolve
Body: { "note": "PIX devolvido ao jogador pelo banco; depósito nunca foi creditado na plataforma." }
Permissão: finance.reconciliation.resolve      →  204 No Content
```

**A regra central:** *"A nota é o registro contábil do porquê daquele lançamento não ter par — é ela
que permite fechar o dia sem apagar a divergência."* Sem nota obrigatória, a baixa viraria só um botão
de esconder pendência.

**Passo a passo:**

1. `ParseUUIDPipe` no `:id` → `400` se não for UUID.
2. DTO: `note` **obrigatória**, `@Length(10, 1000)` → `400`.
3. Resolve as marcas acessíveis.
4. Revalida a nota **depois de `trim()`** no use-case (10–1000) → `400`. Validação dupla de propósito:
   o DTO valida o que chegou, o use-case valida o que será gravado — `"          "` passa no DTO e é
   recusado aqui.
5. Busca o item por `id` → **`404 Pendência não encontrada`**.
6. **Autorização pelo dado:** se `item.brand` não está nas marcas acessíveis → **`403 Usuário sem
   acesso a esta marca`**. É o único par de rotas (13 e 14) onde a autorização vem do registro, não da
   URL.
7. Se `status = RESOLVED` → **`409 Pendência já tratada — reabra antes de registrar outra nota`**.
   Empilhar tratamento sobre tratamento é proibido.
8. Em transação: grava `status = RESOLVED`, `note`, `resolved_at`, `resolved_by = userId`; recalcula
   `pending_count` do run.
9. Loga **só** id, marca e autor — **nunca** a nota nem a contraparte.

**Regras que não são óbvias:**

- **Nota de operador nunca é sobrescrita por nota automática.** Vale nos dois caminhos automáticos: a
  liquidação de estorno verifica `status = RESOLVED AND resolved_by != 'sistema'` e preserva; a baixa
  em lote filtra `status = OPEN`.
- **`409`, não `200` idempotente.** Tratar de novo exige reabrir — força o operador a reconhecer que
  está substituindo um registro contábil.
- **Não há validação de `still_pending`.** Um item `OPEN` com `still_pending = false` seria tratável —
  estado que o fluxo normal não produz (item `OPEN` que sumiu é deletado).
- A nota é texto livre: nada além do tamanho é validado. Não há template nem categorização de motivo —
  decisão de produto que o destino pode querer revisitar (categorizar permitiria estatística de
  causa), mas mudaria o contrato.

---

### 3.7 · `POST /reconciliation/items/:id/reopen` — devolve à fila

```
POST /reconciliation/items/8f2c.../reopen
(sem corpo)
Permissão: finance.reconciliation.resolve      →  204 No Content
```

**Por que existe:** *"nota errada acontece, e a alternativa seria empilhar tratamento sobre
tratamento"*.

**Passo a passo:**

1. `ParseUUIDPipe` → `400`.
2. Busca o item → `404`.
3. Autorização por `item.brand` → `403`.
4. Em transação: `status = OPEN`, **`note = null`**, `resolved_at = null`, `resolved_by = null`;
   recalcula `pending_count`.
5. Loga id, marca e autor.

**Regras que não são óbvias:**

- **A nota anterior é APAGADA, não versionada.** Justificativa registrada: *"quem quiser o rastro tem o
  log de auditoria, e manter duas versões da mesma justificativa na tela confunde o fechamento"*. Mas
  atenção: o `AuditInterceptor` grava `after` = corpo da resposta, e esta rota responde **204 sem
  corpo** — logo **a nota apagada não fica em lugar nenhum**. Se rastreabilidade de nota importar no
  destino, isso é uma lacuna real a fechar (tabela de histórico de nota, ou `before` na auditoria), não
  uma tradução a fazer.
- **Não há `409`:** reabrir item já `OPEN` funciona e é praticamente no-op.
- Reabrir **não** reexecuta a conciliação — só devolve a pendência para a fila.
- Reabrir um item de **estorno** (que nasce `RESOLVED` pelo sistema) o coloca em `OPEN` e ele passa a
  contar como pendência aberta, bloqueando `reconciled`. Na próxima execução, o upsert de estorno o
  trata de novo (`keepHumanNote` é falso porque `resolved_by` foi zerado) e ele volta a `RESOLVED`. O
  ciclo é consistente, mas vale saber que existe.

---

### 3.8 · Dado pessoal na resposta — regra explícita

`counterparty_name` e `counterparty_tax_number` saem nas rotas 8 e (indiretamente) 11.

**O CPF/CNPJ sai COMPLETO e pontuado** (`formatTaxNumber`: `123.456.789-01`, `12.345.678/0001-90`).
Decisão de produto de 10/08/2026, tomada com ciência de que expõe dado pessoal na tela. A razão está
no código:

> O desenho original mascarava. Só que a pendência que mais custa tratar é o depósito que está no banco
> e **não está na plataforma**: aí não existe registro do lado da plataforma, logo não existe
> `client_id` para exibir, e a única identidade disponível é o documento da contraparte. Com ele
> mascarado, o operador não tem como achar o jogador no backoffice.

O caminho correto (resolver documento → `client_id` no warehouse e exibir o id do jogador) está
bloqueado: a view existe (`pii_compliance.vw_player_pii`) e a credencial do módulo está sem permissão
(`ACCESS_DENIED`); em `dw_bet` não há documento em nenhuma tabela.

Mitigações que continuam valendo e precisam sobreviver: rota autenticada, com permissão, filtrada por
marca via `/auth/me`; e **o documento nunca vai para log**.

> **Isso resolve a divergência marcada como "a confirmar" no `MIGRACAO-FINANCE.md` §3.2** entre o
> `HANDOFF.md` (mascarado) e o `ARQUITETURA.md` (completo): **o código faz completo**, e a
> justificativa está documentada com data e autor. O que resta confirmar é se a decisão de produto
> segue valendo no destino — não qual é o comportamento atual.

---

## 4 · `GET /health`

```
GET /api/health          →  200 { status: 'ok', module: 'finance' }
```

`@Public()` — sem autenticação. **Estático:** não verifica banco, warehouse nem Trio. No destino vira
`/health/liveness` + `/health/readiness` (Terminus, fora do prefixo). Recomendação sobre **o que o
readiness deve e não deve verificar** — e por que ClickHouse não deve entrar — em `INFRA-FINANCE.md`
§8.

---

## 5 · Jobs e CLIs — as regras que não passam por rota

Os 3 crons e os 5 CLIs batem nos **mesmos use-cases** que a API usa. Suas regras próprias:

| Tipo | Nome | Quando | Regras específicas |
|---|---|---|---|
| `@Cron` | `trio-closing-capture` | `00:00:30` BRT | Captura o fechamento das **3 marcas do catálogo**. **Nunca sobrescreve** (`overwrite = false`): a `UNIQUE(reference_date, brand)` serializa réplicas e a primeira gravação vence. Marca que falha não impede as outras. Desligável por `TRIO_CLOSING_CAPTURE_ENABLED=false` |
| `@Cron` | `trio-closing-catchup` | `00:30` BRT | Confere quais marcas faltam e recaptura. **Não é rede de segurança contra perder o instante** — é retentativa: como a leitura é do instante do corte (`at_datetime`), a segunda tentativa vale tanto quanto a primeira, e rodar três dias depois dá o mesmo número |
| `@Cron` | `daily-reconciliation` | `04:00` BRT | Concilia o dia anterior nas **3 marcas do catálogo** (não há usuário; o controle de acesso continua no request). 04:00 é depois da captura e com folga para o warehouse ingerir o dia, e antes de o operador chegar. Desligável por `RECONCILIATION_SCHEDULE_ENABLED=false` |
| CLI | `trio:capture -- <data> [--overwrite]` | manual | `--overwrite` é o **único** caminho que sobrescreve fechamento gravado — é como se recaptura uma linha `SNAPSHOT`/`RECONSTRUCTED` errada |
| CLI | `reconcile -- <data>` | manual | mesmo caminho do cron das 04:00, sob demanda, sem passar por HTTP nem por permissão |
| CLI | `trio:statement -- --from= --to=` | manual | extrato diário por marca em CSV |
| CLI | `trio:transactions -- --from= --to=` | manual | extrato analítico linha a linha — **contém dado pessoal** |
| CLI | `balance:import -- <csv>` | manual | única escrita que grava `deposits_total`/`withdrawals_total` como **zero** de propósito (não são fonte primária), recebe os agregados prontos da planilha, e é o **único** caminho que chama `recomputeMonthlyAccumulated` (recalcula o acumulado do mês inteiro, obrigatório após inserir dia no meio do mês) e `closeCompleteDays` (fecha os dias do intervalo que já têm as 3 marcas) |

**Regras de segurança do caminho job:** nenhum CLI passa por `JwtAuthGuard` nem por
`PermissionsGuard` — são scripts Node com acesso direto ao banco e às integrações. Quem tem acesso ao
pod/host tem acesso total ao módulo. É a razão pela qual a opção 2 do `MIGRACAO-FINANCE.md` §4.3
(aplicar `runInTenantContext` por marca no caminho job) adiciona defesa onde hoje não há nenhuma.

**Nota sobre `trio_closing_balances` como acoplamento entre job e rota:** a rota 6 (`register`)
depende de o cron ter rodado. Se a captura falhar 3 dias seguidos e ninguém rodar o CLI, o operador
não consegue registrar 3 dias de balanço e a mensagem que ele vê é um `503`. O alerta sobre falha do
cron (`INFRA-FINANCE.md` §13) é o que transforma isso em problema detectado em vez de descoberto.

---

## 6 · Catálogo consolidado de erros

| Status | Quando | Rotas |
|---|---|---|
| `400` | formato de data inválido | todas com `date`/`from`/`to` |
| `400` | `from > to` ou intervalo > 180 dias | 3, 9 |
| `400` | campo não declarado no DTO (`forbidNonWhitelisted`) | todas com corpo |
| `400` | `:id` não é um inteiro válido (`ParseIntPipe` — decisão 13 do `CLAUDE.md`, `ReconciliationItem.id` é `SERIAL`, nunca UUID) | 13, 14 |
| `400` | `note` fora de 10–1000 caracteres (antes e depois do `trim`) | 13 |
| `400` | `balance` ausente, não numérico ou com mais de 2 decimais | 5 |
| `400 Marca não reconhecida` | `:brand` fora do catálogo | 5, 6, 7, 11, 12 |
| `400 Banco não reconhecido` | `:bank` fora do catálogo | 5 |
| `400 Saldo da Trio é somente leitura` | `:bank = trio` | 5 |
| `400` + **`pendingBanks`** | registro com banco manual não confirmado | 6 |
| `401` | sem Bearer / token inválido / chave pública ausente | todas exceto 15 |
| `403 Usuário sem acesso a esta marca` | sem vínculo com a marca | 5, 6, 7, 11, 12, 13, 14 |
| `403` | permissão ausente no claim do JWT | todas exceto 15 |
| `404 Não há balanço registrado para esta marca na data` | reabrir marca sem registro | 7 |
| `404 Pendência não encontrada` | item inexistente | 13, 14 |
| `409 Pendência já tratada` | resolver item já `RESOLVED` | 13 |
| ~~`429`~~ | ~~rate limit (100 req/min por default)~~ — **não existe em nenhuma camada**, ver §8 | — |
| `503 Não foi possível validar as marcas do usuário` | `/auth/me` fora | **todas as 14** |
| `503 Saldo de fechamento da Trio não capturado...` | sem captura do dia | 6 |
| `503 Saldo de jogadores indisponível/não encontrado` | ClickHouse fora ou sem linha da marca | 6 |
| `503 Integração com o data warehouse não configurada` / `Data warehouse indisponível` | ClickHouse fora | 11, 12 |
| `500` | erro não tratado — corpo genérico, **nunca** stack trace | todas |

**Assimetria proposital que vale destacar:** falha do ClickHouse é `503` nas rotas de **escrita** (6,
12) e degradação silenciosa (`available: false`, `null`) nas de **leitura** (1, 2, 3). A escrita é
rigorosa porque grava número em tabela que não se corrige com `UPDATE`; a leitura é tolerante porque
tela travada é pior que tela incompleta.

---

## 7 · Invariantes de negócio — a lista para virar teste

Ordenadas por custo de violação. As três primeiras correspondem a incidentes reais já ocorridos e
corrigidos na origem.

| # | Invariante | Rota / caminho | História |
|---|---|---|---|
| 1 | `totalBalanco = saldoTransacional − saldoJogadores` | 2, 3, 6 | sinal invertido em 4 pontos até 30/07/2026 |
| 2 | Casamento é 1:1 por chave do gateway; **nenhuma** degradação para valor | 10 | 37 jogadores inocentes marcados como pendência em 12/08/2026 |
| 3 | Fechamento da Trio vem de leitura point-in-time; **nunca** reconstruído | 4, 6, cron | 8 de 18 fechamentos errados por reconstrução |
| 4 | As 3 linhas de um estorno saem juntas, ou nenhuma sai | 10 | pendência falsa de R$ 1.000,00 em 15/08/2026 |
| 5 | Registro exige **todos** os bancos manuais confirmados | 6 | — |
| 6 | Registro **ignora/recusa** saldo no corpo | 6 | imposto por `forbidNonWhitelisted` |
| 7 | Dia só é `CLOSED` com as 3 marcas `CONFIRMED` | 6 | — |
| 8 | Reabrir marca reabre o dia | 7 | — |
| 9 | Nota de operador nunca é sobrescrita por nota automática | 10, 12 | — |
| 10 | Nota sobrevive a reexecução da conciliação | 10 | garantido pela chave natural, não pelo `run_id` |
| 11 | Nota é obrigatória e tem 10–1000 caracteres após `trim` | 13 | — |
| 12 | `PARTIAL` nunca gera baixa automática | 12 | — |
| 13 | Só o candidato de maior confiança é considerado na baixa | 12 | — |
| 14 | Baixa em lote é idempotente (filtro `status = OPEN`) | 12 | — |
| 15 | `TREASURY` nunca é pendência | 10 | contraparte no CNPJ próprio |
| 16 | Tarifa (`fee`) fica fora do casamento e só entra em `feesTotal` | 10 | — |
| 17 | `NOT_RUN` é pior que `PENDING` na severidade do dia | 9 | pendência desconhecida > conhecida |
| 18 | `missingDays` = `NOT_RUN` + `FAILED`; `RUNNING` não conta | 9 | estado transitório não é buraco |
| 19 | `pending_count` é recalculado em toda mutação de item, na mesma transação | 10, 12, 13, 14 | 4 caminhos |
| 20 | Estorno com reprocessamento pendente não bloqueia `reconciled` | 8 | o caixa fecha; falta trabalho na plataforma |
| 21 | Nenhuma rota HTTP chama a API da Trio de forma sincronizada | todas | tela em ~135 ms |
| 22 | KPI/saldo de jogadores indisponível não bloqueia leitura | 1, 2, 3 | degradação projetada |
| 23 | CPF/CNPJ sai completo na API e **nunca** em log | 8, 11 | decisão de 10/08/2026 |
| 24 | `withdrawal` usa `transaction_date` (liberação), não `withdrawal_ts` (pedido) | 10 | diferença real de R$ 5.755,00 na ULTRA |
| 25 | Marca nunca vem do body/query — sempre de `/auth/me` | todas | passar `:brand` na URL não concede acesso |

---

## 8 · Divergências entre documentação e código — situação

| Divergência | Situação | Onde |
|---|---|---|
| `trio/refresh` "chama a Trio na hora" | **falso** — lê o Postgres. Nenhuma rota HTTP chama a Trio | §0, corrige `MIGRACAO-FINANCE.md` §3.1 |
| CPF mascarado × completo | **resolvido pelo código**: completo e pontuado, com justificativa datada | §3.8, resolve `MIGRACAO-FINANCE.md` §3.2 |
| Casamento por valor × `gateway_external_id` | **resolvido pelo código**: só `gateway_external_id`, 1:1. `matchKey` é fixo em `EXTERNAL_KEY`; `AMOUNT` é enum morto | §3.0, resolve `MIGRACAO-FINANCE.md` §3.2 |
| `tenantId` em `CashBalanceDaily` "vestigial ou real?" | **real e populado**, mas só em 2 das 8 tabelas; foi **removido de propósito** das tabelas de conciliação em 31/07/2026 | `DADOS-FINANCE.md` §7.2, resolve `MIGRACAO-FINANCE.md` §4.3 |
| `TRIO_AMOUNT_DIVISOR` = 1 ou 100 | **✅ confirmado na Fase 06 (2026-09-01): 100 (centavos)** — decisão do usuário na PARADA HUMANA, alinhada com a documentação do cliente | `INFRA-FINANCE.md` §4.2 |
| `ThrottlerGuard`/`429` (100 req/min) descrito na cadeia de guardas | **falso** — descoberto na Fase 17 ao escrever o smoke test: `src/auth/auth.module.ts` só registra `JwtAuthGuard`+`PermissionsGuard` via `APP_GUARD`; não há `@nestjs/throttler` no `package.json`, nenhum `ThrottlerGuard` em `src/`, nenhuma anotação de rate-limit em `deploy/helm/`. **Nenhuma camada** (app ou ingress) impõe rate limit hoje. Decisão do usuário (3 opções, Fase 17): documentar a divergência, não implementar `ThrottlerGuard` nesta fase de fechamento — fica como débito conhecido, não bloqueante para o cutover desta trilha | §1.1, §6 |

Das quatro perguntas que o plano de migração listava como bloqueantes da Fase 0, três foram respondidas
pela leitura do código e a quarta — `TRIO_AMOUNT_DIVISOR`, que não era respondível por leitura de
código — foi confirmada por decisão humana na Fase 06. Nenhuma pendência bloqueante de negócio resta
desta lista. A divergência do `ThrottlerGuard`/`429` (acima) foi descoberta só na Fase 17 — não fazia
parte das quatro perguntas originais do plano.
