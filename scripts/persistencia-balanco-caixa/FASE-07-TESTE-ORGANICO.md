# FASE 07 — Teste Orgânico: Persistência do Balanço de Caixa
> Data: 2026-09-01 | Status: ✅ passou

## Como executar
```bash
bash scripts/persistencia-balanco-caixa/FASE-07-TESTE-ORGANICO.sh
```

## Pré-requisitos
- Docker disponível — `cash-balance.repository.spec.ts` sobe um Postgres 16 efêmero via
  `@testcontainers/postgresql` e roda a migration real (`FinanceInitialSchema1788210289000`).
- `clickhouse-read.service.spec.ts` não precisa de infra — mocka `ClickHouseService`.

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| `npx jest .../infrastructure` — exit 0 (23 testes, Postgres real) | ✅ |
| Teste de atomicidade do `registerBrand` (rollback real, violação de `varchar(50)`) | ✅ |
| Teste de recálculo do acumulado mensal (soma corrente em ordem de data) | ✅ |
| `architecture.spec.ts` 100% verde | ✅ |

## Notas técnicas
- RED confirmado com teste decisivo (implementação movida para fora do repositório, script
  reexecutado com falha real, restaurada e reconfirmado GREEN) — ver aprendizado da Fase 07 no
  `CLAUDE.md` sobre o processo ter ficado fora de ordem.
- `cash-balance.repository.ts` dividido em 3 arquivos por limite de 400 linhas do ESLint — ver
  `cash-balance.repository-reads.ts` e `cash-balance.repository-upserts.ts`.
- `reference_date` (`date`) confirmado empiricamente como `string` `'YYYY-MM-DD'` no retorno do
  TypeORM/`pg`, nunca `Date` — sem necessidade de `toDateOnly`/`fromDateOnly` como na origem Prisma.
- `AppModule` completo (incluindo `CashBalanceModule` com os novos providers) validado via
  `npm run test:e2e -- --testPathPatterns=users` (21/21) — confirma que a injeção de dependência
  resolve sem erro em boot real.
