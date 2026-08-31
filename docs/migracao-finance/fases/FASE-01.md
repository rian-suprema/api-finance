# FASE 01 — Domínio puro — Conciliação + golden dataset
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 35**
> Limite: _7 arquivos · risco: reintroduzir, sem saber, um dos 3 incidentes reais já corrigidos na origem (casamento por valor, estorno classificado como depósito, sinal invertido)_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `src/modules/finance-reconciliation/domain/` contém a lógica pura de casamento
da conciliação bancária (matcher, liquidação de estorno, casamento de correção, montagem de totais) —
sem nenhum import de TypeORM, HTTP, Prisma ou ClickHouse — coberta por testes unitários contra um
golden dataset fixo, travando os 3 incidentes reais documentados na origem.

## Pré-requisito

Nenhuma fase anterior. Esta é a primeira fase da trilha — cria a branch única que recebe todas as
fases seguintes.

## 🔀 Configuração de Git da Trilha

> Executar antes do Pre-flight Check. Só se aplica à Fase 01 — as fases seguintes herdam a branch já
> criada aqui e vão direto para o Pre-flight Check.

### 1. Confirmar branch atual
```bash
git branch --show-current
```
Se não for `main`: **PARAR** e perguntar ao usuário se deseja trocar para `main` antes de continuar.

### 2. Confirmar que `main` está atualizada com o remoto
```bash
git fetch origin main
git status -uno
```
Se `main` estiver atrás do remoto: **PARAR** e perguntar se deseja `git pull` antes de criar a branch.

### 3. Criar a branch única da trilha
```bash
git checkout -b feature/migracao-finance
```

### 4. Confirmar
```bash
git branch --show-current   # deve mostrar feature/migracao-finance
```

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora, antes de escrever qualquer código.**

### Arquivos a ler
- `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` (seção 3.0 — "O casamento") — as regras completas do matcher e da liquidação de estorno
- `src/architecture.spec.ts` — confirmar que `src/modules/**` já é alcançado pelas regras de organização (`entities/`, `dto/`) sem exigir controller/módulo NestJS ainda existente

### Prompt para Haiku

> Leia os arquivos listados. Esta fase cria só lógica pura (funções TypeScript, sem decorators do
> Nest, sem import de typeorm/axios/@clickhouse) dentro de `src/modules/finance-reconciliation/domain/`.
>
> Verifique:
> 1. Nenhuma regra do `architecture.spec.ts` exige que `src/modules/<nome>/` tenha um `*.module.ts`
>    para existir (confirmar lendo o arquivo — a regra de ciclos e a de `entities/`/`dto/` não impõem isso).
> 2. O diretório `src/modules/finance-reconciliation/` ainda não existe (para não colidir com trabalho
>    de outra sessão).
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [arquivo — conflito específico]**.

> **Se BLOQUEADO:** resolver o conflito descrito antes de prosseguir para "Testes a escrever".
> **Se APROVADO:** fechar sub-agente e continuar abaixo.

## Testes a escrever

Cenários (todos contra o golden dataset — ver "Arquivos a criar" para o fixture):

