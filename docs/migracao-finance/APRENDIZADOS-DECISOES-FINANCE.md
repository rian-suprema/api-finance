# Aprendizados e decisões — Migração Finance (histórico completo, 17 fases)

> Arquivo criado na Fase 17 (fechamento) para tirar do `CLAUDE.md` o detalhe fase a fase que só
> importa como HISTÓRICO — o `CLAUDE.md` ficou com a versão consolidada (`## Convenções consolidadas
> — Migração Finance`), que é o que qualquer sessão futura precisa carregar por padrão. Este arquivo
> é a referência completa por trás de cada item consolidado.

## Decisões já fechadas para esta trilha (não reabrir sem novo ADR)

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
   `REGRAS-NEGOCIO-ROTAS.md`. `.env`/`.env.example`/`.env.test`/`.env.docker` locais atualizados; o
   Secret/ConfigMap real de homologação/produção está fora do alcance desta sessão.
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
   importar a classe irmã). Se um par de entidades novo tiver o mesmo padrão bidirecional, este é o
   precedente a seguir — adicionar a pasta à exclusão + as 2 regras de `import type`, não inventar
   uma solução nova.
   **Débito conhecido (achado no `/code-review` da Fase 17, convergido por 2 ângulos
   independentes):** a garantia "nenhuma relação desta pasta tem ciclo real de valor" só é
   verdadeira — e só é testada — para os 2 pares citados. `CashBalanceDaily↔CashBalanceBankEntry` e
   `CashBalanceDaily↔CashBalanceBrandSnapshot` (mesma pasta excluída) usam o alvo por ARROW FUNCTION
   padrão do TypeORM (`@OneToMany(() => Classe, ...)`), não por STRING como o par Day/Daily — isso
   exige import de VALOR dos dois lados, logo é um ciclo de valor real, sem teste compensatório.
   Seguro hoje (todas as classes carregam antes de `DataSource.initialize()` resolver a metadata,
   sem acesso circular-em-tempo-de-import), mas qualquer entidade nova nesta pasta fica sem proteção
   de ciclo nenhuma. Comentário de `architecture.spec.ts` corrigido para não generalizar demais; não
   corrigido (mudar o alvo para string exigiria alterar entidades centrais de dinheiro na última
   fase) — fica como ADR pendente se algum dia importar corrigir isso.
10. **Auditoria automática via `AuditInterceptor` por módulo, não global — decisão da Fase 09.**
    `finance_audit_logs` (entidade desde a Fase 04) é exclusiva do Finance; o interceptor é registrado
    como provider em `cash-balance.module.ts` e aplicado via `@UseInterceptors(AuditInterceptor)` no
    controller — nunca em `main.ts`/`app.module.ts` (isso auditaria também as rotas do módulo
    `[EXEMPLO]`/petshop na mesma tabela). Reusado pela Conciliação (Fase 13) reexportando o próprio
    `TypeOrmModule` (não um token específico) de `cash-balance.module.ts` — `@UseInterceptors(Classe)`
    resolve as dependências do enhancer no container do módulo que **declara o controller**, não no
    módulo de origem da classe (descoberta empírica: `UnknownDependenciesException` sem esse ajuste).
    Precedente: qualquer enhancer que dependa de um repositório TypeORM de outro módulo precisa desse
    padrão — exportar só a classe do enhancer não basta se a dependência transitiva dela não estiver
    visível no módulo consumidor.
11. **`registerBrand` lê os saldos manuais confirmados sob `SELECT ... FOR UPDATE`, dentro da própria
    transação de escrita — decisão da Fase 09, corrigindo uma race condition real encontrada pelo
    `/code-review`.** `CashBalanceRepository.registerBrand` mudou de assinatura:
    `registerBrand(params, resolveManualBalances)` — o callback só é chamado depois de
    `lockBankEntries` travar as linhas, nunca antes da transação. Qualquer escrita nova que combine
    "ler um agregado confirmado por fora" + "escrever um snapshot calculado a partir dele" precisa do
    mesmo padrão (ler sob lock, dentro da mesma transação da escrita).
