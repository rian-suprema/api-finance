# FASE 10 — Persistência da Conciliação (repositório)
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 40**
> Limite: _3 arquivos · risco: perder a identidade natural do item (chave = `reference_date+brand+bank+side+item_key`, NÃO `run_id`) e apagar nota de operador numa reexecução_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, a persistência da conciliação existe — `startRun`/`failRun`/`saveResult` (a
transação que apaga pendência falsa sem nota, preserva pendência com nota, e nunca sobrescreve
nota/status/autor de tratamento humano) e as leituras (`findRuns`, `findRunsInRange`,
`countItemsInRange`, `findItems`, `countItems`, `findItemById`,
`findItemsForCorrectionSearch`, `resolveItems`, `resolveItem`, `reopenItem`).

## Pré-requisito

Fase 04 concluída (entidades `ReconciliationRun`/`ReconciliationItem` + migration aplicada).

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/modules/finance-reconciliation/entities/reconciliation-run.entity.ts` e `reconciliation-item.entity.ts` (Fase 04)
- `src/modules/finance-reconciliation/domain/reconciliation.types.ts` (Fase 01) — `Movement`, `SettledMovement`, `RunTotals`
- `docs/migracao-finance/DADOS-FINANCE.md` (seção 4.2, "A identidade é a chave natural, não o `run_id`")

### Prompt para Haiku

> Leia os 4 arquivos. Esta fase escreve `saveResult`, que faz upsert de `ReconciliationItem` pela
> chave `(referenceDate, brand, bank, side, itemKey)` — **não** por `id` nem por `runId`.
>
> Verifique:
> 1. A entidade `ReconciliationItem` tem um índice único exatamente nessas 5 colunas (criado na
>    migration da Fase 04) — confirme o nome/colunas do `@Unique(...)` na entidade.
> 2. `Movement`/`SettledMovement` (tipos da Fase 01) têm os campos que o repositório vai persistir
>    (`side`, `flow`, `key`, `amountCents`, `occurredAt`, `externalKey`, `endToEndId`,
>    `counterpartyName`, `counterpartyTaxNumber`).
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **`startRun` é upsert por `(referenceDate, brand, bank)`:** chamar duas vezes para o mesmo dia+
   marca+banco preserva o `id` da primeira execução.
2. **`saveResult` — pendência sem nota que sumiu é DELETADA:** gravar um item `OPEN` sem nota, rodar
   `saveResult` de novo sem esse item na lista de `pending` → a linha desaparece do banco.
3. **`saveResult` — pendência COM nota que sumiu vira `stillPending: false`, não é deletada:** mesmo
   cenário, mas o item tinha `status: RESOLVED` com nota → linha permanece, `stillPending = false`.
4. **`saveResult` — upsert nunca sobrescreve nota/status/autor de item ainda pendente na lista:** um
   item que continua em `pending` na segunda execução mantém seus dados de fato atualizados
   (valor, chave) mas — se já tinha sido tratado por engano antes de a regra normal impedir isso —
   nota/status/autor não mudam via este caminho (o upsert de "pending" só atualiza campos de fato,
   nunca `note`/`status`/`resolvedBy`).
5. **`saveResult` — estornos liquidados (`settled`) nunca sobrescrevem nota HUMANA:** um item já
   `RESOLVED` por um `userId` real (não `'sistema'`) não tem a nota trocada quando o mesmo item
   aparece em `settled` numa reexecução.
6. **`saveResult` — `platformReprocessPending` é recalculado a cada execução:** de `true` para
   `false` quando o item de estorno reaparece sem o sinalizador.
7. **`resolveItem`/`reopenItem` recalculam `pending_count` do run correspondente** — ler
   `reconciliation_runs.pending_count` após cada operação e confirmar que bate com a contagem real de
   `OPEN AND still_pending`.
8. **`resolveItems` (baixa em lote) é idempotente:** chamar duas vezes com os mesmos ids — a segunda
   não altera nada (filtro `status = OPEN`), e `resolvedCount` da segunda chamada é `0`.
9. **`countItemsInRange`/`findRunsInRange` agregam no banco:** não trazem linha nenhuma de item — só
   contagens (confirmar via `groupBy`, não `findMany` + contagem em memória).
10. **`findItemsForCorrectionSearch`:** só devolve itens `side=BANK, flow=WITHDRAWAL, status=OPEN,
    stillPending=true, counterpartyTaxNumber IS NOT NULL` — um item de depósito ou de tesouraria não
    aparece mesmo que atenda aos outros filtros.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/persistencia-conciliacao/FASE-10-TESTE-ORGANICO.sh` agora. Resultado esperado:
> RED — o repositório ainda não existe.

## Arquivos a criar

### `src/modules/finance-reconciliation/reconciliation.constants.ts` (se ainda não coberto pela Fase 01 — confirmar no Pre-flight; caso já exista, esta fase só adiciona o que faltar)

