# FASE 12 — Teste Orgânico: Trio — movimentos por bisseção
> Data: 2026-09-02 | Status: ✅ PASSOU (4/4)

## Como executar
```bash
bash scripts/trio-movimentos/FASE-12-TESTE-ORGANICO.sh
```

## Pré-requisitos
- [x] Fase 06 concluída (`TrioBankingClient`)

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| Teste de regressão do estorno (Maxima 15/08) presente | ✅ |
| Teste de regressão do bug de cursor presente | ✅ |
| `architecture.spec.ts` 100% verde (import cruzado correto) | ✅ |
| 14 specs (`trio-movements.service.spec.ts`) | ✅ |

## Notas técnicas
### Import cruzado entre módulos
`ReconciliationModule` importa `CashBalanceModule` para reusar `TrioBankingClient` — mesmo padrão da
origem, evita duplicar a lógica de bisseção. `TrioBankingClient` precisou ser adicionado a
`providers`+`exports` de `cash-balance.module.ts` (não estava em nenhum dos dois; nenhum use-case do
balanço de caixa o injetava diretamente até esta fase). Ver CLAUDE.md, decisão 12.

### Limpeza de import cruzado indevido (Fase 10)
A invariante de sessão (Haiku) encontrou uma violação real em 2 specs da Fase 10
(`reconciliation-{run,item}.repository.spec.ts`): importavam 6 entidades de
`finance-cash-balance/entities/**` só para o array `entities: [...]` do `DataSource` de teste, sem uso
real (a migration é SQL explícito). Corrigido restringindo a `ReconciliationRun`/`ReconciliationItem`.

### Regressão do bug de cursor via cliente real
O teste usa `TrioBankingClient` real (não mockado), com `axios.create` mockado só na camada HTTP —
mesmo padrão da Fase 06 — simulando 2 lançamentos no mesmo microssegundo (o lançamento e a tarifa)
separados por um `has_more: true` no meio da bisseção. Confirma que as 2 linhas aparecem via
`TrioMovementsService.fetchMovements`, não só via `TrioBankingClient.listTransactions` isolado.

Regressão da Fase 11 confirmada 100% (4/4). `architecture.spec.ts`: 16/16. Suite completa
(`npm test`): 31 suites, 189 testes, 100%. `npm run build`: sem erros. `npm run test:e2e` (com stub
de dev de pé): 5 suites, 57 testes, 100%.
