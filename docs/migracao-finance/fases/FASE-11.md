# FASE 11 — ClickHouse da Conciliação (movimentos + busca de correção)
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 35**
> Limite: _3 arquivos · risco: esquecer `FINAL` (linha duplicada infla casamento/correção) ou usar o instante errado (`withdrawal_ts` em vez de `transaction_date` — diferença real de R$ 5.755,00 documentada na origem)_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `PlatformMovementsService` (depósitos/saques aprovados da plataforma, lado
`PLATFORM` do casamento) e `CorrectionSearchService` (busca de correção de saldo para explicar
pendência de saque) existem, lendo os marts corretos com `FINAL` e os instantes corretos por fluxo.

## Pré-requisito

Fase 05 concluída (`ClickHouseService`).

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/clickhouse/clickhouse.service.ts` — assinatura de `query<T>`
- `src/modules/finance-reconciliation/domain/reconciliation.types.ts` (Fase 01) — o tipo `Movement`
- `src/modules/finance-reconciliation/domain/correction-matcher.ts` (Fase 01) — o tipo `CorrectionEntry`
- `docs/migracao-finance/DADOS-FINANCE.md` (seção 10) — as 5 queries e os 4 detalhes de leitura

### Prompt para Haiku

> Leia os 4 arquivos. Esta fase cria 2 serviços que consultam `dw_bet.fct_deposit`,
> `dw_bet.fct_withdrawal` e `dw_bet.fct_correction`, mapeando linhas para `Movement`/`CorrectionEntry`.
>
> Verifique:
> 1. `Movement` tem exatamente os campos que as queries vão preencher (`side`, `flow`, `key`,
>    `amountCents`, `core`, `occurredAt`, `externalKey`).
> 2. `CorrectionEntry` tem `correctionId`, `brand`, `clientId`, `correctionDate`, `occurredAt`,
>    `amountCents`.
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **`fetchMovements` — depósito usa `deposit_ts`, saque usa `transaction_date`:** o teste monta duas
   linhas fake (mock de `ClickHouseService.query`) e confirma que `occurredAt` de cada `Movement` vem
   do campo certo por fluxo — não pode ser o mesmo campo para os dois.
2. **`fetchMovements` — `core` reflete a janela núcleo:** lançamento com `occurredAt` dentro de
   `[coreFrom, coreTo)` → `core: true`; fora (mas dentro da janela alargada `[from, to)`) → `core: false`.
3. **`fetchMovements` — sem `gateway_external_id`:** `externalKey` fica `undefined` (não string
   vazia) — é o que faz o item virar pendência por falta de chave no casamento (Fase 01).
4. **`fetchMovements` — não filtra `source_system`:** confirmar que a query montada **não** contém
   `source_system` no `WHERE` (grep no SQL literal do teste) — filtrar abriria pendência falsa para
   depósito de outro canal que cai na mesma conta bancária.
5. **`fetchDownCorrectionsByTaxNumber` usa `FINAL`:** a string da query contém `FINAL` logo após
   `FROM dw_bet.fct_correction`.
6. **`resolveClients` — ponte por `pix_key`:** filtra `pix_key_type = 'CPF'`, usa `DISTINCT` (não
   `any()`) — dois `client_id` para o mesmo CPF na mesma marca **ambos** entram no resultado.
7. **Datas/marcas sempre via `query_params`:** nenhuma das 5 queries desta fase interpola valor na
   string (mesma verificação estrutural da Fase 05, agora aplicada a estas duas classes).

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/clickhouse-conciliacao/FASE-11-TESTE-ORGANICO.sh` agora. Resultado esperado: RED
> — os 2 serviços ainda não existem.

## Arquivos a criar

### `src/modules/finance-reconciliation/infrastructure/clickhouse/platform-movements.service.ts`
**Motivo:** lado `PLATFORM` do casamento. Portar literalmente as 2 queries (`DEPOSITS_QUERY`,
`WITHDRAWALS_QUERY`, ambas com `FINAL` — `ReplacingMergeTree`) e `fetchMovements`, `toMovement`. Regras
que **não podem regredir** (ver `docs/migracao-finance/DADOS-FINANCE.md` §10):
- Depósito: instante = `deposit_ts`. Saque: instante = `coalesce(transaction_date, withdrawal_ts)`
  — **nunca** o inverso.
- `state_normalized = 'APPROVED'` nas duas.
- **Sem** filtro de `source_system`.
- Janela `[from, to)` alargada (`D−1` a `D+1`) para `crossEdge`; `core` calculado contra a janela
  núcleo (`coreFrom`/`coreTo`) recebida como parâmetro.

