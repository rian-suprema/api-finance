# FASE 14 — Conciliação — evidência de correção de saldo
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 30**
> Limite: _3 arquivos · risco: `apply` dar baixa em candidato `PARTIAL` (esconderia divergência real) ou repetir a busca com critério diferente do que a tela mostrou_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `GET /reconciliation/:brand/corrections` e `POST
/reconciliation/:brand/corrections/apply` respondem, reusando exatamente a mesma busca para exibir e
para dar baixa — nunca com critérios diferentes entre as duas rotas.

## Pré-requisito

Fase 01 (domínio — `correction-matcher.ts`, `correction-note.ts`), Fase 11 (ClickHouse —
`CorrectionSearchService`) e Fase 13 (controller/módulo da conciliação já existe) concluídas.

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/modules/finance-reconciliation/domain/correction-matcher.ts` (Fase 01) — `findCorrectionCandidates`, `CorrectionCandidate`
- `src/modules/finance-reconciliation/infrastructure/clickhouse/correction-search.service.ts` (Fase 11) — assinaturas
- `src/modules/finance-reconciliation/infrastructure/reconciliation-item.repository.ts` (Fase 10) — `findItemsForCorrectionSearch`, `resolveItems`

### Prompt para Haiku

> Leia os 3 arquivos. Esta fase cria `search-corrections.use-case.ts` (orquestra
> `findItemsForCorrectionSearch` + `CorrectionSearchService` + `findCorrectionCandidates`) e
> `apply-correction-matches.use-case.ts` (reusa o primeiro e chama `resolveItems`).
>
> Verifique que as 3 assinaturas batem entre si (tipos de entrada/saída compatíveis, nomes de campo
> idênticos entre `CorrectionSearchItem`/`CorrectionEntry`/`CorrectionCandidate`).
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **`GET .../corrections`** para marca sem pendência de saque com CPF → `200`, `items: []`,
   `searchedCount: 0`.
2. **`GET .../corrections`** com pendência cujo CPF não tem `client_id` conhecido (stub sem
   correspondência) → `clientResolved: false`, `candidates: []`.
3. **`GET .../corrections`** com correção de valor exato → candidato `EXACT_SAME_BRAND`, `exact:
   true`.
4. **`POST .../corrections/apply`** dá baixa **só** nas pendências cujo **primeiro** candidato é
   exato — uma pendência com candidato `PARTIAL` em primeiro lugar (mesmo que exista um exato mais
   abaixo, hipoteticamente) permanece `OPEN`.
5. **`POST .../corrections/apply`** é idempotente: chamar duas vezes seguidas — a segunda tem
   `resolvedCount: 0` (a primeira já resolveu via `status=OPEN` no filtro do repositório).
6. **`POST .../corrections/apply`** grava `resolvedBy = <sub do JWT>` (autor humano que apertou o
   botão), **nunca** `'sistema'` (reservado à liquidação de estorno automática).
7. **A busca do `apply` é literalmente a mesma do `GET`:** um teste de integração que injeta um spy
   em `SearchCorrectionsUseCase.execute` e confirma que `ApplyCorrectionMatchesUseCase` o chama com
   os **mesmos parâmetros**, nunca reimplementando a consulta.
8. **ClickHouse indisponível** → `503 Integração com o data warehouse não configurada` nas duas rotas.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/conciliacao-correcoes/FASE-14-TESTE-ORGANICO.sh` agora. Resultado esperado: RED.

## Arquivos a criar

