# FASE 09 — Balanço de Caixa — use-cases + services + controller
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 45**
> Limite: _11 arquivos · risco alto: `register` aceitar saldo do corpo (contorna a exigência de confirmação banco a banco), ou registrar sem fechamento exato da Trio/saldo de jogadores_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, as 7 rotas de `/cash-balance` respondem de ponta a ponta contra Postgres real +
stubs de ClickHouse/Trio/identidade, com as regras de negócio da
`docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §2 implementadas literalmente: `register` nunca
aceita saldo no corpo, exige os 7 bancos manuais confirmados + fechamento Trio capturado + saldo de
jogadores disponível, e o dia só fecha com as 3 marcas confirmadas.

## Pré-requisito

Fases 01, 02, 06, 07 e 08 concluídas — domínio, persistência, integração Trio e identidade/marca já
existem. Esta é a primeira fase da trilha com HTTP real.

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/modules/finance-cash-balance/domain/services/brand-access.service.ts` (Fase 08) — assinaturas exatas
- `src/modules/finance-cash-balance/infrastructure/cash-balance.repository.ts` (Fase 07) — assinaturas de `registerBrand`, `confirmBank`, `findDay`
- `src/auth/current-user.decorator.ts` e `src/auth/jwt-payload.interface.ts` — como o controller lê o usuário autenticado
- `src/common/filters/global-exception.filter.ts` (Fase 03, já estendido) — confirmar que `pendingBanks` passa

### Prompt para Haiku

