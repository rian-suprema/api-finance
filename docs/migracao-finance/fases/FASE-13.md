# FASE 13 — Conciliação — use-cases núcleo + controller
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 45**
> Limite: _9 arquivos · risco alto: `run` bloquear o request (a varredura leva ~2 min/marca — precisa responder 202 e rodar em background) e a severidade do histórico tratar `NOT_RUN` como melhor que `PENDING` (é o inverso)_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `GET /reconciliation`, `GET /reconciliation/history`, `POST
/reconciliation/run`, `POST /reconciliation/items/:id/resolve` e `POST
/reconciliation/items/:id/reopen` respondem de ponta a ponta, com a varredura do extrato rodando em
background (nunca bloqueando o request) e a invariante `diferença = crossover + pendências`
verificável na resposta.

## Pré-requisito

Fases 01 (domínio puro), 08 (identidade/marca), 10 (persistência), 11 (ClickHouse) e 12 (Trio)
concluídas.

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/modules/finance-reconciliation/infrastructure/reconciliation-run.repository.ts` e `reconciliation-item.repository.ts` (Fase 10) — assinaturas exatas
- `src/modules/finance-reconciliation/infrastructure/clickhouse/platform-movements.service.ts` (Fase 11) e `infrastructure/trio/trio-movements.service.ts` (Fase 12) — assinaturas de `fetchMovements`
- `src/modules/finance-cash-balance/domain/services/brand-access.service.ts` (Fase 08) — reuso via módulo exportado

### Prompt para Haiku

> Leia os arquivos. Esta fase cria `run-reconciliation.use-case.ts`, que orquestra os 2 serviços de
> leitura (ClickHouse + Trio) e o repositório, chamando o `matcher`/`refund-settlement`/`totals.util`
> da Fase 01.
>
> Verifique:
> 1. As assinaturas de `fetchMovements` dos dois serviços aceitam os parâmetros de janela
>    (`coreFrom`/`coreTo`/`from`/`to` para a plataforma; `coreFrom`/`coreTo`/`accountId` para o
>    banco) sem conflito de nome.
> 2. `matchFlow`/`settleRefunds`/`emptyTotals` (Fase 01) têm as assinaturas que o use-case vai chamar.
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

_(cenários que alimentam o script funcional + o e2e Jest — usam o golden dataset da Fase 01 como
insumo para o `run`)_

1. **`GET /reconciliation`** sem execução para o dia → `200`, cada marca com `status: 'NOT_RUN'`,
   `message: 'Conciliação deste dia ainda não foi executada'`.
2. **`POST /reconciliation/run`** → **`202`** imediato (medir que a resposta volta em menos de 500ms,
   mesmo que a varredura real leve segundos no teste com stub) com `{referenceDate}`.
3. **Após o `run` terminar** (poll do `GET /reconciliation` até `status !== 'RUNNING'`): `status:
   'DONE'`, `matchedCount`/`pendingCount` refletem o resultado do golden dataset da Fase 01 (mesmos
   números travados no fixture).
4. **`GET /reconciliation`** com a invariante: `depositsDifference`/`withdrawalsDifference`
   calculados = `bank.total - platform.total`; somados a `crossover`, batem com `pendingCount` (via
   os totais do golden dataset).
5. **`GET /reconciliation/history`** cobre **todo dia do intervalo**, mesmo sem execução — um dia sem
   run aparece com `status: 'NOT_RUN'`, não é omitido da lista.
6. **Severidade do histórico:** um dia com uma marca `PENDING` e outra `NOT_RUN` → o dia herda
   `NOT_RUN` (pior), não `PENDING`.
7. **`missingDays`** conta `NOT_RUN` + `FAILED`, nunca `RUNNING`.
8. **`POST /reconciliation/items/:id/resolve`** com nota < 10 caracteres → `400`; com nota válida →
   `204`; ler no Postgres: `status = 'RESOLVED'`, `resolvedBy = <sub do JWT>`.
9. **`POST /reconciliation/items/:id/resolve`** de item já `RESOLVED` → `409`.
10. **`POST /reconciliation/items/:id/reopen`** → `204`; ler no Postgres: `status = 'OPEN'`, `note =
    NULL`.
11. **`resolve`/`reopen` de item de marca sem vínculo do usuário** → `403` (autorização pelo **dado**,
    não pela URL — ver `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §3.6).
