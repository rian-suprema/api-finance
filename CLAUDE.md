# CLAUDE.md — users-api

> Guia operacional para sessões de IA neste repositório. Detalhes completos do produto/arquitetura
> do archetype → [README.md](./README.md) · segurança/RLS → [SECURITY-README.md](./SECURITY-README.md) ·
> execução local → [LOCAL-EXECUTION-README.md](./LOCAL-EXECUTION-README.md) · CI/CD →
> [CI-CD.md](./CI-CD.md). Detalhes completos da migração do Finance →
> [docs/migracao-finance/](./docs/migracao-finance/) (dados, infra, regras de negócio).

## Stack

Node 22 · NestJS 11 · TypeScript strict · TypeORM → RDS Aurora PostgreSQL · Jest (unit colocalizado
`*.spec.ts` + e2e via Testcontainers em `test/*.e2e-spec.ts`) · Joi (`src/config/env.validation.ts`,
fail-fast) · ArchUnitTS (`src/architecture.spec.ts`) · OpenTelemetry (opt-in por env) · Helm + CI 5 jobs.

## Arquitetura

```
Controller (fino) → Service/Use-case → Repositório (único a tocar TypeORM) → PostgreSQL
```

Guards globais: `JwtAuthGuard` (RS256, chave pública da SayPlus) → `PermissionsGuard`
(deny-by-default, `@Permissions(...)`/`@Public()`). RLS por `tenant_id` no banco (Step 5,
`src/database/tenant-context.ts`) — ver divergência do Finance (marca, não tenant) abaixo.

## Princípios de código

SOLID por camada + nomenclatura descritiva. Controller nunca importa `typeorm`/`@nestjs/typeorm`.
Service nunca importa controller. `joi` só em `src/config/`. Toda rota declara `@Permissions(...)`
ou `@Public()` (gate de build, `architecture.spec.ts`). Migrations em SQL explícito,
`synchronize: false`. Chave primária `SERIAL` por padrão. Dinheiro é sempre `numeric`/`decimal` com
transformer — nunca `float`.

## Protocolo de decisão

Dúvida arquitetural ou inconsistência detectada durante uma fase: **PARAR**, apresentar **3 opções**
no chat, aguardar escolha explícita do usuário antes de prosseguir. Nunca inventar contrato, regra de
negócio ou decisão arquitetural para preencher uma lacuna.

## Estado atual — Migração do módulo Finance

Trilha em `feature/migracao-finance` — 17 fases, dashboard em
[docs/migracao-finance/fases/dashboard.html](./docs/migracao-finance/fases/dashboard.html), progresso em
[docs/migracao-finance/fases/progress.json](./docs/migracao-finance/fases/progress.json).

**Fase atual: 13 — Conciliação: use-cases núcleo + controller.**

| Fase | Nome | Status |
|---|---|---|
| 01 | Domínio puro — Conciliação + golden dataset | ✅ concluída |
| 02 | Domínio puro — Balanço de Caixa | ✅ concluída |
| 03 | Esqueleto não-funcional + allowlist + contrato de erro | ✅ concluída |
| 04 | Schema TypeORM — 8 entidades + migration inicial | ✅ concluída |
| 05 | Integração ClickHouse — conexão global | ✅ concluída |
| 06 | Integração Trio — client + adapter point-in-time | ✅ concluída |
| 07 | Persistência do Balanço de Caixa (repositórios + read-service) | ✅ concluída |
| 08 | Identidade da plataforma (/auth/me) + BrandAccessService | ✅ concluída |
| 09 | Balanço de Caixa — use-cases + services + controller | ✅ concluída |
| 10 | Persistência da Conciliação (repositório) | ✅ concluída |
| 11 | ClickHouse da Conciliação (movimentos + busca de correção) | ✅ concluída |
| 12 | Trio — movimentos por bisseção + regressão | ✅ concluída |
| 13 | Conciliação — use-cases núcleo + controller | pending |
| 14 | Conciliação — evidência de correção de saldo | pending |
| 15 | Jobs — CronJob Helm + crons + 5 CLIs + RLS no caminho job | pending |
| 16 | Contrato do archetype (prefixo/Swagger/health/decimal) | pending |
| 17 | Fechamento — e2e completo, quality gates, cutover | pending |

### Decisões já fechadas para esta trilha (não reabrir sem novo ADR)

1. **Contrato de erro:** `GlobalExceptionFilter` será estendido para preservar campos extras do
   payload da exceção (ex.: `pendingBanks`) além de `{code, message}` — decisão da Fase 03.
2. **Readiness:** verifica só PostgreSQL. ClickHouse/Trio **não entram** no readiness — o módulo
   degrada de propósito quando eles caem (tela de balanço continua editável sem KPI); indisponibilidade
   de dependência de outro time nunca deve remover o pod do tráfego.
