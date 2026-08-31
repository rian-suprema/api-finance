# FASE 06 — Integração Trio — client + adapter point-in-time
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 40**
> Limite: _4 arquivos · risco: reintroduzir paginação simples (perde linhas) ou a reconstrução por saldo+movimento (8 de 18 fechamentos errados na origem)_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `TrioBankingClient` (varredura por bisseção, nunca paginação) e
`TrioPointInTimeBalanceSource` (leitura do saldo exato no instante do corte, nunca reconstrução)
existem e estão isolados em `infrastructure/trio/` — o único diretório onde `axios` pode aparecer
(allowlist da Fase 03).

## Pré-requisito

Fase 03 concluída (allowlist `axios`, `trioConfig`). Fase 05 não é pré-requisito técnico (Trio e
ClickHouse são integrações independentes), mas mantém a ordem sequencial da trilha.

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/config/configuration.ts` — assinatura de `trioConfig` (`baseUrl`, `clientId`, `clientSecret`, `amountDivisor`, `accountIds`)
- `src/architecture.spec.ts` — a regra `axios cru só existe no adapter da Trio`
- `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` (seção 6, "Integrações externas") — as duas pegadinhas de contrato da Trio

### Prompt para Haiku

> Leia os 3 arquivos. Esta fase cria `infrastructure/trio/trio-banking.client.ts` e
> `trio-point-in-time-balance.source.ts`, usando `trioConfig` e `axios`.
>
> Verifique:
> 1. `trioConfig.accountIds` é um objeto `{suprema, ultra, maxima}` — confirme os nomes das chaves.
> 2. A regra de allowlist aceita qualquer arquivo cujo `directory.includes('infrastructure/trio')`.
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **`findTransactionalVirtualAccount`:** com exatamente 1 conta `approved` na resposta, devolve ela;
   com 0 aprovadas, lança erro; com **mais de 1** aprovada, **lança erro** (nunca escolhe uma — regra
   explícita: escolher errado grava o saldo da conta errada como fechamento do dia).
2. **`readBalanceAtCents`:** resposta sem `data.available_balance.amount` lança erro; `amount` não
   numérico lança erro; `amount` numérico ou string numérica é aceito e convertido.
3. **Bisseção — janela sem `has_more`:** uma única chamada, todas as linhas retornadas.
4. **Bisseção — janela com `has_more: true`:** divide em duas metades **sem overlap e sem buraco**
   (o teste de regressão do caso real: janela de 10h que perdeu 2 linhas via cursor simples —
   `docs/migracao-finance/DADOS-FINANCE.md` §10, item 4 — deve produzir a contagem completa via
   bisseção).
5. **Bisseção — `has_more` no mesmo microssegundo (`start === end`):** lança erro em vez de repetir
   infinitamente (mais de 50 lançamentos no mesmo instante — janela indivisível).
6. **Orçamento de requisições:** ultrapassar `REQUEST_BUDGET` (20.000) lança erro em vez de rodar
   para sempre.
7. **Retry:** erro `429` ou `5xx` tenta novamente (até 4 vezes, backoff linear); erro `4xx` diferente
   de `429` **não** tenta de novo (é erro de contrato).
8. **`toCurrency`:** com `amountDivisor = 100`, `250` centavos vira `2.50`; com `amountDivisor = 1`,
   `250` vira `250` — a fase não decide qual é o certo (isso é a PARADA HUMANA abaixo), só garante que
   a conversão usa o divisor configurado, nunca um valor fixo no código.
9. **Nenhuma credencial em log:** simular uma falha de autenticação (`401`) e confirmar que a
   mensagem logada não contém `clientId`/`clientSecret`.

## ⚠️ PARADA HUMANA — Confirmar `TRIO_AMOUNT_DIVISOR`

> **Claude deve parar AQUI e aguardar confirmação antes de finalizar esta fase — a implementação do
> `toCurrency`/testes pode seguir, mas o valor real de `TRIO_AMOUNT_DIVISOR` no `.env`/Secret de
> homologação e produção não pode ser preenchido sem esta confirmação.**
>
> A API da Trio documenta valores em **centavos** (`TRIO_AMOUNT_DIVISOR=100`), mas o `.env.example`
> original do módulo de origem tinha default `1` com o comentário "⚠️ CONFIRMAR na doc da Trio antes
> de usar em produção" — nunca confirmado. Errar este valor multiplica ou divide **todo** saldo e
> valor de conciliação por 100, sem nenhum erro sendo lançado.
>
> Passos:
> 1. Confirmar com o time de integração/parceria da Trio (ou na documentação oficial
>    `docs.trio.com.br`, seção de saldo/transações) se `available_balance.amount` e
>    `amount.amount` das transações vêm em reais ou centavos.
> 2. Registrar a resposta em `docs/migracao-finance/INFRA-FINANCE.md` §4.2, substituindo a nota "⚠️ a
>    confirmar" pelo valor confirmado e a fonte.
> 3. Preencher `TRIO_AMOUNT_DIVISOR` no `.env` de homologação com o valor confirmado.
>
> Responder **"confirmado: <1|100>"** quando concluído. Sem essa confirmação, os testes desta fase
> usam ambos os valores (1 e 100) como parâmetros de teste — nunca assumem um como "o certo" — e a
> fase pode ser concluída e commitada normalmente; o preenchimento real da variável em homologação/
> produção é que fica bloqueado até a resposta humana.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/trio-integracao/FASE-06-TESTE-ORGANICO.sh` agora. Resultado esperado: RED —
> `infrastructure/trio/` ainda não existe.