### `src/modules/finance-reconciliation/domain/use-cases/search-corrections.use-case.ts`
Portar literalmente (ver `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §3.4): janela `D−7` a `D`,
os 5 filtros da consulta de pendências candidatas, união das 2 fontes de correção por CPF
(`correctionsByTaxNumber`, unindo por `correctionId` para nunca somar em duplicidade), distinção
`clientResolved: false` × `candidates: []`.

### `.../apply-correction-matches.use-case.ts`
Portar literalmente (§3.5): reusa `SearchCorrectionsUseCase.execute` **sem** repetir a consulta com
outro critério, filtra `isExact` (primeiro candidato com `exact === true`), chama
`resolveItems` (Fase 10) com o mapa `noteById`.

### `src/modules/finance-reconciliation/domain/services/correction-evidence.service.ts`
Orquestra os 2 use-cases + `BrandAccessService`, resolvendo `requireBrand` (marca **exigida**, não
filtrada — o operador escolhe qual marca investigar).

## Atualizar arquivo de registro de rotas/servidor

`reconciliation.controller.ts` (Fase 13) — adicionar as 2 rotas restantes: `GET
/:brand/corrections`, `POST /:brand/corrections/apply`, cada uma com `@Permissions(...)` (a de busca
com `READ`, a de aplicar com `RESOLVE` — escreve, então exige permissão mais forte).
`reconciliation.module.ts` — registrar os 2 use-cases e o service novos.

## Documentação

**Fase com rotas novas.** Swagger para as 2 rotas — a descrição de `corrections` deve explicar o
cenário de negócio (pagamento manual a jogador autoexcluído/bloqueado) e a de `apply` deve deixar
claro que reusa a mesma busca do GET. Responses `200`/`201`/`403`/`503`.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/conciliacao-correcoes/FASE-14-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 14 — Teste Orgânico: Conciliação — evidência de correção
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
PREFIX="/api/v1"
PASS=0; FAIL=0

ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

TOKEN=$(node scripts/auth-dev-token.js finance.reconciliation.read finance.reconciliation.resolve)
AUTH="Authorization: Bearer $TOKEN"

echo ""
echo "=== FASE 14 — Conciliação: evidência de correção ==="
echo ""

SEARCH_BODY=$(curl -s "$BASE_URL$PREFIX/reconciliation/suprema/corrections?date=2026-08-15" -H "$AUTH")
echo "$SEARCH_BODY" | grep -q '"searchedCount"' && ok "GET corrections responde com searchedCount" \
  || fail "GET corrections não devolveu o formato esperado"

APPLY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE_URL$PREFIX/reconciliation/suprema/corrections/apply?date=2026-08-15" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-08-15"}')
[ "$APPLY_STATUS" = "201" ] && ok "POST corrections/apply → 201" \
  || fail "POST corrections/apply → esperado 201, obtido $APPLY_STATUS"

APPLY_BODY_2=$(curl -s -X POST "$BASE_URL$PREFIX/reconciliation/suprema/corrections/apply?date=2026-08-15" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-08-15"}')
echo "$APPLY_BODY_2" | grep -q '"resolvedCount":0' && ok "segunda chamada de apply é idempotente (resolvedCount:0)" \
  || fail "segunda chamada de apply não foi idempotente"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 14 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 14 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Subir a aplicação + stubs e executar
```bash
node scripts/finance-dev-stubs.js &
npm run start:dev &
sleep 5
bash scripts/conciliacao-correcoes/FASE-14-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPattern=finance-reconciliation
```

### 2. Regressão
```bash
bash scripts/conciliacao-api/FASE-13-TESTE-ORGANICO.sh
```

### 3. Criar documento de teste
`scripts/conciliacao-correcoes/FASE-14-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/conciliacao-correcoes/FASE-14-TESTE-ORGANICO.sh` — passa 100%
- [ ] `npm run test:e2e -- --testPathPattern=finance-reconciliation` — passa 100% (cobre os 8 cenários, incluindo os desta fase)
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 13 passa 100%
- [ ] Documentação: Swagger atualizado para as 2 rotas
- [ ] `apply` nunca repete a busca com critério diferente do `GET` — mesmo método, mesmos parâmetros
- [ ] `PARTIAL` nunca recebe baixa automática
- [ ] `apply` é idempotente
- [ ] `resolvedBy` da baixa automática é o `sub` do usuário, nunca `'sistema'`
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
grep -n "this.search.execute\|this.searchCorrections.execute" \
  src/modules/finance-reconciliation/domain/use-cases/apply-correction-matches.use-case.ts
grep -n "PARTIAL" src/modules/finance-reconciliation/domain/use-cases/apply-correction-matches.use-case.ts
```

### Prompt para Haiku

> Confirme que `apply-correction-matches.use-case.ts` chama o use-case de busca (não reimplementa a
> query) e que o filtro de "exato" exclui explicitamente `PARTIAL`. Resposta: **TODOS APROVADOS** ou
> **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco: confirmar, lendo o código,
> que não existe nenhum caminho em `apply` que aceite `differenceCents !== 0` como "exato".
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **15 — Jobs**. Marcar Fase 14 concluída. Neste ponto, **as 14 rotas de
negócio do Finance estão completas** — registrar isso como marco na tabela de status.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-reconciliation/domain/use-cases/search-corrections.use-case.ts \
        src/modules/finance-reconciliation/domain/use-cases/apply-correction-matches.use-case.ts \
        src/modules/finance-reconciliation/domain/services/correction-evidence.service.ts \
        src/modules/finance-reconciliation/presenters/controllers/reconciliation.controller.ts \
        src/modules/finance-reconciliation/reconciliation.module.ts \
        test/finance-reconciliation.e2e-spec.ts \
        scripts/conciliacao-correcoes/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-reconciliation): evidência de correção de saldo — as 14 rotas completas

Fase 14/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 14 concluída, validada e enviada para `feature/migracao-finance`.**
As 14 rotas de negócio do Finance (7 do balanço + 7 da conciliação) estão completas e testadas.
Responder "sim" para iniciar a **Fase 15**.
