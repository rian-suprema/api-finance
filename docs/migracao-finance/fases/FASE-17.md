# FASE 17 — Fechamento: e2e completo, quality gates, cutover
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 40**
> Limite: _4 arquivos (e2e) + auditoria de todo o resto · risco: declarar a trilha pronta sem rodar de fato os gates que o CI vai rodar — a fase só termina quando os comandos do CI passarem localmente, byte a byte_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, a trilha inteira (17 fases, 14 rotas de negócio, 8 tabelas, 3 integrações
externas, 1 `CronJob`, 5 CLIs) passa nos mesmos gates que o CI (`quality-validation` +
`security` + `e2e-testing` + `build-image` + `helm-validate`), o smoke test de 190 verificações da
origem está portado, o `requirements.yaml` declara as dependências novas, e o `CLAUDE.md` +
code-review-graph estão sincronizados com a trilha inteira — não só com esta fase.

## Pré-requisito

Fases 15 e 16 concluídas — todo o código de negócio, infraestrutura e contrato já existe.

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `.github/workflows/ci.yml` — os 5 jobs exatos e os comandos de cada um
- `scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.md` até `scripts/contrato-archetype/FASE-16-TESTE-ORGANICO.md` — confirmar que todas as 16 fases anteriores estão marcadas com status final (nenhuma "pendente" esquecida)
- `test/finance-cash-balance.e2e-spec.ts` (Fase 09) e `test/finance-reconciliation.e2e-spec.ts` (Fases 13/14) — o que já está coberto, para não duplicar

### Prompt para Haiku

> Leia os arquivos. Esta fase expande o e2e para o smoke test completo e roda os 5 comandos do CI
> localmente.
>
> Verifique:
> 1. Os comandos exatos de `quality-validation` (`lint`, `dup:check`, `format:check`, `test:cov`,
>    `build`) e de `security` (`npm audit --audit-level=high`).
> 2. Todas as 16 fases anteriores (`scripts/*/FASE-*-TESTE-ORGANICO.md`) têm status diferente de
>    "pendente" — se alguma ainda estiver pendente, é sinal de que a trilha não está realmente
>    completa e esta fase não deveria ter começado.
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [fase pendente encontrada / comando de CI divergente]**.

> **Se BLOQUEADO:** parar e resolver a fase pendente antes de prosseguir — nunca fechar a trilha com
> uma fase anterior incompleta. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **As 190 verificações do `scripts/smoke-test.js` da origem, portadas para Jest e2e:** casos de
   borda documentados — `401` sem token, `400` de whitelist (campo extra em qualquer DTO), marca
   inválida, dia sem execução como `NOT_RUN`, "Trio read-only" (confirmar banco `trio` recusado).
   Não precisam ser 190 `it()` literais — podem ser parametrizados (`it.each`) cobrindo a mesma
   superfície.
2. **Fluxo completo do Balanço de Caixa ponta a ponta:** confirmar os 8 bancos → `register` libera
   só no 8º (a Trio capturada previamente) → `reopen` devolve a `DRAFT` → registrar de novo.
3. **Fluxo completo da Conciliação contra o golden dataset (Fase 01):** `run` → aguardar `DONE` →
   confirmar totais e pendências batem com o `expected` do fixture → tratar uma pendência com nota →
   `run` de novo → confirmar que a nota sobreviveu (chave natural, não `run_id`).
4. **`AppModule` completo sobe com o `Joi` fail-fast** sobre todas as variáveis novas (`CLICKHOUSE_*`,
   `TRIO_*`, `SAYPLUS_API_URL`, `RECONCILIATION_BANK_KEY_FIELD`) — testado no `test:e2e`, que já monta
   o app real.
5. **`quality-validation` local:** `npm run lint && npm run dup:check && npm run format:check && npm
   run test:cov && npm run build` — todos verdes, incluindo os arquivos novos do Finance.
6. **`security` local:** `npm audit --audit-level=high` sem vulnerabilidade alta/crítica introduzida
   pelas 2 dependências novas (`@clickhouse/client`, `axios`).
7. **`helm-validate` local:** `helm template` + `helm lint` no chart com o `cronjob.yaml` novo.
8. **`build-image` local:** a imagem builda e o container sobe (`docker compose --profile full up`),
   `curl` no `/health/readiness` responde `200`.

## 🔴 Teste Orgânico — RED antes da implementação