3. **Crons:** **nunca portamos `@nestjs/schedule`/`@Cron` in-process.** A execução agendada é só
   **CronJob do Kubernetes** invocando os CLIs (`reconcile`, `trio:capture` — Fase 15) — evita, por
   construção, a duplicação de trabalho contra a Trio que `@Cron` in-process teria com
   `replicaCount: 2`.
4. **PK das 8 tabelas novas:** `SERIAL` (regra 7 do archetype), não UUID. Nenhuma garantia de negócio
   depende do tipo — todo upsert é por chave natural (`reference_date`+`brand`, etc.).
5. **Marca ≠ tenant:** as tabelas do Finance **não** usam a RLS de tenant único do esqueleto — o
   isolamento por marca (até 3 simultâneas por request) vive inteiramente na camada de aplicação
   (`BrandAccessService`), sem RLS nenhuma nas tabelas do Finance. A ideia original (RLS com o slug
   da marca como GUC, só no caminho job) foi **reavaliada na Fase 15** e descartada: com `FORCE ROW
   LEVEL SECURITY` ativo, toda leitura/escrita sem o GUC setado — inclusive as 14 rotas HTTP, que não
   usam GUC nenhum — passaria a ver zero linhas. A defesa em profundidade do caminho job (jobs/CLIs
   sem guard nenhum hoje) é uma asserção de aplicação (`assertKnownBrand`), não RLS — ver Fase 15.
6. **`TRIO_AMOUNT_DIVISOR` = 100 (centavos)** — ✅ confirmado pelo usuário na PARADA HUMANA da Fase 06
   (2026-09-01), alinhado com a documentação do cliente Trio. Registrado em `INFRA-FINANCE.md` §4.2 e
   `REGRAS-NEGOCIO-ROTAS.md`. `.env`/`.env.example` locais atualizados; o Secret/ConfigMap real de
   homologação/produção está fora do alcance desta sessão.
7. **Fail-fast em tudo, sem exceção — convenção consolidada na Fase 03:** nenhuma das 14 variáveis
   novas do Finance tem default de valor perigoso no Joi. Em particular `TRIO_AMOUNT_DIVISOR` é
   `.required()` (`Joi.number().valid(1, 100)`), nunca `.default(1)` — mesmo já validado como "ambíguo,
   PARADA HUMANA" no item 6, o boot cai sem ela em vez de assumir silenciosamente. Vale para toda
   variável nova das Fases 04–17: default só quando o valor for inócuo (ex.: `CLICKHOUSE_DATABASE`),
   nunca quando errar o valor custa 100× o valor real.
8. **`match_key` padronizado como `snake_case` — convenção consolidada na Fase 04.** A origem tinha
   `reconciliation_runs."matchKey"` sem `@map` (pegadinha real, `DADOS-FINANCE.md` §2.1); nesta
   trilha a coluna nasce `match_key` desde o início. Vale como padrão para qualquer coluna nova: nome
   de coluna é sempre `snake_case` explícito via `name:`, sem excecão "porque a origem fez diferente".
9. **ADR-FINANCE-3 — `haveNoCycles()` não distingue `import type` de import de valor
   (`architecture.spec.ts`, Fase 04):** as 2 pastas `entities/` do Finance
   (`finance-cash-balance/entities/**`, `finance-reconciliation/entities/**`) ficam de fora do escopo
   da regra geral de ciclos, porque o TypeORM exige relação bidirecional real
   (`@OneToMany`+`@ManyToOne`) entre `CashBalanceDay↔CashBalanceDaily` e
   `ReconciliationRun↔ReconciliationItem`, o que sempre cria um ciclo de ARQUIVO (mesmo quando um dos
   lados importa a classe irmã só como tipo). Duas regras adicionais garantem que o lado "pai" nunca
   importa a classe "filha" como valor (só `import type`) — o ciclo real de valor continua proibido.
   Decisão do usuário entre 3 opções (as outras eram remover as relações inversas, ou tipar sem
   importar a classe irmã). Se um par de entidades novo (Fases 07+) tiver o mesmo padrão bidirecional,
   este é o precedente a seguir — adicionar a pasta à exclusão + as 2 regras de `import type`, não
   inventar uma solução nova.
10. **Auditoria automática via `AuditInterceptor` por módulo, não global — decisão da Fase 09.**
    `finance_audit_logs` (entidade desde a Fase 04) é exclusiva do Finance; o interceptor é registrado
    como provider em `cash-balance.module.ts` e aplicado via `@UseInterceptors(AuditInterceptor)` no
    controller — nunca em `main.ts`/`app.module.ts` (isso auditaria também as rotas do módulo
    `[EXEMPLO]`/petshop na mesma tabela). A Fase 13 (Conciliação) precisa decidir como reusar a mesma
    classe para suas rotas de mutação (hoje ela só resolve `FinanceAuditLog` via
    `TypeOrmModule.forFeature` do `cash-balance.module.ts`).
