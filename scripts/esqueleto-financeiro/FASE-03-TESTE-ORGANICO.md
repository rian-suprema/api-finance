# Teste Orgânico — Fase 03 (Esqueleto não-funcional + allowlist + contrato de erro)

## Como executar

```bash
bash scripts/esqueleto-financeiro/FASE-03-TESTE-ORGANICO.sh
```

Saída esperada: `exit 0`, zero `❌`.

## Pré-requisitos

- `npm install` já executado, `jq` disponível no PATH.
- Nenhum outro processo ocupando as portas `3100`/`9001`/`8123` ao testar
  `scripts/finance-dev-stubs.js` manualmente.

## O que o script verifica

1. `npx tsc --noEmit` compila sem erros com os 2 módulos vazios registrados e
   as 14 variáveis novas de ambiente.
2. Boot falha (fail-fast) sem `TRIO_AMOUNT_DIVISOR` — nunca assume `1`
   silenciosamente.
3. As 2 regras novas do `architecture.spec.ts` (allowlist `axios` e
   `@clickhouse/client`) existem e passam — confirmado via `--json`/`jq`, pelo
   mesmo motivo registrado na Fase 01 (Jest 30 não lista testes que passaram
   no reporter `--verbose`; o script original do plano usava `--verbose` +
   `grep` e precisou ser corrigido para o padrão `--json`/`jq` já
   estabelecido).

## Notas técnicas

- **Jest 30 renomeou a flag de filtro de suíte**: `--testPathPattern` (citada
  no `FASE-03.md` para a regressão) não existe mais — é `--testPathPatterns`.
  Débito de documentação pré-existente (mesma família do problema do
  `--verbose`), não específico desta fase.
- **7 permissões, não 8**: o objetivo do `FASE-03.md` fala em "8 permissões",
  mas o próprio bloco de código do plano já exclui `EXPORT` deliberadamente
  ("declarada na origem sem endpoint... evita permissão morta") — a
  implementação segue o código do plano (4 `FINANCE_CASH_BALANCE` + 3
  `FINANCE_RECONCILIATION` = 7), não o número no texto do objetivo.
- `date.util.ts`/`tax-number.util.ts` portados literalmente de
  `/home/feh/sayplus-modules/finance/finance-api/src/common/utils/` — 2
  comentários reescritos (sem mudar o sentido) porque a palavra "Todo"
  (português, "todo o módulo"/"todo valor") colidia com a regra
  `sonarjs/todo-tag` (falso positivo por casar com o token em inglês `TODO`).
- `scripts/finance-dev-stubs.js` portado literalmente de
  `/home/feh/sayplus-modules/finance/scripts/dev-stubs.js` (só o comentário de
  cabeçalho/uso mudou). Validado por `node --check` + diff de fidelidade +
  chamada real nas 3 portas (o processo original da origem já estava rodando
  nas mesmas portas durante a verificação; não foi finalizado por não ser
  deste repositório/sessão — a chamada real contra o contrato idêntico já
  comprova o comportamento).
- Lint: 15 erros pré-existentes em código das Fases 01/02
  (`finance-*/domain/**`) não foram tocados nem corrigidos nesta fase — fora
  de escopo, registrados para decisão futura do usuário.

## Resultado da última execução

```text
=== FASE 03 — Esqueleto não-funcional ===

  ✅  typecheck sem erros
  ✅  boot falha sem TRIO_AMOUNT_DIVISOR (fail-fast confirmado)
  ✅  regra allowlist axios presente
  ✅  regra allowlist @clickhouse/client presente
  ✅  architecture.spec.ts 100% verde

✅  FASE 03 — PASSOU (5 testes)
```

`npm test`: 10 suítes / 56 testes, 100% verde (inclui os 6 testes novos de
`global-exception.filter.spec.ts` e `env.validation.spec.ts`). `npm run
build`: exit 0. Regressão das Fases 01/02 (`FASE-01-TESTE-ORGANICO.sh`,
`FASE-02-TESTE-ORGANICO.sh`): PASSOU, sem impacto. Verificação Adversarial de
Aceite: CONFIRMADO.
