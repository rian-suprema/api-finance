# Análise — Por que o módulo Finance usa ClickHouse

> Documento de **análise apenas** — nenhuma decisão nova aqui, nenhum código alterado. Consolida o que
> já está espalhado em [`DADOS-FINANCE.md`](../DADOS-FINANCE.md) §10, [`INFRA-FINANCE.md`](../INFRA-FINANCE.md)
> §4/§8/§10, [`REGRAS-NEGOCIO-ROTAS.md`](../REGRAS-NEGOCIO-ROTAS.md) e o código já implementado
> (`src/clickhouse/`, `src/modules/finance-cash-balance/infrastructure/clickhouse/`), respondendo
> diretamente: por que existe, quais regras protege, se precisa entrar *agora* (Fase 10) e o que
> ganha/perde o projeto se for excluído.

## 1 · O que é, neste projeto

ClickHouse aqui **não é um banco do módulo** — é um data warehouse analítico de **outro time** (dados),
alimentado por pipelines dbt que o Finance não controla. O módulo é só leitor:

- **Nunca escreve** nele.
- **Nunca lê tabela raw** — só *marts* já tratados (`dw_bet.*`), regra herdada da origem (ADR-034).
- A conexão é única e global (`ClickHouseModule`, `@Global()`), porque duas telas diferentes
  (balanço de caixa e conciliação) consultam o mesmo warehouse — um pool por consumidor duplicaria a
  conexão sem necessidade ([`clickhouse.module.ts`](../../../src/clickhouse/clickhouse.module.ts)).

### Os 5 *marts* lidos (nenhum é tabela do módulo)

| Mart | Para quê | Consumido por | `FINAL`? | Status na migração |
|---|---|---|---|---|
| `dw_bet.fct_kpi_daily` | KPIs de depósito/saque do dia, do mês e do histórico | `ClickHouseReadService` (cash-balance) | não — já agregado | ✅ em produção (Fase 09) |
| `dw_bet.fct_sigap_saldo_diario` | `saldo_jogadores` do balanço | `ClickHouseReadService` (cash-balance) | **sim** | ✅ em produção (Fase 09) |
| `dw_bet.fct_deposit` | lado `PLATFORM` da conciliação (depósitos) | `PlatformMovementsService` | **sim** | ⏳ Fase 11 (ainda não portado) |
| `dw_bet.fct_withdrawal` | lado `PLATFORM` da conciliação (saques) + ponte CPF→`client_id` | `PlatformMovementsService` | **sim** | ⏳ Fase 11 |
| `dw_bet.fct_correction` | busca de correção que explica pendência de saque | `CorrectionSearchService` | **sim** | ⏳ Fase 11 |

## 2 · Por que ClickHouse, e não Postgres

1. **O dado não é do domínio Finance.** Depósito, saque e saldo de jogadores são fatos da plataforma
   de apostas — vivem no pipeline analítico de outro time. Replicá-los no Postgres do módulo
   significaria o Finance se tornar dono de um pipeline de ingestão que já existe e é mantido por
   quem entende a fonte (SIGAP, gateways de pagamento). Isso é reconstruir infraestrutura, não usá-la.
2. **Perfil de consulta é analítico, não transacional.** São agregações por dia/marca sobre volume que
   cresce continuamente (`fct_kpi_daily` já vem pré-agregado; `fct_deposit`/`fct_withdrawal` são fatos
   granulares que alimentam varredura por janela de data). Esse é exatamente o caso de uso para o qual
   um column-store como ClickHouse existe — Postgres transacional pagaria caro por essas mesmas
   agregações em `numeric`.
3. **O módulo é consumidor, nunca fonte de verdade desses números.** Depósito e saque nunca são
   persistidos no Postgres do Finance como dado primário — são lidos do warehouse a cada request
   (`REGRAS-NEGOCIO-ROTAS.md` §3.1). Isso é proposital: duplicar esse dado no Postgres criaria uma
   segunda fonte que poderia divergir da que a plataforma realmente usa para decidir "o que foi
   aprovado".