11. **`registerBrand` lê os saldos manuais confirmados sob `SELECT ... FOR UPDATE`, dentro da própria
    transação de escrita — decisão da Fase 09, corrigindo uma race condition real encontrada pelo
    `/code-review`.** `CashBalanceRepository.registerBrand` (Fase 07) mudou de assinatura:
    `registerBrand(params, resolveManualBalances)` — o callback (`extractManualBalances`, no use-case)
    só é chamado depois de `lockBankEntries` travar as linhas de `cash_balance_bank_entries` do
    `daily`, nunca antes da transação. Qualquer escrita nova que combine "ler um agregado confirmado
    por fora" + "escrever um snapshot calculado a partir dele" precisa do mesmo padrão (ler sob lock,
    dentro da mesma transação da escrita) — ler fora e só depois abrir a transação de escrita é
    exatamente a classe de bug (*lost update*) que este padrão fecha.
12. **`ReconciliationModule` importa `CashBalanceModule` para reusar `TrioBankingClient` — decisão da
    Fase 12, primeira dependência real entre os 2 módulos de negócio do Finance.** `TrioBankingClient`
    (cliente da bisseção, Fase 06) foi adicionado a `providers`+`exports` de `cash-balance.module.ts`
    (não estava em nenhum dos dois antes — nenhum use-case do balanço de caixa precisava injetá-lo
    diretamente até aqui). `reconciliation.module.ts` importa `CashBalanceModule` nos `imports` e usa a
    classe exportada — nunca duplica o cliente Trio nem a lógica de bisseção. Precedente: qualquer
    reuso futuro entre os dois módulos de negócio segue o mesmo padrão (provider exportado + módulo
    importado), nunca import direto de arquivo interno do outro módulo (entidade, repositório,
    use-case) — só de uma classe que o `exports:` do módulo alvo declara explicitamente.

## Aprendizados críticos

- **Fase 01:** Jest 30 não imprime mais nomes de teste que passaram no reporter `--verbose` (só
  detalha testes que falham) — qualquer script de teste orgânico que faça `grep` na saída
  `--verbose` esperando nomes de cenário precisa usar `--json` + `jq` (`testResults[].assertionResults[].fullName`)
  em vez disso. Ver `scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.sh`.
- **Fase 01:** os artefatos de planejamento (os 17 `FASE-*.md`, este `CLAUDE.md` e
  `scripts/update-phase-cost.js`) referenciavam `docs/backend/fases/` — diretório que nunca existiu.
  Os artefatos reais sempre estiveram em `docs/migracao-finance/fases/`. Corrigido nos 19 arquivos
  na Fase 01; se algum documento novo copiar o padrão antigo, o path certo é
  `docs/migracao-finance/fases/`.
- **Fase 01:** `BrandKey` (tipo definido em `cash-balance.constants.ts`, só criado na Fase 07) foi
  removido do escopo do `reconciliation.types.ts` portado nesta fase — só os tipos efetivamente
  exercitados pelo domínio testado (`Movement`, `SettledMovement`, `SideTotals`, `FlowMatch`,
  `RunTotals`, `CorrectionConfidence`) foram portados agora. As views que dependem de `BrandKey`
  (`ReconciliationBrandView`, `ReconciliationHistoryView`, `RunOutcome`, `CorrectionApplyView`,
  `CorrectionSearchView`) devem ser portadas só quando a fase que as consome (13/14) rodar, quando
  `BrandKey` já existir.
- **Fase 02:** `scripts/update-phase-cost.js` recalcula `totalCostUsd`/`projectedTotalCostUsd`/
  `summary.completed`/`summary.pending`, mas **não** recalcula `summary.percentComplete` nem
  `summary.hoursCompleted`/`hoursRemaining` — ficam presos no valor anterior se não forem ajustados
  à mão. O comentário no topo do arquivo pede para não editar a lógica compartilhada (fonte única no
  skill `criar-fase`), então o ajuste é manual a cada fase: `percentComplete = completed/17*100` e
  `hoursCompleted = soma de estimatedHours das fases completed` (não há tracking de `actualHours`
  real). Repetir esse ajuste manual nas fases 03–17.
- **Fase 02:** o mesmo padrão de tipo provisório da Fase 01 (`BrandKey`) se repetiu — `BrandKey` e
  `BankType` foram declarados localmente em `cash-balance.types.ts` (`BrandKey = string`) em vez de
  importados de `cash-balance.constants.ts`, que só existe na Fase 07. `buildKpiCard` usa a própria
  chave da marca como `label` (sem lookup em `BRANDS`) até lá.