### `src/modules/finance-reconciliation/infrastructure/clickhouse/correction-search.service.ts`
**Motivo:** evidência para a pendência de saque. Portar literalmente as 3 queries
(`CORRECTIONS_BY_TAX_NUMBER_QUERY` — caminho definitivo, `FINAL`; `CLIENT_BRIDGE_QUERY` — ponte por
`pix_key`; `CORRECTIONS_QUERY` — correções por `client_id`, `FINAL`) e `fetchDownCorrectionsByTaxNumber`,
`resolveClients`, `fetchDownCorrections`, `toEntry`. **Nunca** logar o CPF — só contagens.

### Specs colocalizados
`platform-movements.service.spec.ts` (cenários 1–4), incluído no mesmo arquivo ou em
`correction-search.service.spec.ts` (cenários 5–6) — mock de `ClickHouseService.query`.

## Atualizar arquivo de registro de rotas/servidor

Registrar os 2 serviços como providers em `reconciliation.module.ts`.

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/clickhouse-conciliacao/FASE-11-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 11 — Teste Orgânico: ClickHouse da Conciliação
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 11 — ClickHouse da Conciliação ==="
echo ""

OUTPUT=$(npx jest src/modules/finance-reconciliation/infrastructure/clickhouse --verbose 2>&1)
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "specs — exit 0" || fail "specs falharam — exit $STATUS"

echo "$OUTPUT" | grep -qi "transaction_date\|deposit_ts" \
  && ok "teste do instante correto por fluxo presente" \
  || fail "teste do instante por fluxo ausente — risco de diferença de caixa sem pendência (caso real R\$5.755,00)"

grep -c "FINAL" src/modules/finance-reconciliation/infrastructure/clickhouse/*.ts | \
  awk -F: '{sum+=$2} END {exit (sum>=4)?0:1}' \
  && ok "FINAL presente nas queries de fct_deposit/fct_withdrawal/fct_correction" \
  || fail "FINAL ausente em alguma query — risco de linha duplicada"

grep -n "source_system" src/modules/finance-reconciliation/infrastructure/clickhouse/platform-movements.service.ts \
  && fail "filtro de source_system encontrado — abriria pendência falsa" \
  || ok "sem filtro de source_system"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 11 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 11 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/clickhouse-conciliacao/FASE-11-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/persistencia-conciliacao/FASE-10-TESTE-ORGANICO.sh
```

### 3. Criar documento de teste
`scripts/clickhouse-conciliacao/FASE-11-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/clickhouse-conciliacao/FASE-11-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 10 passa 100%
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] Depósito usa `deposit_ts`; saque usa `coalesce(transaction_date, withdrawal_ts)` — nunca trocados
- [ ] `FINAL` presente nas 3 queries sobre `ReplacingMergeTree`
- [ ] Zero filtro de `source_system`
- [ ] Zero interpolação de valor dinâmico na string SQL
- [ ] Zero log de CPF
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
grep -n "deposit_ts\|transaction_date\|withdrawal_ts" \
  src/modules/finance-reconciliation/infrastructure/clickhouse/platform-movements.service.ts
grep -n "logger\." src/modules/finance-reconciliation/infrastructure/clickhouse/correction-search.service.ts
```

### Prompt para Haiku

> Execute os comandos. Confirme: (1) a query de depósito usa `deposit_ts` e a de saque usa
> `transaction_date`/`withdrawal_ts` via `coalesce`, nunca o campo do outro fluxo; (2) nenhum
> `logger.*` em `correction-search.service.ts` referencia CPF/`taxNumber`/`documento` diretamente — só
> contagens.
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco: reconstruir o caso real de
> R$5.755,00 na ULTRA (saque pedido 23:53, liberado 00:05 do dia seguinte) e confirmar que a query de
> saque usa o instante da liberação, não do pedido.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **12 — Trio: movimentos por bisseção**. Marcar Fase 11 concluída.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-reconciliation/infrastructure/clickhouse/ \
        src/modules/finance-reconciliation/reconciliation.module.ts \
        scripts/clickhouse-conciliacao/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-reconciliation): leitura de movimentos e correção no ClickHouse

Fase 11/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 11 concluída, validada e enviada para `feature/migracao-finance`.**
O lado plataforma do casamento e a busca de correção usam o instante certo por fluxo e `FINAL` onde
precisa. Responder "sim" para iniciar a **Fase 12**.
