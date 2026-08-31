# FASE 12 — Trio — movimentos por bisseção + regressão
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 40**
> Limite: _2 arquivos · risco: classificar estorno como depósito/saque comum (abre pendência falsa — incidente real de 15/08/2026 na Maxima) ou perder a tarifa/tesouraria no meio do casamento_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `TrioMovementsService` (lado `BANK` do casamento — o extrato normalizado em
`Movement[]`) existe, com a classificação correta de tesouraria/estorno/tarifa/comum e o teste de
regressão do caso real de perda de linhas por cursor.

## Pré-requisito

Fase 06 concluída (`TrioBankingClient`, com `listTransactions` já usando bisseção).

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/modules/finance-cash-balance/infrastructure/trio/trio-banking.client.ts` (Fase 06) — assinatura de `listTransactions`, tipo `TrioTransaction`
- `src/modules/finance-reconciliation/domain/reconciliation.types.ts` (Fase 01) — `Movement`
- `src/modules/finance-reconciliation/reconciliation.constants.ts` (Fase 01) — `OWN_TAX_NUMBERS`, `BANK_REF_TYPE_*`, `BANK_TYPE_*`, `BANK_KEY_FIELDS`
- `src/common/utils/uuid.util.ts` — **este arquivo ainda não existe**; a origem usa `timestampFromUuidV7(ref_id)` para extrair o instante do PIX. Se não existir, criar nesta fase (1 função pura, sem I/O)

### Prompt para Haiku

> Leia os 4 pontos acima. Esta fase cria `trio-movements.service.ts`, que importa
> `TrioBankingClient` (Fase 06) de fora de `infrastructure/trio` do **outro** módulo
> (`finance-cash-balance`) — confirme se isso é um import cruzado entre módulos.
>
> Verifique:
> 1. Se `TrioBankingClient` está em `finance-cash-balance/infrastructure/trio/` e este arquivo fica em
>    `finance-reconciliation/infrastructure/trio/`, o import atravessa módulos — a regra 3 do
>    archetype ("colaboração entre módulos só via service exportado") exige que
>    `CashBalanceModule` **exporte** `TrioBankingClient` e que `ReconciliationModule` **importe**
>    `CashBalanceModule` (mesmo padrão da origem: `ReconciliationModule` importa `CashBalanceModule`).
> 2. `common/utils/uuid.util.ts` não existe ainda — confirme antes de assumir que existe.
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]** — se o problema for (1),
> descrever como bloqueio e aplicar o protocolo de decisão (as 3 opções já estão implícitas: (a)
> `ReconciliationModule` importa `CashBalanceModule` e usa o `TrioBankingClient` exportado — como a
> origem faz; (b) duplicar um cliente Trio dentro de `finance-reconciliation` — **não recomendado**,
> duplica a lógica de bisseção; (c) mover `TrioBankingClient` para uma pasta compartilhada fora dos
> dois módulos — maior escopo do que esta fase pede). Recomendação: opção (a).

> **Se BLOQUEADO:** aplicar a opção (a) — ajustar `reconciliation.module.ts` para importar
> `CashBalanceModule` e confirmar que `cash-balance.module.ts` exporta `TrioBankingClient` (ajuste de
> 1 linha, dentro do orçamento desta fase). **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **Classificação por sinal:** `amount < 0` (convenção Trio: negativo entra) → `DEPOSIT`;
   `amount > 0` → `WITHDRAWAL`.
2. **Tesouraria:** contraparte no CNPJ próprio (`OWN_TAX_NUMBERS`) → `flow: TREASURY`,
   **independente do sinal**.
3. **Estorno — herda o fluxo da operação original, não o sinal:** `ref_type = 'payment_refund'`
   (que é um crédito, sinal indicaria `DEPOSIT`) → `flow: WITHDRAWAL` (porque `payment_refund`
   começa com o prefixo de `payment`). Este é o teste de regressão direto do incidente de 15/08/2026
   na Maxima (chave 778446251, R$ 1.000,00).
4. **`collection_refund`** → `flow: DEPOSIT` (prefixo `collection`).
5. **Tarifa (`transaction_type = 'fee'`):** não entra em `movements[]` — soma em `fees.total`/`count`
   separadamente; `amount` da tarifa é somado em valor absoluto.
6. **`transaction_type` diferente de `regular`/`fee`:** ignorado (nem `movements`, nem `fees`).
7. **Chave do casamento — `external_id` é o campo padrão:** com `RECONCILIATION_BANK_KEY_FIELD` não
   configurado, usa `external_id`; com valor inválido no config, cai para `external_id` **com log de
   erro** (não derruba o processo).
8. **`occurredAt` vem do UUIDv7 do `ref_id`,** não de `transaction_date` (que a Trio sempre devolve
   nulo).
9. **Aviso de lançamento sem chave (fora de `TREASURY`):** contagem de `withoutKey` exclui
   tesouraria (transferência pelo painel da Trio vem sem `external_id` de propósito — não é alarme
   real).
10. **Regressão do bug de cursor:** usando o `TrioBankingClient` real (não mockado — ou mockado só na
    camada HTTP, exercitando a bisseção de verdade) com um stub que simula 2 lançamentos no mesmo
    microssegundo (o lançamento e a tarifa) espalhados por uma janela com `has_more: true` no meio,
    confirmar que **as 2 linhas aparecem**, nunca 1.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/trio-movimentos/FASE-12-TESTE-ORGANICO.sh` agora. Resultado esperado: RED —
