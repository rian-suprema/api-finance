# FASE 15 — Jobs: CronJob Helm + 5 CLIs + RLS no caminho job
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 40**
> Limite: _8 arquivos · risco: habilitar RLS/FORCE nas tabelas do Finance sem perceber que isso zera toda leitura HTTP existente (Fases 09/13/14) — ver "Dúvida arquitetural" abaixo, tratar como bloqueante_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, um `CronJob` do Kubernetes invoca os CLIs de captura e conciliação (decisão já
tomada nesta trilha — ver `CLAUDE.md` §"Decisões já fechadas", item 3), eliminando a duplicação de
trabalho contra a Trio que o `replicaCount: 2` causaria com `@Cron` in-process. Os 5 CLIs existem como
scripts Node standalone, batendo nos mesmos use-cases que a API usa.

## ⚠️ Dúvida arquitetural encontrada nesta fase — ler ANTES de tocar em RLS

> O `docs/migracao-finance/MIGRACAO-FINANCE.md` §4.3 (opção 2) sugeria aplicar
> `runInTenantContext(dataSource, brandSlug, work)` no caminho job, com policy de RLS usando o slug
> da marca como valor do GUC `app.tenant_id`. **Ao chegar nesta fase, isso se mostra incompatível com
> o que já foi construído:** se uma policy de RLS com `FORCE` for habilitada nas tabelas do Finance,
> **toda** leitura/escrita passa a exigir o GUC setado — inclusive as rotas HTTP das Fases 09/13/14,
> que hoje leem/escrevem via `Repository`/`DataSource.transaction()` **sem** GUC nenhum (o isolamento
> por marca é só na aplicação, via `BrandAccessService` — decisão registrada em `CLAUDE.md` item 5).
> Com `FORCE` ativo e sem GUC, a policy resolve `NULL` → **zero linhas visíveis**, silenciosamente,
> em todas as 14 rotas de negócio já testadas e comitadas.
>
> **Isto é uma inconsistência real entre uma sugestão do plano original e o que foi efetivamente
> implementado — parar e aplicar o protocolo de decisão, com estas 3 opções:**
>
> 1. **(Recomendado) Não habilitar RLS/FORCE nas tabelas do Finance.** O isolamento por marca
>    continua só na aplicação (como já está, testado e funcionando). A defesa em profundidade do
>    caminho job vira uma **asserção na aplicação**: cada CLI/job já itera `BRAND_KEYS` do catálogo
>    (`cash-balance.constants.ts`), nunca um valor vindo de fora — adicionar um `assertKnownBrand(brand)`
>    (lança se a marca não estiver no catálogo) no ponto de entrada de cada CLI é defesa real, sem
>    risco de derrubar o caminho HTTP.
> 2. **Implementar RLS com policy de array** (`brand = ANY(string_to_array(current_setting(...),
>    ','))`) e fazer o `TenantTransactionInterceptor`-equivalente do Finance setar o GUC com as
>    marcas acessíveis do usuário em toda request HTTP, além do job. Correto, mas é trabalho de
>    modelagem novo (nunca pedido, ver `MIGRACAO-FINANCE.md` §4.3) e fora do orçamento desta fase —
>    exigiria uma fase própria.
> 3. **Adiar a decisão**, registrar como dívida explícita em `docs/migracao-finance/MIGRACAO-FINANCE.md`
>    e no `requirements.yaml`, sem implementar nenhuma defesa nova no caminho job por ora.
>
> **Recomendação desta fase: opção 1.** Aguardar confirmação do usuário antes de prosseguir com
> "Arquivos a criar".

## Pré-requisito

Fases 09, 13 e 14 concluídas (os use-cases que os CLIs invocam já existem).

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora — depois da decisão sobre RLS acima.**