1. **Happy path do casamento:** depósito e saque com a mesma `externalKey` nos dois lados → `matchedCount` incrementa, nenhum dos dois sobra em `pending`.
2. **Lançamento sem chave (`externalKey` ausente):** vira pendência direto — nunca casa por proximidade de valor ou instante. `withoutKey` conta 1.
3. **Chave repetida do mesmo lado:** `duplicateKeys` conta 1; os pares casam por ordem (`core` primeiro).
4. **Virada do dia:** par cujo lado plataforma está fora do dia de referência (`core = false`) e o lado banco está dentro → `crossEdge.count = 1`, `crossEdge.total` reflete o deslocamento correto na direção certa (positivo quando o banco lançou hoje e a plataforma no vizinho).
5. **Par com os dois lados fora do dia:** ignorado — não conta como `matched` nem como pendência (pertence ao dia vizinho).
6. **Tesouraria:** lançamento com contraparte no CNPJ próprio nunca aparece no fluxo `DEPOSIT`/`WITHDRAWAL` — é classificado à parte e nunca é pendência (regra de `flowOf`, mas a montagem de `Movement` de teste já entra classificada — o teste cobre que `filterFlow`/`sumCore` tratam `TREASURY` corretamente, nunca somando com os outros fluxos).
7. **Estorno liquida as 3 linhas:** débito original do banco + saque da plataforma + crédito de estorno com o mesmo `externalKey` → as 3 saem das listas que seguem para o casamento; `settled` tem 1 item com `note` mencionando a chave e o valor.
8. **Estorno sem chave:** não liquida nada — segue para o casamento como lançamento sem chave.
9. **`platformReprocessPending = true`:** quando o lançamento da plataforma correspondente **ainda está presente** (aprovado) após remover o estorno das duas pontas.
10. **`platformReprocessPending = false`:** quando o lançamento da plataforma **não** está presente (já foi revertido).
11. **`correction-matcher` — `EXACT_SAME_BRAND`:** correção de valor idêntico na mesma marca → primeiro candidato, `exact = true` (via `differenceCents === 0` e confiança ≠ `PARTIAL`).
12. **`correction-matcher` — `SUM`:** 2 correções cuja soma bate o valor exato → candidato `SUM`.
13. **`correction-matcher` — corte de custo:** mais de `MAX_CORRECTIONS_FOR_COMBINATION` (12) correções → não tenta somar (nenhum candidato `SUM`, mesmo que a soma exista matematicamente).
14. **`correction-matcher` — `PARTIAL`:** valor diferente, mesmo jogador → confiança `PARTIAL`, `exact = false`, ordenado pela menor diferença absoluta.
15. **`totals.util` — invariante:** `diferença (banco − plataforma) = crossover + pendências` fecha para o golden dataset inteiro (depósito e saque, separadamente).
16. **`kpi-card`/sinal — não aplicável nesta fase** (fica na Fase 02).

## 🔴 Teste Orgânico — RED antes da implementação

> **Escrever `scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.sh` AGORA**, com base nos cenários
> acima, e executá-lo antes de criar qualquer arquivo de implementação.
>
> Resultado esperado: **FALHA (RED)** — os arquivos de domínio ainda não existem, então
> `npx jest src/modules/finance-reconciliation/domain` falha por "no tests found" / módulo inexistente.
> Se o script "passar" nesse estado, ele está errado — corrigir antes de prosseguir.
>
> Só depois de confirmar RED, seguir para "Arquivos a criar" e implementar até GREEN (seção 11).

## Arquivos a criar

### `src/common/utils/number.util.ts`
**Motivo:** utilitário compartilhado por toda a aritmética monetária do Finance (ambos os módulos).
Fica em `common/` (esqueleto), não em `modules/finance-*` — é infraestrutura, não domínio.
```ts
export function toNumber(value: unknown): number
export function roundCurrency(value: number): number
```
`toNumber` normaliza `number`, `string` (o TypeORM/`pg` devolve `numeric` como string) e objeto com
`toString()` para `number`, nunca lançando (`NaN`/inválido → `0`). `roundCurrency` arredonda para 2
casas com correção de `Number.EPSILON` (`Math.round((value + Number.EPSILON) * 100) / 100`).