12. **Duas chamadas simultâneas de `run` para o mesmo dia+marca:** a segunda não duplica trabalho —
    `RunReconciliationUseCase.isRunning()` reflete a guarda de reentrância em memória.
13. **Sem Bearer / sem permissão** em qualquer das 5 rotas → `401`/`403`.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/conciliacao-api/FASE-13-TESTE-ORGANICO.sh` agora, com base nos 13 cenários, e
> executá-lo antes de criar qualquer arquivo. Resultado esperado: RED.

## Arquivos a criar

### `src/modules/finance-reconciliation/domain/use-cases/run-reconciliation.use-case.ts`
**Motivo:** a operação mais cara e mais importante do módulo. Portar literalmente (ver
`docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §3.3): guarda de reentrância em `Set` de processo,
`startRun` → busca plataforma+banco em paralelo → `settleRefunds` → `matchFlow` para depósito e saque
→ monta os 8 pares de totais → `saveResult` em transação → `failRun` em caso de erro (sem derrubar as
outras marcas). Marcas em `Promise.all`.

### `.../get-reconciliation.use-case.ts`
Portar literalmente (§3.1): `NOT_RUN` quando não há linha de execução (não é valor de enum — é
ausência), `depositsDifference`/`withdrawalsDifference` derivados, `reconciled = status==='DONE' &&
openCount===0`.

### `.../get-reconciliation-history.use-case.ts`
Portar literalmente (§3.2): preenche **todo** dia do intervalo, severidade `NOT_RUN(4) > FAILED(3) >
RUNNING(2) > PENDING(1) > RECONCILED(0)`, `missingDays = NOT_RUN + FAILED` (nunca `RUNNING`).

### `.../resolve-item.use-case.ts`
Portar literalmente (§3.6): valida nota (10–1000, após `trim()`), `404` se não achar, `403` por
marca do dado, `409` se já `RESOLVED`.

### `.../reopen-item.use-case.ts`
Portar literalmente (§3.7): apaga a nota anterior, `404`/`403` nos mesmos moldes.

### `src/modules/finance-reconciliation/domain/services/reconciliation.service.ts`
Orquestra os 5 use-cases + `BrandAccessService` (importado via `CashBalanceModule` exportado — Fase
12). `run()` dispara `void this.runReconciliation.execute(...).catch(log)` — **sem** `await` — e
devolve `{referenceDate}` na hora.

### `src/modules/finance-reconciliation/dto/reconciliation.dto.ts`
`ReconciliationQueryDto` (`date?`), `ReconciliationHistoryQueryDto` (`from?`/`to?`), `ResolveItemDto`
(`note: string`, `@Length(10,1000)`).

### `src/modules/finance-reconciliation/presenters/controllers/reconciliation.controller.ts`
As 5 rotas desta fase (as 2 de correção ficam para a Fase 14): `GET /`, `GET /history`, `POST /run`
(`@HttpCode(202)`), `POST /items/:id/resolve` (`@HttpCode(204)`, `ParseUUIDPipe`), `POST
/items/:id/reopen` (idem). Cada uma com `@Permissions(FINANCE_RECONCILIATION.<CODE>)`.

## Atualizar arquivo de registro de rotas/servidor

`reconciliation.module.ts` — registrar os 5 use-cases, o service e o controller, exportando
`ReconciliationService`/`RunReconciliationUseCase` para a Fase 14 (evidência de correção) e Fase 15
(CLI/CronJob).

## Documentação

