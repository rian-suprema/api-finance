# FASE 02 — Domínio puro — Balanço de Caixa
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 25**
> Limite: _2 arquivos · risco: inverter o sinal do Total do Balanço (incidente corrigido em 30/07/2026, 4 pontos)_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `src/modules/finance-cash-balance/domain/kpi-card.util.ts` e
`cash-balance.types.ts` existem, portados literalmente, com o sinal `Total do Balanço = Saldo
Transacional − Saldo de Jogadores` travado por teste nomeado explicitamente pelo sinal.

## Pré-requisito

Fase 01 concluída — provê `src/common/utils/number.util.ts` (`roundCurrency`), usado por
`buildKpiCard`/`subtractByBrand`/`divideByBrand`.

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/common/utils/number.util.ts` — confirmar assinatura de `roundCurrency(value: number): number`
- `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` (seção 2.2) — a fórmula e o histórico do sinal

### Prompt para Haiku

> Leia os arquivos listados. Esta fase cria `kpi-card.util.ts`, que importa `roundCurrency` de
> `../../../common/utils/number.util.ts`.
>
> Verifique:
> 1. `roundCurrency` existe e aceita `number`, devolve `number`.
> 2. O caminho relativo de `src/modules/finance-cash-balance/domain/` até `src/common/utils/` é
>    `../../../common/utils/` (3 níveis).
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **`buildKpiCard`:** com `brands = ['suprema','ultra']` e um `Map` com valor só para `suprema`,
   `byBrand` traz as duas marcas na ordem do array (não do Map), `ultra` com `amount: 0`; `total` é a
   soma arredondada.
2. **`subtractByBrand`:** união das chaves dos dois mapas — marca presente só no segundo mapa entra
   com `left = 0`.
3. **`divideByBrand`:** divisor `0` ou negativo devolve `Map` vazio, nunca `NaN`/`Infinity`.
4. **Sinal do Total do Balanço — teste nomeado explicitamente:** dado `saldoTransacional = 1000` e
   `saldoJogadores = 700`, o total é **`+300`** (transacional menos jogadores), nunca `-300`. Nome do
   teste deve conter literalmente "sinal" ou "transacional menos jogadores", para que uma futura
   inversão apareça no nome do teste que falhou, não só no valor.
5. **Arredondamento:** valores com dízima (ex.: `0.1 + 0.2`) não produzem erro de ponto flutuante no
   resultado de `buildKpiCard`/`subtractByBrand`.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/dominio-balanco-caixa/FASE-02-TESTE-ORGANICO.sh` agora e confirmar RED (o módulo
> `kpi-card.util.ts` ainda não existe).

## Arquivos a criar

### `src/modules/finance-cash-balance/domain/cash-balance.types.ts`
**Motivo:** os tipos consumidos pelo `kpi-card.util.ts` desta fase e pelos use-cases das Fases 7–8.
Portar literalmente da origem: `BrandAmount`, `KpiCard`, `CashBalanceSummary`, `BankState`,
`BrandBanksState`, `CashBalanceBanksState`, `TrioBalance`, `BrandAccess`, `RegisterBrandResult`,
`CashBalanceHistory`, `HistoryAmounts`, `HistoryBrandRow`, `HistoryDay`, `HistoryKpis`, `HistoryTotals`.

### `src/modules/finance-cash-balance/domain/kpi-card.util.ts`
**Motivo:** montagem dos cards de KPI, compartilhada pelos use-cases de leitura (tela do dia e
histórico), garantindo o mesmo formato e a mesma ordem de marcas nos dois lugares.
```ts
export function buildKpiCard(brands: BrandKey[], amounts: Map<BrandKey, number>): KpiCard
export function subtractByBrand(left: Map<BrandKey, number>, right: Map<BrandKey, number>): Map<BrandKey, number>
export function divideByBrand(amounts: Map<BrandKey, number>, divisor: number): Map<BrandKey, number>
```
`buildKpiCard` depende de `BRANDS` (catálogo — chega na Fase 07 via `cash-balance.constants.ts`; **por
enquanto**, esta fase recebe `brands: BrandKey[]` já resolvidos e um `label` fixo por chave dentro do
próprio arquivo de teste, sem importar o catálogo ainda — para não criar dependência cruzada com uma
fase futura). Se o `label` precisar do catálogo real, declare `BrandKey = string` provisoriamente
neste arquivo e ajuste a assinatura na Fase 07 quando `cash-balance.constants.ts` existir — registrar
essa decisão como nota da fase.