### `src/modules/finance-reconciliation/reconciliation.constants.ts`
**Motivo:** configuração e vocabulário da conciliação, consumidos pelo domínio puro desta fase e pelas
fases 10–14. Portar literalmente da origem (`docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §3.0 e
`DADOS-FINANCE.md` para os valores): `RECONCILIATION_BANK_TRIO = 'trio'`, `PLATFORM_NEIGHBOUR_DAYS = 1`,
`OWN_TAX_NUMBERS` (array de CNPJ), `BANK_TYPE_REGULAR/FEE`, `BANK_REF_TYPE_*` (collection/payment/
payment_refund/collection_refund), `BANK_REF_TYPE_REFUND_SUFFIX = '_refund'`, `SYSTEM_ACTOR = 'sistema'`,
`MAX_ITEMS_IN_RESPONSE = 500`, `MIN_NOTE_LENGTH = 10`, `MAX_NOTE_LENGTH = 1000`,
`BANK_KEY_FIELDS = ['external_id','end_to_end_id','ref_id']`, `DEFAULT_BANK_KEY_FIELD = 'external_id'`,
`CORRECTION_DIRECTION_DOWN = 'down'`, `CORRECTION_LOOKBACK_DAYS = 7`,
`MAX_CORRECTION_COMBINATION_SIZE = 3`, `MAX_CORRECTIONS_FOR_COMBINATION = 12`,
`MAX_CORRECTION_CANDIDATES = 5`.

### `src/modules/finance-reconciliation/domain/reconciliation.types.ts`
**Motivo:** os tipos que todo o resto do domínio consome. Portar literalmente: `Movement`,
`SettledMovement`, `SideTotals`, `FlowMatch`, `ReconciliationFlow`, `ReconciliationSide`,
`RunTotals`, `RunOutcome`, `CorrectionConfidence` (`'EXACT_SAME_BRAND'|'EXACT_OTHER_BRAND'|'SUM'|'PARTIAL'`)
e as views usadas pelos use-cases das fases 13–14 (`ReconciliationView`, `ReconciliationBrandView`,
`ReconciliationItemView`, `ReconciliationHistoryView` etc. — ver origem
`src/modules/reconciliation/domain/reconciliation.types.ts`).

### `src/modules/finance-reconciliation/domain/matcher.ts`
**Motivo:** o casamento 1:1 por `externalKey`. Portar literalmente `matchFlow`, `sumCore`,
`filterFlow`, `pairByExternalKey`, `groupByKey`, `coreFirst` — comportamento exato descrito no
cenário 1–5 acima. **Nenhuma degradação para casamento por valor** — se a implementação introduzir
qualquer fallback por valor, é regressão do incidente de 12/08/2026 (37 saques legítimos marcados como
pendência).

### `src/modules/finance-reconciliation/domain/refund-settlement.ts`
**Motivo:** liquidação de estorno antes do casamento. Portar `settleRefunds`, `buildRefundNote`,
`isRefund`, `formatBrl` — comportamento exato dos cenários 7–10. As 3 linhas da chave estornada saem
juntas ou nenhuma sai; `platformReprocessPending` é inferido pela presença do lançamento da
plataforma, sem consulta nova.

### `src/modules/finance-reconciliation/domain/correction-matcher.ts`
**Motivo:** os 4 níveis de confiança da busca de evidência de correção. Portar `findCorrectionCandidates`,
`findSums`, `findPartials` — comportamento exato dos cenários 11–14. `PARTIAL` nunca é `exact`.

### `src/modules/finance-reconciliation/domain/correction-note.ts`
**Motivo:** a nota de tratamento automático (dois consumidores: rascunho da tela e baixa em lote — ver
Fase 14). Portar `buildCorrectionNote`, `formatBrl`, `formatDay`, `describe`, `trim`.

### `src/modules/finance-reconciliation/domain/totals.util.ts`
**Motivo:** montagem dos 16 totais de `ReconciliationRun` e o valor inicial (`emptyTotals()`). Portar
literalmente, garantindo a invariante do cenário 15.

### `test/fixtures/reconciliation-maxima-2026-08-15.json`
**Motivo:** o golden dataset — oráculo fixo dos testes de integração da conciliação (reaproveitado na
Fase 17). Sintético mas realista, cobrindo todas as regras: 2 depósitos casados (1 dentro do dia, 1 em
virada), 2 saques casados, 1 saque sem par no banco (pendência real), 1 lançamento de tesouraria, 1
tarifa, e a chave de estorno completa (débito banco + crédito estorno `payment_refund` + saque
plataforma). Estrutura:
```json
{
  "referenceDate": "2026-08-15",
  "brand": "maxima",
  "platform": [ /* Movement[] lado PLATFORM */ ],
  "bank": [ /* Movement[] lado BANK, incluindo o trio de estorno */ ],
  "expected": {
    "matchedCount": 4,
    "settledCount": 1,
    "pendingCount": 1,
    "crossEdge": { "deposits": { "count": 1, "total": 150.00 } },
    "platformReprocessPending": true
  }
}
```
Os valores exatos de `expected` são calculados pelo próprio teste na primeira execução (GREEN) e
então travados — depois disso o fixture não muda sem decisão explícita.

### Specs (colocalizados, `*.spec.ts`)
`matcher.spec.ts`, `refund-settlement.spec.ts`, `correction-matcher.spec.ts`, `totals.util.spec.ts` —
um `it()` por cenário da lista acima, carregando o fixture via `JSON.parse(readFileSync(...))`.

## Atualizar arquivo de registro de rotas/servidor

Não aplicável — esta fase não cria controller nem registra módulo no `AppModule` (isso é da Fase 03).

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

> Esta fase não expõe HTTP nem toca banco — o "teste funcional" roda os specs Jest do domínio contra
> o golden dataset real, verificando resultado aritmético e as 16 regras de negócio, não apenas que
> arquivos existem.

**Arquivo:** `scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 01 — Teste Orgânico: Domínio puro da Conciliação
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 01 — Domínio puro da Conciliação ==="
echo ""

OUTPUT=$(npx jest src/modules/finance-reconciliation/domain --verbose 2>&1)
STATUS=$?

echo "$OUTPUT" | grep -q "casamento 1:1 por externalKey" \
  && ok "cenário de casamento 1:1 presente e executado" \
  || fail "cenário de casamento 1:1 ausente do relatório do Jest"

echo "$OUTPUT" | grep -q "estorno" \
  && ok "cenário de liquidação de estorno presente e executado" \
  || fail "cenário de estorno ausente do relatório do Jest"

echo "$OUTPUT" | grep -qi "PARTIAL" \
  && ok "cenário de correção PARTIAL presente e executado" \
  || fail "cenário PARTIAL ausente do relatório do Jest"

[ "$STATUS" -eq 0 ] && ok "npx jest domain — exit 0" || fail "npx jest domain — exit $STATUS"

# Estrutural: nenhum import de infraestrutura no domínio puro
if grep -rlE "from '(typeorm|@nestjs/typeorm|axios|@clickhouse/client)'" \
     src/modules/finance-reconciliation/domain/ 2>/dev/null | grep -q .; then
  fail "domain/ importa infraestrutura — não é lógica pura"
else
  ok "domain/ sem import de typeorm/axios/@clickhouse/client"
fi

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 01 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 01 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar o script (deve estar GREEN agora)
```bash
bash scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.sh
```
Deve terminar com `exit 0` e zero `❌`.

### 2. Regressão
Não há fase anterior — primeira fase da trilha.

### 3. Criar documento de teste
`scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.md` conforme modelo padrão (como executar,
pré-requisitos, resultados esperados, notas técnicas).

## Critérios de aceite

- [ ] `bash scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.sh` — passa 100% (zero `❌`)
- [ ] Teste Orgânico foi escrito e confirmado RED antes de qualquer arquivo de implementação — evidência (saída do comando) registrada
- [ ] Regressão: não aplicável (primeira fase)
- [ ] Documentação: não aplicável — esta fase não expõe rotas nem componentes
- [ ] `matcher.ts` nunca degrada para casamento por valor (grep por qualquer comparação de `amountCents` fora de `sumCore`/totais confirma ausência)
- [ ] `refund-settlement.ts` remove as 3 linhas da chave estornada juntas, nunca uma só
- [ ] `correction-matcher.ts`: `PARTIAL` nunca tem `differenceCents === 0` tratado como exato
- [ ] `totals.util.ts`: invariante `diferença = crossover + pendências` verificada por teste contra o golden dataset
- [ ] Golden dataset (`test/fixtures/reconciliation-maxima-2026-08-15.json`) congelado — nenhum valor de `expected` foi ajustado para o teste passar (deve ser o inverso: o teste calcula e trava)
- [ ] Zero import de `typeorm`/`axios`/`@clickhouse/client` em `domain/`
- [ ] Invariantes de sessão verificados com Haiku — zero violações
- [ ] Verificação Adversarial de Aceite (sub-agente em contexto isolado) — retornou CONFIRMADO
- [ ] `CLAUDE.md` atualizado — fase atual avançada e aprendizados adicionados
- [ ] `progress.json` atualizado — fase marcada como completed, campo `model` preenchido
- [ ] `dashboard.html` EMBEDDED sincronizado — zero campos `null` na fase concluída
- [ ] Custo real da fase registrado via `node scripts/update-phase-cost.js`
- [ ] Dashboard aberto no browser — best-effort
- [ ] Commit desta fase criado e `git push` feito para `feature/migracao-finance`

## ✅ Invariantes de Sessão — Haiku antes de finalizar

> **Invocar Agent com `model: claude-haiku-4-5-20251001`.**

### Comandos de inspeção
```bash
grep -rn "from 'typeorm'\|from '@nestjs/typeorm'\|from 'axios'\|from '@clickhouse/client'" \
  src/modules/finance-reconciliation/domain/
grep -rn "amountCents ===" src/modules/finance-reconciliation/domain/matcher.ts
```

### Prompt para Haiku

> Execute os comandos acima e leia os 7 arquivos criados nesta fase.
>
> Verifique:
> 1. Zero import de `typeorm`/`@nestjs/typeorm`/`axios`/`@clickhouse/client` em `domain/`.
> 2. `matcher.ts` não compara `amountCents` para decidir casamento (só `externalKey`) — o único uso
>    de `amountCents` deve ser em somas/totais, nunca em comparação de igualdade entre lados.
> 3. `refund-settlement.ts`: a função que remove linhas por chave estornada filtra os DOIS lados
>    (`platform` e `bank`) — não só um.
>
> Para cada violação: `arquivo:linha — descrição exata`.
> Resposta final: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir antes de prosseguir.
> **Se TODOS APROVADOS:** fechar sub-agente e continuar com `claude-sonnet-5` para a Verificação Adversarial de Aceite.

## 🔎 Verificação Adversarial de Aceite

> Invocar um **novo** sub-agente, sem o histórico desta implementação, só com: (1) os Critérios de
> Aceite desta fase, (2) o `git diff` do que foi criado, (3) a saída do Teste Orgânico (GREEN).
>
> Instrução: **tentar refutar** que os critérios foram atendidos — em especial, verificar linha a
> linha se `matcher.ts` realmente não tem nenhum caminho de casamento por valor residual, e se
> `correction-matcher.ts` realmente nunca marca `PARTIAL` como `exact`. Não aceitar "parece que sim".
>
> Resposta final: **CONFIRMADO** ou **REPROVADO: [critério — motivo específico]**.

> **Se REPROVADO:** corrigir a causa raiz e repetir antes de prosseguir.
> **Se CONFIRMADO:** fechar sub-agente e continuar com `claude-sonnet-5` para "Atualizar CLAUDE.md".

## 📊 Dashboard — Validação Pós-fase

### 1. Sincronizar dados
```bash
node scripts/update-phase-cost.js
```
Deve conter `✅ Custo atualizado` e `✅ dashboard.html EMBEDDED sincronizado`.

### 2. Verificar integridade do `progress.json`
Confirmar `status: "completed"`, `model` preenchido, `completedDate` preenchido, `costUsd` preenchido,
`summary.completed`/`percentComplete` atualizados.

### 3. Verificar `const EMBEDDED` no `dashboard.html`
Deve bater com o `progress.json` atual. Se divergir, re-rodar o script.

### 4. Garantir `live-server` disponível e abrir no browser (best-effort)
```bash
which live-server 2>/dev/null && echo "OK" || npm install -g live-server
npx --yes live-server docs/migracao-finance/fases/ --open=dashboard.html --port=4500 &
```
Se não abrir neste ambiente: registrar em `notes` e seguir — não bloqueia a fase.

### 5. Validar visualmente (best-effort)
- [ ] Barra de progresso reflete 1/17 fases
- [ ] Dot da Fase 01 está verde
- [ ] Cards de custo preenchidos

## Atualizar CLAUDE.md

- Avançar "Fase atual" para **02 — Domínio puro (Balanço de Caixa)**.
- Marcar Fase 01 como concluída na tabela.
- Adicionar em "Aprendizados críticos" apenas o que surpreenderia quem leu só este documento (ex.:
  se o golden dataset revelou um caso de borda não documentado na origem, ou se a assinatura de
  algum tipo mudou por causa da tradução).

## 🔀 Git — Commit e Push da Fase

### 1. Revisar o que será commitado
```bash
git status --porcelain
```

### 2. Commit
```bash
git add src/modules/finance-reconciliation/domain/ \
        src/modules/finance-reconciliation/reconciliation.constants.ts \
        src/common/utils/number.util.ts \
        test/fixtures/reconciliation-maxima-2026-08-15.json \
        scripts/dominio-conciliacao/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-reconciliation): porta domínio puro da conciliação + golden dataset

Fase 01/17 — Migração Finance"
```

### 3. Push para a branch da trilha
```bash
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 01 concluída, validada e enviada para `feature/migracao-finance`.**
O domínio puro da conciliação está portado e testado contra o golden dataset, sem nenhum import de
infraestrutura. Dashboard sincronizado (abertura visual best-effort). Responder "sim" para iniciar a
**Fase 02**.