**Fase com rotas novas.** Swagger para as 5 rotas — método, descrição (a de `run` explicitando que é
assíncrona e a tela acompanha pelo `status` do GET), request/query tipados, responses
`200`/`202`/`204`/`400`/`403`/`404`/`409`, tag `reconciliation`.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/conciliacao-api/FASE-13-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 13 — Teste Orgânico: Conciliação — use-cases núcleo + API
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
PREFIX="/api/v1"
PASS=0; FAIL=0

ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

TOKEN=$(node scripts/auth-dev-token.js \
  finance.reconciliation.read finance.reconciliation.run finance.reconciliation.resolve)
AUTH="Authorization: Bearer $TOKEN"

check_http() {
  local label="$1" expected="$2"; shift 2
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@")
  [ "$actual" = "$expected" ] && ok "$label → $expected" || fail "$label → esperado $expected, obtido $actual"
}

echo ""
echo "=== FASE 13 — Conciliação (API) ==="
echo ""

# --- 1. sem execução ---
READ_BODY=$(curl -s "$BASE_URL$PREFIX/reconciliation?date=2099-01-01" -H "$AUTH")
echo "$READ_BODY" | grep -q '"NOT_RUN"' && ok "GET reconciliation sem execução → NOT_RUN" \
  || fail "GET reconciliation não sinalizou NOT_RUN"

# --- 2. run responde rápido (202) ---
START=$(date +%s%3N)
RUN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL$PREFIX/reconciliation/run" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-08-15"}')
END=$(date +%s%3N)
ELAPSED=$((END - START))
[ "$RUN_STATUS" = "202" ] && ok "POST run → 202" || fail "POST run → esperado 202, obtido $RUN_STATUS"
[ "$ELAPSED" -lt 2000 ] && ok "POST run respondeu em ${ELAPSED}ms (não bloqueou no request)" \
  || fail "POST run demorou ${ELAPSED}ms — pode estar bloqueando no request"

# --- 3. history cobre todo dia (mesmo sem execução) ---
HISTORY_BODY=$(curl -s "$BASE_URL$PREFIX/reconciliation/history?from=2026-08-01&to=2026-08-15" -H "$AUTH")
echo "$HISTORY_BODY" | grep -q '"rangeDays":15' && ok "GET history cobre os 15 dias do intervalo" \
  || fail "GET history não cobriu o intervalo inteiro"

# --- 4. resolve com nota curta → 400 ---
check_http "POST resolve nota curta" 400 -X POST \
  "$BASE_URL$PREFIX/reconciliation/items/00000000-0000-0000-0000-000000000000/resolve" \
  -H "$AUTH" -H "content-type: application/json" -d '{"note": "curta"}'

# --- 5. resolve de item inexistente com nota válida → 404 ---
check_http "POST resolve item inexistente" 404 -X POST \
  "$BASE_URL$PREFIX/reconciliation/items/00000000-0000-0000-0000-000000000000/resolve" \
  -H "$AUTH" -H "content-type: application/json" \
  -d '{"note": "Nota de teste com mais de dez caracteres."}'

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 13 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 13 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

> **Nota:** os cenários 3, 4, 6, 7, 12 (resultado do `run` completo contra o golden dataset,
> severidade do histórico, guarda de reentrância) exigem o `run` terminar e ler o resultado — cobertos
> pelo e2e Jest (`test/finance-reconciliation.e2e-spec.ts`, criado nesta fase e expandido na Fase 14),
> com `await` no poll de `GET /reconciliation` até `status !== 'RUNNING'` (timeout de alguns segundos
> contra os stubs, que respondem instantaneamente).

### 1. Subir a aplicação + stubs e executar
```bash
node scripts/finance-dev-stubs.js &
npm run start:dev &
sleep 5
bash scripts/conciliacao-api/FASE-13-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPattern=finance-reconciliation
```

### 2. Regressão
```bash
bash scripts/trio-movimentos/FASE-12-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPattern="users|finance-cash-balance"
```