### Spec colocalizado
`kpi-card.util.spec.ts` — um `it()` por cenário acima.

## Atualizar arquivo de registro de rotas/servidor

Não aplicável — sem controller nesta fase.

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/dominio-balanco-caixa/FASE-02-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 02 — Teste Orgânico: Domínio puro do Balanço de Caixa
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 02 — Domínio puro do Balanço de Caixa ==="
echo ""

OUTPUT=$(npx jest src/modules/finance-cash-balance/domain --verbose 2>&1)
STATUS=$?

echo "$OUTPUT" | grep -qi "sinal\|transacional menos jogadores" \
  && ok "teste nomeado pelo sinal do Total do Balanço presente" \
  || fail "nenhum teste nomeado explicitamente pelo sinal — risco de regressão silenciosa"

[ "$STATUS" -eq 0 ] && ok "npx jest domain — exit 0" || fail "npx jest domain — exit $STATUS"

if grep -rlE "from '(typeorm|@nestjs/typeorm|axios|@clickhouse/client)'" \
     src/modules/finance-cash-balance/domain/ 2>/dev/null | grep -q .; then
  fail "domain/ importa infraestrutura"
else
  ok "domain/ sem import de infraestrutura"
fi

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 02 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 02 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/dominio-balanco-caixa/FASE-02-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.sh
```
Qualquer `❌` = regressão — corrigir antes de concluir.

### 3. Criar documento de teste
`scripts/dominio-balanco-caixa/FASE-02-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/dominio-balanco-caixa/FASE-02-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: `FASE-01-TESTE-ORGANICO.sh` passa 100%
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] Existe um teste cujo nome referencia explicitamente o sinal do Total do Balanço
- [ ] `divideByBrand` nunca produz `NaN`/`Infinity` para divisor ≤ 0
- [ ] Zero import de infraestrutura em `domain/`
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
grep -n "saldoTransacional.*-.*saldoJogadores\|saldoJogadores.*-.*saldoTransacional" \
  src/modules/finance-cash-balance/domain/**/*.spec.ts 2>/dev/null
grep -rn "from 'typeorm'\|from 'axios'" src/modules/finance-cash-balance/domain/
```

### Prompt para Haiku

> Leia `kpi-card.util.ts` e o spec. Confirme que nenhum teste calcula
> `saldoJogadores - saldoTransacional` esperando esse resultado como "correto" — a ordem certa é
> sempre transacional menos jogadores. Responda **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo, sem histórico: Critérios de Aceite + `git diff` + saída GREEN do teste. Instrução:
> tentar refutar que o sinal está correto — construir mentalmente um caso onde `saldoJogadores >
> saldoTransacional` e confirmar que o teste cobre esse caso com resultado negativo esperado (alerta),
> não positivo.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 da Fase 01 (`node scripts/update-phase-cost.js`, verificar `progress.json` e
`EMBEDDED`, abrir best-effort).

## Atualizar CLAUDE.md

Avançar "Fase atual" para **03 — Esqueleto não-funcional**. Marcar Fase 02 concluída. Registrar se a
decisão sobre `BrandKey` provisório (ver "Arquivos a criar") precisou de ajuste na Fase 07.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-cash-balance/domain/ scripts/dominio-balanco-caixa/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-cash-balance): porta domínio puro do balanço de caixa

Fase 02/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 02 concluída, validada e enviada para `feature/migracao-finance`.**
O sinal do Total do Balanço está travado por teste nomeado explicitamente. Responder "sim" para
iniciar a **Fase 03**.
