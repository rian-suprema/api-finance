# FASE 09 — Teste Orgânico: Balanço de Caixa — API completa
> Data: 2026-09-01 | Status: ✅ passou

## Como executar
```bash
node scripts/finance-dev-stubs.js &      # :3100 /auth/me · :8123 ClickHouse · :9001 Trio (não usado)
npm run start:dev &
sleep 12
bash scripts/balanco-caixa-api/FASE-09-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPatterns=finance-cash-balance
```

## Pré-requisitos
- [x] Fases 01, 02, 06, 07, 08 concluídas
- [x] `npm run auth:keys` (par RS256 de dev) rodado ao menos uma vez
- [x] `node scripts/finance-dev-stubs.js` rodando antes do `npm run start:dev` e antes do `test:e2e`
- [x] Postgres local (`docker compose up -d`) para o script bash; Testcontainers cobre o e2e Jest

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| Script bash (9 checagens HTTP rápidas) | ✅ 9/9 |
| e2e Jest — 14 cenários completos (16 `it`, incluindo os 2 sub-casos de `confirm`) | ✅ 16/16 |
| Regressão Fase 08 | ✅ 4/4 |
| Regressão e2e `users` [EXEMPLO] | ✅ 21/21 |
| Regressão e2e completa (5 suites) | ✅ 57/57 |
| `npm run lint` — zero erro novo (débito pré-existente de Fases 01/02 mantido, fora do escopo) | ✅ |
| `npm run build` / `tsc --noEmit` | ✅ zero erro |

## RED antes da implementação — evidência decisiva

Mesma categoria de defeito de processo já registrada nas Fases 05/07 (implementação escrita antes do
teste orgânico). Corrigido com o mesmo teste decisivo: `cash-balance.module.ts` foi trocado
temporariamente pela versão da Fase 08 (sem `CashBalanceController`/use-cases registrados, arquivo
`git show HEAD:...` da revisão anterior) — a aplicação subiu normalmente, mas as 7 rotas
`/cash-balance/*` devolveram `404` (confirmado por `curl` e pelo script, que falhou 9/9 com exit 9).
Restaurado o `module.ts` da Fase 09, reconfirmado GREEN (9/9 no bash, 16/16 no e2e). RED genuíno e
verificável, embora fora de ordem.

## Notas técnicas

- **Auditoria automática (§1.6 de REGRAS-NEGOCIO-ROTAS.md) não estava no escopo original do
  `FASE-09.md`** — inconsistência real detectada entre o plano e as regras transversais (toda mutação
  autenticada deveria gerar linha em `finance_audit_logs`, mecanismo inexistente até esta fase, embora
  a entidade já existisse desde a Fase 04 com o comentário "extraídos da URL pelo interceptor de
  auditoria (Fase futura)"). Resolvido via protocolo de decisão (3 opções apresentadas ao usuário):
  escolhido implementar `AuditInterceptor` genérico agora (`infrastructure/audit.interceptor.ts`),
  aplicado via `@UseInterceptors` no `CashBalanceController` — não registrado globalmente no `main.ts`
  como na origem, porque neste archetype a tabela é exclusiva do Finance, não de toda a API
  (petshop/users não deve ser auditado nesta tabela). Fase 13 (Reconciliation) precisa decidir como
  reusar a mesma classe para suas rotas de mutação — hoje ela só está registrada como provider em
  `cash-balance.module.ts` e depende de `FinanceAuditLog` (TypeOrmModule.forFeature) só desse módulo.
- **`@AuthToken()` decorator não existia no destino** (a origem tinha; não estava na lista de arquivos
  do `FASE-09.md`) — criado em `src/auth/auth-token.decorator.ts`, mesmo padrão de
  `current-user.decorator.ts`, para repassar o header `Authorization` bruto ao
  `PlatformIdentityService` via `BrandAccessService`.
- **Escalonamento com `/code-review` (segurança) encontrou 4 achados reais**, todos verificados
  adversarialmente e corrigidos nesta fase:
  1. `AuditInterceptor` gravava o header `User-Agent` sem truncar numa coluna `varchar(255)` — um
     valor maior que 255 caracteres fazia o `INSERT` falhar e, como a falha de auditoria é silenciada
     de propósito (`.catch(() => {})`), a mutação financeira seguia com sucesso e sem log de auditoria.
     Corrigido com `.slice(0, 255)`.
  2. `RegisterBrandUseCase` fazia 4 `await`s sequenciais para chamadas independentes — reordenado para
     `resolveManualBalances` (fail-fast, mais barato) seguido de `Promise.all` nas 3 chamadas restantes
     (Trio + 2× ClickHouse).
  3. **Race condition real (a mais séria):** `RegisterBrandUseCase` lia os saldos manuais confirmados
     **fora** de qualquer transação/lock e só depois abria a transação de escrita — uma confirmação
     concorrente (`ConfirmBankUseCase`) entre a leitura e o commit podia ser sobrescrita por um valor
     obsoleto (*lost update*). Corrigido movendo a leitura para **dentro** da transação de
     `CashBalanceRepository.registerBrand`, com `SELECT ... FOR UPDATE` (`lockBankEntries`,
     `cash-balance.repository-upserts.ts`) nas linhas de `cash_balance_bank_entries` **antes** de
     invocar o callback de validação (`resolveManualBalances`, agora injetado pelo use-case) — qualquer
     `UPDATE` concorrente na mesma linha (ex.: `confirmBank`) bloqueia até o commit/rollback dessa
     transação. **Mudança de assinatura em arquivo da Fase 07** (`cash-balance.repository.ts`,
     `registerBrand` agora recebe `(params, resolveManualBalances)`; `RegisterBrandParams` perdeu
     `manualBalances`/`saldoTransacional`/`totalBalanco`, que passam a ser computados dentro da
     transação; `RegisterBrandOutcome` ganhou `saldoTransacional`/`totalBalanco`) — decisão do usuário
     entre 3 opções (a alternativa escolhida foi corrigir agora com lock real, não débito nem
     revalidação sem lock).
     **Gotcha do próprio processo de verificação:** o primeiro teste de regressão escrito para provar
     isso (`Promise.all([registerBrand(...), confirmBank(...)])`, valor final == valor do confirm) foi
     reprovado por uma segunda verificação adversarial que removeu o `.setLock('pessimistic_write')` e
     rodou o teste 5× — passou igual, prova de que era coincidência de timing (o Node/driver não cria
     concorrência real de round-trips só por `Promise.all` de duas chamadas de repositório completas).
     Reescrito como teste decisivo: `QueryRunner` manual mantém a transação que trava a linha **aberta**
     de propósito, dispara a escrita concorrente, confirma que ela **não termina** em 300 ms
     (`expect(confirmCompleted).toBe(false)`), só então libera o lock e confirma que a escrita conclui
     e o valor final é o dela. Confirmado empiricamente nos dois sentidos: com o `.setLock` presente,
     passa (6/6); removendo-o de novo, a mesma asserção falha (`Received: true` — a escrita concorrente
     terminou sem bloqueio). Mesma categoria de aprendizado já registrado nas Fases 05/07: só um teste
     que falha de verdade quando o mecanismo é removido é decisivo — coincidência de timing entre
     `Promise.all` de operações completas não prova nada sobre locking real.
  4. `cash-balance.dto.ts` duplicava o regex `ISO_DATE` já existente em `date.util.ts` — trocado por
     `import { ISO_DATE_PATTERN }`, mesmo padrão, sem mudança de comportamento.