### 3. Validação no banco
Após o `run` completo do cenário e2e, confirmar via `psql` que `reconciliation_runs.pending_count`
bate com a contagem real de `reconciliation_items` `OPEN`.

### 4. Criar documento de teste
`scripts/conciliacao-api/FASE-13-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/conciliacao-api/FASE-13-TESTE-ORGANICO.sh` — passa 100%
- [ ] `npm run test:e2e -- --testPathPattern=finance-reconciliation` — passa 100% (cobre os 13 cenários)
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 12 passa 100%; e2e do `users` e `finance-cash-balance` continuam verdes
- [ ] Documentação: Swagger atualizado para as 5 rotas
- [ ] `POST /run` responde em menos de 2s mesmo quando a varredura real levaria minutos (nunca `await` na chamada da varredura dentro do handler)
- [ ] `NOT_RUN` é pior que `PENDING` na severidade do histórico
- [ ] `missingDays` nunca conta `RUNNING`
- [ ] `resolve`/`reopen` autorizam pela marca do **item**, não da URL
- [ ] Guarda de reentrância impede 2 varreduras simultâneas do mesmo dia+marca
- [ ] Todas as 5 rotas declaram `@Permissions(...)`
- [ ] Invariantes de sessão verificados com Haiku — zero violações
- [ ] Verificação Adversarial de Aceite — CONFIRMADO
- [ ] `CLAUDE.md` atualizado
- [ ] `progress.json` atualizado
- [ ] `dashboard.html` EMBEDDED sincronizado
- [ ] Custo real registrado via `update-phase-cost.js`
- [ ] Dashboard aberto no browser — best-effort
- [ ] Commit e push para `feature/migracao-finance`

## ✅ Invariantes de Sessão — Haiku antes de finalizar

> **Invocar Agent com `model: claude-haiku-4-5-20251001`.**

### Comandos de inspeção
```bash
grep -n "await this.runReconciliation" src/modules/finance-reconciliation/domain/services/reconciliation.service.ts
grep -c "@Permissions" src/modules/finance-reconciliation/presenters/controllers/reconciliation.controller.ts
grep -n "allowedBrands\|item.brand" src/modules/finance-reconciliation/domain/use-cases/resolve-item.use-case.ts
```

### Prompt para Haiku

> Execute os comandos. Confirme: (1) o método `run()` do service **não** usa `await` na chamada de
> `runReconciliation.execute` (deve ser `void ...execute(...).catch(...)`); (2) a contagem de
> `@Permissions` é **5**; (3) `resolve-item.use-case.ts` confere `item.brand` contra
> `allowedBrands`, não um parâmetro de rota.
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir — um `await` esquecido aqui derruba a tela com timeout de proxy em
> produção. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN do bash e do e2e. Foco: medir o
> tempo de resposta real do `POST /run` no ambiente de teste e confirmar que é da ordem de
> milissegundos, não segundos — e ler `run()` linha a linha para confirmar que não há nenhum caminho
> que aguarde a promise da varredura antes de responder.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

> **Escalonamento:** esta fase toca autorização por dado (não por URL) — encadear com `/code-review`
> antes de considerar CONFIRMADO definitivo.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **14 — Conciliação: evidência de correção**. Marcar Fase 13 concluída.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-reconciliation/domain/use-cases/ \
        src/modules/finance-reconciliation/domain/services/reconciliation.service.ts \
        src/modules/finance-reconciliation/dto/ \
        src/modules/finance-reconciliation/presenters/ \
        src/modules/finance-reconciliation/reconciliation.module.ts \
        test/finance-reconciliation.e2e-spec.ts \
        scripts/conciliacao-api/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-reconciliation): use-cases núcleo e as 5 rotas principais

Fase 13/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 13 concluída, validada e enviada para `feature/migracao-finance`.**
`run` nunca bloqueia o request, o histórico cobre todo dia do intervalo com a severidade correta, e
`resolve`/`reopen` autorizam pelo dado. Responder "sim" para iniciar a **Fase 14**.
