# Plano de testes orgânicos — módulo Finance (API ligada, Docker completo)

> Documento de **análise + checklist de execução**. Nenhum código de teste é escrito nesta entrega —
> é o passo anterior, para alinhar escopo antes de implementar. Regras de negócio citadas aqui vêm
> de [`REGRAS-NEGOCIO-ROTAS.md`](./REGRAS-NEGOCIO-ROTAS.md) (already lida ponta a ponta contra o
> código) — nenhuma regra nova foi inventada para preencher lacuna.

## 0 · O que é isto e por que existe, além do e2e que já temos

O repositório já tem uma suíte e2e (`test/*.e2e-spec.ts`, 4 arquivos, 151 testes) que sobe o
`AppModule` inteiro **dentro do processo do Jest**, contra um Postgres **efêmero** via
Testcontainers (nasce e morre a cada execução). É rápida, é isolada, e é o gate do CI — não muda.

Este plano é **outra coisa, complementar**: subir o **ambiente Docker completo e persistente**
(`docker compose --profile full`, a imagem real da API, o Postgres real do dia a dia) e bater nas
14 rotas de negócio **por HTTP, de fora**, exatamente como o front-end ou um script de smoke em
produção bateriam — e depois **entrar no container do banco com `docker exec` e ler a linha
gravada**, para provar que o dado que a API diz ter gravado é o dado que está mesmo na tabela.

A diferença que importa: no e2e atual, se o `TypeOrmModule` mapear uma coluna errada, ou se a
migration não rodar, ou se o `.env.docker` não tiver uma variável nova, **ninguém percebe** —
Testcontainers cria um banco do zero com as migrations do próprio código, sempre em sincronia. Aqui
não: o Postgres é o container que fica de pé, as migrations são aplicadas como seriam em produção, e
o `docker exec` olha a tabela de fora da aplicação. É o nível que pega "esqueci de atualizar o
`.env.docker`" (aconteceu na Fase 17, ver `CLAUDE.md`) — não pega regra de negócio nova, pega o
**ambiente** mentir sobre o que a aplicação realmente gravou.

**Este plano NÃO substitui nada que já existe.** Ele não repete a matriz de forja de JWT
(`security.e2e-spec.ts`), não repete a superfície genérica de 401/403/400
(`finance-smoke.e2e-spec.ts`), e não repete a exploração de combinações do algoritmo de casamento
(`matcher.spec.ts` + golden dataset de `test/fixtures/reconciliation-maxima-2026-08-15.json`) — ver
§6 para a lista explícita do que fica de fora e por quê. O que ele cobre é: **cada uma das 14 rotas
de negócio recebe pelo menos uma chamada real, e cada regra de negócio que só se prova com um dado
persistido tem exatamente um teste, verificado no banco.**

---

## 1 · Visão da API Finance (para quem está vendo isto pela primeira vez)

`api-finance` é o módulo financeiro de uma operação de apostas com três marcas — **Suprema**,
**Ultra** e **Maxima** — compartilhando a mesma infraestrutura bancária. Ele resolve dois problemas
todos os dias:

1. **Balanço de caixa** (`finance-cash-balance`, 7 rotas): todo dia, alguém do financeiro confere o
   saldo de 8 contas bancárias (7 manuais + a conta na **Trio**, o parceiro bancário, lida por
   integração), confirma cada uma, e "fecha o dia" registrando quanto a operação tem em caixa versus
   quanto deve aos jogadores. É o **balanço de caixa diário** de cada marca.
2. **Conciliação bancária** (`finance-reconciliation`, 7 rotas): todo dia, o sistema casa **o que a
   plataforma de apostas registrou** (depósitos e saques aprovados) com **o que o extrato do banco
   mostra** (créditos e débitos reais). O que não casa é **pendência**, e uma pendência só sai da
   lista com uma nota de um operador explicando o motivo — nunca com um botão de "esconder".

Guardas em todas as rotas protegidas (`src/auth/auth.module.ts`): `JwtAuthGuard` (Bearer RS256,
chave pública da SayPlus) → `PermissionsGuard` (deny-by-default, 7 codes de permissão em
`src/auth/permissions.constants.ts`). **A marca nunca vem da URL, do body ou da query** — vem sempre
de `GET /auth/me` na plataforma SayPlus, que devolve os tenants aos quais o usuário logado tem
vínculo. Passar `:brand=suprema` na URL não dá acesso à Suprema; só dá se `/auth/me` disser que o
usuário tem vínculo com `suprema-bet`.

Banco próprio, 8 tabelas, **sem RLS** (marca ≠ tenant — o isolamento é só na aplicação). Duas
integrações externas lidas, nunca escritas por rota HTTP: **ClickHouse** (data warehouse, KPIs e
saldo de jogadores) e **Trio** (extrato bancário e fechamento diário, sempre lido do que um cron já
capturou no Postgres — nenhuma rota chama a Trio em tempo de request).

Mapa completo das 14 rotas + regras: [`REGRAS-NEGOCIO-ROTAS.md`](./REGRAS-NEGOCIO-ROTAS.md). Este
documento não repete aquele — ele **seleciona**, dali, o que vira teste orgânico, e conta a história
de quem usa a API para chegar em cada regra.

---

## 2 · A persona

**Marina**, analista de operações financeiras. Toda tarde, depois que os bancos e a plataforma já
fecharam o movimento do dia anterior, Marina faz duas coisas, nesta ordem: fecha o **balanço de
caixa** de ontem (Suprema, Ultra e Maxima) e concilia o **extrato bancário** com o que a plataforma
registrou. As duas tarefas têm o mesmo formato — abrir a tela, confirmar o que está certo, investigar
o que não casa, registrar por que — e é essa rotina que organiza o roteiro do §5.

---

## 3 · Ferramental de teste

O repositório **já tem** uma stack de teste HTTP madura e amplamente usada no mercado — não é
necessário introduzir nada novo:

| Ferramenta | Onde já é usada | Por que serve também aqui |
|---|---|---|
| **Jest 30** | `npm test`, `npm run test:e2e` | ~44k★ no GitHub, o test runner mais usado do ecossistema Node/TypeScript. Já é o runner de todo o projeto — introduzir um segundo (Vitest, Mocha) fragmentaria tooling sem ganho. |
| **Supertest 7** | as 4 suítes de `test/*.e2e-spec.ts` | ~5k★, é o padrão de fato para asserção HTTP em Node/Nest/Express. Já usado nas 4 suítes atuais. |
| **`pg`/`psql` via `docker exec`** | novo neste plano | não é uma lib de teste — é o comando usado para ler a tabela de fora da aplicação, ver §4. |