12. **`ReconciliationModule` importa `CashBalanceModule` para reusar `TrioBankingClient` — decisão da
    Fase 12, primeira dependência real entre os 2 módulos de negócio do Finance.** Precedente:
    qualquer reuso futuro entre os dois módulos de negócio segue o mesmo padrão (provider exportado +
    módulo importado), nunca import direto de arquivo interno do outro módulo (entidade,
    repositório, use-case) — só de uma classe que o `exports:` do módulo alvo declara explicitamente.
13. **`:id` das rotas `resolve`/`reopen` usa `ParseIntPipe`, não `ParseUUIDPipe` — decisão da Fase 13.**
    `ReconciliationItem.id` é `SERIAL` (decisão 4) — nenhuma tabela do Finance usa UUID como PK.
14. **`CorrectionEvidenceService` é um serviço próprio, não um método de `ReconciliationService` —
    decisão da Fase 14.** `ReconciliationService` serve o estado já calculado (leitura do Postgres);
    `CorrectionEvidenceService` consulta o warehouse sob demanda para investigar uma pendência
    específica. `SearchCorrectionsUseCase.execute` é o único ponto de acesso ao ClickHouse desse
    fluxo; `ApplyCorrectionMatchesUseCase` **reusa** essa chamada (nunca reimplementa a consulta) e
    filtra pelo **primeiro** candidato de cada pendência. Precedente: qualquer rota futura que
    precise "ver o mesmo que outra rota viu antes de agir sobre isso" injeta o use-case de leitura e
    chama `.execute()` com os mesmos parâmetros — nunca duplica a query só porque o efeito é outro.
15. **RLS no caminho job — ✅ confirmado pelo usuário na PARADA da Fase 15 (2026-09-02).** Fecha o que
    o item 5 já antecipava: nenhuma tabela do Finance ganha `ENABLE`/`FORCE ROW LEVEL SECURITY`. A
    defesa em profundidade do caminho job/CLI é `assertKnownBrand(key)`, chamada em `parseArgs` dos 5
    CLIs **antes** de `NestFactory.createApplicationContext` resolver qualquer use-case. Precedente:
    qualquer policy de RLS futura nas tabelas do Finance é ADR novo, não reabertura silenciosa desta
    decisão.
16. **`ThrottlerGuard`/`429` removido do catálogo de rotas na Fase 17 — não existe em nenhuma camada**
    (app ou ingress) neste destino, apesar de `REGRAS-NEGOCIO-ROTAS.md` descrever uma cadeia de 3
    guards incluindo ele. Decisão do usuário: documentar a divergência, não implementar. Se um rate
    limit real for necessário no futuro, é um ADR novo (guard `@nestjs/throttler` OU annotation de
    ingress), não assumir que já existe.

## Aprendizados críticos (fase a fase)

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
  real).
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
  com o token em inglês `TODO` case-insensitive. Ao portar comentários literalmente da origem, ou
  escrever novos, reescrever a frase preservando o sentido em vez de suprimir a regra. Ocorreu de novo
  nas Fases 04 e 14 (mesma causa) e, se ela reaparecer, é o mesmo fix — nunca `eslint-disable`.
- **Fase 03:** `scripts/finance-dev-stubs.js` e `src/common/utils/{date,tax-number}.util.ts` foram
  portados literalmente de `/home/feh/sayplus-modules/finance` (`finance-api` + `scripts/dev-stubs.js`
  da origem, presentes no disco local) — não havia cópia desses arquivos dentro deste repositório
  antes da Fase 03.
- **Fase 04:** o script orgânico do próprio `FASE-04.md` tinha um bug de contagem de tabelas —
  `table_name LIKE '%cash_balance%' OR ... OR table_name = 'finance_audit_logs'` sem parênteses
  (precedência `AND`/`OR` errada) e o padrão `%cash_balance%` não cobre `trio_closing_balances`,
  então a contagem real dava 7, nunca 8. Corrigido para uma lista `IN (...)` com os 8 nomes exatos.
- **Fase 04:** não existia `.env` no checkout (só `.env.example`/`.env.test`) — `npm run
  migration:run` só funciona com `.env` real (`data-source.ts` carrega `.env` quando `NODE_ENV !==
  'test'`). Criado localmente via `cp .env.example .env` (gitignorado).
