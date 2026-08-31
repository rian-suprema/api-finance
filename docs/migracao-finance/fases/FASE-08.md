# FASE 08 — Identidade da plataforma (/auth/me) + BrandAccessService
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 30**
> Limite: _3 arquivos · risco: logar o token (mesmo que hasheado errado) ou aceitar marca/tenant vindo de body/query em vez de exclusivamente do claim + `/auth/me`_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `PlatformIdentityService` (chama `GET /auth/me` da SayPlus, cache de 60s por
hash SHA-256 do token) e `BrandAccessService` (`resolveBrands`, `requireBrand`, `resolveReferenceDate`,
`resolveRange`) existem — é o pré-requisito de isolamento por marca de **ambos** os módulos de negócio
(Fases 09 e 13/14).

## Pré-requisito

Fase 03 concluída (`platformConfig.apiUrl`, allowlist `axios` já cobre `infrastructure/` de qualquer
módulo finance — confirmar no Pre-flight que o caminho `infrastructure/platform/` também é alcançado
pela condição `directory.includes('infrastructure/trio')`... **não é** — a regra da Fase 03 só cita
`infrastructure/trio`. Esta fase precisa de uma pasta nova coberta pela allowlist; ver "Arquivos a
criar" para a decisão).

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/architecture.spec.ts` — o texto exato da regra `axios cru só existe no adapter da Trio`
- `src/config/configuration.ts` — assinatura de `platformConfig`
- `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` (seção 1.2) — os dois padrões de escopo por marca

### Prompt para Haiku

> Leia os 3 arquivos. Esta fase cria `infrastructure/platform/platform-identity.service.ts`, que
> também usa `axios` para chamar `GET /auth/me` — **fora** de `infrastructure/trio/`.
>
> Verifique:
> 1. A regra de allowlist atual do `architecture.spec.ts` restringe `axios` só a
>    `infrastructure/trio/**` — se for esse o texto exato, ela **vai falhar** quando
>    `platform-identity.service.ts` for criado, porque `infrastructure/platform/` não está na
>    condição de exceção.
>
> Se a regra for exatamente essa restrição estreita, responda
> **BLOQUEADO: architecture.spec.ts restringe axios só a infrastructure/trio — precisa de ajuste
> antes desta fase** (a correção é trivial: trocar a condição para `directory.includes('infrastructure/trio')
> || directory.includes('infrastructure/platform')`, ou generalizar para qualquer `infrastructure/`
> de módulo finance — decidir com o usuário via as 3 opções do protocolo de decisão).
>
> Caso contrário, responda **APROVADO**.

> **Se BLOQUEADO:** parar e aplicar o protocolo de decisão (3 opções: (a) ampliar a allowlist para
> `infrastructure/platform` também, (b) ampliar para qualquer `infrastructure/**` de módulo finance,
> (c) mover a chamada a `/auth/me` para dentro de `infrastructure/trio/` só para caber na regra atual
> — **não recomendado**, mistura responsabilidades). Aguardar escolha do usuário, ajustar a regra do
> `architecture.spec.ts` (fora do orçamento de arquivos desta fase, é 1 linha), e só então prosseguir.
> **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **Cache por hash do token:** duas chamadas com o **mesmo** token dentro de 60s fazem **1** request
   HTTP (mock de `axios` contado); com tokens diferentes, 2 requests.
2. **Cache expira:** avançar o relógio (`jest.useFakeTimers`) além de 60s → nova chamada HTTP.
3. **Nunca loga o token:** simular falha (`401`/timeout) e confirmar que a mensagem logada não contém
   o token nem o header `Authorization`.
4. **`resolveBrands`:** mapeia `tenants[].slug` do `/auth/me` para as chaves do catálogo
   (`suprema-bet` → `suprema`) — tenant sem correspondência no catálogo é ignorado, não gera erro.
5. **`requireBrand` — marca inexistente no catálogo:** `BadRequestException('Marca não reconhecida')`.
6. **`requireBrand` — marca existente mas sem vínculo:** `ForbiddenException('Usuário sem acesso a
   esta marca')`.
7. **`requireBrand` — marca existente e com vínculo:** devolve `{brand, tenantId}`.
8. **`resolveReferenceDate`:** sem `date`, devolve o dia anterior em BRT; com `date` inválida, `400`.
9. **`resolveRange`:** sem `from`/`to`, últimos 15 dias terminando ontem; `from > to` → `400`;
   intervalo > 180 dias → `400`.
10. **Falha do `/auth/me` propaga como `ServiceUnavailableException`,** nunca o erro cru do axios.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/identidade-plataforma/FASE-08-TESTE-ORGANICO.sh` agora. Resultado esperado: RED —
> os 2 arquivos ainda não existem.

## Arquivos a criar

### `src/modules/finance-cash-balance/infrastructure/platform/platform-identity.service.ts`
**Motivo:** o módulo Finance não tem tabela de usuários — as marcas do vínculo vêm sempre de
`GET /auth/me` da SayPlus. Portar literalmente da origem: `resolveAccessibleBrands` (cache de 60s por
hash SHA-256 do token — **nunca** o token em cache/log), `fetchTenants`, `evictExpired`.
Depende de `platformConfig.apiUrl` (Fase 03) e de `BRANDS` (`cash-balance.constants.ts`, Fase 07).

### `src/modules/finance-cash-balance/domain/services/brand-access.service.ts`
**Motivo:** a peça central de isolamento — a marca **nunca** vem de body/query, só da associação
resolvida aqui. Portar literalmente: `resolveBrands`, `requireBrand`, `resolveReferenceDate`,
`resolveRange` (usando `date.util.ts` da Fase 03 — `yesterdayInBrt`, `isIsoDate`, `shiftDays`,
`daysInRange`).

### Spec colocalizado
`platform-identity.service.spec.ts` — mock de `axios`, um `it()` por cenário 1–3 e 10.
`brand-access.service.spec.ts` — um `it()` por cenário 4–9.

## Atualizar arquivo de registro de rotas/servidor

Registrar os 2 providers em `cash-balance.module.ts`, exportando `BrandAccessService` (é consumido
também pelo `ReconciliationModule` na Fase 13, via import do service exportado — regra 3 do archetype:
"colaboração entre módulos só via service exportado", nunca importar arquivo direto de outro módulo).

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/identidade-plataforma/FASE-08-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 08 — Teste Orgânico: Identidade da plataforma + BrandAccessService
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 08 — Identidade da plataforma ==="
echo ""

OUTPUT=$(npx jest src/modules/finance-cash-balance --testPathPattern="platform-identity|brand-access" --verbose 2>&1)
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "specs de identidade — exit 0" || fail "specs falharam — exit $STATUS"

echo "$OUTPUT" | grep -qi "cache\|60s\|hash" \
  && ok "cenário de cache por hash do token presente" \
  || fail "cenário de cache ausente"

if grep -n "logger\.\(warn\|error\|log\)" \
     src/modules/finance-cash-balance/infrastructure/platform/platform-identity.service.ts \
     | grep -iE "authorization|token|bearer"; then
  fail "possível log do token/Authorization"
else
  ok "nenhum log contém token/Authorization"
fi

npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas" \
  || ok "architecture.spec.ts 100% verde"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 08 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 08 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/identidade-plataforma/FASE-08-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/persistencia-balanco-caixa/FASE-07-TESTE-ORGANICO.sh
```

### 3. Criar documento de teste
`scripts/identidade-plataforma/FASE-08-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/identidade-plataforma/FASE-08-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 07 passa 100%
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] Cache por hash SHA-256 do token, TTL 60s, evicção de expirados
- [ ] Zero log de token/Authorization
- [ ] `requireBrand`/`resolveBrands` nunca aceitam marca vinda de parâmetro — só do resultado de `/auth/me`
- [ ] `BrandAccessService` exportado por `cash-balance.module.ts` (para reuso pela Fase 13)
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
grep -n "authorization\|token" src/modules/finance-cash-balance/infrastructure/platform/platform-identity.service.ts | grep -i "logger"
grep -n "brandParam\|req\.\(body\|query\)\.brand" src/modules/finance-cash-balance/domain/services/brand-access.service.ts
```

### Prompt para Haiku

> Execute os comandos. Confirme que nenhum `logger.*` referencia o token/Authorization, e que
> `BrandAccessService` só recebe a marca como parâmetro explícito de método (nunca lê `req.body`/
> `req.query` diretamente — a extração do request é responsabilidade do controller, fase 09).
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco: confirmar que
> `resolveAccessibleBrands` é a **única** fonte de marca aceita — procurar por qualquer caminho
> alternativo (parâmetro opcional, fallback) que permitiria contornar a resolução via `/auth/me`.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **09 — Balanço de Caixa: use-cases + controller**. Marcar Fase 08 concluída.
Registrar a correção de ordem (Identidade antes do uso pelos módulos de negócio, não depois) como
aprendizado — a numeração original do plano tinha isso invertido.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-cash-balance/infrastructure/platform/ \
        src/modules/finance-cash-balance/domain/services/brand-access.service.ts \
        src/architecture.spec.ts src/modules/finance-cash-balance/cash-balance.module.ts \
        scripts/identidade-plataforma/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance-cash-balance): identidade da plataforma + BrandAccessService

Fase 08/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 08 concluída, validada e enviada para `feature/migracao-finance`.**
A resolução de marca por `/auth/me` está pronta e será reusada pelos dois módulos de negócio.
Responder "sim" para iniciar a **Fase 09**.