- **Fase 03:** o script orgânico do próprio `FASE-03.md` tinha o mesmo defeito documentado na Fase 01
  (`grep` na saída `--verbose` do Jest 30, que não lista testes que passaram) — o template da fase não
  herdou a correção já registrada. Corrigido para `--json` + `jq` no
  `scripts/esqueleto-financeiro/FASE-03-TESTE-ORGANICO.sh`; qualquer novo script orgânico deve nascer
  já usando esse padrão, não copiar o texto literal do `FASE-*.md` sem revisar.
- **Fase 03:** Jest 30 também renomeou a flag de filtro de suíte: `--testPathPattern` (citada nos
  comandos de regressão dos `FASE-*.md`) não existe mais — é `--testPathPatterns`. Mesma família do
  problema do `--verbose`; usar a flag nova em qualquer comando de regressão futuro.
- **Fase 03:** a regra `sonarjs/todo-tag` do ESLint dá falso positivo em comentários em português que
  usam a palavra "Todo"/"todo" como pronome ("todo o módulo", "todo valor monetário") — o linter casa
  com o token em inglês `TODO` case-insensitive. Ao portar comentários literalmente da origem
  (`date.util.ts`, `env.validation.ts`), reescrever a frase preservando o sentido em vez de suprimir a
  regra.
- **Fase 03:** 15 erros de `npm run lint` já existiam em código das Fases 01/02
  (`finance-cash-balance/domain/**`, `finance-reconciliation/domain/**`) antes desta fase — nenhum
  arquivo tocado pela Fase 03 tem erro de lint. Ficam registrados aqui como débito conhecido, não
  corrigido (fora do escopo desta fase); decisão do usuário sobre quando limpar.
- **Fase 03:** `scripts/finance-dev-stubs.js` e `src/common/utils/{date,tax-number}.util.ts` foram
  portados literalmente de `/home/feh/sayplus-modules/finance` (`finance-api` + `scripts/dev-stubs.js`
  da origem, presentes no disco local) — não havia cópia desses arquivos dentro deste repositório
  antes da Fase 03.
- **Fase 04:** o script orgânico do próprio `FASE-04.md` tinha um bug de contagem de tabelas —
  `table_name LIKE '%cash_balance%' OR ... OR table_name = 'finance_audit_logs'` sem parênteses
  (precedência `AND`/`OR` errada) e o padrão `%cash_balance%` não cobre `trio_closing_balances`,
  então a contagem real dava 7, nunca 8. Corrigido para uma lista `IN (...)` com os 8 nomes exatos.
  Mesma categoria de defeito já visto em scripts orgânicos anteriores — o template de um `FASE-*.md`
  não é confiável sem rodar contra a implementação real.
- **Fase 04:** não existia `.env` no checkout (só `.env.example`/`.env.test`) — `npm run
  migration:run` só funciona com `.env` real (`data-source.ts` carrega `.env` quando `NODE_ENV !==
  'test'`). Criado localmente via `cp .env.example .env` (gitignorado). Qualquer fase futura que
  precise rodar migration precisa desse `.env` local.
- **Fase 04:** entidades TypeORM com relação bidirecional real entre arquivos-irmãos colidem com
  `haveNoCycles()` do `architecture.spec.ts`, porque a regra não distingue `import type` de import de
  valor. Ver decisão 9 (ADR-FINANCE-3) acima — é o precedente para qualquer par de entidades novo com
  o mesmo padrão.
- **Fase 04:** enums de coluna (`CashBalanceDayStatus` etc.) não podem morar dentro de `entities/` —
  a regra "entities/ só contém `*.entity.ts`" (já existente, não é do Finance) rejeita qualquer outro
  arquivo ali. Ficam na raiz do módulo (`cash-balance.enums.ts`, `reconciliation.enums.ts`).
- **Fase 04:** `up()` de uma migration com muitas tabelas bate no limite de 80 linhas por função do
  ESLint (`max-lines-per-function`) — não há exceção para migrations no `eslint.config.mjs` (só para
  `*.spec.ts`/`test/**`). Resolvido dividindo `up()` em métodos privados por sub-domínio, mantendo
  uma migration/classe só (a decisão de "migration única" é sobre o arquivo, não sobre o tamanho da
  função).
- **Fase 04:** `sonarjs/todo-tag` deu falso positivo de novo (mesma causa da Fase 03: "todo" como
  pronome em português, ex. "cada upsert" tinha sido escrito como "todo upsert").
- **Fase 04:** a seção "Validação no banco" do `FASE-04.md` cita "as 3 FKs" mas o próprio texto de
  `cash-balance-brand-snapshot.entity.ts` (mesma fase) e `DADOS-FINANCE.md` §3.4 exigem uma 4ª FK
  (`cash_balance_brand_snapshots.daily_id → cash_balance_daily.id`, 1:1). Implementada como FK real —
  a contagem "3" no texto de validação é omissão, não decisão de excluir. Mesma categoria do
  "8 permissões" vs. 7 reais da Fase 03: quando a prosa de um `FASE-*.md` diverge do código
  explicitamente especificado na mesma fase, o código vale.
