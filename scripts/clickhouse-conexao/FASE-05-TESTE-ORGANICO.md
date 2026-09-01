# FASE 05 — Teste Orgânico: Integração ClickHouse
> Data: 2026-09-01 | Status: ✅ passou

## Como executar
```bash
bash scripts/clickhouse-conexao/FASE-05-TESTE-ORGANICO.sh
```

## Pré-requisitos
- Nenhum serviço externo necessário — os testes mockam `@clickhouse/client` (`jest.mock`), sem
  conexão real com um data warehouse.

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| `npx jest src/clickhouse` — exit 0 | ✅ |
| Cenário de `query_params` (nunca interpolação) presente no relatório | ✅ |
| Nenhuma interpolação de SQL em `clickhouse.service.ts` | ✅ |
| `architecture.spec.ts` 100% verde (allowlist ClickHouse respeitada) | ✅ |

## Notas técnicas
- Jest 30 com `Logger` do Nest ativo contamina `--json` via stdout — usar
  `--json --outputFile=<tmp>` em vez de capturar a saída padrão (ver aprendizado da Fase 05 no
  `CLAUDE.md`).
- RED confirmado duas vezes: (1) antes da implementação existir (script criado primeiro,
  `src/clickhouse/` inexistente → jest "No tests found"); (2) teste decisivo pós-implementação,
  movendo `src/clickhouse/` para fora do repositório e reexecutando o script — falha real
  reproduzida (exit 2, 2/4 testes) antes de restaurar.