## Arquivos a criar

### `src/modules/finance-cash-balance/domain/ports/closing-balance-source.port.ts`
**Motivo:** porta de saída (Ports & Adapters) — o domínio depende desta interface, não do adapter
concreto da Trio. Permite trocar a fonte de fechamento sem tocar use-cases.
```ts
export const CLOSING_BALANCE_SOURCE = Symbol('CLOSING_BALANCE_SOURCE');
export type ClosingBalanceMethod = 'POINT_IN_TIME' | 'SNAPSHOT' | 'RECONSTRUCTED';
export interface ClosingBalanceCapture {
  brand: BrandKey;
  accountId: string;
  balance: number;
  cutoffAt: Date;
  capturedAt: Date;
  exact: boolean;
  method: ClosingBalanceMethod;
}
export interface ClosingBalanceSource {
  capture(brand: BrandKey, referenceDate: string): Promise<ClosingBalanceCapture>;
}
```
(`BrandKey` ainda não existe formalmente até a Fase 07 criar `cash-balance.constants.ts` — declarar
localmente como `type BrandKey = string` nesta fase e ajustar o import na Fase 07, registrando a nota.)

### `src/modules/finance-cash-balance/infrastructure/trio/trio-banking.client.ts`
**Motivo:** cliente HTTP cru da banking-api da Trio — Basic Auth (`clientId:clientSecret`, nunca
OAuth), varredura por bisseção. Portar literalmente da origem (ver
`docs/migracao-finance/INFRA-FINANCE.md` §6 e o próprio arquivo-fonte): `toMicros`, `toIsoMicros`,
`findTransactionalVirtualAccount`, `readBalanceAtCents`, `listTransactions`, `summarizeFlows`,
`walkWindow` (a bisseção — `REQUEST_BUDGET = 20_000`), `toCurrency` (usa `trioConfig.amountDivisor`,
**nunca** um valor fixo `100` ou `1` hardcoded no código), `get<T>` (retry com backoff linear, 4
tentativas, só para `429`/`5xx`).

### `src/modules/finance-cash-balance/infrastructure/trio/trio-point-in-time-balance.source.ts`
**Motivo:** implementa `ClosingBalanceSource` lendo o saldo **no instante do corte**
(`at_datetime = meia-noite BRT do dia seguinte`), nunca reconstruindo. `exact` é sempre `true` — sem
caminho de fallback por reconstrução (o fallback é comprovadamente errado na origem, 8 de 18
fechamentos). Portar literalmente `capture()`, `resolveVirtualAccount()` (cache em memória do
processo, por `bankAccountId`), `requireAccountId()`.

### Spec colocalizado
`trio-banking.client.spec.ts` — mock de `axios` (`jest.mock('axios')`), um `it()` por cenário 1–9.

## Atualizar arquivo de registro de rotas/servidor

Não aplicável — sem controller nesta fase. O provider `CLOSING_BALANCE_SOURCE` será registrado no
`CashBalanceModule` na Fase 07/08, quando o módulo ganha conteúdo real.

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/trio-integracao/FASE-06-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 06 — Teste Orgânico: Integração Trio
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 06 — Integração Trio ==="
echo ""