**A única diferença técnica real** em relação às suítes atuais: hoje `supertest` recebe
`app.getHttpServer()` (a aplicação Nest viva **dentro do processo do Jest**). Aqui `supertest` recebe
uma **URL** (`request('http://localhost:3005')`), porque a aplicação está viva num **container
separado**. Duas consequências a decidir na implementação (não nesta entrega):

- `setupTestAuth()` (`test/auth-helper.ts`) gera um par RSA **efêmero em memória** e escreve a chave
  pública onde a aplicação (que está no mesmo processo) vai ler. Isso não funciona aqui — o container
  `api` já subiu com a chave pública de `./keys/public.pem` montada (`npm run auth:keys`, já é o
  fluxo documentado no `docker-compose.yml`). Os testes orgânicos precisam assinar tokens com
  `keys/private.pem`, no mesmo padrão de `scripts/auth-dev-token.js` (`npm run auth:token`) — não
  gerar chave nova por teste.
- O `sub` do token decide o que o stub de identidade devolve (`user-limited-brands` → só a marca
  Ultra; qualquer outro `sub` → as 3 marcas), então "Marina com acesso total" e "Marina com acesso
  limitado" são dois `sub` diferentes, não dois usuários de banco diferentes.

---

## 4 · Ambiente Docker completo

### 4.1 · O que sobe

| Serviço | Como sobe | Papel |
|---|---|---|
| `postgres` (`api-finance-postgres`) | `docker compose up -d` (default) | Postgres real, persistente entre execuções — é onde o `docker exec` olha |
| `api` (`api-finance`) | `docker compose --profile full up -d --build` | a imagem real da API, porta `3005`, prefixo `api/v1` |
| stub `:3100` (identidade SayPlus) | `node scripts/finance-dev-stubs.js &`, **no host** | `GET /auth/me` — marcas do usuário |
| stub `:8123` (ClickHouse) | idem | KPIs, saldo de jogadores, correções por CPF |
| stub `:9001` (Trio) | idem | extrato bancário e fechamento diário — dataset fixo em `RECON_DATE = 2026-06-15`, marca `suprema` |

Os 3 stubs rodam no **host**, fora da rede do compose — o container `api` os alcança por
`host.docker.internal` (já configurado em `.env.docker`). Não existe serviço ClickHouse/Trio real no
`docker-compose.yml`; são esses 3 stubs Node que fazem o papel, e já são os mesmos usados pelo e2e
atual — nenhum stub novo é necessário.

### 4.2 · Passo a passo para levantar o ambiente

```bash
npm run auth:keys                                    # gera keys/private.pem + keys/public.pem
node scripts/finance-dev-stubs.js &                  # :3100 :8123 :9001, no host
docker compose --profile full up -d --build          # postgres + api, rede do compose
npm run migration:run                                # aplica as migrations no Postgres do compose
curl -fsS http://localhost:3005/health/readiness      # {"status":"ok","info":{"database":{"status":"up"}}}
export TOKEN_MARINA=$(npm run -s auth:token -- finance.cash-balance.summary.read finance.cash-balance.banks.read finance.cash-balance.banks.confirm finance.cash-balance.register.create finance.reconciliation.read finance.reconciliation.run finance.reconciliation.resolve)
```

`migration:run` precisa apontar para o Postgres do compose (`DB_HOST=localhost` no `.env` do host,
não `DB_HOST=postgres` do `.env.docker` — são dois arquivos de env diferentes para dois processos
diferentes, o mesmo padrão que já existe hoje para `npm run start:dev` local).

### 4.3 · O padrão de verificação via `docker exec`

Todo teste que faz uma escrita (`POST`) verifica o efeito HTTP (status + corpo) **e** confere a linha
gravada direto no Postgres, sem passar pela aplicação de novo:

```bash
docker exec -i api-finance-postgres psql -U users -d users -t -c "
  SELECT status, confirmed, confirmed_by, balance
  FROM cash_balance_bank_entries e
  JOIN cash_balance_daily d ON d.id = e.daily_id
  WHERE d.brand = 'suprema' AND d.reference_date = '2026-09-10' AND e.bank = 'onekey';
"
```

Cada teste na tabela do §5 traz a consulta específica (tabela + filtro), não repetida aqui.

### 4.4 · Encerrar

```bash
docker compose --profile full down       # mantém o volume postgres-data
kill %1                                  # encerra os stubs do host
```

---

## 5 · Critério de seleção das regras (por que são exatamente estas, e não outras)

A fonte é a seção **"7 · Invariantes de negócio — a lista para virar teste"** de
`REGRAS-NEGOCIO-ROTAS.md` — 25 invariantes já extraídos do código, cada um com a rota onde vive e,
quando existe, o incidente real que motivou a regra. Este plano:

1. **Atribui cada invariante a UMA rota canônica** — a que expõe o efeito de forma mais direta e
   verificável no banco. Um invariante listado em 3 rotas (ex.: "KPI indisponível não bloqueia
   leitura", rotas 1/2/3) vira **um** teste, não três — testá-lo três vezes seria exatamente o "teste
   desnecessário" que não queremos.
2. **Acrescenta as regras de guarda de cada rota** que não estão na lista dos 25 porque são
   validação de entrada, não invariante de domínio (ex.: banco `trio` é somente leitura na
   confirmação, `404` ao reabrir sem registro) — sem elas, rotas como a 5 e a 7 não teriam nenhuma
   chamada própria no roteiro, e a exigência é "cada rota implementada tem uma chamada".
3. **Exclui** o que já está provado em outro nível sem ganho real em repetir — lista completa no §6.
4. **Um `it()` = uma regra.** Onde o mesmo cenário de setup serve para duas regras (ex.: rodar a
   conciliação uma vez e checar 5 invariantes na mesma execução), o **setup** é compartilhado
   (`beforeAll`) mas cada regra tem seu próprio bloco de teste e sua própria consulta ao banco — não
   um `expect` gigante testando cinco coisas de uma vez.

---

## 6 · Fora de escopo deste plano (e por quê)

| Item | Por quê fica fora |
|---|---|
| Forja de JWT (chave errada, `alg:none`, downgrade HS256, issuer/audience/expiração) | Já é `security.e2e-spec.ts`, roda contra a aplicação em processo — repetir contra o Docker não muda o resultado, é o mesmo `JwtAuthGuard` |
| Superfície genérica de erro (401 sem token, 403 sem permissão, 400 de data malformada, 400 de campo extra) em cada uma das 14 rotas | Já é `finance-smoke.e2e-spec.ts`, parametrizado (`it.each`) contra o catálogo de erros do §6 de `REGRAS-NEGOCIO-ROTAS.md`. Este plano usa 1-2 casos de campo extra/whitelist só onde a regra de negócio se apoia nisso (rota 6), não para repetir a superfície inteira |
| Exploração de combinações do algoritmo de casamento (múltiplos cenários de chave duplicada, sem chave, virada de dia) | Já é `matcher.spec.ts`/`refund-settlement.spec.ts`/`correction-matcher.spec.ts` contra o golden dataset `test/fixtures/reconciliation-maxima-2026-08-15.json` — domínio puro, sem HTTP, mais rápido e mais fácil de variar caso a caso |
| Invariante #21 ("nenhuma rota chama a Trio de forma síncrona") | Provar isso por tempo de resposta (ex.: "responde em menos de 300ms") é exatamente o tipo de teste instável que gera falso positivo — a garantia real já existe como regra estrutural (`architecture.spec.ts`/ArchUnitTS restringe o `axios` da Trio a um diretório) |
| CLIs (`trio:capture`, `reconcile`, `trio:statement`, `trio:transactions`, `balance:import`) e os 2 `CronJob` | Não são rotas HTTP — fora do pedido explícito ("cada rota... deve ter uma chamada"). Fica registrado aqui como lacuna real (nenhuma suíte hoje testa os CLIs de ponta a ponta) para uma decisão futura, não implícito neste plano |
| Rate limit / `429` | Não existe em nenhuma camada (decisão registrada na Fase 17) — não há o que testar |

---

## 7 · O roteiro da Marina — rota por rota, regra por regra

Convenção de leitura de cada bloco: **Por que Marina chama isto** (a história) → **Regra sob teste**
(citando o invariante ou a seção de origem) → **Verificação HTTP** → **Verificação `docker exec`**.

Fixture de data usada nos testes de balanço (não depende do dataset fixo dos stubs, que não varia
por data): `2026-09-10`, marcas `suprema`/`ultra`/`maxima`. Fixture de data dos testes de conciliação
(depende do dataset fixo do stub Trio): `2026-06-15`, marca `suprema`.

### 7.1 · Balanço de caixa

#### T01 — `GET /cash-balance/summary` — o resumo só mostra o que Marina pode ver

**Por que Marina chama isto:** é a primeira tela do dia — antes de tocar em qualquer banco, Marina
olha os KPIs consolidados. Hoje ela está logada com acesso só à marca Ultra (token com
`sub=user-limited-brands`).

**Regra sob teste:** a marca nunca vem de query/body, sempre de `/auth/me` — invariante #25
(`REGRAS-NEGOCIO-ROTAS.md` §1.2). Um usuário sem vínculo com Suprema/Maxima não vê os cards dessas
marcas, mesmo que a rota não peça `:brand` nenhum.

**Verificação HTTP:** `GET /cash-balance/summary?date=2026-09-10` com o token de acesso limitado →
`200`, `byBrand` de cada card contém **só** `ultra`.

**Verificação `docker exec`:** nenhuma — rota 100% de leitura do warehouse, sem tabela própria
envolvida.

---

#### T02 — `GET /cash-balance/banks` — o saldo sugerido vem do último dia conhecido

**Por que Marina chama isto:** ela confirma os 7 bancos de `2026-09-10` e registra o dia. No dia
seguinte (`2026-09-11`), ela abre a tela de novo — sem ter confirmado nada ainda — e espera ver os
mesmos valores de ontem já preenchidos, prontos para ajustar só o que mudou.

**Regra sob teste:** banco manual não confirmado sugere o **último saldo conhecido antes da data**,
não `0` (`REGRAS-NEGOCIO-ROTAS.md` §2.2, tabela "Como o estado de cada banco é decidido").

**Verificação HTTP:** `GET /cash-balance/banks?date=2026-09-11` → cada banco manual tem `confirmed:
false`, `suggested: true`, e `balance` igual ao valor confirmado em `2026-09-10`.

**Verificação `docker exec`:** confirma que **não existe** linha em `cash_balance_bank_entries` para
`(daily_id de 2026-09-11, bank)` — prova que o valor sugerido não veio de um entry escondido do dia
atual, e sim da consulta ao dia anterior:

```sql
SELECT count(*) FROM cash_balance_bank_entries e
JOIN cash_balance_daily d ON d.id = e.daily_id
WHERE d.brand = 'suprema' AND d.reference_date = '2026-09-11';
-- esperado: 0
```

---

#### T03 — `GET /cash-balance/history` — dias registrados ≠ dias do intervalo

**Por que Marina chama isto:** fim de mês, ela quer ver os últimos 3 dias antes de fechar o período,
mas sabe que ontem ninguém tocou no sistema (feriado). Ela precisa que a tela deixe isso visível, não
que finja que o KPI de 3 dias é o mesmo balanço de 3 dias.

**Regra sob teste:** duas fontes, dois recortes — a tabela de dias mostra só dias `CONFIRMED` com
snapshot; os KPIs do topo cobrem o intervalo inteiro. `registeredDays` ≠ `rangeDays` quando um dia
não foi registrado (`REGRAS-NEGOCIO-ROTAS.md` §2.3).

**Verificação HTTP:** registrar `suprema` em `2026-09-10` e `2026-09-12`, **não** em `2026-09-11`;
`GET /cash-balance/history?from=2026-09-10&to=2026-09-12` → `rangeDays: 3`, `registeredDays: 2`,
`days[]` com 2 entradas.

**Verificação `docker exec`:**

```sql
SELECT reference_date, status FROM cash_balance_daily
WHERE brand = 'suprema' AND reference_date BETWEEN '2026-09-10' AND '2026-09-12'
ORDER BY reference_date;
-- esperado: 2 linhas (10 e 12), nenhuma em 11
```

---

#### T04 — `GET /cash-balance/trio/refresh` — os 3 estados da captura, e o gate do registro

**Por que Marina chama isto:** antes de confirmar qualquer banco manual, ela checa se o fechamento da
Trio já foi capturado hoje — se não foi, ela sabe que não vale a pena confirmar os outros 7 ainda,
porque o registro vai falhar de qualquer forma.

**Regra sob teste:** o card distingue **ausente** (`available: false`) de **capturado exato**
(`POINT_IN_TIME`, `exact: true`) de **capturado reconstruído** (`RECONSTRUCTED`/`SNAPSHOT`,
`exact: false`, mensagem "Fechamento sem convergência, conferir") — e é a leitura do Postgres, nunca
da Trio (`REGRAS-NEGOCIO-ROTAS.md` §2.4, invariante #3).

**Verificação HTTP (3 casos, mesma rota):**
1. Sem nenhuma linha para `2026-09-13` → `available: false`, `balance: null`.
2. Com uma linha `method='POINT_IN_TIME'` inserida via `docker exec` → `available: true`, `exact:
   true`.
3. Com uma linha `method='RECONSTRUCTED'` → `available: true`, `exact: false`, mensagem de
   convergência.

**Verificação `docker exec` (aqui o `docker exec` também semeia o dado, não só confere):**

```sql
INSERT INTO trio_closing_balances (reference_date, brand, bank_account_id, balance, cutoff_at, captured_at, exact, method)
VALUES ('2026-09-13', 'suprema', 'acc-suprema', 2500.25, now(), now(), true, 'POINT_IN_TIME');
```

---

#### T05a — `POST /cash-balance/:brand/banks/:bank/confirm` — a Trio é somente leitura

**Por que Marina chama isto:** por engano, ela tenta confirmar o saldo da Trio manualmente (o card
está visível na tela, mas é `readOnly`). O sistema precisa recusar, porque a Trio só entra por
captura automática — se aceitasse, dois caminhos diferentes escreveriam o mesmo dado e um dia
divergiria do outro sem aviso.

**Regra sob teste:** confirmar `bank='trio'` é recusado com `400 Saldo da Trio é somente leitura`
(`REGRAS-NEGOCIO-ROTAS.md` §2.5).

**Verificação HTTP:** `POST /cash-balance/suprema/banks/trio/confirm` com `{"balance": 999}` → `400`.

**Verificação `docker exec`:** nenhuma linha nova em `cash_balance_bank_entries` para `bank='trio'`
na data — a recusa aconteceu antes de qualquer escrita, não depois:

```sql
SELECT count(*) FROM cash_balance_bank_entries e
JOIN cash_balance_daily d ON d.id = e.daily_id
WHERE d.reference_date = '2026-09-10' AND d.brand = 'suprema' AND e.bank = 'trio';
-- esperado: 0 (a captura automática ainda não rodou nesta data de teste)
```

---

#### T05b — `POST /cash-balance/:brand/banks/:bank/confirm` — confirmar cria o dia e reconfirmar sobrescreve

**Por que Marina chama isto:** ela confirma o banco `onekey` da Suprema pela primeira vez do dia
(`R$ 10.000,00`) — essa chamada precisa criar o dia sozinha, sem nenhum passo anterior. Vinte minutos
depois, ela percebe que digitou errado e confirma de novo (`R$ 10.500,00`) — a segunda chamada
precisa **substituir** a primeira, não empilhar.

**Regra sob teste:** a primeira confirmação do dia cria `cash_balance_days` (status `OPEN`) e
`cash_balance_daily` (status `DRAFT`); reconfirmar é upsert atômico por `(daily_id, bank)` — sobrescreve
valor, autor e instante, sem trava (`REGRAS-NEGOCIO-ROTAS.md` §2.5).

**Verificação HTTP:** duas chamadas `POST .../onekey/confirm` seguidas, `{"balance": 10000}` depois
`{"balance": 10500}` → ambas `204`.

**Verificação `docker exec`:**

```sql
SELECT balance, confirmed, confirmed_by FROM cash_balance_bank_entries e
JOIN cash_balance_daily d ON d.id = e.daily_id
WHERE d.reference_date = '2026-09-10' AND d.brand = 'suprema' AND e.bank = 'onekey';
-- esperado: 1 linha só, balance = 10500.00
```

---

#### T06a — `POST /cash-balance/:brand/register` — o corpo não aceita saldo

**Por que Marina chama isto (ou melhor, por que a integração não deveria conseguir):** um script
antigo de integração tenta registrar o dia mandando `{"date": "2026-09-10", "balance": 999999}` — um
atalho que pularia a exigência de confirmar banco por banco.

**Regra sob teste:** `forbidNonWhitelisted` recusa campo não declarado no DTO — é o mecanismo que
impõe "o saldo nunca vem do corpo" (`REGRAS-NEGOCIO-ROTAS.md` §1.4, invariante #6).

**Verificação HTTP:** `POST /cash-balance/suprema/register` com `{"date": "2026-09-10", "balance":
999999}` → `400`.

**Verificação `docker exec`:** `cash_balance_daily.status` de `2026-09-10`/`suprema` continua
`DRAFT`, sem `deposits_total` alterado pela chamada rejeitada.

---

#### T06b — `POST /cash-balance/:brand/register` — faltando bancos, o erro diz quais

**Por que Marina chama isto:** ela confirmou só 5 dos 7 bancos manuais da Suprema (esqueceu `okto` e
`genial`) e tenta registrar assim mesmo, achando que já tinha terminado.

**Regra sob teste:** registro exige os 7 bancos manuais confirmados; o erro lista exatamente os que
faltam em `pendingBanks` (`REGRAS-NEGOCIO-ROTAS.md` §2.6, invariante #5, e §1.5 sobre o payload
estruturado).

**Verificação HTTP:** `POST /cash-balance/suprema/register` (com 5/7 confirmados) → `400`, body
`pendingBanks: ["okto", "genial"]` (nesta ordem, a do catálogo).

**Verificação `docker exec`:** `cash_balance_daily.status` continua `DRAFT` — a chamada rejeitada não
grava nada.

---

#### T06c — `POST /cash-balance/:brand/register` — sem captura da Trio, falha sem gravar nada pela metade

**Por que Marina chama isto:** os 7 bancos manuais estão confirmados, mas o cron de captura da Trio
falhou hoje (não rodou ainda, ou caiu) — Marina tenta registrar assim mesmo, sem saber.

**Regra sob teste:** sem `trio_closing_balances` para o dia, registro falha com `503`, **e a
transação não deixa nenhuma escrita parcial** — nem `cash_balance_daily` passa a `CONFIRMED`, nem o
snapshot é criado (`REGRAS-NEGOCIO-ROTAS.md` §2.6, invariante #3 — é a regra que corrigiu 8 de 18
fechamentos errados por reconstrução).

**Verificação HTTP:** com os 7 bancos manuais confirmados e **nenhuma** linha em
`trio_closing_balances` para a data → `POST /cash-balance/suprema/register` → `503`.

**Verificação `docker exec`:**

```sql
SELECT status FROM cash_balance_daily WHERE brand = 'suprema' AND reference_date = '2026-09-14';
-- esperado: DRAFT (nunca chegou a CONFIRMED)
SELECT count(*) FROM cash_balance_brand_snapshots s
JOIN cash_balance_daily d ON d.id = s.daily_id
WHERE d.brand = 'suprema' AND d.reference_date = '2026-09-14';
-- esperado: 0
```

---

#### T06d — `POST /cash-balance/:brand/register` — o sinal é transacional menos jogadores

**Por que Marina chama isto:** é o registro de verdade, com tudo pronto — 7 bancos confirmados,
Trio capturada, saldo de jogadores disponível no warehouse. Ela aperta "OK".

**Regra sob teste:** `totalBalanco = saldoTransacional − saldoJogadores`, nesta ordem — inverter foi
um bug real corrigido em 30/07/2026 (`REGRAS-NEGOCIO-ROTAS.md` §2.6, invariante #1).

**Verificação HTTP:** `POST /cash-balance/suprema/register` → `201`, corpo com
`saldoTransacional`, `saldoJogadores`, `totalBalanco` — confere `totalBalanco === saldoTransacional -
saldoJogadores` (aritmética em centavos inteiros).

**Verificação `docker exec`:**

```sql
SELECT saldo_transacional, saldo_jogadores, total_balanco FROM cash_balance_brand_snapshots s
JOIN cash_balance_daily d ON d.id = s.daily_id
WHERE d.brand = 'suprema' AND d.reference_date = '2026-09-14';
-- esperado: total_balanco = saldo_transacional - saldo_jogadores, exatamente
```

---

#### T06e — `POST /cash-balance/:brand/register` — o dia só fecha com as 3 marcas

**Por que Marina chama isto:** ela registra Suprema e Ultra, mas ainda não chegou a vez da Maxima —
o dia precisa continuar `OPEN`. Quando ela termina de registrar a Maxima também, o dia deve fechar
sozinho, sem um botão extra de "fechar o dia".

**Regra sob teste:** o dia só é `CLOSED` quando as **3 marcas do catálogo** estão `CONFIRMED` — não as
3 marcas do usuário logado (`REGRAS-NEGOCIO-ROTAS.md` §2.6, invariante #7).

**Verificação HTTP:** registrar `suprema` e `ultra` → resposta de cada uma tem `dayStatus: "OPEN"`;
registrar `maxima` → resposta tem `dayStatus: "CLOSED"`.

**Verificação `docker exec`:**

```sql
SELECT status, closed_at, closed_by FROM cash_balance_days WHERE reference_date = '2026-09-14';
-- esperado, após as 3: status = CLOSED, closed_at/closed_by preenchidos
```

---

#### T07a — `POST /cash-balance/:brand/reopen` — reabrir sem registro é 404

**Por que Marina chama isto:** ela clica em "reabrir" numa marca que nunca foi registrada
(`2026-09-20`, um dia futuro que ela abriu por engano na tela).

**Regra sob teste:** sem `cash_balance_daily` para `(reference_date, brand)`, reabrir é `404 Não há
balanço registrado para esta marca na data` (`REGRAS-NEGOCIO-ROTAS.md` §2.7).

**Verificação HTTP:** `POST /cash-balance/suprema/reopen` com `{"date": "2026-09-20"}` → `404`.

**Verificação `docker exec`:** nenhuma.

---

#### T07b — `POST /cash-balance/:brand/reopen` — reabre o dia inteiro, preserva o snapshot antigo

**Por que Marina chama isto:** depois de registrar a Suprema de `2026-09-14`, ela percebe que
confirmou o valor errado num banco. Ela reabre a marca para corrigir — e precisa que o dia inteiro
(inclusive Ultra e Maxima, já `CONFIRMED`) volte a `OPEN`, porque o dia só é definitivo com as 3.

**Regra sob teste:** reabrir uma marca reabre o **dia** inteiro; o snapshot da marca reaberta **não é
apagado** — some da tabela do histórico (que filtra `status = CONFIRMED`) mas continua na tabela até
um novo registro sobrescrever (`REGRAS-NEGOCIO-ROTAS.md` §2.7, invariante #8).

**Verificação HTTP:** `POST /cash-balance/suprema/reopen` com `{"date": "2026-09-14"}` → `204`;
`GET /cash-balance/history?from=2026-09-14&to=2026-09-14` não traz mais `suprema` naquele dia.

**Verificação `docker exec`:**

```sql
SELECT status FROM cash_balance_days WHERE reference_date = '2026-09-14';
-- esperado: OPEN (mesmo com ultra/maxima ainda CONFIRMED)
SELECT status FROM cash_balance_daily WHERE brand = 'suprema' AND reference_date = '2026-09-14';
-- esperado: DRAFT
SELECT count(*) FROM cash_balance_brand_snapshots s
JOIN cash_balance_daily d ON d.id = s.daily_id
WHERE d.brand = 'suprema' AND d.reference_date = '2026-09-14';
-- esperado: 1 (o snapshot antigo continua gravado, não foi apagado)
```

---

### 7.2 · Conciliação bancária

> Os testes desta seção usam a data fixa do stub da Trio, `2026-06-15`, marca `suprema` — é o único
> dia em que o stub devolve extrato bancário de verdade (fora dele, lista vazia). Rodar
> `POST /reconciliation/run` para esta data e aguardar `status: DONE` no `GET /reconciliation` é o
> setup comum a todos os testes de 7.2 — feito uma vez, os testes abaixo só leem o resultado.

#### T08 — `GET /reconciliation` — estorno com reprocessamento pendente não trava o "conciliado"

**Por que Marina chama isto:** depois de rodar a conciliação do dia, ela abre a tela para ver se pode
marcar o caixa de `2026-06-15` como fechado. Existe um estorno na Trio (chave `trio-saq-2-est`) cuja
operação de saque continua `APPROVED` na plataforma — sobrou trabalho para o time de pagamentos, mas
o caixa do dia bateu.

**Regra sob teste:** estorno com `platformReprocessPending: true` não impede `reconciled: true` — não
é pendência de caixa (`REGRAS-NEGOCIO-ROTAS.md` §3.0 "Estorno liquida" + §3.1, invariante #20).

**Verificação HTTP:** `GET /reconciliation?date=2026-06-15` → marca `suprema`: `reconciled: true`,
`reprocessPendingCount ≥ 1`.

**Verificação `docker exec`:**

```sql
SELECT status, resolved_by, still_pending FROM reconciliation_items
WHERE reference_date = '2026-06-15' AND brand = 'suprema' AND item_key = 'trio-saq-2-est';
-- esperado: status = RESOLVED, resolved_by = 'sistema', still_pending = false
```

---

#### T09a — `GET /reconciliation/history` — dia sem execução é mais grave que dia com pendência

**Por que Marina chama isto:** fim de mês, ela olha os últimos 3 dias para decidir se pode fechar o
período. Um deles (`2026-06-16`) nunca foi conciliado; outro (`2026-06-14`, semeado via `docker exec`
com `status = 'DONE'` e uma pendência aberta) tem pendência conhecida.

**Regra sob teste:** `NOT_RUN` é pior que `PENDING` na severidade do dia — pendência desconhecida
custa mais que pendência conhecida (`REGRAS-NEGOCIO-ROTAS.md` §3.2, invariante #17).

**Verificação HTTP:** `GET /reconciliation/history?from=2026-06-14&to=2026-06-16` → `2026-06-16`
aparece com severidade `NOT_RUN`, `2026-06-14` com `PENDING` — e `NOT_RUN` é o pior dos três dias do
período.

**Verificação `docker exec`:**

```sql
SELECT reference_date FROM reconciliation_runs WHERE brand = 'suprema' AND reference_date = '2026-06-16';
-- esperado: 0 linhas (nunca rodou)
```

---

#### T09b — `GET /reconciliation/history` — `missingDays` não conta execução em andamento

**Por que Marina chama isto:** no mesmo período acima, uma marca está com a conciliação `RUNNING` no
momento em que ela consulta o histórico — não é um buraco, é trabalho em andamento.

**Regra sob teste:** `missingDays = NOT_RUN + FAILED`; `RUNNING` não entra na contagem
(`REGRAS-NEGOCIO-ROTAS.md` §3.2, invariante #18).

**Verificação HTTP:** com uma run em `status = 'RUNNING'` semeada via `docker exec` para
`2026-06-17`, `GET /reconciliation/history?from=2026-06-16&to=2026-06-17` → `missingDays: 1` (só o
`NOT_RUN` de 16, não o `RUNNING` de 17).

**Verificação `docker exec` (aqui também semeando):**

```sql
INSERT INTO reconciliation_runs (reference_date, brand, bank, status, started_at, matched_count, pending_count)
VALUES ('2026-06-17', 'suprema', 'trio', 'RUNNING', now(), 0, 0);
```

---

#### T10a — `POST /reconciliation/run` — casamento é só por chave, nunca por valor

**Por que Marina chama isto:** ela dispara a conciliação do dia e depois investigate um saque
"órfão" do extrato (`ext-saq-orfa`, `R$ 70,00`, sem par na plataforma). Ela quer confirmar que o
sistema não inventou um par por coincidência de valor com outro saque qualquer do dia.

**Regra sob teste:** o casamento é 1:1 por `external_id`/`gateway_external_id`; lançamento sem par na
mesma chave fica pendência, nunca casa por valor aproximado (`REGRAS-NEGOCIO-ROTAS.md` §3.0,
invariante #2 — o incidente dos 37 saques legítimos de 12/08/2026).

**Verificação HTTP:** `GET /reconciliation?date=2026-06-15` (após o `run`) → a pendência com
`item_key = 'ext-saq-orfa'` aparece na lista, `status: OPEN`.

**Verificação `docker exec`:**

```sql
SELECT status, side, flow FROM reconciliation_items
WHERE reference_date = '2026-06-15' AND brand = 'suprema' AND item_key = 'ext-saq-orfa';
-- esperado: status = OPEN, side = PLATFORM, flow = WITHDRAWAL
```

---

#### T10b — `POST /reconciliation/run` — as 3 linhas de um estorno saem juntas, ou nenhuma

**Por que Marina chama isto:** mesma execução do T10a — agora ela olha a chave `trio-saq-3-est`
(estorno da Trio) e confirma que nem o débito original, nem o crédito de devolução, nem o saque da
plataforma aparecem como pendência separada — as 3 saíram juntas da lista.

**Regra sob teste:** liquidação de estorno remove as 3 linhas da chave estornada juntas, nunca uma só
(`REGRAS-NEGOCIO-ROTAS.md` §3.0 "Estorno liquida, não abre pendência", invariante #4 — o incidente da
pendência falsa de R$ 1.000,00 em 15/08/2026).

**Verificação HTTP:** `GET /reconciliation?date=2026-06-15` → nenhuma pendência `OPEN` com
`item_key` relacionado a `trio-saq-3-est`.

**Verificação `docker exec`:**

```sql
SELECT item_key, status FROM reconciliation_items
WHERE reference_date = '2026-06-15' AND brand = 'suprema' AND item_key = 'trio-saq-3-est';
-- esperado: 1 linha, status = RESOLVED (não 0 linhas, não OPEN)
```

---

#### T10c — `POST /reconciliation/run` — transferência para a conta própria nunca é pendência

**Por que Marina chama isto:** no extrato do dia existe um débito para o próprio CNPJ da operação
(retirada de excedente de caixa) — ela confirma que isso nunca aparece na lista de pendências, porque
por definição não tem contrapartida na plataforma.

**Regra sob teste:** contraparte no CNPJ próprio classifica como `TREASURY`, nunca pendência
(`REGRAS-NEGOCIO-ROTAS.md` §3.0 "Classificação do lado do banco", invariante #15).

**Verificação HTTP:** `GET /reconciliation?date=2026-06-15` → `openCount` não inclui nenhum item
`flow: TREASURY`.

**Verificação `docker exec`:**

```sql
SELECT status FROM reconciliation_items
WHERE reference_date = '2026-06-15' AND brand = 'suprema' AND flow = 'TREASURY';
-- esperado: toda linha TREASURY já nasce fora de OPEN (não conta pendência)
```

---

#### T10d — `POST /reconciliation/run` — tarifa fica fora do casamento

**Por que Marina chama isto:** o extrato tem uma tarifa bancária (`trio-fee-1`, R$ 0,05) — ela
confirma que isso nunca tenta casar com um depósito ou saque, e só aparece somado em `feesTotal`.

**Regra sob teste:** `transaction_type = 'fee'` sai do casamento, entra só em `feesTotal`
(`REGRAS-NEGOCIO-ROTAS.md` §3.0, invariante #16).

**Verificação HTTP:** `GET /reconciliation?date=2026-06-15` → `fees.total ≥ 0.05`; nenhum item de
`reconciliation_items` com `item_key = 'trio-fee-1'`.

**Verificação `docker exec`:**

```sql
SELECT count(*) FROM reconciliation_items WHERE item_key = 'trio-fee-1';
-- esperado: 0 (nunca entra como item, só soma no total)
```

---

#### T10e — `POST /reconciliation/run` — saque usa a data de liberação, não a do pedido

**Por que Marina chama isto:** ela verifica um saque pedido perto da virada da meia-noite e liberado
já no dia seguinte — quer confirmar que ele entrou na conciliação do dia em que foi **liberado**, não
do dia em que foi **pedido**.

**Regra sob teste:** saque usa `transaction_date` (liberação), não `withdrawal_ts` (pedido)
(`REGRAS-NEGOCIO-ROTAS.md` §3.0 "Qual instante define o dia", invariante #24 — a diferença real de
R$ 5.755,00 na Ultra).

**Verificação HTTP:** com um saque de teste cujo `request_ts` cai em `2026-06-14` e `allow_ts`
(liberação) em `2026-06-15`, ele aparece na conciliação de `2026-06-15`, não na de `2026-06-14`.

**Verificação `docker exec`:**

```sql
SELECT reference_date FROM reconciliation_items WHERE item_key = '<chave do saque de teste>';
-- esperado: 2026-06-15, não 2026-06-14
```

> Nota de implementação: este caso precisa de um lançamento adicional no fixture do stub
> (`scripts/finance-dev-stubs.js`) com `allow_ts`/`transaction_date` e `request_ts` em dias
> diferentes — não existe hoje no dataset fixo. É o único teste desta lista que exige um ajuste no
> stub antes de implementar; registrar como pré-requisito, não decidir o valor aqui.

---

#### T11 — `GET /reconciliation/:brand/corrections` — a busca não altera nada

**Por que Marina chama isto:** ela investiga uma pendência de saque para um jogador autoexcluído,
abrindo a busca de correções de saldo. Ela só está olhando evidência — ainda não decidiu dar baixa.

**Regra sob teste:** a busca é só leitura, não dá baixa em nada — a baixa é ação separada da rota 12
(`REGRAS-NEGOCIO-ROTAS.md` §3.4 "Só leitura. Não dá baixa em nada").

**Verificação HTTP:** `GET /reconciliation/suprema/corrections?date=2026-06-15` → `200`.

**Verificação `docker exec`:** o `updated_at`/`status` de todos os `reconciliation_items` de
`suprema`/`2026-06-15` são exatamente os mesmos antes e depois da chamada:

```sql
SELECT status, resolved_at FROM reconciliation_items
WHERE reference_date = '2026-06-15' AND brand = 'suprema' AND status = 'OPEN'
ORDER BY item_key;
-- comparar linha a linha antes/depois da chamada GET — deve ser idêntico
```

---

#### T12a — `POST /reconciliation/:brand/corrections/apply` — `PARTIAL` nunca recebe baixa automática

**Por que Marina chama isto:** ela aplica a baixa em lote das correções exatas do dia. Existe uma
pendência cujo único candidato encontrado é `PARTIAL` (valor da correção diferente do pagamento) —
ela espera que essa continue aberta, porque valor diferente não explica o pagamento.

**Regra sob teste:** `PARTIAL` nunca gera baixa automática (`REGRAS-NEGOCIO-ROTAS.md` §3.4.2,
invariante #12).

**Verificação HTTP:** `POST /reconciliation/suprema/corrections/apply` com `{"date": "2026-06-15"}` →
`201`; a pendência cujo primeiro candidato é `PARTIAL` **não** está entre os `resolvedCount`.

**Verificação `docker exec`:**

```sql
SELECT status FROM reconciliation_items WHERE item_key = '<item com candidato PARTIAL>';
-- esperado: OPEN (continua aberta)
```

---

#### T12b — `POST /reconciliation/:brand/corrections/apply` — só o candidato de maior confiança conta

**Por que Marina chama isto:** mesma chamada acima — ela confere uma pendência específica cujo
**primeiro** candidato não é exato, mesmo que exista um candidato exato mais abaixo na lista (caso
raro, mas o sistema precisa respeitar a ordem).

**Regra sob teste:** só o primeiro candidato (maior confiança) é considerado; um exato mais abaixo na
lista não conta (`REGRAS-NEGOCIO-ROTAS.md` §3.5, invariante #13).

**Verificação HTTP:** na mesma resposta do T12a, a pendência cujo primeiro candidato não é `exact`
**não** está em `resolvedCount`, independentemente dos candidatos seguintes.

**Verificação `docker exec`:** mesma tabela do T12a, item diferente — `status = OPEN`.

---

#### T12c — `POST /reconciliation/:brand/corrections/apply` — chamar duas vezes resolve zero na segunda

**Por que Marina chama isto:** ela clica no botão de novo por engano (duplo clique, ou a tela não
desabilitou o botão a tempo).

**Regra sob teste:** baixa em lote é idempotente — o filtro `status = 'OPEN'` garante que a segunda
chamada não sobrescreve nada (`REGRAS-NEGOCIO-ROTAS.md` §3.5, invariante #14).

**Verificação HTTP:** repetir `POST /reconciliation/suprema/corrections/apply` com o mesmo `date` →
`201`, `resolvedCount: 0`.

**Verificação `docker exec`:** `resolved_at` das linhas resolvidas na primeira chamada é **idêntico**
antes e depois da segunda chamada (não foi regravado):

```sql
SELECT item_key, resolved_at FROM reconciliation_items
WHERE reference_date = '2026-06-15' AND brand = 'suprema' AND status = 'RESOLVED' AND resolved_by != 'sistema'
ORDER BY item_key;
-- comparar com o resultado capturado logo após a primeira chamada — deve ser idêntico
```

---

#### T13a — `POST /reconciliation/items/:id/resolve` — nota curta é recusada, nota válida grava tudo

**Por que Marina chama isto:** ela decide tratar manualmente a pendência do saque órfão do T10a —
escreve a nota explicando o motivo (o jogador foi pago na mão pela conta da Trio) e confirma.

**Regra sob teste:** `note` é obrigatória, 10–1000 caracteres **depois** do `trim` — e ao gravar,
recalcula `pending_count` do run na mesma transação (`REGRAS-NEGOCIO-ROTAS.md` §3.6, invariante #19).

**Verificação HTTP:** `POST /reconciliation/items/<id>/resolve` com `{"note": "   "}` (só espaços) →
`400`; com `{"note": "Pago na mão pela conta Trio, jogador autoexcluído — ver correção de saldo."}` →
`204`.

**Verificação `docker exec`:**

```sql
SELECT status, note, resolved_by FROM reconciliation_items WHERE id = <id>;
-- esperado: status = RESOLVED, note = o texto, resolved_by = userId da Marina
SELECT pending_count FROM reconciliation_runs WHERE reference_date = '2026-06-15' AND brand = 'suprema' AND bank = 'trio';
-- esperado: decrementado em 1 em relação ao valor antes da chamada
```

---

#### T13b — `POST /reconciliation/items/:id/resolve` — item já tratado não aceita nota por cima

**Por que Marina chama isto:** ela tenta registrar uma segunda nota no mesmo item do T13a, achando
que estava complementando a explicação.

**Regra sob teste:** resolver item já `RESOLVED` é `409`, não sobrescreve nem é idempotente
silencioso (`REGRAS-NEGOCIO-ROTAS.md` §3.6 — "força o operador a reconhecer que está substituindo um
registro contábil").

**Verificação HTTP:** repetir `POST /reconciliation/items/<id>/resolve` com nota válida diferente →
`409`.

**Verificação `docker exec`:** `note` do item continua sendo o texto do T13a, não o da segunda
tentativa.

---

#### T14 — `POST /reconciliation/items/:id/reopen` — reabrir apaga a nota, sem versionar

**Por que Marina chama isto:** ela percebe que escreveu a nota no item errado e reabre para
corrigir.

**Regra sob teste:** `note` volta a `null` (não é preservada nem versionada); o item volta a contar
como pendência aberta (`REGRAS-NEGOCIO-ROTAS.md` §3.7).

**Verificação HTTP:** `POST /reconciliation/items/<id do T13a>/reopen` (sem corpo) → `204`;
`GET /reconciliation?date=2026-06-15` → `openCount` volta a incluir este item.

**Verificação `docker exec`:**

```sql
SELECT status, note, resolved_at, resolved_by FROM reconciliation_items WHERE id = <id>;
-- esperado: status = OPEN, note = NULL, resolved_at = NULL, resolved_by = NULL
```

---

## 8 · Checklist consolidado de execução

Marcar ao rodar. Pré-requisito de cada linha: ambiente do §4 de pé.

**Ambiente**
- [ ] `npm run auth:keys` executado, `keys/public.pem` existe
- [ ] `node scripts/finance-dev-stubs.js &` rodando (3100/8123/9001 respondendo)
- [ ] `docker compose --profile full up -d --build` — `api-finance-postgres` e `api-finance` `Up`
- [ ] `npm run migration:run` aplicado contra o Postgres do compose
- [ ] `curl -fsS http://localhost:3005/health/readiness` → `200`
- [ ] Token da Marina (acesso total) e token de acesso limitado (`sub=user-limited-brands`) gerados

**Balanço de caixa (`2026-09-10` em diante)**
- [ ] T01 — summary filtra por marca vinculada
- [ ] T02 — banks sugere saldo do último dia conhecido
- [ ] T03 — history distingue dias registrados de dias do intervalo
- [ ] T04 — trio/refresh distingue ausente / exato / reconstruído
- [ ] T05a — confirmar banco `trio` é recusado
- [ ] T05b — confirmar cria o dia e reconfirmar sobrescreve
- [ ] T06a — register recusa saldo no corpo
- [ ] T06b — register sem todos os bancos lista `pendingBanks`
- [ ] T06c — register sem captura da Trio falha sem escrita parcial
- [ ] T06d — register grava `totalBalanco = transacional − jogadores`
- [ ] T06e — dia fecha só com as 3 marcas do catálogo
- [ ] T07a — reopen sem registro é 404
- [ ] T07b — reopen reabre o dia e preserva o snapshot

**Conciliação (`2026-06-15`, marca `suprema`)**
- [ ] Setup: `POST /reconciliation/run` disparado e `status: DONE` confirmado antes dos testes abaixo
- [ ] T08 — estorno com reprocessamento pendente não bloqueia `reconciled`
- [ ] T09a — `NOT_RUN` é mais grave que `PENDING`
- [ ] T09b — `missingDays` não conta `RUNNING`
- [ ] T10a — casamento só por chave, nunca por valor
- [ ] T10b — as 3 linhas do estorno saem juntas
- [ ] T10c — `TREASURY` nunca é pendência
- [ ] T10d — tarifa fora do casamento
- [ ] T10e — saque usa data de liberação, não de pedido *(exige ajuste no fixture do stub antes de implementar)*
- [ ] T11 — busca de correções não altera nada
- [ ] T12a — `PARTIAL` nunca recebe baixa automática
- [ ] T12b — só o candidato de maior confiança conta
- [ ] T12c — baixa em lote é idempotente
- [ ] T13a — nota curta recusada; nota válida grava e recalcula `pending_count`
- [ ] T13b — item já tratado não aceita nota por cima (`409`)
- [ ] T14 — reabrir apaga a nota, sem versionar

**Encerramento**
- [ ] `docker compose --profile full down`
- [ ] stubs do host encerrados

---

## 9 · Próximos passos

Esta entrega é só o plano. Ao aprovar:

1. Decidir onde o código mora — sugestão: `test/organic/*.organic-spec.ts`, fora do `testRegex` do
   `test:e2e` atual (não pode rodar no CI de PR, que não tem o Docker completo nem os stubs de pé por
   padrão) — provavelmente um `npm run test:organic` novo, script separado.
2. Escrever o helper de auth equivalente a `test/auth-helper.ts`, mas assinando com
   `keys/private.pem` (fixo, do host) em vez de gerar par efêmero — ver §3.
3. Ajustar `scripts/finance-dev-stubs.js` para o caso do T10e (pedido e liberação em dias diferentes)
   antes de implementar aquele teste especificamente.
4. Implementar T01–T14 (29 testes) na ordem deste documento — cada um já tem a chamada HTTP e a
   consulta SQL de verificação escritas, é tradução direta para código.