## 3 · Regras de uso — negócio disfarçado de detalhe técnico

Quatro regras que, se ignoradas, produzem números **errados sem erro visível** (`DADOS-FINANCE.md` §10):

1. **`FINAL` é obrigatório** nos 4 *marts* `ReplacingMergeTree` (todos exceto `fct_kpi_daily`, que já
   vem agregado). Sem ele, uma linha ainda não deduplicada aparece duas vezes: no casamento da
   conciliação isso abre uma pendência que não existe; numa soma de correções, infla o valor.
2. **O instante que define "o dia" muda por fluxo.** Depósito usa `deposit_ts`; saque usa
   `transaction_date` (o `allow_ts` da *liberação*, não do *pedido*). Usar o campo errado abre
   diferença de caixa sem pendência para explicar — caso real documentado: R$ 5.755,00 na ULTRA, dois
   saques pedidos às 23:53 e liberados às 00:05 do dia seguinte.
3. **Nenhuma query filtra `source_system`.** Depósitos de canais diferentes (`bc`, `enigma`) caem na
   mesma conta bancária; filtrar por um deles abriria pendência falsa para o outro (conferido:
   875.242,18 + 11.982,00 = 887.224,18, exatamente o crédito do extrato do banco no dia).
4. **Toda data/marca/lista dinâmica entra via `query_params` nomeados — nunca interpolada na string da
   query.** É a defesa contra injeção nesse caminho, e é verificado estruturalmente em teste (grep no
   SQL literal).

Mais duas regras de arquitetura/operação:

5. **Normalização de marca é acoplamento vivo.** As queries fazem `multiIf(brand = 'suprema', ...)` no
   SQL e o serviço reconverte para minúsculas na volta — o mart guarda a marca capitalizada, o módulo
   trabalha com slug. Uma marca nova no catálogo exige tocar nessa expressão SQL; é o único ponto onde
   o catálogo de marcas em código e uma string em query precisam ser mantidos manualmente em sincronia.
6. **Assimetria deliberada entre leitura e escrita.** Falha do ClickHouse em rota de **leitura**
   (`summary`, `banks`, `history`) degrada silenciosamente — `available: false`, KPIs zerados, tela
   continua editável. Falha em rota de **escrita** (`register`, `corrections/apply`, `reconciliation/run`)
   é **503** — a escrita é rigorosa porque grava número em tabela que não se corrige com `UPDATE`; a
   leitura é tolerante porque tela travada é pior que tela incompleta.

## 4 · Readiness: por que ClickHouse **não** entra na probe

Decisão já fechada (`CLAUDE.md` item 2, `INFRA-FINANCE.md` §8): o `/health/readiness` do módulo
verifica **só Postgres**. Se verificasse ClickHouse também, uma indisponibilidade do warehouse — que é
de **outro time** — removeria os pods do balanceador e anularia a degradação projetada (a tela de
bancos continuar editável sem KPI). Indisponibilidade de dependência de terceiro nunca deve tirar o
serviço do ar.

## 5 · Precisa ser importado **agora**?

**Não, não nesta fase.** O estado atual da trilha é Fase 10 — persistência da conciliação
(`ReconciliationRunRepository`/`ReconciliationItemRepository`, só Postgres). O próprio
`REGRAS-NEGOCIO-ROTAS.md` (§ `GET /reconciliation` e `/history`) é explícito: essas rotas "**nunca
disparam varredura**... lê **só o Postgres** do módulo: nada de ClickHouse, nada de Trio." E
`reconciliation.module.ts` (o arquivo em edição nesta fase) hoje só importa `TypeOrmModule` — nenhuma
referência a `ClickHouseService`.