- **Fase 04:** enums de coluna (`CashBalanceDayStatus` etc.) não podem morar dentro de `entities/` —
  a regra "entities/ só contém `*.entity.ts`" (já existente, não é do Finance) rejeita qualquer outro
  arquivo ali. Ficam na raiz do módulo (`cash-balance.enums.ts`, `reconciliation.enums.ts`).
- **Fase 04:** `up()` de uma migration com muitas tabelas bate no limite de 80 linhas por função do
  ESLint (`max-lines-per-function`) — não há exceção para migrations no `eslint.config.mjs`. Resolvido
  dividindo `up()` em métodos privados por sub-domínio, mantendo uma migration/classe só.
- **Fase 04:** a seção "Validação no banco" do `FASE-04.md` cita "as 3 FKs" mas o próprio texto de
  `cash-balance-brand-snapshot.entity.ts` e `DADOS-FINANCE.md` §3.4 exigem uma 4ª FK
  (`cash_balance_brand_snapshots.daily_id → cash_balance_daily.id`, 1:1). Implementada como FK real —
  quando a prosa de um `FASE-*.md` diverge do código explicitamente especificado na mesma fase, o
  código vale.
- **Fase 05:** `stat(1)` (`Birth`) não é evidência confiável de ordem histórica de criação de arquivo
  nesta sessão — a ferramenta de edição usada aqui grava via temp-file+rename, o que reseta
  Birth/Change do inode a cada edição subsequente. Resolvido com evidência decisiva e reproduzível:
  mover a pasta implementada para fora do repositório, reexecutar o script confirmando falha real,
  restaurar e confirmar sucesso real — não depende de metadado de filesystem.
- **Fase 05:** Jest 30 com Nest `Logger` ativo contamina `--json` no stdout — o `Logger.warn`/`error`
  do NestJS escreve no mesmo stdout que o `--json` do Jest, produzindo um blob não-parseável por
  `jq` mesmo redirecionando stderr. Correção: `--json --outputFile=<tmp>` em vez de capturar `--json`
  da saída padrão. Reapareceu como regressão real na Fase 17 (scripts das Fases 01/02, nunca
  atualizados até então) — corrigido nos dois.
- **Fase 06:** testar o teto `REQUEST_BUDGET` (20.000) da bisseção da Trio exige um mock de
  `has_more` condicionado ao tamanho real da janela (comparação lexicográfica dos timestamps ISO de
  largura fixa) — um mock "sempre `true`" incondicional nunca atinge o teto: a varredura usa uma
  pilha (LIFO), então sempre desce pelo galho mais à esquerda até `start === end`. Só uma janela onde
  `has_more` depende do tamanho de cada nó produz exploração ampla o bastante para ultrapassar
  20.000 chamadas.
- **Fase 06:** `accountIdFor()`/`BrandKey` adaptados para usar o que já existe no destino em vez do
  catálogo `BRANDS` da origem (só chega na Fase 07) — preferir o tipo/valor já existente no destino a
  duplicar.
- **Fase 06:** `@typescript-eslint/unbound-method` dispara em `expect(objeto.metodo)` sempre que o
  método é declarado com sintaxe de método no `.d.ts` da lib (caso de `axios.create`). A correção é
  `jest.spyOn(objeto, 'metodo')`, que não dispara a regra porque o nome do método é passado como
  string, não como acesso de propriedade.
- **Fase 07:** confirmado empiricamente contra Postgres real: coluna `type: 'date'` do TypeORM/`pg`
  volta como `string` `'YYYY-MM-DD'` via `repo.find()`/`QueryBuilder`, nunca `Date` — mas
  `dataSource.query()` (raw SQL) não passa pelo transform de coluna do TypeORM, e o driver `pg` puro
  devolve `Date` para o OID `date` (achado da Fase 10, mesma causa-raiz). Qualquer raw query que
  agrupe ou devolva uma coluna `date` como parte de uma chave/comparação precisa de
  `::text` explícito no `SELECT`.
- **Fase 07:** `cash-balance.repository.ts` bateu no `max-lines` (400) do ESLint — dividido em 3
  arquivos por responsabilidade (API pública, leituras puras, upserts elementares), não por tamanho
  arbitrário. Precedente para qualquer repositório novo que se aproxime do limite.