> Leia os 4 arquivos. Esta fase cria 7 use-cases, 2 services e 1 controller que os consomem.
>
> Verifique:
> 1. As assinaturas de `BrandAccessService`/`CashBalanceRepository` batem com o que os use-cases vão
>    chamar (nomes de método e parâmetros, não o corpo).
> 2. `@CurrentUser()` devolve `JwtPayload` com `sub`/`email`/`tenantId`/`permissions` — não há
>    `userId` direto (é `sub`).
> 3. O filtro de exceção estendido preserva campos extras do payload — confirmar que a interface
>    `ErrorBody` aceita `[key: string]: unknown`.
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [arquivo — conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

_(cenários que alimentam o script funcional — Artefato 2-A, curl real contra app + Postgres + stubs)_

1. **`GET /cash-balance/summary`** sem `date` → `200`, `available` reflete se o stub do ClickHouse
   respondeu; com marca sem vínculo no stub de identidade, a marca simplesmente não aparece em
   `byBrand`.
2. **`GET /cash-balance/banks`** → `200`, os 8 bancos aparecem na ordem do catálogo, banco `trio` com
   `readOnly: true`.
3. **`GET /cash-balance/history`** com `from`/`to` válidos → `200`, `registeredDays` ≤ `rangeDays`;
   com intervalo > 180 dias → `400`.
4. **`GET /cash-balance/trio/refresh`** sem captura no banco para a data → `available: false`,
   nenhuma chamada HTTP à Trio (stub não recebe request — confirmar pelo log do stub).
5. **`POST /:brand/banks/:bank/confirm`** com `bank=trio` → `400 Saldo da Trio é somente leitura`.
6. **`POST /:brand/banks/:bank/confirm`** com banco manual válido → `204`; ler direto no Postgres:
   `cash_balance_bank_entries.confirmed = true`.
7. **`POST /:brand/register`** com corpo `{"date": "...", "balance": 999}` (campo extra) → `400`
   (`forbidNonWhitelisted`).
8. **`POST /:brand/register`** com bancos manuais **incompletos** → `400` com `pendingBanks` no corpo
   (confirmar que o campo sobrevive ao `GlobalExceptionFilter` estendido).
9. **`POST /:brand/register`** com os 7 bancos confirmados **mas sem fechamento Trio capturado** →
   `503 Saldo de fechamento da Trio não capturado...`.
10. **`POST /:brand/register`** completo (7 bancos confirmados + fechamento Trio seedado direto no
    Postgres + stub do ClickHouse respondendo saldo de jogadores) → `201`, `totalBalanco =
    saldoTransacional - saldoJogadores` (sinal correto), e ler no Postgres:
    `cash_balance_daily.status = 'CONFIRMED'`.
11. **Registrar as 3 marcas do dia** → a 3ª resposta tem `dayStatus: 'CLOSED'`; ler
    `cash_balance_days.status = 'CLOSED'` no Postgres.
12. **`POST /:brand/reopen`** da marca registrada → `204`; ler `cash_balance_daily.status = 'DRAFT'`
    e `cash_balance_days.status = 'OPEN'` no Postgres.
13. **`POST /:brand/reopen`** de marca nunca registrada → `404`.
14. **Sem Bearer** em qualquer rota → `401`. **Com Bearer mas sem a permissão da rota** → `403`.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/balanco-caixa-api/FASE-09-TESTE-ORGANICO.sh` agora, com base nos 14 cenários, e
> executá-lo antes de criar qualquer arquivo. Resultado esperado: RED — a rota `/cash-balance/*` não
> existe (`404` em tudo, ou app nem sobe por módulo vazio sem controller).

## Arquivos a criar

### `src/modules/finance-cash-balance/domain/use-cases/get-summary.use-case.ts`
Portar literalmente (ver `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §2.1): degrada para
`available: false` se o ClickHouse falhar, nunca lança.

### `.../get-banks-state.use-case.ts`
Portar literalmente (§2.2): 5 leituras em paralelo (`Promise.all`), sinal `totalBalanco =
saldoTransacional − saldoJogadores`, `null` (não `0`) quando o warehouse falha.

### `.../get-history.use-case.ts`
Portar literalmente (§2.3): duas fontes (snapshots do módulo × KPIs do warehouse), dois divisores de
média (`rangeDays` vs `days.length`).

### `.../refresh-trio.use-case.ts`
Portar literalmente (§2.4): lê **só** `trio_closing_balance.repository.ts` (Fase 07) — nunca chama
`TrioBankingClient` (Fase 06) diretamente.

### `.../confirm-bank.use-case.ts`
Portar literalmente (§2.5): recusa `bank = trio` com `400`.

### `.../register-brand.use-case.ts`
Portar literalmente (§2.6) — **a lógica mais crítica desta fase**: bancos manuais confirmados (senão
`400` com `pendingBanks`), fechamento Trio capturado (senão `503`), saldo de jogadores disponível
(senão `503`), KPIs do dia (degrada para `{0,0}` se falhar), `saldoTransacional = trioBalance +
soma(manualBalances)`, `totalBalanco = saldoTransacional − saldoJogadores`.

### `.../reopen-brand.use-case.ts`
Portar literalmente (§2.7): `404` se não houver `daily` para a marca+data.

### `src/modules/finance-cash-balance/domain/services/cash-balance-read.service.ts`
Orquestra as 4 leituras — resolve escopo via `BrandAccessService` (Fase 08) e delega.

### `.../cash-balance-registry.service.ts`
Orquestra as 3 escritas — mesmo padrão.

### `src/modules/finance-cash-balance/dto/cash-balance.dto.ts`
`CashBalanceQueryDto` (`date?`, `@Matches` ISO), `CashBalanceHistoryQueryDto` (`from?`/`to?`),
`ConfirmBankDto` (`balance: number` com `@IsNumber({maxDecimalPlaces:2})`, `date?`),
`RegisterBrandDto` (**só** `date?` — nunca `balance`, é a garantia estrutural da regra "register não
aceita saldo no corpo").

### `src/modules/finance-cash-balance/presenters/controllers/cash-balance.controller.ts`
As 7 rotas, cada uma com `@Permissions(FINANCE_CASH_BALANCE.<CODE>)` (nunca sem — o gate de
`architecture.spec.ts` reprova). `@HttpCode(204)` em `confirm`/`reopen`. Marca vem de `@Param('brand')`
só como **string a validar** dentro do use-case/service — nunca como fonte de autorização direta.

## Atualizar arquivo de registro de rotas/servidor

`cash-balance.module.ts` — registrar os 7 use-cases, 2 services e o controller como providers,
importando `TypeOrmModule.forFeature` (já feito na Fase 07) e exportando o que a Fase 08 exige.

## Documentação

**Fase com rotas novas.** Para cada uma das 7 rotas, adicionar ao Swagger via decorators
(`@ApiOperation`, `@ApiResponse`) no próprio controller — método + descrição + request body/query
tipado + responses `200`/`201`/`204`/`400`/`403`/`404`/`503` conforme a tabela de erros de
`docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §6, tag `cash-balance`.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/balanco-caixa-api/FASE-09-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 09 — Teste Orgânico: Balanço de Caixa — API completa
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
PREFIX="/api/v1"
PASS=0; FAIL=0

ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

TOKEN_FULL=$(node scripts/auth-dev-token.js \
  finance.cash-balance.summary.read finance.cash-balance.banks.read \
  finance.cash-balance.banks.confirm finance.cash-balance.register.create)
AUTH="Authorization: Bearer $TOKEN_FULL"

check_http() {
  local label="$1" expected="$2"; shift 2
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@")
  [ "$actual" = "$expected" ] && ok "$label → $expected" || fail "$label → esperado $expected, obtido $actual"
}

echo ""
echo "=== FASE 09 — Balanço de Caixa (API) ==="
echo ""

# --- 1. summary sem date ---
check_http "GET /cash-balance/summary" 200 "$BASE_URL$PREFIX/cash-balance/summary" -H "$AUTH"

# --- 2. banks ---
BANKS_BODY=$(curl -s "$BASE_URL$PREFIX/cash-balance/banks" -H "$AUTH")
echo "$BANKS_BODY" | grep -q '"trio"' && ok "GET banks lista o banco trio" || fail "GET banks não lista trio"

# --- 3. history ---
check_http "GET history (intervalo válido)" 200 \
  "$BASE_URL$PREFIX/cash-balance/history?from=2026-08-01&to=2026-08-15" -H "$AUTH"
check_http "GET history (intervalo > 180 dias)" 400 \
  "$BASE_URL$PREFIX/cash-balance/history?from=2025-01-01&to=2026-08-15" -H "$AUTH"

# --- 4. trio/refresh sem captura ---
REFRESH_BODY=$(curl -s "$BASE_URL$PREFIX/cash-balance/trio/refresh?date=2099-01-01" -H "$AUTH")
echo "$REFRESH_BODY" | grep -q '"available":false' \
  && ok "trio/refresh sem captura → available:false" || fail "trio/refresh não sinalizou available:false"

# --- 5. confirm banco trio → 400 ---
check_http "POST confirm bank=trio" 400 -X POST \
  "$BASE_URL$PREFIX/cash-balance/suprema/banks/trio/confirm" \
  -H "$AUTH" -H "content-type: application/json" -d '{"balance": 100}'

# --- 6. confirm banco manual → 204 ---
check_http "POST confirm bank=caixa" 204 -X POST \
  "$BASE_URL$PREFIX/cash-balance/suprema/banks/caixa/confirm?date=2026-08-20" \
  -H "$AUTH" -H "content-type: application/json" -d '{"balance": 1000.50, "date": "2026-08-20"}'

# --- 7. register com campo extra → 400 ---
check_http "POST register com campo extra" 400 -X POST \
  "$BASE_URL$PREFIX/cash-balance/suprema/register" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-08-20", "balance": 999}'

# --- 8. register com bancos incompletos → 400 + pendingBanks ---
REGISTER_INCOMPLETE=$(curl -s -X POST "$BASE_URL$PREFIX/cash-balance/suprema/register" \
  -H "$AUTH" -H "content-type: application/json" -d '{"date": "2026-08-20"}')
echo "$REGISTER_INCOMPLETE" | grep -q "pendingBanks" \
  && ok "register incompleto devolve pendingBanks" || fail "register incompleto sem pendingBanks (ver GlobalExceptionFilter)"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 09 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 09 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

> **Nota:** os cenários 9–14 (register completo, fechamento de dia, reopen) exigem seed direto no
> Postgres (`trio_closing_balances`) e stub do ClickHouse respondendo saldo de jogadores — cobertos
> pelo teste e2e Jest completo abaixo, não só pelo script bash (que valida o caminho HTTP rápido).
> Adicionar `test/finance-cash-balance.e2e-spec.ts` com Testcontainers + os stubs de
> `scripts/finance-dev-stubs.js`, cobrindo os 14 cenários por completo — este arquivo é reaproveitado
> e expandido na Fase 17, mas **nasce aqui**, cobrindo só as rotas desta fase.

### 1. Subir a aplicação + stubs e executar
```bash
node scripts/finance-dev-stubs.js &
npm run start:dev &
sleep 5
bash scripts/balanco-caixa-api/FASE-09-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPattern=finance-cash-balance
```

### 2. Regressão
```bash
bash scripts/identidade-plataforma/FASE-08-TESTE-ORGANICO.sh
npm run test:e2e -- --testPathPattern=users   # o [EXEMPLO] não pode ter regredido
```

### 3. Validação no banco
Confirmar via `psql` que `cash_balance_bank_entries`/`cash_balance_daily`/`cash_balance_days` refletem
exatamente o que os cenários 6, 10, 11 e 12 esperam.

### 4. Criar documento de teste
`scripts/balanco-caixa-api/FASE-09-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/balanco-caixa-api/FASE-09-TESTE-ORGANICO.sh` — passa 100%
- [ ] `npm run test:e2e -- --testPathPattern=finance-cash-balance` — passa 100% (cobre os 14 cenários)
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 08 passa 100%; e2e do `users` [EXEMPLO] continua verde
- [ ] Documentação: Swagger atualizado para as 7 rotas (método, descrição, request, responses)
- [ ] `register` nunca aceita `balance` no corpo (`forbidNonWhitelisted` confirmado)
- [ ] `register` com bancos pendentes devolve `pendingBanks` no corpo do erro
- [ ] `register` sem fechamento Trio ou sem saldo de jogadores devolve `503`, nunca grava
- [ ] Dia fecha só com as 3 marcas `CONFIRMED`
- [ ] `reopen` reabre marca **e** dia na mesma operação
- [ ] Todas as 7 rotas declaram `@Permissions(...)` — `architecture.spec.ts` confirma
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
grep -n "balance" src/modules/finance-cash-balance/dto/cash-balance.dto.ts | grep -A3 "RegisterBrandDto"
grep -c "@Permissions" src/modules/finance-cash-balance/presenters/controllers/cash-balance.controller.ts
grep -n "from '.*typeorm'" src/modules/finance-cash-balance/presenters/controllers/cash-balance.controller.ts
```

### Prompt para Haiku

> Execute os comandos e leia o controller inteiro.
>
> Verifique:
> 1. `RegisterBrandDto` não declara nenhum campo `balance`.
> 2. O terceiro comando (contagem de `@Permissions`) é **7** — uma por rota, nenhuma faltando.
> 3. O quarto comando devolve **zero linhas** — controller não importa `typeorm`.
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN do script bash **e** do e2e Jest.
> Foco: reconstruir o cenário 8 (bancos incompletos) e confirmar, lendo o `git diff` linha a linha, que
> o `pendingBanks` realmente sobrevive ao `GlobalExceptionFilter` — não aceitar "o teste passou" sem
> mostrar o corpo JSON da resposta.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

> **Escalonamento:** esta fase toca segurança (permissões, isolamento por marca) — encadear com
> `/code-review` antes de considerar CONFIRMADO definitivo.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **10 — Persistência da Conciliação**. Marcar Fase 09 concluída. Registrar
em "Aprendizados críticos" qualquer ajuste feito no `scripts/finance-dev-stubs.js` para os testes
passarem (é o tipo de detalhe que vai faltar na Fase 13/14 se não documentado agora).

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-cash-balance/domain/use-cases/ \
        src/modules/finance-cash-balance/domain/services/cash-balance-read.service.ts \
        src/modules/finance-cash-balance/domain/services/cash-balance-registry.service.ts \
        src/modules/finance-cash-balance/dto/ \
        src/modules/finance-cash-balance/presenters/ \
        src/modules/finance-cash-balance/cash-balance.module.ts \
        test/finance-cash-balance.e2e-spec.ts \
        scripts/balanco-caixa-api/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-cash-balance): use-cases, services e as 7 rotas da API

Fase 09/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 09 concluída, validada e enviada para `feature/migracao-finance`.**
As 7 rotas do Balanço de Caixa respondem de ponta a ponta contra infraestrutura real, com as
garantias de negócio críticas (nunca aceitar saldo no corpo, nunca registrar sem fechamento exato)
provadas por teste. Responder "sim" para iniciar a **Fase 10**.