- **Fase 05:** `stat(1)` (`Birth`) não é evidência confiável de ordem histórica de criação de arquivo
  nesta sessão — a ferramenta de edição usada aqui grava via temp-file+rename, o que reseta
  Birth/Change do inode a cada edição subsequente. Um arquivo editado depois de escrito pela primeira
  vez passa a mostrar `Birth` igual ao horário da ÚLTIMA edição, não da criação original; comparar
  `Birth` entre dois arquivos com históricos de edição diferentes pode inverter a ordem real dos
  eventos. Uma verificação adversarial baseada nisso reprovou (incorretamente) o critério "RED antes
  da implementação" da Fase 05. Resolvido com evidência decisiva e reproduzível: mover a pasta
  implementada para fora do repositório, reexecutar o script confirmando falha real, restaurar e
  confirmar sucesso real — não depende de metadado de filesystem. Se uma verificação adversarial
  futura citar timestamp de arquivo como prova de ordem, preferir esse tipo de teste decisivo a
  confiar em `stat`.
- **Fase 05:** Jest 30 com Nest `Logger` ativo contamina `--json` no stdout — o `Logger.warn`/`error`
  do NestJS escreve no mesmo stdout que o `--json` do Jest, produzindo um blob não-parseável por
  `jq` mesmo redirecionando stderr. Correção: `--json --outputFile=<tmp>` (grava o relatório limpo em
  arquivo, ignora o que for escrito em stdout) em vez de capturar `--json` da saída padrão. Mesma
  categoria do gotcha `--verbose` da Fase 01 — qualquer script orgânico futuro que precise do
  relatório JSON do Jest deve usar `--outputFile`, nunca capturar stdout diretamente quando o código
  sob teste usa `Logger`/`console`.
- **Fase 06:** testar o teto `REQUEST_BUDGET` (20.000) da bisseção da Trio exige um mock de
  `has_more` condicionado ao tamanho real da janela (comparação lexicográfica dos timestamps ISO de
  largura fixa, que reflete ordem cronológica) — um mock "sempre `true`" incondicional nunca atinge o
  teto: a varredura usa uma pilha (LIFO), então sempre desce pelo galho mais à esquerda até
  `start === end`, batendo no erro de "janela indivisível" em poucas iterações (profundidade
  `log2(tamanho)`), nunca no teto de requisições. Só uma janela onde `has_more` depende do tamanho de
  cada nó (verdadeiro sempre que o nó > 1) produz exploração ampla o bastante (árvore binária
  completa) para ultrapassar 20.000 chamadas. Qualquer teste futuro de teto de requisições em
  bisseção precisa desse padrão, não de um mock incondicional.
- **Fase 06:** `accountIdFor()`/`BrandKey` adaptados para usar o que já existe no destino em vez do
  catálogo `BRANDS` da origem (só chega na Fase 07) — `accountIdFor` lê direto de
  `trioConfig.accountIds`, e `BrandKey` foi importado de `cash-balance.types.ts` (existente desde a
  Fase 02) em vez de redeclarado localmente, como o texto do `FASE-06.md` sugeria. Mesma categoria do
  padrão provisório já registrado nas Fases 01/02: preferir o tipo/valor já existente no destino a
  duplicar.
- **Fase 06:** `@typescript-eslint/unbound-method` dispara em `expect(objeto.metodo)` sempre que o
  método é declarado com sintaxe de método (não `propriedade: () => T`) no `.d.ts` da lib — caso de
  `axios.create`. Extrair para uma `const` antes do `expect` não resolve (a regra ainda vê a leitura
  desacoplada na atribuição); a correção é `jest.spyOn(objeto, 'metodo')`, que não dispara a regra
  porque o nome do método é passado como string, não como acesso de propriedade.
- **Fase 07:** confirmado empiricamente contra Postgres real (script descartável, não suposição):
  coluna `type: 'date'` do TypeORM/`pg` volta como `string` `'YYYY-MM-DD'`, nunca `Date` — diferente
  da origem em Prisma, que exigia `toDateOnly`/`fromDateOnly` em toda borda. `reference_date` trafega
  como string do início ao fim em `cash-balance.repository.ts`, sem conversão. Vale para qualquer
  coluna `date` nova nas fases seguintes.
- **Fase 07:** `cash-balance.repository.ts` bateu no `max-lines` (400) do ESLint com os 13 métodos
  literais da origem — dividido em 3 arquivos por responsabilidade, não por tamanho arbitrário:
  `cash-balance.repository.ts` (API pública da classe, injetável), `cash-balance.repository-reads.ts`
  (leituras puras, funções livres recebendo `DataSource`), `cash-balance.repository-upserts.ts`
  (upserts elementares, funções livres recebendo o `EntityManager` transacional). Precedente para
  qualquer repositório novo que se aproxime do limite: extrair por responsabilidade (leitura/escrita
  elementar) antes de simplesmente cortar comentários.
