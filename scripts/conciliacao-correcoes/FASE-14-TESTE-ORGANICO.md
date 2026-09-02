# FASE 14 — Teste Orgânico: Conciliação — evidência de correção
> Data: 2026-09-02 | Status: ✅ concluída

## Como executar
```bash
node scripts/finance-dev-stubs.js &
npm run start:dev &
sleep 5
bash scripts/conciliacao-correcoes/FASE-14-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPatterns=finance-reconciliation
```

## Pré-requisitos
- [x] Fase 13 concluída

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| `GET corrections` (marca sem pendência candidata) → `searchedCount:0` | ✅ |
| `GET corrections` (suprema) → `searchedCount:4`, 3 com candidato, 1 sem cliente | ✅ |
| Candidato `EXACT_SAME_BRAND` com `exact:true` (FABIO/IVONE) | ✅ |
| Candidato `PARTIAL` com `exact:false` (GISELE) | ✅ |
| `POST corrections/apply` → `201`, `resolvedCount:2`, `partialCount:1`, `withoutCandidateCount:1` | ✅ |
| Segunda chamada de `apply` é idempotente (`resolvedCount:0`) | ✅ |
| Regressão Fase 13 (`FASE-13-TESTE-ORGANICO.sh`) | ✅ |
| `npm run lint` / `npm test` / `npm run build` / `npm run test:e2e` (módulo inteiro) | ✅ |

## Notas técnicas
- RED confirmado de forma decisiva (mesmo padrão das Fases 05/07): as 3 classes novas
  (`search-corrections.use-case.ts`, `apply-correction-matches.use-case.ts`,
  `correction-evidence.service.ts`) foram movidas para fora do repositório e as 4 edições
  (`controller`, `module`, `dto`, `types`) revertidas via `git stash` — com o servidor de dev já no
  ar, `GET /reconciliation/:brand/corrections` voltou a `404` (rota inexistente na Fase 13). Restaurado
  tudo, a mesma chamada voltou a `200` sem reiniciar o processo (hot-reload do `nest start --watch`).
- Golden dataset dos 4 débitos manuais (`trio-man-1..4`) já estava preparado no stub antes desta fase
  começar — ver `CLAUDE.md`, aprendizado da Fase 14, para os valores/CPFs e o número travado de cada
  cenário.
- Pre-flight (Haiku) sinalizou um possível `BLOQUEADO` de unidade (reais vs. centavos) que se revelou
  falso positivo — a conversão já existia no use-case (`toCents`), só não tinha sido lida pelo agente.
  Ver aprendizado da Fase 14 no `CLAUDE.md`.
- `sonarjs/todo-tag` deu falso positivo de novo (mesma causa das Fases 03/04): comentário começando
  com "Todo CPF..." em português. Reescrito.
