# FASE 17 — Teste Orgânico: Fechamento (última fase)
> Data: 2026-09-02/03 | Status: ✅ concluída

## Como executar
```bash
npm ci --ignore-scripts
npm run lint
npm run dup:check
npm run format:check
npm run test:cov
npm run build
npm audit --audit-level=high
docker build -t users-api:finance-ci .
helm lint deploy/helm/users-api
helm template deploy/helm/users-api --set image.tag=finance-ci >/dev/null
docker compose -f docker-compose.yml -f docker-compose.ci.yml --profile full up -d
curl -fsS http://localhost:3005/health/readiness
docker compose -f docker-compose.yml -f docker-compose.ci.yml --profile full down -v
```

## Pré-requisitos
- [x] Fases 01–16 concluídas
- [x] `docker`, `helm` instalados (`~/.local/bin/helm`, v3.15.4)
- [x] `node scripts/finance-dev-stubs.js &` rodando (portas 3100/8123/9001)

## Resultado real dos 12 comandos do passo 4 (exit code confirmado, não assumido)

| # | Comando | Exit | Observação |
|---|---|---|---|
| 1 | `npm ci --ignore-scripts` | 0 | 1176 pacotes, 0 vulnerabilidades |
| 2 | `npm run lint` | 0 | 19 erros pré-existentes das Fases 01/02 + 5 do arquivo novo desta fase, todos corrigidos (ver "Correções de débito" abaixo) |
| 3 | `npm run dup:check` | 0 | 42 clones, 3.35% de tokens duplicados — sob o limiar do script |
| 4 | `npm run format:check` | 0 | — |
| 5 | `npm run test:cov` | 0 | 48 suítes, 288 testes unitários |
| 6 | `npm run build` | 0 | — |
| 7 | `npm audit --audit-level=high` | 0 (era 1) | 2 vulnerabilidades pré-existentes (`fast-uri` alta, `qs` moderada) corrigidas via `npm audit fix` (sem `--force`) — ver abaixo |
| 8 | `docker build -t users-api:finance-ci .` | 0 | imagem final, `found 0 vulnerabilities` na camada de produção |
| 9 | `helm lint deploy/helm/users-api` | 0 | 1 chart linted, 0 falhas |
| 10 | `helm template ... --set image.tag=finance-ci` | 0 | 292 linhas de manifest renderizadas |
| 11 | `docker compose ... --profile full up -d` + `curl readiness` | 0 | `{"status":"ok","info":{"database":{"status":"up"}}}`, HTTP 200 |
| 12 | `docker compose ... --profile full down -v` | 0 | teardown limpo |

`npm run test:e2e` (fora da lista dos 12, mas exigido pelos critérios de aceite): **151/151** — as 7
suítes (`users`, `finance-cash-balance`, `finance-reconciliation`, `finance-smoke`, `security`, `rls`,
`rls-app`).

Regressão das 16 fases anteriores, uma a uma (`scripts/*/FASE-*-TESTE-ORGANICO.sh`): **16/16 verde**.

## Correções de débito encontradas nesta fase (não implementação nova — auditoria virou correção)

Todas as 3 abaixo são débito **pré-existente** (Fases 01–15), nunca tocado por nenhuma fase anterior
porque nenhuma delas rodou os 12 gates do CI de ponta a ponta. Decisão do usuário (3 opções, Fase 17):
corrigir tudo agora, já que "fechamento" é exatamente o momento certo.

