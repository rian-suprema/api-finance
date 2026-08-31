# Teste Orgânico — Fase 02 (Domínio puro do Balanço de Caixa)

## Como executar

```bash
bash scripts/dominio-balanco-caixa/FASE-02-TESTE-ORGANICO.sh
```

Saída esperada: `exit 0`, zero `❌`.

## Pré-requisitos

- Fase 01 concluída (`src/common/utils/number.util.ts` com `roundCurrency`).
- `npm install` já executado, `jq` disponível no PATH.

## O que o script verifica

1. Existe um teste nomeado explicitamente pelo sinal do Total do Balanço
   (`"sinal"` ou `"transacional menos jogadores"` no nome do teste) —
   confirmado via `--json`/`jq`, pelo mesmo motivo registrado na Fase 01
   (Jest 30 não lista testes que passaram no reporter `--verbose`).
2. `npx jest src/modules/finance-cash-balance/domain` termina com `exit 0`.
3. `src/modules/finance-cash-balance/domain/` não importa `typeorm`, `axios`
   nem `@clickhouse/client`.

## Notas técnicas

- `BrandKey`/`BankType` são declarados localmente em `cash-balance.types.ts`
  como provisórios (`BrandKey = string`) — o catálogo real (`BRANDS`) só
  existe a partir da Fase 07 (`cash-balance.constants.ts`). Decisão já
  antecipada no próprio `FASE-02.md`, não foi necessário parar para decidir.
- `buildKpiCard` usa a própria chave da marca como `label` nesta fase (sem
  catálogo ainda) — os testes desta fase não dependem do conteúdo do `label`,
  só da ordem e dos valores em `byBrand`/`total`.
- `subtractByBrand` não arredonda o resultado — é `buildKpiCard`, na
  composição real dos use-cases futuros, quem arredonda o valor final exibido
  na tela. O teste de arredondamento (cenário 5) verifica a composição
  `subtractByBrand` → `buildKpiCard`, não `subtractByBrand` isolado.

## Resultado da última execução

```text
=== FASE 02 — Domínio puro do Balanço de Caixa ===

  ✅  teste nomeado pelo sinal do Total do Balanço presente
  ✅  npx jest domain — exit 0
  ✅  domain/ sem import de infraestrutura

✅  FASE 02 — PASSOU (3 testes)
```

`npx jest src/modules/finance-cash-balance/domain --verbose`: 1 suíte, 5
testes, todos passando. Regressão da Fase 01
(`FASE-01-TESTE-ORGANICO.sh`): PASSOU, sem impacto.