- **Fase 07/08/09:** processo — a implementação de algumas fases foi escrita antes do script de teste
  orgânico (falha do processo RED-antes-da-implementação). Corrigido sempre com o mesmo teste
  decisivo: mover os arquivos novos para fora do repositório, reexecutar o script confirmando falha
  real, restaurar e reconfirmar GREEN.
- **Fases 03/04/07/08/10/11:** um `FASE-*.md` pode ter prosa desatualizada, incompleta ou com bug no
  próprio script orgânico fornecido — sempre verificar por leitura/grep do código real (ou, melhor,
  Pre-flight com Haiku) antes de assumir que o texto do plano está certo. Ocorrências: contagem de
  tabelas/permissões errada, lista incompleta de arquivos a corrigir, allowlist já mais ampla do que
  o texto supunha, teste tautológico que não cobre o comportamento real, `grep` sem excluir
  comentário casando com a própria explicação do porquê algo não é filtrado.
- **Fase 09:** escalonamento com `/code-review` (exigido por fases que tocam permissões/isolamento
  por marca) encontrou achados reais mesmo com testes verdes — reforça que testes verdes não
  substituem revisão adversarial dedicada em fases de alto risco. O mais grave: `RegisterBrandUseCase`
  lia saldos confirmados fora de qualquer transação/lock antes de escrever, permitindo *lost update*
  (ver decisão 11).
- **Fase 09:** testar lock/concorrência real em Postgres via Testcontainers exige `QueryRunner`
  mantendo a trava aberta de propósito, forçando a escrita concorrente a bloquear de verdade por um
  tempo mensurável — `Promise.all` de chamadas de alto nível termina rápido demais para gerar
  contenção genuína e pode dar falso-positivo de "lock funcionando" mesmo sem o lock.
- **Fase 10:** `useDefineForClassFields` (tsconfig) faz `repo.create({...})` do TypeORM gravar
  `undefined` como propriedade própria em toda coluna não informada no objeto passado — e o
  `decimalTransformer` converte esse `undefined` em `NULL` explícito no `INSERT`, ignorando o
  `default` da coluna e violando `NOT NULL`. **Qualquer coluna com `default` no Postgres precisa de
  valor explícito em `repo.create()`** — o default do banco só se aplica quando a coluna está
  ausente do `INSERT`, e `create()` nunca a omite quando a classe tem a propriedade declarada.
- **Fase 10:** `brand`/`bank` ficam tipados como `string` em repositórios que não podem importar
  `BrandKey` diretamente de outro módulo (só via service exportado) — a coluna já é `varchar`, sem
  perda de garantia no banco; a validação contra o catálogo fica para o use-case que já tem acesso
  ao service certo.
- **Fase 12:** o Pre-flight (Haiku) e as invariantes de sessão pegaram bloqueios/violações reais que
  o próprio `FASE-*.md` não previa: `TrioBankingClient` faltando em `providers`/`exports`, e specs de
  Testcontainers de um módulo importando entidades de outro só por conveniência (nunca usadas de
  fato, já que a migration é SQL explícito). Precedente: registrar só as entidades que o teste
  efetivamente toca.
- **Fase 12:** ao passar um `string` para um parâmetro que exige um tipo nominal mais estrito
  (`BrandKey`) de outro módulo, preferir cast estrutural
  (`brand as Parameters<Classe['metodo']>[0]`) a importar o tipo nominal só para o cast.
- **Fase 13:** bug real de configuração pego pelo primeiro e2e a fazer asserção monetária ponta a
  ponta: `.env.test` tinha `TRIO_AMOUNT_DIVISOR=1`, divergindo da decisão 6 (100, confirmada na Fase
  06 só em `.env`/`.env.example`). Vale revisar TODOS os arquivos de ambiente sempre que uma decisão
  de env fail-fast for confirmada.
- **Fase 13:** golden dataset do e2e (marca `suprema`, dia `2026-06-15`) validado manualmente via
  `psql` contra Postgres real antes de travar os números nos testes — não são arbitrários. Qualquer
  alteração futura no stub de conciliação precisa recalcular esses números à mão antes de mudar as
  asserções do e2e.