> `trio-movements.service.ts` ainda não existe.

## Arquivos a criar

### `src/common/utils/uuid.util.ts` (se ainda não existir)
**Motivo:** `timestampFromUuidV7(uuid): Date` — extrai o instante em milissegundos embutido nos
primeiros 48 bits de um UUIDv7. Usado para datar o lançamento do lado banco (a Trio nunca informa
`transaction_date`, mas o `ref_id` é UUIDv7).

### `src/modules/finance-reconciliation/infrastructure/trio/trio-movements.service.ts`
**Motivo:** normaliza o extrato da Trio em `Movement[]` (lado `BANK`) para o casamento. Portar
literalmente `fetchMovements`, `toMovement`, `flowOf` (a classificação — tesouraria → estorno (herda
fluxo pelo prefixo do `ref_type`) → sinal, **nesta ordem de prioridade**), `externalKeyOf` (campo
configurável, `RECONCILIATION_BANK_KEY_FIELD`). Depende de `TrioBankingClient` (Fase 06, via
`CashBalanceModule` exportado — ver Pre-flight) e `reconciliationConfig.bankKeyField` (Fase 03).

## Atualizar arquivo de registro de rotas/servidor

`reconciliation.module.ts` — importar `CashBalanceModule` (se ainda não importado) e registrar
`TrioMovementsService` como provider, exportando-o para a Fase 13.
`cash-balance.module.ts` — confirmar que `TrioBankingClient` está em `exports: [...]`.

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/trio-movimentos/FASE-12-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 12 — Teste Orgânico: Trio — movimentos por bisseção
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 12 — Trio — movimentos por bisseção ==="
echo ""

OUTPUT=$(npx jest src/modules/finance-reconciliation/infrastructure/trio --verbose 2>&1)
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "specs — exit 0" || fail "specs falharam — exit $STATUS"

echo "$OUTPUT" | grep -qi "payment_refund\|778446251\|estorno" \
  && ok "teste de regressão do estorno (Maxima 15/08) presente" \
  || fail "teste de regressão do estorno ausente"

echo "$OUTPUT" | grep -qi "mesmo microssegundo\|2 linhas\|cursor" \
  && ok "teste de regressão do bug de cursor presente" \
  || fail "teste de regressão do cursor ausente — risco de perder linha em empate de timestamp"

npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas (import cruzado entre módulos?)" \
  || ok "architecture.spec.ts 100% verde"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 12 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 12 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/trio-movimentos/FASE-12-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/clickhouse-conciliacao/FASE-11-TESTE-ORGANICO.sh
```

### 3. Criar documento de teste
`scripts/trio-movimentos/FASE-12-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/trio-movimentos/FASE-12-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 11 passa 100%; `architecture.spec.ts` continua verde
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] Estorno herda o fluxo da operação original pelo prefixo do `ref_type`, nunca pelo sinal
- [ ] Tesouraria classificada antes de qualquer outra regra (prioridade correta)
- [ ] Tarifa nunca entra em `movements[]`
- [ ] `CashBalanceModule` exporta `TrioBankingClient`; `ReconciliationModule` o importa — sem duplicação de cliente Trio
- [ ] Teste de regressão do bug de cursor (empate de microssegundo) presente e verde
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
grep -n "flowOf" src/modules/finance-reconciliation/infrastructure/trio/trio-movements.service.ts
grep -n "from '.*finance-cash-balance" src/modules/finance-reconciliation/**/*.ts 2>/dev/null
```

### Prompt para Haiku

> Leia `flowOf` inteiro. Confirme a ordem exata: (1) `OWN_TAX_NUMBERS` primeiro, (2) sufixo
> `_refund` do `ref_type` segundo, (3) sinal do valor por último — nesta ordem, não outra. Confirme
> que qualquer import de `finance-cash-balance` vem só do módulo (`cash-balance.module` exportado),
> nunca de um arquivo interno de `infrastructure/`.
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco: reconstruir o incidente de
> 15/08/2026 (estorno de saque, R$1.000,00, chave 778446251) e confirmar, lendo o código linha a
> linha, que ele produziria `flow: WITHDRAWAL` (não `DEPOSIT`) com a implementação atual.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **13 — Conciliação: use-cases núcleo**. Marcar Fase 12 concluída. Registrar
a decisão de import cruzado (`ReconciliationModule` importa `CashBalanceModule`) na convenção
consolidada do módulo.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/common/utils/uuid.util.ts \
        src/modules/finance-reconciliation/infrastructure/trio/ \
        src/modules/finance-reconciliation/reconciliation.module.ts \
        src/modules/finance-cash-balance/cash-balance.module.ts \
        scripts/trio-movimentos/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-reconciliation): normalização do extrato Trio (lado banco)

Fase 12/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 12 concluída, validada e enviada para `feature/migracao-finance`.**
O extrato do banco é classificado corretamente (tesouraria → estorno → sinal) e a bisseção não perde
linha em empate de timestamp. Responder "sim" para iniciar a **Fase 13**.
