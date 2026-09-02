# FASE 15 — Teste Orgânico: Jobs (CronJob + CLIs)
> Data: 2026-09-02 | Status: ✅ concluída

## Como executar
```bash
bash scripts/jobs-financeiros/FASE-15-TESTE-ORGANICO.sh
```

## Pré-requisitos
- [x] Fase 14 concluída
- [x] `helm` instalado (para `helm template`) — instalado localmente em `~/.local/bin/helm` nesta
  sessão (ausente no ambiente; ver nota técnica)

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| Build compila os CLIs | ✅ |
| CLI de conciliação usa default (ontem BRT) sem data | ✅ |
| CLI de exportação escreve em stdout | ✅ |
| `helm template` renderiza o `CronJob` | ✅ |
| Regressão e2e (Fases 09/13/14) — 36/36 | ✅ |
| `npm run lint` / `npm test` (288 testes) / `npm run build` | ✅ |

## Notas técnicas

### Decisão sobre RLS no caminho job
Ver `docs/migracao-finance/fases/FASE-15.md`, seção "Dúvida arquitetural encontrada nesta fase" —
3 opções apresentadas ao usuário via pergunta direta. **Escolhida a opção 1 (recomendada):** não
habilitar RLS/`FORCE` nas tabelas do Finance. O isolamento por marca continua só na aplicação
(`BrandAccessService`), como já estava testado e funcionando nas 14 rotas HTTP. A defesa em
profundidade do caminho job/CLI é a função `assertKnownBrand(key)`
(`src/modules/finance-cash-balance/cash-balance.constants.ts`), chamada em `parseArgs` dos 5 CLIs
**antes** de `NestFactory.createApplicationContext` resolver qualquer use-case — uma marca fora do
catálogo nunca chega perto de uma escrita. Confirmado por Haiku (invariantes) que nenhuma migration
habilita RLS/FORCE nas tabelas `cash_balance_*`/`reconciliation_*`.

### `helm` ausente no ambiente
Instalado localmente (binário oficial `v3.15.4`, sem privilégio de root) em `~/.local/bin/helm` —
esse diretório já estava no `PATH` padrão do shell. Necessário revalidar `command -v helm` no início
de qualquer fase futura de infra.

### Bug pego antes de commitar: stdout poluído pelo Logger
`export-trio-statement.ts`/`export-trio-transactions.ts` escrevem o CSV em `stdout` por padrão
(`--out=-`), mas o `Logger` do Nest (nível `log`) também escreve em `stdout` por padrão — misturaria
progresso com CSV no mesmo redirecionamento. Corrigido desligando o nível `log` do
`NestFactory.createApplicationContext` quando `out === '-'` (mantendo `error`/`warn`, que vão para
`stderr`). Verificado manualmente: `node dist/cli/export-trio-statement.js --from=... --out=-`
produz CSV puro em stdout, sem linha de log misturada.

### `CLOSING_BALANCE_SOURCE` ganhou provider real
O token existia desde a Fase 07 (Ports & Adapters), mas nenhum módulo o provia — resolvido nesta
fase com `{ provide: CLOSING_BALANCE_SOURCE, useExisting: TrioPointInTimeBalanceSource }` em
`cash-balance.module.ts`, já que `CaptureTrioClosingUseCase` (desta fase) é o primeiro consumidor
real.

### Regressão manual do script da Fase 14 "falhou" — não é regressão de código
`scripts/conciliacao-correcoes/FASE-14-TESTE-ORGANICO.sh` rodado de novo (fora do fluxo oficial) deu
3/10 "falhas" — causa: o Postgres local via `docker compose` é persistente entre execuções, e uma
corrida anterior já tinha resolvido (`apply`) as 2 pendências exatas do golden dataset. A segunda
corrida via o resultado idempotente correto, não o estado "fresco" que o script assume. O teste
oficial (`npm run test:e2e -- --testPathPatterns="finance-cash-balance|finance-reconciliation"`,
Testcontainers — Postgres efêmero) passou 36/36 sem ressalva — é ele que vale como regressão real.
