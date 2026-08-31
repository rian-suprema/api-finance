# FASE 16 — Contrato do archetype (prefixo/Swagger/health/decimal)
> **Configuração da sessão**
> Comando: `claude --model claude-haiku-4-5-20251001` (`MODELO_HAIKU` resolvido) · **max-turns 20**
> Limite: _2 arquivos · risco: baixo — auditoria e confirmação, não lógica nova_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, está confirmado (não implementado do zero — a maior parte já é comportamento do
esqueleto) que: as 14 rotas do Finance vivem sob `api/v1`, aparecem no Swagger com a tag correta, o
`/health/readiness` verifica só Postgres (decisão já registrada, ver `CLAUDE.md` item 2), e **toda**
coluna monetária das 8 tabelas usa `decimalTransformer` (auditoria final, não criação).

## Pré-requisito

Fases 09, 13 e 14 concluídas — as 14 rotas de negócio existem.

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/main.ts` — prefixo e configuração do Swagger já existentes
- `src/health/health.controller.ts` — já só verifica Postgres desde o esqueleto original (nada do Finance foi adicionado ao readiness, por decisão da Fase 03/CLAUDE.md)

### Prompt para Haiku

> Leia os 2 arquivos. Esta fase é principalmente auditoria — confirmar que nada precisa mudar, e
> corrigir se algo escapou.
>
> Verifique:
> 1. `main.ts` usa `appConfig.apiPrefix` (não um valor fixo `'api'` hardcoded).
> 2. `health.controller.ts` não ganhou nenhum `HealthIndicator` de ClickHouse/Trio em nenhuma fase
>    anterior (buscar por `clickhouse`/`trio` no arquivo).
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **Todas as 14 rotas do Finance respondem sob `/api/v1/...`** (não `/api/...` sem versão).
2. **`GET /docs` (Swagger)** lista as tags `cash-balance` e `reconciliation`, cada uma com as rotas
   esperadas.
3. **`GET /health/readiness`** não faz nenhuma chamada ao ClickHouse/Trio (confirmar via log do stub
   — nenhuma requisição chega neles quando só o readiness é chamado).
4. **Auditoria de `decimalTransformer`:** todas as 18 colunas monetárias das 8 entidades (contagem
   exata, ver `docs/migracao-finance/DADOS-FINANCE.md` §3–4) têm `transformer: decimalTransformer`.
5. **`overrides.js-yaml`** do `package.json` (supply chain, já resolvido no esqueleto) continua
   presente depois de todas as dependências novas instaladas (`@clickhouse/client`, `axios`,
   `jsonwebtoken` já era do esqueleto) — nenhuma delas reintroduziu a versão vulnerável.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/contrato-archetype/FASE-16-TESTE-ORGANICO.sh` agora. Como esta fase é
> majoritariamente auditoria, o RED esperado aqui é **diferente** das fases anteriores: não é "o
> recurso não existe", é "a auditoria ainda não foi executada" — rodar o script uma vez antes de
> qualquer alteração e registrar o resultado (pode já vir GREEN, se nada precisar de correção; nesse
> caso, documentar isso explicitamente em vez de forçar uma falha artificial).

## Arquivos a criar

### `src/main.ts` (editar, só se a auditoria encontrar divergência)
Confirmar `app.setGlobalPrefix(appConfig.apiPrefix)` e o Swagger `SwaggerModule.setup(...)` com
`DocumentBuilder` incluindo as tags `cash-balance`/`reconciliation` (o `@ApiTags` dos controllers já
deveria bastar — Swagger code-first não exige listagem manual de tags).

### `src/health/health.controller.ts` (editar, só se a auditoria encontrar divergência)
Confirmar que **nenhum** `HealthIndicator` de ClickHouse/Trio foi adicionado — se algum PR anterior
tiver introduzido isso por engano, remover (decisão registrada: readiness é só Postgres).

## Atualizar arquivo de registro de rotas/servidor

Nenhuma mudança de registro — esta fase é auditoria.

## Documentação

Não aplicável — nenhuma rota nova; confirmar que a documentação Swagger **já existente** (Fases 09,
13, 14) está completa, não criar nova.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/contrato-archetype/FASE-16-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 16 — Teste Orgânico: Contrato do archetype (auditoria)
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
PREFIX="/api/v1"
PASS=0; FAIL=0

ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 16 — Contrato do archetype ==="
echo ""