- **Fase 07:** `trioAccountEnvKey` do `BrandConfig` da origem não foi portado — ficaria sem nenhum
  consumidor real, já que `TrioBankingClient.accountIdFor()` (Fase 06) já lê `trioConfig.accountIds`
  direto pela própria `BrandKey`, sem precisar do nome da variável de ambiente.
- **Fase 07:** o texto do `FASE-07.md` citava só 2 arquivos (`closing-balance-source.port.ts`,
  `kpi-card.util.ts`) para ajustar o import provisório de `BrandKey` — na prática eram 4 (os outros 2,
  `trio-banking.client.ts` e `trio-point-in-time-balance.source.ts`, da Fase 06, tinham o mesmo
  problema). Mesma categoria de omissão de prosa já vista nas Fases 03/04: quando o `FASE-*.md` lista
  uma correção, verificar por `grep` todos os sites reais antes de assumir que a lista está completa.
- **Fase 07:** processo — a implementação desta fase foi escrita antes do script de teste orgânico
  (falha do processo RED-antes-da-implementação, mesma categoria da Fase 05). Corrigido com o mesmo
  teste decisivo: mover os arquivos novos para fora do repositório, reexecutar o script confirmando
  falha real, restaurar e reconfirmar GREEN. RED genuíno e verificável, embora fora de ordem — mas o
  objetivo é não repetir a inversão de ordem numa fase futura, não só saber corrigi-la depois.
- **Fase 08:** o texto do "Pré-requisito" do próprio `FASE-08.md` especulava que a regra de allowlist
  de `axios` em `architecture.spec.ts` cobria só `infrastructure/trio` e precisaria de ajuste antes da
  fase — o Pre-flight com Haiku confirmou que a regra já incluía `infrastructure/platform/**` desde a
  Fase 03. Mesma categoria de prosa desatualizada já vista nas Fases 03/04/07: o Pre-flight existe
  exatamente para evitar uma correção desnecessária baseada em suposição do template.
- **Fase 08:** primeira Verificação Adversarial de Aceite reprovou por teste tautológico — nenhum
  teste em `platform-identity.service.spec.ts` fazia asserção sobre o **conteúdo** do mapeamento
  `tenant.slug → brand.key` (`BRANDS.flatMap`), só contagem de chamadas HTTP e tipo de exceção; o
  teste equivalente em `brand-access.service.spec.ts` passaria mesmo com o mapeamento quebrado, porque
  o mock de `PlatformIdentityService` já injetava o resultado pós-mapeamento (`BrandAccessService.
  resolveBrands` é um passthrough sem lógica própria). Corrigido com um teste novo que mocka 2 tenants
  (1 válido + 1 sem correspondência no catálogo) e verifica o array exato devolvido. Qualquer teste de
  um service que só repassa (passthrough) o retorno de outro precisa deixar explícito no nome do teste
  que cobre repasse, não a lógica de quem produz o dado — a cobertura real do comportamento fica no
  arquivo que a implementa.
- **Fase 09:** `finance_audit_logs` (auditoria automática, §1.6 de `REGRAS-NEGOCIO-ROTAS.md`) não
  estava no escopo de nenhum `FASE-*.md` até esta fase, embora a entidade existisse desde a Fase 04
  com o comentário explícito "extraídos da URL pelo interceptor de auditoria (Fase futura)". Detectado
  como inconsistência real (não suposição) entre o plano da fase e as regras transversais — protocolo
  de decisão (3 opções), usuário escolheu implementar o `AuditInterceptor` agora. Ver decisão 10.
- **Fase 09:** `@AuthToken()` decorator não existia no destino (a origem tinha; nenhum `FASE-*.md`
  listava esse arquivo) — criado em `src/auth/auth-token.decorator.ts`, mesmo padrão de
  `current-user.decorator.ts`. Qualquer rota futura que precise repassar o Bearer bruto a uma
  integração externa (não o payload decodificado) usa este decorator, não reinventa a extração.
- **Fase 09:** escalonamento com `/code-review` (exigido pelo `FASE-09.md` por a fase tocar
  permissões/isolamento por marca) encontrou 4 achados reais de uma revisão que, à primeira vista,
  "passava todos os testes" — reforça que testes verdes não substituem revisão adversarial dedicada
  em fases de alto risco. O mais grave: `RegisterBrandUseCase` lia saldos confirmados fora de qualquer
  transação/lock antes de escrever, permitindo *lost update* contra uma confirmação concorrente. Ver
  decisão 11 — qualquer combinação futura de "ler agregado confirmado por fora + escrever snapshot
  calculado dele" precisa nascer com o mesmo padrão de lock, não como capítulo de correção posterior.