### Arquivos a ler
- `src/modules/finance-reconciliation/domain/use-cases/run-reconciliation.use-case.ts` (Fase 13) — assinatura de `execute`
- `src/modules/finance-cash-balance/domain/use-cases/capture-trio-closing.use-case.ts` — **ainda não existe formalmente como arquivo separado**; confirmar se a Fase 09 já criou algo equivalente ou se nasce aqui
- `deploy/helm/users-api/templates/migrations-job.yaml` — padrão de `Job` do chart, para espelhar no `CronJob`
- `docs/migracao-finance/INFRA-FINANCE.md` (seção 6) — a análise completa do problema de réplicas

### Prompt para Haiku

> Leia os 4 pontos. Esta fase cria `capture-trio-closing.use-case.ts` (se ainda não existir),
> `import-balance-history.use-case.ts`, 5 CLIs e um `CronJob` Helm.
>
> Verifique:
> 1. `RunReconciliationUseCase.execute({referenceDate, brands})` — os CLIs vão chamar exatamente essa
>    assinatura com `brands: [...BRAND_KEYS]` (todas as marcas do catálogo, não as de um usuário —
>    não há usuário no job).
> 2. O padrão de `migrations-job.yaml` (imagem, `command`, `env`/`envFrom` do ConfigMap/Secret) para
>    reaproveitar no `cronjob.yaml`.
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **CLI de conciliação sem argumento de data:** usa `yesterdayInBrt()` como default (o `CronJob` não
   passa data — precisa funcionar "às cegas", como o `@Cron` original fazia).
2. **CLI de conciliação com data explícita:** usa a data passada, ignorando o default.
3. **CLI de captura com `--overwrite`:** propaga a flag para `CaptureTrioClosingUseCase`.
4. **CLI de captura sem `--overwrite`:** propaga `false` (nunca sobrescreve por acidente).
5. **`assertKnownBrand`** (decisão da "Dúvida arquitetural", opção 1): marca fora do catálogo lança
   erro explícito antes de qualquer escrita.
6. **CLI de exportação de extrato:** com `--out=-` (ou sem `--out`), escreve CSV em `stdout` — nunca
   em arquivo (decisão registrada em `docs/migracao-finance/INFRA-FINANCE.md` §7, por causa de
   `readOnlyRootFilesystem` e do PII no extrato analítico).
7. **`cronjob.yaml` renderiza** (`helm template`) sem erro, com `schedule` em UTC correto para
   00:00:30/00:30/04:00 BRT (`03:00:30`/`03:30`/`07:00` UTC, já que o Brasil não tem horário de
   verão desde 2019 — documentar esse pressuposto no comentário do template).
8. **`cronjob.yaml` reaproveita a mesma imagem e o mesmo ConfigMap/Secret** do `Deployment` — não
   duplica variável de ambiente.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/jobs-financeiros/FASE-15-TESTE-ORGANICO.sh` agora. Resultado esperado: RED — os
> CLIs e o template ainda não existem.

## Arquivos a criar

### `src/modules/finance-cash-balance/domain/use-cases/capture-trio-closing.use-case.ts`
Portar literalmente (a origem já documentada em `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §5):
uma marca que falha não impede as outras (`Promise.all` com try/catch por marca).

### `.../import-balance-history.use-case.ts`
Portar literalmente: recebe os agregados já prontos de uma linha de CSV (não recalcula
`saldoJogadores`), grava via `importBrandBalance` (Fase 07), chama `recomputeMonthlyAccumulated` e
`closeCompleteDays` ao final da carga inteira — nunca por linha.

### `src/cli/run-reconciliation.ts`
**Motivo:** `node dist/cli/run-reconciliation.js [data]` — sem `npm run` (a imagem de produção não
tem o toolchain, ver `docs/migracao-finance/INFRA-FINANCE.md` §7). Sem argumento, usa
`yesterdayInBrt()`. `NestFactory.createApplicationContext(AppModule)`, resolve
`RunReconciliationUseCase`, chama com `brands: [...BRAND_KEYS]`, loga o resultado, `process.exit(0)`
ou `1` conforme sucesso/falha, fecha o contexto (`app.close()`).

