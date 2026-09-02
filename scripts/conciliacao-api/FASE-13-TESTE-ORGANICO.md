# FASE 13 — Teste Orgânico: Conciliação — use-cases núcleo + API
> Data: 2026-09-02 | Status: ✅ GREEN

## Como executar

```bash
node scripts/finance-dev-stubs.js &
npm run start:dev &
sleep 5
bash scripts/conciliacao-api/FASE-13-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPatterns=finance-reconciliation
```

## Pré-requisitos
- [x] Postgres local no ar (`docker compose up -d`), migrations aplicadas
- [x] Stubs de ClickHouse/Trio/`auth/me` no ar (`scripts/finance-dev-stubs.js`)
- [x] App rodando em `:3005`

## Resultados

| Verificação | Resultado |
| --- | --- |
| `FASE-13-TESTE-ORGANICO.sh` (6 checks funcionais) | ✅ 6/6 |
| `test/finance-reconciliation.e2e-spec.ts` (13 cenários) | ✅ 16/16 |
| Regressão Fase 12 (`FASE-12-TESTE-ORGANICO.sh`) | ✅ 4/4 |
| Regressão e2e `users` + `finance-cash-balance` | ✅ 37/37 |
| Suíte unitária completa (`npx jest`) | ✅ 189/189 |
| `npm run build` / `npm run lint` | ✅ zero erro novo (14 erros de débito pré-existente, fora do escopo desta fase) |
| Validação no banco: `reconciliation_runs.pending_count` (suprema/2026-06-15) = 7, confere com `COUNT(*) FROM reconciliation_items WHERE status='OPEN'` = 7 | ✅ |

## Golden dataset (stub, marca `suprema`, dia `2026-06-15`)

Números travados, derivados manualmente de `RECON_BANK_ROWS`/`RECON_PLATFORM_*` em
`scripts/finance-dev-stubs.js` e confirmados via `psql` contra o Postgres real:

- `matchedCount` = 4 (3 depósito + 1 saque)
- `openCount` = 7, `resolvedCount` = 2 (estornos liquidados automaticamente), `reprocessPendingCount` = 1
- `platformDeposits` = {175.00, 3} · `bankDeposits` = {170.00, 4} · `depositsCrossover` = {12.00, 1}
- `platformWithdrawals` = {270.00, 2} · `bankWithdrawals` = {430.00, 5} · `withdrawalsCrossover` = {0, 0}
- `treasury` = {500.00, 1} · `fees` = {0.05, 1}
- `depositsDifference` = -5.00, `withdrawalsDifference` = 160.00 (invariante: diferença = crossover + pendências, confirmado)

## Notas técnicas

- **Bug real encontrado e corrigido nesta fase:** `.env.test` tinha `TRIO_AMOUNT_DIVISOR=1`,
  divergindo da decisão 6 do CLAUDE.md (confirmada em `100`, mas só `.env`/`.env.example` haviam
  sido atualizados na Fase 06). Sem a correção, todo valor em reais vindo da Trio chegava 100× maior
  no e2e — só apareceu agora porque esta é a primeira fase com asserção de valor monetário real
  ponta a ponta contra os stubs. Corrigido para `100`.
- **`AuditInterceptor` entre módulos:** `@UseInterceptors(Classe)` resolve as dependências do
  enhancer no container do módulo que declara o controller consumidor, não no módulo que originou a
  classe — mesmo com a classe exportada. Foi necessário reexportar o próprio `TypeOrmModule` (não só
  `AuditInterceptor`) de `cash-balance.module.ts` para que `FinanceAuditLogRepository` (dependência
  transitiva) ficasse visível em `ReconciliationModule`. Ver comentário em `cash-balance.module.ts`.
- **`:id` das rotas `resolve`/`reopen` é `ParseIntPipe`, não `ParseUUIDPipe`** — decisão do usuário
  corrigindo uma inconsistência real do planejamento da fase (`ReconciliationItem.id` é `SERIAL`,
  decisão 4 do CLAUDE.md, não UUID).
- **`ResolveItemUseCase` concentra resolve+reopen** — decisão de implementação para manter o
  construtor de `ReconciliationService` em 5 parâmetros (`max-params` do ESLint); as duas transições
  de estado compartilham a mesma checagem de posse (busca + autorização pelo dado).