- **Fase 09:** o primeiro teste escrito para a race condition (`Promise.all` entre duas chamadas de
  repositório completas, comparando o valor final persistido) **não era decisivo** — removendo o
  `.setLock('pessimistic_write')` da produção, o mesmo teste continuou passando 5/5 execuções seguidas
  (coincidência de agendamento do Node/driver, as duas operações completas nunca chegavam a contender
  de fato pelo lock). Mesma categoria de falso positivo de verificação já registrada nas Fases 05/07 —
  a correção foi reescrever com controle explícito de transação (`QueryRunner` mantendo a trava aberta
  de propósito, forçando a escrita concorrente a bloquear de verdade por um tempo mensurável antes de
  liberar). Testar lock/concorrência real em Postgres via Testcontainers exige esse padrão — nunca só
  `Promise.all` de chamadas de alto nível, que terminam rápido demais para gerar contenção genuína.
- **Fase 10:** bug real confirmado empiricamente contra Postgres real (não suposição):
  `useDefineForClassFields` (tsconfig) faz `repo.create({...})` do TypeORM gravar `undefined` como
  propriedade própria em toda coluna não informada no objeto passado — e o `decimalTransformer`
  converte esse `undefined` em `NULL` explícito no `INSERT`, ignorando o `default: 0`/`default: false`
  da coluna e violando `NOT NULL`. Afetou `startRun` (as 16 colunas de totais + 2 contagens de
  `ReconciliationRun`) e `platformReprocessPending` de `ReconciliationItem`. Corrigido zerando
  explicitamente (`ZERO_TOTALS` em `reconciliation-run.repository.ts`) em vez de confiar no default do
  banco — o mesmo padrão já existia em `upsertDaily` (Fase 07) mas nunca tinha sido nomeado como regra
  geral: **qualquer coluna com `default` no Postgres precisa de valor explícito em `repo.create()`**,
  porque o default do banco só se aplica quando a coluna está ausente do `INSERT`, e `create()` nunca a
  omite quando a classe tem a propriedade declarada.
- **Fase 10:** segundo bug real, mesma causa-raiz de classe diferente: `dataSource.query()` (raw SQL)
  não passa pelo transform de coluna do TypeORM — só `repo.find()`/`QueryBuilder` devolvem `date` como
  `string` `YYYY-MM-DD` (achado empírico da Fase 07); o driver `pg` puro devolve `Date` para o OID
  `date`. `countItemsInRange` quebrava a chave `dia|marca` (`${row.reference_date}|${row.brand}`) por
  isso — corrigido com `reference_date::text AS reference_date` no `SELECT`. Qualquer raw query futura
  que agrupe ou devolva uma coluna `date` como parte de uma chave/comparação precisa do mesmo cast —
  `fromDateOnly`/normalização em JS não bastaria sozinha, o cast no SQL é a correção mais direta.
- **Fase 10:** o mesmo defeito de script orgânico já documentado nas Fases 01/03/05/08 (Jest 30 não
  lista nomes de teste que passaram no reporter `--verbose`, só detalha falhas) apareceu de novo no
  próprio texto do `FASE-10.md` — o bloco de script fornecido literalmente na especificação da fase
  ainda usava `--verbose` + `grep` na saída. Corrigido para `--json --outputFile=<tmp>` +
  `jq -r '.testResults[].assertionResults[].fullName'` antes de considerar RED/GREEN confiável. Quinta
  ocorrência do mesmo gotcha copiado de um template desatualizado — vale revisar todo `FASE-*.md`
  restante (11-17) por esse padrão antes de rodar o script literal fornecido nele.
- **Fase 10:** `brand`/`bank` ficam tipados como `string` nos 2 repositórios novos, não `BrandKey` —
  `BrandKey` só existe em `cash-balance.constants.ts` (módulo `finance-cash-balance`), e a decisão 10
  deste documento proíbe import direto de arquivo de outro módulo (só via service exportado). A coluna
  da entidade já é `varchar`, então não há perda de garantia no banco; a validação contra o catálogo de
  marcas conhecidas (`BRANDS`) fica para o use-case da Fase 13, via `BrandAccessService` — mesmo padrão
  provisório já registrado nas Fases 01/02/06 para tipos que só existem de verdade numa fase posterior.
- **Fase 11:** `platform-movements.service.ts`/`correction-search.service.ts` portados literalmente da
  origem — a normalização de marca via `multiIf(brand = 'suprema', 'Suprema', ...)` citada em
  `DADOS-FINANCE.md` §10 pertence a `fct_kpi_daily`/`fct_sigap_saldo_diario` (lidos por
  `ClickHouseReadService` do `finance-cash-balance`, Fase 07), que agrupam por marca — não às 5 queries
  desta fase, que filtram `brand = {marca:String}`/`toString(client_id)` diretamente e nunca agrupam.
  Nenhuma inconsistência real: a nota de §10 é genérica ao mart, não a esta fase especificamente.
