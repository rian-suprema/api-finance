# Teste Orgânico — Fase 01 (Domínio puro da Conciliação)

## Como executar

```bash
bash scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.sh
```

Saída esperada: `exit 0`, zero `❌`.

## Pré-requisitos

- `npm install` já executado (o script chama `npx jest`).
- `jq` disponível no PATH (usado para ler a saída `--json` do Jest e confirmar
  que os cenários nomeados nos testes realmente executaram).

## O que o script verifica

1. Cenário de casamento 1:1 por `externalKey` presente e executado
   (`matcher.spec.ts`).
2. Cenário de liquidação de estorno presente e executado
   (`refund-settlement.spec.ts`).
3. Cenário de correção `PARTIAL` presente e executado
   (`correction-matcher.spec.ts`).
4. `npx jest src/modules/finance-reconciliation/domain` termina com `exit 0`
   (todos os 17 testes passam, incluindo `totals.util.spec.ts`).
5. `src/modules/finance-reconciliation/domain/` não importa `typeorm`,
   `@nestjs/typeorm`, `axios` nem `@clickhouse/client` — confirma que é lógica
   pura, sem infraestrutura.

## Notas técnicas

- **Jest 30 não imprime mais nomes de teste que passaram no reporter
  `--verbose`** (só imprime detalhe de testes que falham). O script usa
  `npx jest ... --json` e `jq` para ler `testResults[].assertionResults[].fullName`
  em vez de fazer `grep` na saída humana do `--verbose` — a verificação (1)-(3)
  acima depende disso. Se o Jest for atualizado e o formato do `--json` mudar,
  reavaliar este script.
- O golden dataset (`test/fixtures/reconciliation-maxima-2026-08-15.json`) foi
  simulado manualmente contra o algoritmo de `matcher.ts`/`refund-settlement.ts`
  antes da primeira execução — os 17 testes passaram de primeira (`GREEN` já na
  primeira rodada), confirmando que os valores em `expected` batem com o
  comportamento real do domínio portado.
- A invariante de `totals.util.spec.ts` (`diferença banco−plataforma = crossover
  mais pendências`) só é matematicamente verdadeira porque o fixture usa o mesmo
  valor em centavos nos dois lados de todo par que efetivamente casa dentro do
  dia ou na virada — como acontece nos dados reais (a mesma operação registrada
  nos dois livros). Pares com quantidade diferente de linhas por chave (chave
  duplicada) não precisam dessa igualdade: a linha extra sobra como pendência
  legítima, e a invariante contabiliza isso via o termo de pendências.

## Resultado da última execução

```text
=== FASE 01 — Domínio puro da Conciliação ===

  ✅  cenário de casamento 1:1 presente e executado
  ✅  cenário de liquidação de estorno presente e executado
  ✅  cenário de correção PARTIAL presente e executado
  ✅  npx jest domain — exit 0
  ✅  domain/ sem import de typeorm/axios/@clickhouse/client

✅  FASE 01 — PASSOU (5 testes)
```

`npx jest src/modules/finance-reconciliation/domain --verbose`: 4 suítes, 17
testes, todos passando.