- **Fase 13:** a Verificação Adversarial de Aceite achou uma lacuna de processo real: nenhuma classe
  nova tinha `*.spec.ts` colocalizado, embora o `FASE-13.md` só pedisse e2e — um `FASE-*.md` que não
  lista specs unitários para uma fase de use-cases é omissão a verificar contra a convenção geral do
  projeto, não silêncio = "não precisa".
- **Fase 14:** o golden dataset dos 4 débitos manuais com CPF (FABIO/GISELE/HELIO/IVONE) cobre os 4
  caminhos da busca de correção (exato via ponte, evidência parcial, sem client_id, exato direto).
  `CorrectionSearchItem.amount` fica em **reais**, não `amountCents`, na borda repositório↔use-case —
  a conversão para centavos acontece só na borda com `findCorrectionCandidates`; é esperado, não é o
  mesmo bug que "esquecer de converter".
- **Fase 15:** `helm` não vem instalado por padrão neste ambiente de sessão — instalar localmente em
  `~/.local/bin/helm` (binário oficial, sem root). Checar `command -v helm` no início de qualquer
  fase futura que precise dele.
- **Fase 15:** um CLI que escreve dado estruturado em `stdout` por padrão (`--out=-`) precisa
  desligar o nível `log` do Logger do Nest quando `out === '-'` (mantendo `error`/`warn` em stderr) —
  senão a linha de progresso do Logger se mistura com o dado.
- **Fase 15:** scripts orgânicos com `curl` contra o Postgres de desenvolvimento (`docker compose`)
  não são idempotentes entre execuções manuais (estado persiste entre rodadas) — só o e2e com
  Testcontainers garante estado limpo a cada rodada; não tratar uma "falha" de reexecução manual
  como regressão sem checar isso primeiro.
- **Fase 16:** auditoria pura pode vir GREEN de primeira — documentar isso explicitamente em vez de
  tratar como sinal de script fraco, quando a fase realmente é so confirmação (prefixo, Swagger,
  readiness, `decimalTransformer` — nada mudou).
- **Fase 17:** rodar os 12 gates do CI de ponta a ponta, de verdade, pela primeira vez na trilha
  revelou 3 débitos pré-existentes que nenhuma fase anterior tinha exercitado: (1) os scripts
  orgânicos das Fases 01/02 nunca receberam o fix de `--outputFile` da Fase 05 (mesma causa-raiz,
  script nunca re-rodado); (2) `npm audit --audit-level=high` tinha 2 vulnerabilidades transitivas
  pré-existentes (`fast-uri`/`qs`, nenhuma do Finance) nunca resolvidas porque ninguém tinha rodado o
  audit gate real antes; (3) `.env.docker` nunca ganhou as 14 variáveis novas do Finance — `docker
  compose --profile full up` teria caído no boot (Joi fail-fast) na primeira vez que alguém tentasse.
  Lição geral: **um gate do CI nunca rodado de ponta a ponta durante a trilha é um gate desconhecido,
  não um gate verde** — mesmo com todas as fases "concluídas" e testes verdes fase a fase, só a
  execução real dos 12 comandos revela esse tipo de débito acumulado.
- **Fase 17:** testar "usuário com marca válida no catálogo mas sem vínculo" (403) contra os 5 rotas
  com `:brand` na URL não é possível com o stub real de identidade tal como estava (`/auth/me` sempre
  devolvia as 3 marcas para qualquer token) — extendido o stub para decodificar (sem verificar
  assinatura) o `sub` do Bearer recebido e devolver um subconjunto de tenants quando `sub ===
  'user-limited-brands'`. Continua sendo uma chamada HTTP real ao stub (não um mock de infra),
  seguindo o mesmo espírito de `test/auth-helper.ts` já ter opções para "forjar tokens inválidos".
- **Fase 17:** `CLICKHOUSE_URL`/`SAYPLUS_API_URL` são `.required()` no Joi — `isConfigured === false`
  (ClickHouseService) só é alcançável em teste unitário com config mockada, nunca em e2e/produção. Em
  e2e, "dependência externa fora" só é testável como falha de CONEXÃO (porta fechada), não como
  "variável ausente" — usar uma URL sintaticamente válida apontando para uma porta sem listener
  (`http://127.0.0.1:1`) em uma segunda/terceira instância Nest dedicada, nunca reescrever a var como
  vazia/ausente.
