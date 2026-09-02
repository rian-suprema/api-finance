# FASE 11 — Teste Orgânico: ClickHouse da Conciliação
> Data: 2026-09-02 | Status: ✅ PASSOU (4/4)

## Como executar
```bash
bash scripts/clickhouse-conciliacao/FASE-11-TESTE-ORGANICO.sh
```

## Pré-requisitos
- [x] Fase 05 concluída (`ClickHouseService`)

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| Teste do instante correto por fluxo presente | ✅ |
| `FINAL` presente nas queries (5 ocorrências, 3 marts) | ✅ |
| Sem filtro de `source_system` | ✅ |
| 13 specs (`platform-movements` + `correction-search`) | ✅ |

## Notas técnicas
- O `grep -n "source_system"` literal do `FASE-11.md` casava com o comentário JSDoc que explica por
  que o filtro não existe (mesma categoria de defeito de template já documentada nas Fases
  01/03/04/05/08/10). Restrito às linhas fora de comentário.
- Caso real de R$5.755,00 (Ultra, 2 saques pedidos 23:53, liberados 00:05 do dia seguinte) coberto por
  teste dedicado na string literal de `WITHDRAWALS_QUERY` (`coalesce(transaction_date, withdrawal_ts)`),
  não só no comportamento de `toMovement` — o risco real está na query usar o campo errado.
- Regressão da Fase 10 confirmada 100% (3/3). Suite completa (`npm test`): 30 suites, 175 testes,
  100%. `npm run build`: sem erros. `npm run test:e2e` (com stub de dev de pé): 5 suites, 57 testes,
  100%.