- **Fase 11:** o script orgânico literal do próprio `FASE-11.md` tinha `grep -n "source_system" ...`
  sem excluir comentários — casava com o JSDoc que **explica** por que `source_system` não é
  filtrado (a prosa cita a palavra "source_system" ao justificar a ausência do filtro). Mesma
  categoria de defeito de template já documentada nas Fases 01/03/04/05/08/10 (o script fornecido no
  `FASE-*.md` não é confiável sem rodar contra a implementação real) — corrigido restringindo o grep
  às linhas fora de comentário (`grep -v '^\s*[0-9]*: \?\*'`). O mesmo `grep` puro em código-fonte sem
  filtrar comentário pode dar falso positivo sempre que a decisão de *não* fazer algo for documentada
  citando o nome do próprio filtro evitado.
- **Fase 11:** aplicado preventivamente o fix do Jest 30 (`--json --outputFile` + `jq` em vez de
  `--verbose` + `grep`, já documentado nas Fases 01/03/05/08/10) ao escrever o script orgânico desta
  fase, sem esperar o script literal do `FASE-11.md` falhar primeiro — mostra que vale revisar todo
  `FASE-*.md` restante (12-17) por esse padrão antes de rodar o bloco de script fornecido nele.
- **Fase 12:** o Pre-flight (Haiku) confirmou um bloqueio real além do que o próprio `FASE-12.md`
  já antecipava: `TrioBankingClient` não estava nem em `providers` nem em `exports` de
  `cash-balance.module.ts` (nenhum use-case do balanço de caixa precisava injetá-lo diretamente até
  esta fase — só `TrioPointInTimeBalanceSource`, que também não é provider de nenhum módulo ainda,
  fica para a Fase 15/CronJob). Resolvido com a opção (a) já recomendada no próprio plano: adicionar
  `TrioBankingClient` a `providers`+`exports`. Ver decisão 12.
- **Fase 12:** a mesma invariante de sessão (Haiku, sobre import cruzado entre módulos) encontrou uma
  violação real deixada pela Fase 10: `reconciliation-run.repository.spec.ts`/
  `reconciliation-item.repository.spec.ts` importavam as 6 entidades de
  `finance-cash-balance/entities/**` só para popular o array `entities: [...]` do `DataSource` de
  teste (Testcontainers) — nenhuma é usada de fato, porque a migration `FinanceInitialSchema` é SQL
  explícito (`queryRunner.query`), não depende de metadata de entidade nenhuma para rodar. Corrigido
  restringindo `entities: [...]` às 2 entidades do próprio módulo (`ReconciliationRun`,
  `ReconciliationItem`). Precedente para qualquer spec futuro com Testcontainers cobrindo uma
  migration compartilhada entre módulos: registrar só as entidades que o teste efetivamente toca,
  nunca copiar a lista inteira de outro módulo por conveniência/cópia do padrão de um spec vizinho.
- **Fase 12:** `TrioMovementsService.accountIdFor` precisa repassar `brand: string` (decisão das Fases
  10/11) para `TrioBankingClient.accountIdFor(brand: BrandKey)`, que exige o tipo mais estrito —
  resolvido com cast estrutural (`brand as Parameters<TrioBankingClient['accountIdFor']>[0]`) em vez
  de importar o tipo `BrandKey` de `cash-balance.constants` só para o cast. Vale como padrão sempre
  que uma chamada cruzada de módulo precisar de um tipo mais estrito do lado importado: preferir
  derivar o tipo estruturalmente da própria assinatura da função a importar o tipo nominal.

## Convenções de teste

- Unitário: colocalizado, `*.spec.ts`, `npm test`.
- E2E: `test/*.e2e-spec.ts`, Testcontainers (Postgres efêmero real — sem mock de infra), `npm run test:e2e`.
- Domínio puro (sem NestJS/HTTP/DB): teste unitário direto contra as funções, sem DI.
- Golden dataset da conciliação (Maxima, 2026-08-15) é o oráculo dos testes de integração — não altera
  entre fases; se algum teste precisar mudá-lo, é sinal de que a tradução mudou comportamento.
- Autenticação em teste: `test/auth-helper.ts` (`setupTestAuth()` gera par RS256 efêmero e assina
  tokens `sign({ permissions, tenantId })`).

## Comandos essenciais

```bash
npm run lint && npm test && npm run test:e2e && npm run build   # gates locais = gates do CI
npm run auth:keys && npm run auth:token                          # par RS256 + bearer de dev
npm run migration:run                                            # aplica migrations pendentes
docker compose up -d                                              # Postgres local
```
