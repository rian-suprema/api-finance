# FASE 08 — Teste Orgânico: Identidade da plataforma + BrandAccessService
> Data: 2026-09-01 | Status: ✅ passou

## Como executar
```bash
bash scripts/identidade-plataforma/FASE-08-TESTE-ORGANICO.sh
```

## Pré-requisitos
- [x] Fase 07 concluída (repositórios + read-service ClickHouse)
- [x] `platformConfig` registrado em `app.module.ts` (Fase 03)

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| Specs de `platform-identity`/`brand-access` — exit 0 | ✅ |
| Cenário de cache por hash do token (60s) presente | ✅ |
| Nenhum log contém token/Authorization | ✅ |
| `architecture.spec.ts` 100% verde | ✅ |
| Regressão Fase 07 | ✅ |

## Notas técnicas

O script gerado pelo `FASE-08.md` original usava `--verbose` com `grep` na saída para
detectar o cenário de cache, mesmo defeito já documentado nas Fases 01/03 (Jest 30 não lista
nomes de teste que passaram em `--verbose`). Corrigido para `--json --outputFile` + `jq
'.testResults[].assertionResults[].fullName'` — mesmo padrão já convencionado no projeto.

A regra de `axios` em `architecture.spec.ts` já cobria `infrastructure/platform/**` antes desta
fase (confirmado no Pre-flight com Haiku) — a suposição do próprio `FASE-08.md` de que a regra
seria estreita e precisaria de ajuste não se confirmou; o Pre-flight evitou uma correção
desnecessária.