OUTPUT=$(npx jest src/modules/finance-cash-balance/infrastructure/trio --verbose 2>&1)
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "npx jest trio — exit 0" || fail "specs falharam — exit $STATUS"

echo "$OUTPUT" | grep -qi "bissec\|sem overlap e sem buraco" \
  && ok "teste de regressão da bisseção presente" \
  || fail "teste de regressão da bisseção ausente — risco do bug de cursor (5.234 vs 5.236 linhas)"

echo "$OUTPUT" | grep -qi "mais de 1 aprovada\|desempate não definido" \
  && ok "teste de conta virtual ambígua (nunca escolhe) presente" \
  || fail "teste de conta virtual ambígua ausente"

grep -rn "clientId\|clientSecret" src/modules/finance-cash-balance/infrastructure/trio/trio-banking.client.ts \
  | grep -i "logger\." \
  && fail "possível log de credencial da Trio" \
  || ok "nenhum log contém clientId/clientSecret"

npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas" \
  || ok "architecture.spec.ts 100% verde (allowlist axios respeitada)"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 06 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 06 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/trio-integracao/FASE-06-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/clickhouse-conexao/FASE-05-TESTE-ORGANICO.sh
```

### 3. Criar documento de teste
`scripts/trio-integracao/FASE-06-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/trio-integracao/FASE-06-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 05 passa 100%; `architecture.spec.ts` continua verde
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] **PARADA HUMANA registrada** — resposta sobre `TRIO_AMOUNT_DIVISOR` documentada em
      `docs/migracao-finance/INFRA-FINANCE.md` §4.2 (ou explicitamente marcada como "ainda pendente,
      não bloqueia esta fase" se a resposta humana não tiver chegado)
- [ ] `toCurrency` usa `trioConfig.amountDivisor` — zero valor fixo (`100`/`1`) hardcoded no cliente
- [ ] Bisseção nunca pagina por cursor simples — só divide a janela
- [ ] Conta virtual ambígua (>1 aprovada) lança erro, nunca escolhe
- [ ] Retry só para `429`/`5xx`; `4xx` diferente falha na primeira tentativa
- [ ] Zero credencial em log
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
grep -n "amountDivisor\|/ 100\|\* 100" src/modules/finance-cash-balance/infrastructure/trio/trio-banking.client.ts
grep -n "after:\|cursor" src/modules/finance-cash-balance/infrastructure/trio/trio-banking.client.ts
grep -rn "from 'axios'" src/ --include="*.ts" | grep -v "infrastructure/trio\|\.spec\.ts"
```

### Prompt para Haiku

> Execute os comandos. Verifique:
> 1. Nenhuma conversão de moeda usa `100`/`1` fixo — só `this.amountDivisor` (vindo da config).
> 2. Nenhuma chamada usa o parâmetro `after`/cursor de paginação simples para varrer transações — só
>    `from_datetime`/`to_datetime` da bisseção.
> 3. O terceiro comando devolve zero linhas fora de `infrastructure/trio/`.
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco: reconstruir mentalmente o
> caso real do bug de cursor (janela de 10h, empate de timestamp entre lançamento e tarifa) e
> confirmar que o teste de bisseção cobre exatamente esse padrão — duas linhas no mesmo instante,
> divididas entre as duas metades sem perda.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **07 — Persistência do Balanço de Caixa**. Marcar Fase 06 concluída.
Registrar o status da PARADA HUMANA (`TRIO_AMOUNT_DIVISOR` confirmado ou ainda pendente) em
"Aprendizados críticos" — é a única pendência externa real da trilha.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-cash-balance/domain/ports/ \
        src/modules/finance-cash-balance/infrastructure/trio/ \
        scripts/trio-integracao/ docs/migracao-finance/INFRA-FINANCE.md \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-cash-balance): cliente Trio (bisseção) + adapter point-in-time

Fase 06/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 06 concluída, validada e enviada para `feature/migracao-finance`.**
O cliente Trio nunca pagina por cursor e nunca reconstrói saldo por movimento; a pendência de
`TRIO_AMOUNT_DIVISOR` está registrada e não bloqueia o restante da trilha. Responder "sim" para
iniciar a **Fase 07**.