### `src/cli/capture-trio-closing.ts`
Mesmo padrão, resolve `CaptureTrioClosingUseCase`, aceita `[data] [--overwrite]`.

### `src/cli/import-balance-history.ts`
Mesmo padrão, aceita `<caminho-do-csv>`, parseia e chama `ImportBalanceHistoryUseCase` por linha.

### `src/cli/export-trio-statement.ts`
Usa `TrioBankingClient.summarizeFlows` diretamente (não é use-case de domínio — é utilitário
operacional). Aceita `--from=`/`--to=`/`--out=` (default `-`, escreve em `stdout`).

### `src/cli/export-trio-transactions.ts`
Usa `TrioBankingClient.listTransactions`. **Contém PII** — o comentário do arquivo deve alertar
explicitamente sobre isso e reforçar a recomendação de rodar fora do cluster ou com
`--out=-` + redirecionamento na máquina do operador, nunca em volume de pod de produção.

### `deploy/helm/users-api/templates/cronjob.yaml`
2 `CronJob`: `{{ include "users-api.fullname" . }}-trio-capture` (`schedule: "3 3 * * *"`, comando
`["node","dist/cli/capture-trio-closing.js"]`) e `{{ include "users-api.fullname" . }}-reconciliation`
(`schedule: "0 7 * * *"`, comando `["node","dist/cli/run-reconciliation.js"]`). Reaproveita a mesma
imagem (`.Values.image`), `envFrom` do ConfigMap e `existingSecret` do Deployment,
`restartPolicy: OnFailure`, `concurrencyPolicy: Forbid` (nunca duas execuções simultâneas do mesmo
job — a guarda de reentrância do use-case já existe, mas o CronJob não precisa depender só dela).

### `deploy/helm/users-api/values.yaml` (editar)
Adicionar bloco `cronjobs` com `enabled`, `schedule` de cada um (permitindo sobrescrever por
ambiente em `values-<env>.yaml`), `resources` próprios (não os do Deployment — a conciliação pode
precisar de mais memória, ver `docs/migracao-finance/INFRA-FINANCE.md` §9.2).

## Atualizar arquivo de registro de rotas/servidor

Não aplicável a rotas HTTP. `package.json` — **não** adicionar scripts `npm run trio:capture` etc.
como ponto de entrada de produção (a imagem não tem `npm`) — se adicionados, são só para
conveniência de desenvolvimento local, documentar isso no comentário do `package.json`.

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/jobs-financeiros/FASE-15-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 15 — Teste Orgânico: Jobs (CronJob + CLIs)
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 15 — Jobs ==="
echo ""

npm run build >/tmp/fase15-build.log 2>&1 && ok "build compila os CLIs" || fail "build falhou (ver /tmp/fase15-build.log)"

node scripts/finance-dev-stubs.js &
STUB_PID=$!
sleep 1

node dist/cli/run-reconciliation.js >/tmp/fase15-reconcile.log 2>&1
[ $? -eq 0 ] && ok "CLI run-reconciliation.js executa sem data explícita (default: ontem BRT)" \
  || fail "CLI run-reconciliation.js falhou (ver /tmp/fase15-reconcile.log)"

node dist/cli/export-trio-statement.js --from=2026-08-01 --to=2026-08-02 --out=- \
  >/tmp/fase15-statement.csv 2>/tmp/fase15-statement.log
[ -s /tmp/fase15-statement.csv ] && ok "CLI export-trio-statement escreve em stdout" \
  || fail "CLI export-trio-statement não escreveu em stdout"

kill $STUB_PID 2>/dev/null

helm template deploy/helm/users-api --set image.tag=test >/tmp/fase15-helm.log 2>&1 \
  && ok "helm template renderiza sem erro" || fail "helm template falhou (ver /tmp/fase15-helm.log)"

