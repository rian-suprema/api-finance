# FASE 16 — Teste Orgânico: Contrato do archetype (auditoria)

## Notas técnicas

Esta fase é **auditoria**, não implementação nova (ver objetivo em `FASE-16.md`). O script
`FASE-16-TESTE-ORGANICO.sh` veio **GREEN na primeira execução** — nenhuma correção foi necessária em
`src/main.ts` ou `src/health/health.controller.ts`. Documentando isso explicitamente em vez de tratar
como sinal de script fraco, conforme instruído pela própria fase.

O que a auditoria confirmou, sem nenhuma alteração de código de produção:

1. **Prefixo `/api/v1`:** `app.setGlobalPrefix(config.getOrThrow('app.apiPrefix'), ...)` em
   `src/main.ts` — dinâmico via `API_PREFIX` (default `api/v1`), nunca hardcoded. `GET
   /api/v1/cash-balance/summary` responde `200` (autenticado), não `404`.
2. **Swagger:** `SwaggerModule.setup('docs', ...)` com `DocumentBuilder` code-first — as tags
   `cash-balance`/`reconciliation` vêm dos `@ApiTags(...)` nos 2 controllers, sem listagem manual.
   `GET /docs-json` lista ambas as tags.
3. **Readiness só Postgres:** `src/health/health.controller.ts` usa só `TypeOrmHealthIndicator`;
   zero menção a `clickhouse`/`trio` no arquivo — decisão 2 do `CLAUDE.md` nunca foi violada por
   nenhuma fase anterior.
4. **`decimalTransformer` — 18/18:** as 8 entidades do Finance têm exatamente 18 colunas
   `type: 'numeric'`, e as 18 têm `transformer: decimalTransformer`. Contagem por arquivo:
   `cash-balance-daily.entity.ts` (3), `cash-balance-brand-snapshot.entity.ts` (4),
   `cash-balance-bank-entry.entity.ts` (1), `trio-closing-balance.entity.ts` (1),
   `reconciliation-item.entity.ts` (1), `reconciliation-run.entity.ts` (8),
   `cash-balance-day.entity.ts` (0), `finance-audit-log.entity.ts` (0).
5. **`overrides.js-yaml`:** `npm ls js-yaml` confirma `js-yaml@5.2.3 overridden` em `@nestjs/swagger`
   — nenhuma dependência nova (`@clickhouse/client`, `axios`, `jsonwebtoken`) reintroduziu a versão
   vulnerável.

## Execução

```text
$ bash scripts/contrato-archetype/FASE-16-TESTE-ORGANICO.sh

=== FASE 16 — Contrato do archetype ===

  ✅  rota vive sob /api/v1 (não 404, status=200)
  ✅  Swagger lista a tag cash-balance
  ✅  Swagger lista a tag reconciliation
  ✅  todas as 18 colunas monetárias têm decimalTransformer
  ✅  readiness continua só Postgres
  ✅  overrides.js-yaml intacto (@nestjs/swagger em 5.2.3)

✅  FASE 16 — PASSOU (6 testes)
```

## Regressão

- `bash scripts/jobs-financeiros/FASE-15-TESTE-ORGANICO.sh` — 5/5 ✅
- `npm run test:e2e` — 77/77 (6 suítes) ✅

## Invariantes de sessão (Haiku)

`grep -c "type: 'numeric'"` vs `grep -c "transformer: decimalTransformer"` por arquivo — **TODOS
APROVADOS**, nenhuma divergência.

## Verificação Adversarial de Aceite

**CONFIRMADO** — nenhuma alteração de produção necessária; todos os critérios de aceite verificados
de forma independente (git diff vazio em `src/`, contagens, e2e, build).