> Nesta fase, "RED" significa: rodar `npm run test:e2e` **antes** de escrever o smoke test expandido
> e confirmar que os 190 cenários da origem **ainda não estão todos cobertos** (comparar contra a
> lista de `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §6, "Catálogo consolidado de erros" — se
> algum item dessa tabela não tiver teste correspondente em nenhuma fase anterior, é RED real).

## Arquivos a criar

### `test/finance-smoke.e2e-spec.ts`
**Motivo:** as 190 verificações da origem (`scripts/smoke-test.js`), portadas — não descartadas. Usa
`it.each` sobre a tabela de erros do `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §6 para não
precisar de 190 blocos literais. Cobre os casos de borda que os e2e das Fases 09/13/14 não cobriram
individualmente (foco em: 401 em toda rota sem exceção, 400 de whitelist em todo DTO, todas as
combinações de marca inválida × rota, `NOT_RUN` em todas as combinações de data sem execução).

### Expandir `test/finance-cash-balance.e2e-spec.ts` (Fase 09) e `test/finance-reconciliation.e2e-spec.ts`
(Fases 13/14) com os cenários 2 e 3 acima — fluxo completo ponta a ponta, não só rota a rota.

### `docs/migracao-finance/INFRA-FINANCE.md` (editar)
Atualizar a seção `requirements.yaml` (§10) com o texto final adotado (ou o link direto para o
`deploy/infra/requirements.yaml` já editado — decidir qual by ao terminar as Fases 06/15).

### `deploy/infra/requirements.yaml` (editar)
Adicionar os 3 itens novos (`ClickHouse`, `Trio banking-api`, `API SayPlus`) conforme o rascunho já
pronto em `docs/migracao-finance/INFRA-FINANCE.md` §10 — revisão final, não criação do zero.

## Atualizar arquivo de registro de rotas/servidor

Não aplicável — nenhuma rota nova nesta fase.

## Documentação

Não aplicável a rotas novas. **Revisão final do Swagger completo:** confirmar que `GET /docs` lista
as 14 rotas de negócio sem nenhuma faltando (comparar contra a tabela de
`docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §0).

## Teste Orgânico — Claude Executa

> **Esta é a última fase — o Teste Orgânico é o próprio conjunto de gates do CI, rodado localmente
> ponta a ponta, exatamente como o `MIGRACAO-FINANCE.md` §Onda 6 já previa.**

### 1. Confirmar que a aplicação sobe com todas as integrações (stub) ativas
```bash
node scripts/finance-dev-stubs.js &
npm run start:dev &
sleep 5
curl -fsS http://localhost:3005/health/liveness
curl -fsS http://localhost:3005/health/readiness
```

### 2. Executar o smoke test expandido e os e2e completos
```bash
npm run test:e2e
```
Deve cobrir, sem exceção: `users` [EXEMPLO], `finance-cash-balance`, `finance-reconciliation`,
`finance-smoke`, `security`, `rls`, `rls-app`.

### 3. Regressão — as 16 fases anteriores, uma a uma
```bash
for f in dominio-conciliacao dominio-balanco-caixa esqueleto-financeiro schema-financeiro \
         clickhouse-conexao trio-integracao persistencia-balanco-caixa identidade-plataforma \
         balanco-caixa-api persistencia-conciliacao clickhouse-conciliacao trio-movimentos \
         conciliacao-api conciliacao-correcoes jobs-financeiros contrato-archetype; do
  echo "--- $f ---"
  n=$(ls scripts/$f/FASE-*-TESTE-ORGANICO.sh)
  bash "$n" || { echo "REGRESSÃO em $f"; exit 1; }
done
```

### 4. Os gates do CI, localmente — o critério de saída real desta fase
```bash
npm ci --ignore-scripts
npm run lint
npm run dup:check
npm run format:check
npm run test:cov
npm run build
npm audit --audit-level=high
docker build -t users-api:finance-ci .
helm lint deploy/helm/users-api
helm template deploy/helm/users-api --set image.tag=finance-ci >/dev/null
docker compose -f docker-compose.yml -f docker-compose.ci.yml --profile full up -d
curl -fsS http://localhost:3005/health/readiness
docker compose -f docker-compose.yml -f docker-compose.ci.yml --profile full down -v
```
Todos precisam terminar com código de saída `0`. Se algum falhar aqui, **é mais barato corrigir agora
do que descobrir no CI** — exatamente o critério que o `MIGRACAO-FINANCE.md` §Onda 6 registrou.

### 5. Criar documento de teste
`scripts/fechamento-financeiro/FASE-17-TESTE-ORGANICO.md`, incluindo a saída resumida dos 12 comandos
do passo 4.

## Critérios de aceite

- [ ] Os 12 comandos do passo 4 (gates do CI, localmente) — todos com exit 0
- [ ] `npm run test:e2e` completo — 100% verde (`users`, `finance-cash-balance`,
      `finance-reconciliation`, `finance-smoke`, `security`, `rls`, `rls-app`)
- [ ] As 16 fases anteriores, regredidas uma a uma — 100% verde
- [ ] As 190 verificações da origem estão representadas em `finance-smoke.e2e-spec.ts` (via `it.each`
      ou blocos equivalentes) — comparado item a item contra
      `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §6
- [ ] Fluxo completo do Balanço de Caixa (8 bancos → register → reopen → register de novo) verde
- [ ] Fluxo completo da Conciliação contra o golden dataset — nota sobrevive à reexecução
- [ ] `requirements.yaml` atualizado com os 3 itens externos novos
- [ ] Documentação: Swagger completo confirmado (14/14 rotas)
- [ ] Invariantes de sessão verificados com Haiku — zero violações
- [ ] Verificação Adversarial de Aceite — CONFIRMADO
- [ ] `CLAUDE.md` atualizado
- [ ] **🧹 Revisão de Performance do CLAUDE.md + Sincronização do Code Review Graph** (seção dedicada abaixo) — concluída
- [ ] `progress.json` atualizado — **as 17 fases** com `status: completed`
- [ ] `dashboard.html` EMBEDDED sincronizado — 17/17, `percentComplete: 100`
- [ ] Custo real registrado via `update-phase-cost.js`
- [ ] Dashboard aberto no browser — best-effort
- [ ] Commit e push para `feature/migracao-finance`
- [ ] PR para `main` perguntado ao usuário — só criado com confirmação explícita

## ✅ Invariantes de Sessão — Haiku antes de finalizar

> **Invocar Agent com `model: claude-haiku-4-5-20251001`.**

### Comandos de inspeção
```bash
grep -c "status.*pending" docs/migracao-finance/fases/progress.json
git diff main...feature/migracao-finance --stat | tail -5
```

### Prompt para Haiku

> Execute os comandos. O primeiro deve devolver **zero** (nenhuma fase pendente no `progress.json`
> final). O segundo mostra o resumo do diff da trilha inteira contra `main` — confirme que inclui
> arquivos de todos os módulos esperados (`finance-cash-balance`, `finance-reconciliation`,
> `clickhouse`, `cli`, `deploy/helm`, `database/migrations`).
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo, sem histórico: os Critérios de Aceite desta fase + a saída completa dos 12
> comandos do passo 4 + `git diff main...feature/migracao-finance --stat`. Instrução: **tentar
> refutar** que a trilha está pronta para revisão humana — procurar especificamente por: (a) qualquer
> comando do passo 4 que tenha sido "resumido" em vez de mostrado por completo; (b) qualquer uma das
> 25 invariantes de negócio do `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §7 sem teste
> correspondente identificável no diff.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [critério — motivo específico]**.

> **Escalonamento:** trilha inteira toca auth/RBAC/schema/API pública — encadear com `/code-review`
> (nível `high`) antes de considerar CONFIRMADO definitivo, cobrindo o diff completo
> `main...feature/migracao-finance`.

## 📊 Dashboard — Validação Pós-fase

### 1. Sincronizar dados
```bash
node scripts/update-phase-cost.js
```

### 2. Verificar integridade do `progress.json`
Todas as 17 fases com `status: "completed"`, `summary.completed: 17`, `summary.percentComplete: 100`.

### 3. Verificar `const EMBEDDED` no `dashboard.html`
Bate com o `progress.json` final.

### 4. Garantir `live-server` disponível e abrir no browser (best-effort)
```bash
npx --yes live-server docs/migracao-finance/fases/ --open=dashboard.html --port=4500 &
```

### 5. Validar visualmente (best-effort)
- [ ] Barra de progresso em 100%
- [ ] Os 17 dots verdes
- [ ] Custo total real (não estimado) exibido

## Atualizar CLAUDE.md

- Marcar as 17 fases como concluídas na tabela.
- Remover a seção "Fase atual" (a trilha terminou) ou substituí-la por "Trilha `feature/migracao-finance`
  concluída em `<data>` — ver PR #<número>".
- Consolidar "Aprendizados críticos" das 17 fases em `## Convenções consolidadas` (ver seção 16.5
  abaixo — parte do mesmo movimento).

## 🧹 Revisão de Performance do CLAUDE.md + Sincronização do Code Review Graph

> Executar depois de "Atualizar CLAUDE.md" e antes do commit final da trilha.

### 1. Revisar o `CLAUDE.md` como artefato de performance de contexto

```bash
wc -l CLAUDE.md
git diff 88e9cdf -- CLAUDE.md | wc -l
```
`88e9cdf` é o commit em `main` anterior ao início desta trilha (ver `gitStatus` do início da sessão).
Se o arquivo cresceu de forma acentuada, avaliar: os "Aprendizados críticos" fase a fase já foram
condensados em `## Convenções consolidadas`? A seção "Decisões já fechadas para esta trilha" ainda
precisa existir como está, ou pode virar 2–3 linhas agora que a trilha terminou (o detalhe completo
já está nos `git log` das 17 fases e em `docs/migracao-finance/*.md`)?

### 2. Se não estiver otimizado: quebrar em MDs dedicados dentro de `docs/`

Se a revisão encontrar blocos grandes e estáveis (ex.: o detalhe completo das 6 decisões arquiteturais
da trilha), mover para `docs/finance-decisoes.md` (novo) ou para os arquivos já existentes em
`docs/migracao-finance/`, substituindo por um ponteiro de 1 linha no `CLAUDE.md`. **Nunca mover:**
Stack, Arquitetura, Princípios de código, Protocolo de Decisão, `## Convenções consolidadas` recém-
criada nesta fase (só é candidata a mover numa trilha *futura*, não nesta). Registrar nas notas da
fase o que foi movido e por quê.

Se já estiver bem otimizado: registrar explicitamente **"CLAUDE.md revisado — nenhuma quebra
necessária nesta trilha"**.

### 3. Garantir que o code-review-graph reflete a trilha inteira

1. Confirmar se o projeto usa `code-review-graph` (`.claude/settings.json`, hooks, ou MCP
   `code-review-graph`). **Se não usar:** registrar "code-review-graph não aplicável a este projeto"
   e pular o restante desta seção.
2. Se usar: verificar `Built at commit` do grafo contra `git log -1 --format=%H` de
   `feature/migracao-finance`.
3. Se estiver atrás: rodar a atualização completa (comando documentado no `CLAUDE.md`/README de
   ferramentas do projeto, se existir; senão, registrar como item para o SRE/tooling da organização).
4. Confirmar que o grafo cobre os arquivos de **todas** as 17 fases (`git diff main...feature/migracao-finance --stat`), não só desta última.
5. Registrar nas notas da fase: commit refletido e contagem pós-sincronização.

## 🔀 Git — Commit e Push da Fase

### 1. Revisar o que será commitado
```bash
git status --porcelain
```

### 2. Commit
```bash
git add test/finance-smoke.e2e-spec.ts test/finance-cash-balance.e2e-spec.ts \
        test/finance-reconciliation.e2e-spec.ts deploy/infra/requirements.yaml \
        docs/migracao-finance/INFRA-FINANCE.md \
        scripts/fechamento-financeiro/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "test(finance): smoke test completo, gates do CI locais e fechamento da trilha

Fase 17/17 — Migração Finance (última fase)"
```

### 3. Push para a branch da trilha
```bash
git push -u origin feature/migracao-finance
```

Depois do push, perguntar ao usuário e **aguardar resposta** antes de agir:

```
Fase 17 (última do plano) commitada e enviada para `feature/migracao-finance`.
Deseja que eu crie o Pull Request para `main` agora? (sim/não)
```

Só executar `gh pr create` (título curto + corpo resumindo as 17 fases, listando os 3 riscos aritméticos
que motivaram a ordem do plano — sinal do balanço, casamento por chave, liquidação de estorno — e a
pendência externa de `TRIO_AMOUNT_DIVISOR`, se ainda não confirmada) após confirmação explícita.

## ⏸️ Encerramento da trilha

**Fase 17 (última) concluída, validada e enviada para `feature/migracao-finance`.**
As 14 rotas de negócio do Finance, o schema completo, as 3 integrações externas, o `CronJob` e os 5
CLIs passam nos mesmos gates do CI, localmente. Aguardando a decisão do usuário sobre abrir o PR para
`main`.