grep -q "CronJob" /tmp/fase15-helm.log && ok "cronjob.yaml renderizado no output do helm template" \
  || fail "nenhum CronJob encontrado no output do helm template"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 15 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 15 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/jobs-financeiros/FASE-15-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/conciliacao-correcoes/FASE-14-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPattern="finance-cash-balance|finance-reconciliation"   # confirmar que NÃO habilitar RLS não quebrou nada (e que, se a opção 1 foi escolhida, tudo continua igual)
```

### 3. Criar documento de teste
`scripts/jobs-financeiros/FASE-15-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] **Decisão sobre RLS no caminho job registrada** (uma das 3 opções, com o motivo) — nunca implementada silenciosamente
- [ ] `bash scripts/jobs-financeiros/FASE-15-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 14 passa 100%; e2e das 14 rotas de negócio continuam verdes
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] CLIs funcionam sem `npm` (invocados como `node dist/cli/*.js`)
- [ ] CLI de conciliação/captura usa `yesterdayInBrt()` como default quando sem data explícita
- [ ] CLIs de exportação escrevem em `stdout` por padrão — nunca em arquivo dentro do pod
- [ ] `cronjob.yaml` renderiza, reaproveita imagem/ConfigMap/Secret do Deployment, `concurrencyPolicy: Forbid`
- [ ] Invariantes de sessão verificados com Haiku — zero violações
- [ ] Verificação Adversarial de Aceite — CONFIRMADO
- [ ] `CLAUDE.md` atualizado
- [ ] `progress.json` atualizado
- [ ] `dashboard.html` EMBEDDED sincronizado
- [ ] Custo real registrado via `update-phase-cost.js`
- [ ] Dashboard aberto no browser — best-effort
- [ ] Commit e push para `feature/migracao-finance`

## ✅ Invariantes de Sessão — Haiku antes de finalizar

> **Invocar Agent com `model: claude-haiku-4-5-20251001`.**

### Comandos de inspeção
```bash
grep -n "ENABLE ROW LEVEL SECURITY\|FORCE ROW LEVEL SECURITY" src/database/migrations/*.ts | grep -i "cash_balance\|reconciliation"
grep -rn "npm run" src/cli/ 2>/dev/null
```

### Prompt para Haiku

> Execute os comandos. O primeiro deve devolver **zero linhas** se a opção 1 (recomendada) da
> "Dúvida arquitetural" foi escolhida — nenhuma migration habilita RLS nas tabelas do Finance. Se a
> opção 2 foi escolhida em vez disso, confirme que existe também o interceptor HTTP correspondente
> setando o GUC em toda request — sem ele, a policy quebraria as rotas. O segundo comando deve
> devolver zero linhas — CLIs nunca invocam `npm run` de dentro de si mesmos.
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir — RLS mal aplicado aqui derrubaria silenciosamente as 14 rotas já
> testadas. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco principal: **rodar o e2e
> completo das Fases 09/13/14** depois das mudanças desta fase e confirmar que nenhuma rota deixou de
> ver dado que via antes — é o teste mais direto de que a decisão sobre RLS não quebrou nada.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **16 — Contrato do archetype**. Marcar Fase 15 concluída. Registrar a
decisão sobre RLS no caminho job em "Decisões já fechadas para esta trilha", substituindo a menção
antiga (que citava a opção 2 do `MIGRACAO-FINANCE.md` como planejada).

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-cash-balance/domain/use-cases/capture-trio-closing.use-case.ts \
        src/modules/finance-cash-balance/domain/use-cases/import-balance-history.use-case.ts \
        src/cli/ deploy/helm/users-api/templates/cronjob.yaml deploy/helm/users-api/values.yaml \
        scripts/jobs-financeiros/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance): CronJob + 5 CLIs, sem RLS no caminho job (decisão registrada)

Fase 15/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 15 concluída, validada e enviada para `feature/migracao-finance`.**
O `CronJob` substitui os `@Cron` in-process (elimina duplicação com `replicaCount: 2`); os 5 CLIs
funcionam sem `npm`; a decisão sobre RLS no caminho job está registrada e não quebrou nenhuma rota
existente. Responder "sim" para iniciar a **Fase 16**.