### `src/modules/finance-reconciliation/infrastructure/reconciliation-run.repository.ts`
**Motivo:** persistência da execução (`ReconciliationRun`). Portar `startRun`, `failRun`,
`findRuns`, `findRunsInRange`. Se o arquivo único da origem (692 linhas) for partido em run/item —
decisão desta trilha, ver `docs/migracao-finance/MIGRACAO-FINANCE.md` Onda 3 — este arquivo cobre só
o que toca `ReconciliationRun`; `saveResult` fica no repositório de item porque grava as duas tabelas
na mesma transação (ver abaixo — decidir, ao implementar, em qual dos dois arquivos `saveResult`
mora; recomendação: no de **item**, por tocar mais linhas de `ReconciliationItem`, chamando de lá um
método `updateRunTotals` exposto pelo repositório de run).

### `src/modules/finance-reconciliation/infrastructure/reconciliation-item.repository.ts`
**Motivo:** persistência da pendência — a tabela mais sensível do módulo (identidade por chave
natural, não por `runId`; único `DELETE` físico de dado de negócio do Finance). Portar `saveResult`
(a transação de 4 partes: apaga OPEN sem nota que sumiu, atualiza `stillPending=false` em RESOLVED que
sumiu, upsert dos `pending` atuais sem tocar nota/status/autor, upsert dos `settled` respeitando nota
humana), `findItems`, `countItems`, `findItemById`, `findItemsForCorrectionSearch`, `resolveItems`
(lote), `resolveItem`, `reopenItem`, `countItemsInRange`, e o `refreshPendingCount` privado
compartilhado pelos 3 últimos.

## Atualizar arquivo de registro de rotas/servidor

Registrar `TypeOrmModule.forFeature([ReconciliationRun, ReconciliationItem])` e os 2 repositórios como
providers em `reconciliation.module.ts` (ainda vazio desde a Fase 03) — exportar para a Fase 13.

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/persistencia-conciliacao/FASE-10-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 10 — Teste Orgânico: Persistência da Conciliação
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 10 — Persistência da Conciliação ==="
echo ""

OUTPUT=$(npx jest src/modules/finance-reconciliation/infrastructure --verbose 2>&1)
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "npx jest infrastructure — exit 0" || fail "specs falharam — exit $STATUS"

echo "$OUTPUT" | grep -qi "nunca sobrescreve\|nota human" \
  && ok "teste de preservação de nota humana presente" \
  || fail "teste de preservação de nota humana ausente — risco de apagar trabalho de operador"

echo "$OUTPUT" | grep -qi "idempotente" \
  && ok "teste de idempotência da baixa em lote presente" \
  || fail "teste de idempotência ausente"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 10 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 10 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/persistencia-conciliacao/FASE-10-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/schema-financeiro/FASE-04-TESTE-ORGANICO.sh
```

### 3. Validação no banco
Rodar o cenário 2 manualmente e confirmar via `psql` que a linha some de fato (`SELECT` vazio).

### 4. Criar documento de teste
`scripts/persistencia-conciliacao/FASE-10-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/persistencia-conciliacao/FASE-10-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 04 passa 100%
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] Item `OPEN` sem nota que sumiu é deletado; item `RESOLVED` com nota que sumiu vira `stillPending: false`
- [ ] Nota/status/autor humano nunca sobrescritos por upsert de `pending` nem de `settled`
- [ ] `pending_count` do run é recalculado após `resolveItem`/`reopenItem`/`resolveItems`
- [ ] `resolveItems` é idempotente (`status = OPEN` no filtro)
- [ ] `countItemsInRange`/`findRunsInRange` agregam no banco, não em memória
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
grep -n "note:\|status:\|resolvedBy:" \
  src/modules/finance-reconciliation/infrastructure/reconciliation-item.repository.ts | grep -A2 -B2 "update:"
```

### Prompt para Haiku

> Leia `reconciliation-item.repository.ts` inteiro. Confirme que o bloco de `saveResult` que faz
> upsert dos itens **pendentes** (não os `settled`) nunca inclui `note`/`status`/`resolvedBy` no seu
> `update`. Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [arquivo:linha]**.

> **Se VIOLAÇÕES:** corrigir — é a regra mais importante desta fase. **Se APROVADO:** continuar com
> `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco: simular mentalmente uma
> pendência tratada por um operador humano, depois uma reexecução da conciliação que ainda vê o
> lançamento pendente — confirmar linha a linha que a nota do operador sobrevive.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **11 — ClickHouse da Conciliação**. Marcar Fase 10 concluída.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-reconciliation/infrastructure/ \
        src/modules/finance-reconciliation/reconciliation.constants.ts \
        src/modules/finance-reconciliation/reconciliation.module.ts \
        scripts/persistencia-conciliacao/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-reconciliation): repositório de execução e de pendências

Fase 10/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 10 concluída, validada e enviada para `feature/migracao-finance`.**
A identidade por chave natural e a preservação de nota humana estão provadas por teste.
Responder "sim" para iniciar a **Fase 11**.
