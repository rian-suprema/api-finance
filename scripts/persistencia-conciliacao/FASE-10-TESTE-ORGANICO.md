# FASE 10 — Teste Orgânico: Persistência da Conciliação
> Data: 2026-09-02 | Status: ✅ PASSOU (3/3)

## Como executar
```bash
bash scripts/persistencia-conciliacao/FASE-10-TESTE-ORGANICO.sh
```

## Pré-requisitos
- [x] Fase 04 concluída (schema aplicado)

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| `npx jest infrastructure` exit 0 | ✅ (15 testes: 4 run-repository + 11 item-repository) |
| Preservação de nota humana testada | ✅ |
| Idempotência da baixa em lote testada | ✅ |

## Notas técnicas
- O script fornecido literalmente no `FASE-10.md` usava `--verbose` + `grep` na saída — mesmo
  defeito já documentado nas Fases 01/03/05/08 (Jest 30 não lista nomes de teste que passaram no
  `--verbose`, só detalha falhas). Corrigido para `--json --outputFile=<tmp>` +
  `jq -r '.testResults[].assertionResults[].fullName'`.
- `useDefineForClassFields` (tsconfig) faz `repo.create({...})` gravar `undefined` como propriedade
  própria em toda coluna não informada — o `decimalTransformer` converte isso em `NULL` explícito no
  `INSERT`, ignorando `default: 0`/`default: false` da coluna e violando `NOT NULL`. Corrigido
  zerando explicitamente (`ZERO_TOTALS`, `platformReprocessPending: false`). Ver CLAUDE.md,
  Aprendizados críticos — Fase 10.
- `dataSource.query()` (raw SQL) não passa pelo transform de coluna do TypeORM — `date` volta como
  `Date`, não `string`. `countItemsInRange` precisou de `reference_date::text AS reference_date` no
  `SELECT` para não quebrar a chave `dia|marca`.
- Regressão da Fase 04 (`FASE-04-TESTE-ORGANICO.sh`) confirmada 100% (4/4).
- Suite completa (`npm test`): 28 suites, 162 testes, 100%. `npm run build`: sem erros.
  `npm run test:e2e` (com `node scripts/finance-dev-stubs.js` de pé): 5 suites, 57 testes, 100%.