O `ClickHouseModule`/`ClickHouseService` (`src/clickhouse/`) **já existe desde a Fase 05** e **já está
em produção** para o balanço de caixa desde a Fase 09 (`ClickHouseReadService`, os 2 primeiros marts da
tabela acima). É `@Global()` — a Fase 11 (`PlatformMovementsService`, `CorrectionSearchService`) só
precisa *injetá-lo*, não recriar a conexão. Ou seja: a dependência de infraestrutura já está pronta; o
que falta é código de domínio específico da conciliação, que é exatamente o escopo já planejado para a
Fase 11, não da 10.

## 6 · E se for excluído do projeto?

### O que se perde

- **Os 6 cards de KPI** (depósito/saque do dia, mês e histórico) da tela de balanço deixam de existir
  — não há outra fonte para esse dado dentro do módulo.
- **`saldo_jogadores`** desaparece, e com ele o cálculo `totalBalanco = saldoTransacional −
  saldoJogadores` fica impossível — `POST /:brand/register` (fechamento do dia) **não pode mais
  funcionar**, porque a regra hoje exige esse valor (503 se ausente; sem ClickHouse, seria ausente
  sempre).
- **O módulo de Conciliação perde sua função central.** Sem `fct_deposit`/`fct_withdrawal` não existe
  lado `PLATFORM` para casar contra o lado `BANK` (Trio) — a Fase 11 em diante (13/14: casamento,
  correção de saldo) não tem mais o que fazer. Não é uma degradação parcial: é a funcionalidade
  principal da conciliação inteira.
- **A busca de correção de saldo** (evidência que explica uma pendência de saque, Fase 14) some junto —
  depende de `fct_correction`.

### O que se ganha

- **Uma dependência externa a menos**: sem egress para o cluster do warehouse, sem credencial de
  leitura concedida por outro time, sem risco de o serviço herdar indisponibilidade de um sistema que
  não controla.
- **Infra/CI mais simples**: menos 1 stub HTTP no `docker-compose.yml`/CI (`:8123`), menos 1 `Secret`
  (`CLICKHOUSE_PASSWORD`), menos 1 dependência de segurança a auditar (`@clickhouse/client`).
- **Menos acoplamento de manutenção**: a normalização de marca via string em SQL (item 3.5) some — um
  catálogo de marcas novo não precisaria mais tocar em SQL nenhum.
- **Superfície de teste menor**: menos mocks, menos specs de degradação (`available: false`,
  `503` condicional).

### Conclusão

Excluir o ClickHouse **não é uma opção de simplificação de infraestrutura** — é uma redução de escopo
de produto. Ele não é uma dependência acessória (como um cache opcional): é a **fonte primária** de 2
das 3 telas do módulo (balanço via KPI/saldo de jogadores; conciliação por completo). O ganho
operacional de removê-lo (menos infra, menos credencial) é real, mas pequeno comparado ao que se perde.
A recomendação implícita em toda a documentação já produzida (degradação deliberada em vez de remoção)
é a correta: **manter, e tratar a indisponibilidade dele como evento operacional monitorável — nunca
como motivo para excluir a integração.**

---

## Referências

- [`DADOS-FINANCE.md`](../DADOS-FINANCE.md) §10 — os 5 *marts*, as 4 regras de leitura, normalização de marca
- [`INFRA-FINANCE.md`](../INFRA-FINANCE.md) §4, §8, §10 — variáveis de ambiente, decisão de readiness, dependência externa
- [`REGRAS-NEGOCIO-ROTAS.md`](../REGRAS-NEGOCIO-ROTAS.md) — tabela de rotas × chamada externa, assimetria leitura/escrita
- [`fases/FASE-05.md`](../fases/FASE-05.md) — decisão da conexão única global
- [`fases/FASE-11.md`](../fases/FASE-11.md) — plano ainda não executado (lado `PLATFORM` da conciliação)
- Código: [`src/clickhouse/clickhouse.service.ts`](../../../src/clickhouse/clickhouse.service.ts),
  [`clickhouse.module.ts`](../../../src/clickhouse/clickhouse.module.ts),
  [`clickhouse-read.service.ts`](../../../src/modules/finance-cash-balance/infrastructure/clickhouse/clickhouse-read.service.ts)