1. **`npm run lint` — 14 erros pré-existentes das Fases 01/02** (registrados como débito desde a Fase
   03, "decisão do usuário sobre quando limpar"): 2× `sonarjs/no-floating-point-equality` em
   `kpi-card.util.spec.ts` (suprimido com `eslint-disable-next-line` + comentário — são testes que
   EXISTEM para provar igualdade exata pós-arredondamento; `toBeCloseTo` esconderia a dízima que o
   teste existe para pegar); 4× `@typescript-eslint/no-unsafe-assignment` em specs que leem o fixture
   JSON do golden dataset (`matcher.spec.ts`, `correction-matcher.spec.ts`, `refund-settlement.spec.ts`,
   `totals.util.spec.ts` — trocado `const fixture: Fixture = JSON.parse(...)` por
   `JSON.parse(...) as Fixture`); 1× `sonarjs/todo-tag` em `refund-settlement.ts` (mesmo falso positivo
   de "todo" como pronome em português já documentado 6× nesta trilha — "todo crédito" → "cada
   crédito"); 1× `sonarjs/cognitive-complexity` em `matcher.ts` — `pairByExternalKey` extraída em
   `pairBucket` (extract-method puro, comportamento idêntico, confirmado pelos 63/63 testes do domínio
   da conciliação rodando antes e depois sem alteração de resultado). Mais 5 erros triviais de
   `prettier` no `finance-smoke.e2e-spec.ts` (arquivo novo desta fase), corrigidos com `eslint --fix`.
2. **`npm audit --audit-level=high` — 2 vulnerabilidades pré-existentes, nenhuma do Finance**:
   `fast-uri@3.1.5` (alta, via `@nestjs/cli`/`@commitlint/cli` — devDependencies, tooling de build) e
   `qs@6.15.3` (moderada, via `express`/`supertest`). `npm audit fix` (sem `--force`) resolveu as duas
   com bump de patch/minor (`fast-uri@3.1.7`, `qs@6.16.0`) — só `package-lock.json` mudou (6 linhas).
   Testes unitários (288/288) e e2e (151/151) rerodados depois do bump: zero regressão.
3. **`.env.docker` sem as 14 variáveis novas do Finance** — nunca atualizado em nenhuma fase anterior;
   `docker compose --profile full up` sempre teria falhado no boot (Joi fail-fast) se alguém tivesse
   rodado esse gate antes. Corrigido com as mesmas 3 integrações (`CLICKHOUSE_*`, `TRIO_*`,
   `SAYPLUS_API_URL`, `RECONCILIATION_BANK_KEY_FIELD`) apontando para
   `http://host.docker.internal:{8123,9001,3100}` — os stubs de `finance-dev-stubs.js` rodam no HOST,
   fora da rede do compose; `host.docker.internal` já resolve nesta máquina (Docker Desktop/WSL2) sem
   precisar de `extra_hosts`. Confirmado com o container real subindo e respondendo `/health/readiness`
   200. Em produção estas 3 URLs vêm do `ConfigMap`/`Secret` via `envFrom` do Helm — `.env.docker` é só
   convenção local, nunca chega a produção.

## Divergência de negócio encontrada e resolvida (não correção de código, decisão do usuário)

`docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §1.1/§6 descrevia um `ThrottlerGuard` (429, 100
req/min) como parte da cadeia de guardas globais. **Não existe em nenhuma camada** — nem
`@nestjs/throttler` no `package.json`, nem `ThrottlerGuard` em `src/`, nem anotação de rate-limit no
Helm/ingress. Decisão do usuário (3 opções): documentar a divergência em §8, não implementar nesta
fase de fechamento. A linha `429` do catálogo §6 foi riscada com o motivo. Vale também a correção,
já prevista pela decisão 13 do `CLAUDE.md` mas nunca propagada ao catálogo: `:id não é UUID` → `:id
não é um inteiro válido` (rotas 13/14 usam `ParseIntPipe`, `SERIAL`, nunca UUID).

## Arquivos novos/expandidos desta fase

- `test/finance-smoke.e2e-spec.ts` (novo, 72 testes): superfície comum do catálogo §6 — 401/403 em
  todas as 14 rotas, marca inválida/sem acesso nas 5 rotas com `:brand`, banco inválido, balance
  inválido, campo extra em todas as rotas com corpo, data inválida, `from>to`/`>180 dias`, `:id`
  inválido, nota fora dos limites (bruta e pós-`trim`), `NOT_RUN`, e os 2 cenários de dependência
  externa fora do ar (identidade e ClickHouse) via 2 instâncias Nest adicionais com
  `SAYPLUS_API_URL`/`CLICKHOUSE_URL` apontando para uma porta fechada.
- `test/finance-cash-balance.e2e-spec.ts` (+1 teste): cenário 2 completo — `register` → `reopen` →
  `register` de novo sem reconfirmar bancos.
- `test/finance-reconciliation.e2e-spec.ts` (+1 teste): invariante 10 (§7) — nota do operador sobrevive
  a uma reexecução de `run` sobre o mesmo dia (chave natural, não `run_id`).
- `scripts/finance-dev-stubs.js` (editado): `/auth/me` decodifica (sem verificar assinatura) o `sub`
  do Bearer recebido — sentinela `user-limited-brands` devolve só o tenant ULTRA, único jeito de
  testar "marca válida mas sem vínculo" (403) contra os 2 stubs reais, sem mockar a integração.
- `deploy/infra/requirements.yaml` (+3 itens): ClickHouse, Trio banking-api, identidade SayPlus.
- `docs/migracao-finance/INFRA-FINANCE.md` §10: marcado como adotado; corrigido o 4º item stale
  (`RECONCILIATION_SCHEDULE_ENABLED`/`TRIO_CLOSING_CAPTURE_ENABLED`, que nunca existiram — a decisão
  real da Fase 15 foi CronJob puro, sem flag de app nenhuma).
- `.env.docker`: as 3 integrações do Finance, ver acima.

## Escalonamento `/code-review` (nível high) — diff completo `main...feature/migracao-finance`

Exigido pela própria fase por tocar auth/RBAC/schema/API pública. 8 ângulos de busca +
verificação. Achados reais tratados:

1. **Bug real confirmado e corrigido, com teste decisivo:** `CashBalanceRepository.closeCompleteDays`
   (usado só pelo CLI `import-balance-history`, nunca pelo fluxo HTTP normal — por isso nenhum e2e
   pegou) fazia `SELECT reference_date` raw sem `::text`, e `dataSource.query()` devolve `Date` do
   driver `pg`, não `string` — o `.localeCompare` do sort final quebraria com `TypeError`. Reproduzido
   byte a byte (revertendo o fix, o novo teste falhou com exatamente esse erro; reaplicando, passou).
   Corrigido com `::text` + 2 testes novos contra Postgres real em `cash-balance.repository.spec.ts`
   (8/8 verde). Mesmo achado, menor severidade, em `findLastKnownBalances` (`-reads.ts`) — corrigido
   por consistência (não crashava, mas o tipo declarado `string` mentia sobre o valor real `Date`).
2. **Achado de documentação real, corrigido:** o comentário do ADR-FINANCE-3 em `architecture.spec.ts`
   generalizava demais — a garantia "nenhuma relação desta pasta tem ciclo real de valor" só é
   verdadeira (e só é testada) para os 2 pares citados (`CashBalanceDay↔CashBalanceDaily`,
   `ReconciliationRun↔ReconciliationItem`); `CashBalanceDaily↔CashBalanceBankEntry` e
   `CashBalanceDaily↔CashBalanceBrandSnapshot` (mesma pasta excluída) têm ciclo de valor real, sem
   teste compensatório — seguro hoje (ordem de carregamento de módulo do Node antes do
   `DataSource.initialize()`), mas sem proteção para entidade nova. Comentário corrigido; registrado
   como débito conhecido em `APRENDIZADOS-DECISOES-FINANCE.md` (decisão 9).
3. **Gap real de auditoria, corrigido:** `AuditInterceptor.NAMED_ACTIONS` (Fase 09) nunca ganhou
   `resolve`/`apply` quando a Conciliação (Fase 13/14) passou a reusar o mesmo interceptor — as 2
   escritas mais relevantes para auditoria financeira do módulo caíam no rótulo genérico `CREATE`.
   Corrigido + 2 testes novos (`audit.interceptor.spec.ts`, 8/8 verde).
4. **2 achados investigados e descartados como não-regressão:** (a) um item previamente resolvido
   automaticamente como estorno liquidado nunca reabre se uma execução posterior deixar de classificá-lo
   como estorno; (b) `confirmBank` não tem guarda contra confirmar depois do registro/fechamento.
   Ambos verificados linha a linha contra o código-fonte real da origem
   (`/home/feh/sayplus-modules/finance/finance-api/src/modules/{reconciliation,cash-balance}/infrastructure/*.repository.ts`)
   — a origem tem **exatamente o mesmo comportamento** nos dois casos (comentário original da origem,
   linha ~241 de `reconciliation.repository.ts`: "Nota, status e autor do tratamento nunca são
   sobrescritos"; `confirmBank` da origem também não tem guarda de status). Comportamento fielmente
   portado, não regressão desta migração — inventar uma correção aqui seria criar regra de negócio
   nova sem pedido do usuário (protocolo de decisão do `CLAUDE.md`). Não alterado.
5. **Achados de qualidade (reuse/simplification/efficiency), débito conhecido, não bloqueante:**
   duplicação do parser `--flag=value` nos 5 CLIs; padrão "ClickHouse falha → degrada" repetido 3×
   nos use-cases de leitura do balanço; 2 conversões reais→centavos reimplementadas fora de
   `number.util.ts`; alguns upserts fazem 1 round-trip por linha em vez de lote (`reconciliation-item.repository*.ts`);
   bisseção da Trio e o CLI de exportação de extrato não paralelizam sub-janelas/marcas onde
   poderiam. Nenhum é bug de correção — todos são melhorias de manutenibilidade/performance fora do
   escopo de "fechamento". Registrados aqui como follow-up, não implementados nesta fase.

Suíte completa re-rodada depois de todas as correções: `npm test` 290/290 (48 suítes),
`npm run test:e2e` 151/151 (7 suítes), `npm run lint`/`format:check` 0.

## CLAUDE.md — revisão de performance

`wc -l CLAUDE.md` = 546 linhas antes desta fase; `git diff 88e9cdf -- CLAUDE.md` (commit em `main`
anterior ao início da trilha) = 552 linhas de diff — o arquivo tinha crescido de forma acentuada,
quase inteiramente novo. Decisão: quebrar em `docs/` — as 16 "Decisões já fechadas" (110 linhas) e os
~50 bullets de "Aprendizados críticos" (340 linhas) foram movidos, verbatim, para
`docs/migracao-finance/APRENDIZADOS-DECISOES-FINANCE.md` (novo), substituídos por uma seção
`## Convenções consolidadas — Migração Finance` de 5 parágrafos (~40 linhas) — só as regras
DURÁVEIS que uma sessão futura precisa carregar por padrão (arquitetura/RLS, padrões de módulo,
gotchas de TypeORM/Postgres, gotchas de tooling Jest/ESLint, verificação), sem a narrativa histórica
fase a fase. A tabela de 17 fases ("Estado atual") também foi condensada em 2 parágrafos ("trilha
concluída", com pointer para `dashboard.html`/`progress.json`). Nunca movido: Stack, Arquitetura,
Princípios de código, Protocolo de Decisão, Convenções de teste, Comandos essenciais — como pedido.
Resultado: `CLAUDE.md` caiu de 546 para 108 linhas; `git diff 88e9cdf` cai para 114 linhas.

### code-review-graph
Não aplicável a este projeto — nenhum hook/MCP `code-review-graph` configurado em
`.claude/settings.json` nem em nenhum outro lugar do repositório.