TOKEN=$(node scripts/auth-dev-token.js finance.cash-balance.summary.read)
SUMMARY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$PREFIX/cash-balance/summary" \
  -H "Authorization: Bearer $TOKEN")
[ "$SUMMARY_STATUS" != "404" ] && ok "rota vive sob $PREFIX (não 404)" || fail "rota não encontrada sob $PREFIX"

DOCS_BODY=$(curl -s "$BASE_URL/docs-json" 2>/dev/null || curl -s "$BASE_URL/api/docs-json" 2>/dev/null)
echo "$DOCS_BODY" | grep -qi "cash-balance" && ok "Swagger lista a tag cash-balance" \
  || fail "Swagger não lista cash-balance (confirmar caminho do JSON: /docs-json ou /api/docs-json)"
echo "$DOCS_BODY" | grep -qi "reconciliation" && ok "Swagger lista a tag reconciliation" \
  || fail "Swagger não lista reconciliation"

# Auditoria de decimalTransformer — contagem exata de colunas monetárias
MONEY_COLUMNS=$(grep -rc "type: 'numeric'" src/modules/finance-*/entities/*.entity.ts | \
  awk -F: '{sum+=$2} END {print sum}')
TRANSFORMED=$(grep -rc "transformer: decimalTransformer" src/modules/finance-*/entities/*.entity.ts | \
  awk -F: '{sum+=$2} END {print sum}')
[ "$MONEY_COLUMNS" = "$TRANSFORMED" ] \
  && ok "todas as $MONEY_COLUMNS colunas monetárias têm decimalTransformer" \
  || fail "$MONEY_COLUMNS colunas numeric vs $TRANSFORMED com transformer — divergência"

grep -n "clickhouse\|trio" src/health/health.controller.ts -i \
  && fail "health.controller.ts referencia ClickHouse/Trio — readiness deveria ser só Postgres" \
  || ok "readiness continua só Postgres"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 16 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 16 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (auditoria — pode já vir GREEN)
```bash
bash scripts/contrato-archetype/FASE-16-TESTE-ORGANICO.sh
```
Se vier GREEN de primeira, **documentar isso explicitamente** no documento de teste (seção "Notas
técnicas") em vez de tratar como sinal de que o script está fraco — esta fase é auditoria, não
implementação nova.

### 2. Regressão
```bash
bash scripts/jobs-financeiros/FASE-15-TESTE-ORGANICO.sh
npm run test:e2e
```

### 3. Criar documento de teste
`scripts/contrato-archetype/FASE-16-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/contrato-archetype/FASE-16-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e executado (RED só se a auditoria encontrar divergência real; se já vier GREEN, documentado como tal)
- [ ] Regressão: `npm run test:e2e` completo passa 100%
- [ ] Documentação: não aplicável — nenhuma rota nova
- [ ] Todas as 14 rotas vivem sob `/api/v1`
- [ ] Swagger lista as 2 tags com todas as rotas
- [ ] Readiness continua só Postgres — zero referência a ClickHouse/Trio
- [ ] 100% das colunas monetárias com `decimalTransformer` (contagem exata confirmada)
- [ ] `overrides.js-yaml` do `package.json` intacto
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
grep -c "type: 'numeric'" src/modules/finance-*/entities/*.entity.ts
grep -c "transformer: decimalTransformer" src/modules/finance-*/entities/*.entity.ts
```

### Prompt para Haiku

> Confirme que as duas contagens (por arquivo) batem exatamente — nenhuma coluna `numeric` sem
> transformer. Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [arquivo — contagem]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar (mesmo modelo — Haiku basta para a
> Verificação Adversarial desta fase, dado o baixo risco).

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo (pode ser Haiku, dado o baixo risco desta fase — usar `claude-sonnet-5` só se o
> Haiku sinalizar qualquer incerteza): Critérios de Aceite + `git diff` + saída GREEN.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **17 — Fechamento**. Marcar Fase 16 concluída.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/main.ts src/health/health.controller.ts scripts/contrato-archetype/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "chore(finance): auditoria de contrato — prefixo, Swagger, readiness, decimal

Fase 16/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 16 concluída, validada e enviada para `feature/migracao-finance`.**
Contrato do archetype confirmado — prefixo, Swagger, readiness e transformer de Decimal auditados.
Responder "sim" para iniciar a **Fase 17 (última)**.
