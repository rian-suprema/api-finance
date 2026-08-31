# FASE 03 — Esqueleto não-funcional + allowlist + contrato de erro
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 30**
> Limite: _9 arquivos · risco: esta fase toca código COMPARTILHADO (`GlobalExceptionFilter`, `app.module.ts`, `architecture.spec.ts`) — um erro aqui afeta o módulo `users` [EXEMPLO] e qualquer módulo futuro, não só o Finance_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, os dois módulos `finance-cash-balance`/`finance-reconciliation` existem
(vazios de infra, registrados no `AppModule`), as 8 permissões e as variáveis de ambiente novas estão
validadas por Joi fail-fast, as 2 regras de allowlist do `architecture.spec.ts` existem (em
**vermelho**, esperado — nascem antes do código que elas nomeiam), o `GlobalExceptionFilter` preserva
campos extras do payload de exceção, e os 3 stubs de desenvolvimento (identidade/Trio/ClickHouse)
sobem localmente.

## Pré-requisito

Fases 01 e 02 concluídas (não bloqueante tecnicamente — esta fase não importa o domínio delas —, mas
mantém a ordem sequencial da trilha numa única branch).

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/app.module.ts` — confirmar a ordem de `imports`/`providers` atual
- `src/common/filters/global-exception.filter.ts` — assinatura de `ErrorBody` e `extractMessage`
- `src/config/env.validation.ts` — schema Joi atual
- `src/architecture.spec.ts` — padrão das regras existentes (`projectFiles().inFolder(...).should().adhereTo(...)`)

### Prompt para Haiku

> Leia os 4 arquivos. Esta fase vai: (1) adicionar 2 imports de módulo ao `AppModule`; (2) estender
> `ErrorBody` para aceitar campos extras sem remover `code`/`message`; (3) adicionar ~14 chaves novas
> ao schema Joi; (4) adicionar 2 `it()` novos ao `describe` do `architecture.spec.ts`, seguindo o
> padrão das regras existentes.
>
> Verifique:
> 1. `AppModule.imports` é um array literal — dá para inserir 2 itens sem reescrever o array inteiro.
> 2. `ErrorBody` é uma interface simples (`{code: string, message: string}`) — estendê-la para
>    `{code: string, message: string, [key: string]: unknown}` não quebra `extractMessage`.
> 3. O schema Joi é um único `Joi.object({...})` — dá para inserir chaves novas sem tocar nas
>    existentes.
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [arquivo — conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **`GlobalExceptionFilter` preserva campo extra:** uma `BadRequestException({message: 'x',
   pendingBanks: ['a','b']})` produz corpo `{code, message: 'x', pendingBanks: ['a','b']}` — sem
   `statusCode` nem `error` duplicados vindos do formato padrão do Nest.
2. **`GlobalExceptionFilter` não quebra o caso simples:** uma `NotFoundException('User not found')`
   continua produzindo só `{code, message}`, sem chaves extras vazias.
3. **`GlobalExceptionFilter` com erro do `ValidationPipe`:** `message: string[]` continua unido por
   `'; '` como hoje — este comportamento não pode regredir (usado pelo módulo `users` [EXEMPLO]).
4. **Allowlist `axios`:** um arquivo fake em `src/modules/finance-cash-balance/some-file.ts` com
   `import axios from 'axios'` fora de `infrastructure/trio/` **viola** a regra nova; o mesmo import
   dentro de `infrastructure/trio/` **não viola**.
5. **Allowlist `@clickhouse/client`:** mesma lógica, para `src/clickhouse/**` e
   `infrastructure/clickhouse/**`.
6. **Boot com env válido:** `AppModule` compila com as 14 variáveis novas preenchidas (usar
   `.env.test` de teste com valores fake).
7. **Boot falha sem `TRIO_AMOUNT_DIVISOR`:** ausência da variável derruba o boot (fail-fast) — nunca
   assume `1` silenciosamente (é a variável mais perigosa do conjunto, ver
   `docs/migracao-finance/INFRA-FINANCE.md` §4.2).
8. **Boot falha com `TRIO_AMOUNT_DIVISOR=50`:** só `1` ou `100` são aceitos.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/esqueleto-financeiro/FASE-03-TESTE-ORGANICO.sh` agora. Resultado esperado: RED —
> os módulos ainda não existem, `AppModule` não compila com as env vars novas exigidas pelo teste.

## Arquivos a criar

### `src/modules/finance-cash-balance/cash-balance.module.ts`
**Motivo:** módulo vazio de infra — existe só para o `AppModule` registrar algo real. Ganha conteúdo
progressivamente nas Fases 05–09.
```ts
@Module({})
export class CashBalanceModule {}
```

### `src/modules/finance-reconciliation/reconciliation.module.ts`
Igual, para `ReconciliationModule`.

### `src/auth/permissions.constants.ts` (editar)
**Motivo:** adicionar os 8 codes do Finance ao arquivo existente, na mesma convenção
`modulo.recurso.acao` já usada por `PETSHOP_USERS`.
```ts
export const FINANCE_CASH_BALANCE = {
  SUMMARY_READ: 'finance.cash-balance.summary.read',
  BANKS_READ: 'finance.cash-balance.banks.read',
  BANKS_CONFIRM: 'finance.cash-balance.banks.confirm',
  REGISTER_CREATE: 'finance.cash-balance.register.create',
} as const;

export const FINANCE_RECONCILIATION = {
  READ: 'finance.reconciliation.read',
  RUN: 'finance.reconciliation.run',
  RESOLVE: 'finance.reconciliation.resolve',
} as const;
```
Não incluir `EXPORT` (declarada na origem sem endpoint) — sem rota, sem code (evita permissão morta).

### `src/config/configuration.ts` (editar)
**Motivo:** 3 namespaces novos, mesmo padrão `registerAs` do arquivo existente.
```ts
export const clickhouseConfig = registerAs('clickhouse', () => ({
  url: process.env.CLICKHOUSE_URL,
  user: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE ?? 'dw_bet',
}));

export const trioConfig = registerAs('trio', () => ({
  baseUrl: process.env.TRIO_BASE_URL,
  clientId: process.env.TRIO_CLIENT_ID,
  clientSecret: process.env.TRIO_CLIENT_SECRET,
  amountDivisor: parseInt(process.env.TRIO_AMOUNT_DIVISOR ?? '1', 10),
  accountIds: {
    suprema: process.env.TRIO_ACCOUNT_ID_SUPREMA,
    ultra: process.env.TRIO_ACCOUNT_ID_ULTRA,
    maxima: process.env.TRIO_ACCOUNT_ID_MAXIMA,
  },
}));

export const platformConfig = registerAs('platform', () => ({
  apiUrl: process.env.SAYPLUS_API_URL,
}));

export const reconciliationConfig = registerAs('reconciliation', () => ({
  bankKeyField: process.env.RECONCILIATION_BANK_KEY_FIELD ?? 'external_id',
}));
```

### `src/config/env.validation.ts` (editar)
**Motivo:** validação fail-fast das 14 variáveis novas. **Nenhuma tem default de valor perigoso** —
diferença deliberada da origem (lá, `TRIO_AMOUNT_DIVISOR` tinha default `1` sem confirmação).
```ts
CLICKHOUSE_URL: Joi.string().uri().required(),
CLICKHOUSE_USER: Joi.string().required(),
CLICKHOUSE_PASSWORD: Joi.string().required(),
CLICKHOUSE_DATABASE: Joi.string().default('dw_bet'),

TRIO_BASE_URL: Joi.string().uri().required(),
TRIO_CLIENT_ID: Joi.string().required(),
TRIO_CLIENT_SECRET: Joi.string().required(),
// Nunca default: 1 (reais) e 100 (centavos) mudam todo valor monetário por 100×.
// Confirmar na doc da Trio antes de preencher — ver PARADA HUMANA da Fase 06.
TRIO_AMOUNT_DIVISOR: Joi.number().valid(1, 100).required(),
TRIO_ACCOUNT_ID_SUPREMA: Joi.string().required(),
TRIO_ACCOUNT_ID_ULTRA: Joi.string().required(),
TRIO_ACCOUNT_ID_MAXIMA: Joi.string().required(),

SAYPLUS_API_URL: Joi.string().uri().required(),

RECONCILIATION_BANK_KEY_FIELD: Joi.string()
  .valid('external_id', 'end_to_end_id', 'ref_id')
  .default('external_id'),
```
Atualizar `.env.example` e `.env.test` com valores fake correspondentes (`.env.test` usa stubs locais:
`http://localhost:8123`, `http://localhost:9001`, `http://localhost:3100`).

### `src/architecture.spec.ts` (editar)
**Motivo:** as 2 regras do `MIGRACAO-FINANCE.md` §4.2 — nomeiam duas dependências que o gate de
anti-contrabando atual não cobre (`axios`, `@clickhouse/client`). Adicionar dentro do `describe`
principal, após a regra "sem contrabando de capacidades" existente:
```ts
// ADR-FINANCE-1: HTTP externo (axios) só dentro dos adapters nomeados — Trio
// (integração bancária) e platform (GET /auth/me da SayPlus, Fase 08). Duas
// pastas, não "infrastructure/** de qualquer módulo": a intenção é nomear
// cada capacidade que entra, não abrir um allowlist genérico.
it('axios cru só existe nos adapters da Trio e da identidade da plataforma', async () => {
  const violations = await projectFiles()
    .inFolder('src/**')
    .should()
    .adhereTo(
      (file) =>
        isSpecFile(file.path) ||
        file.directory.includes('infrastructure/trio') ||
        file.directory.includes('infrastructure/platform') ||
        !/from 'axios'/.test(file.content),
      "axios só é permitido em modules/finance-*/infrastructure/{trio,platform}/** — " +
        'HTTP externo em outro lugar é decisão que precisa de ADR próprio',
    )
    .check();
  expect(violations).toStrictEqual([]);
});

// ADR-FINANCE-2: ClickHouse é read-model, confinado à pasta que existe pra isso.
it('@clickhouse/client só existe em src/clickhouse/ e nos adapters de leitura', async () => {
  const violations = await projectFiles()
    .inFolder('src/**')
    .should()
    .adhereTo(
      (file) =>
        isSpecFile(file.path) ||
        file.directory.includes('src/clickhouse') ||
        file.directory.includes('infrastructure/clickhouse') ||
        !/from '@clickhouse\/client'/.test(file.content),
      "@clickhouse/client só é permitido em src/clickhouse/** e em " +
        'infrastructure/clickhouse/** de cada módulo',
    )
    .check();
  expect(violations).toStrictEqual([]);
});
```
Estas 2 regras ficam **verdes desde já** (nenhum arquivo ainda importa `axios`/`@clickhouse/client`) —
diferente do texto original do `MIGRACAO-FINANCE.md` (que assumia elas vermelhas até a integração);
aqui nascem verdes e **continuam** verdes até a Fase 05/06 introduzirem os imports reais dentro das
pastas certas.

### `src/common/filters/global-exception.filter.ts` (editar)
**Motivo:** preservar campos estruturados extras do payload da exceção (decisão de negócio — a rota
de registro do balanço, Fase 08, devolve `pendingBanks`). Denylist das chaves que o Nest já injeta em
`getResponse()` por padrão (`statusCode`, `message`, `error`) para não duplicá-las.
```ts
interface ErrorBody {
  code: string;
  message: string;
  [key: string]: unknown;
}

const NEST_DEFAULT_KEYS = new Set(['statusCode', 'message', 'error']);

private extractExtraFields(res: unknown): Record<string, unknown> {
  if (typeof res !== 'object' || res === null) return {};
  return Object.fromEntries(
    Object.entries(res as Record<string, unknown>).filter(([key]) => !NEST_DEFAULT_KEYS.has(key)),
  );
}
```
No `catch()`, ao montar `body` para `HttpException`, espalhar `...this.extractExtraFields(exception.getResponse())`
depois de `code`/`message` (para que campos extras nunca sobrescrevam os dois).

### `src/common/utils/date.util.ts`
**Motivo:** utilitário de data compartilhado (BRT), usado a partir da Fase 06 em diante — criado aqui
por ser infraestrutura sem dependência de domínio. Portar literalmente da origem:
`TIME_ZONE = 'America/Sao_Paulo'`, `todayInBrt`, `yesterdayInBrt`, `isIsoDate`, `startOfMonth`,
`startOfNextMonth`, `toDateOnly`, `fromDateOnly`, `brtMidnightUtc` (com `brtOffsetMinutes` via
`Intl.DateTimeFormat`, nunca fixado em `-03:00`), `shiftDays`, `nextDay`, `daysInRange`.

### `src/common/utils/tax-number.util.ts`
**Motivo:** `formatTaxNumber` — usado na Fase 13. Portar literalmente, preservando o comentário da
decisão de produto de 10/08/2026 (documento sai completo, nunca mascarado — ver
`docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §3.8).

### `src/app.module.ts` (editar)
**Motivo:** registrar os 2 módulos novos e os `load` novos do `ConfigModule`.
```ts
load: [appConfig, authConfig, databaseConfig, clickhouseConfig, trioConfig, platformConfig, reconciliationConfig],
...
imports: [..., CashBalanceModule, ReconciliationModule],
```

### `scripts/finance-dev-stubs.js`
**Motivo:** porta `scripts/dev-stubs.js` da origem — 3 servidores HTTP mínimos (identidade `:3100`
respondendo `GET /auth/me`, Trio `:9001` respondendo `/banking/virtual_accounts*` e
`/banking/bank_accounts/*/transactions` com `has_more: false`, ClickHouse `:8123` respondendo aos
formatos de `JSONEachRow` esperados pelas queries das Fases 05/11) — é o que torna as Fases 06–14
testáveis sem credencial real.

## Atualizar arquivo de registro de rotas/servidor

`src/app.module.ts` já coberto em "Arquivos a criar" — é o próprio arquivo de registro deste projeto.

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes (os módulos ficam vazios de controller).

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/esqueleto-financeiro/FASE-03-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 03 — Teste Orgânico: Esqueleto não-funcional
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 03 — Esqueleto não-funcional ==="
echo ""

# 1. Lint + build compilam com os módulos vazios registrados
npx tsc -p tsconfig.json --noEmit >/tmp/fase03-tsc.log 2>&1 \
  && ok "typecheck sem erros" || fail "typecheck falhou (ver /tmp/fase03-tsc.log)"

# 2. Boot falha sem TRIO_AMOUNT_DIVISOR (fail-fast)
ENV_MISSING=$(NODE_ENV=test DB_HOST=x DB_USERNAME=x DB_PASSWORD=x DB_NAME=x \
  CLICKHOUSE_URL=http://x CLICKHOUSE_USER=x CLICKHOUSE_PASSWORD=x \
  TRIO_BASE_URL=http://x TRIO_CLIENT_ID=x TRIO_CLIENT_SECRET=x \
  TRIO_ACCOUNT_ID_SUPREMA=x TRIO_ACCOUNT_ID_ULTRA=x TRIO_ACCOUNT_ID_MAXIMA=x \
  SAYPLUS_API_URL=http://x \
  node -e "require('./src/config/env.validation.ts')" 2>&1 || echo "FALHOU_COMO_ESPERADO")
echo "$ENV_MISSING" | grep -q "FALHOU_COMO_ESPERADO\|required" \
  && ok "boot falha sem TRIO_AMOUNT_DIVISOR (fail-fast confirmado)" \
  || fail "boot NÃO falhou sem TRIO_AMOUNT_DIVISOR — risco de valor errado por 100×"

# 3. architecture.spec.ts — as 2 regras novas existem e passam
npx jest src/architecture.spec.ts --verbose 2>&1 | tee /tmp/fase03-arch.log | grep -q "axios cru só existe" \
  && ok "regra allowlist axios presente" || fail "regra allowlist axios ausente"
grep -q "@clickhouse/client só existe" /tmp/fase03-arch.log \
  && ok "regra allowlist @clickhouse/client presente" || fail "regra allowlist ClickHouse ausente"
grep -q "Tests:.*failed" /tmp/fase03-arch.log \
  && fail "architecture.spec.ts com falhas — ver /tmp/fase03-arch.log" \
  || ok "architecture.spec.ts 100% verde"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 03 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 03 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/esqueleto-financeiro/FASE-03-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/dominio-conciliacao/FASE-01-TESTE-ORGANICO.sh
bash scripts/dominio-balanco-caixa/FASE-02-TESTE-ORGANICO.sh
npm test -- --testPathPattern="global-exception|permissions"
```

### 3. Criar documento de teste
`scripts/esqueleto-financeiro/FASE-03-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/esqueleto-financeiro/FASE-03-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fases 01 e 02 passam 100%; suíte existente do `users` [EXEMPLO] continua verde (`npm test`)
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] `GlobalExceptionFilter`: `pendingBanks` (e qualquer campo extra futuro) passa; `statusCode`/`error` nunca duplicados
- [ ] `architecture.spec.ts`: as 2 regras novas passam (nascem verdes, sem código ainda importando `axios`/`@clickhouse/client`)
- [ ] Boot falha (fail-fast) sem `TRIO_AMOUNT_DIVISOR`, e com valor fora de `{1,100}`
- [ ] `AppModule` compila com os 2 módulos novos registrados e vazios
- [ ] `scripts/finance-dev-stubs.js` sobe e responde a uma chamada simples em cada uma das 3 portas
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
grep -n "statusCode\|error:" src/common/filters/global-exception.filter.ts
npm test -- --testPathPattern="users" 2>&1 | tail -20
```

### Prompt para Haiku

> Execute os comandos e leia `global-exception.filter.ts` inteiro.
>
> Verifique:
> 1. O filtro continua produzindo exatamente `{code, message}` para exceções sem campos extras (o
>    módulo `users` [EXEMPLO] não pode ter ganhado campo novo na resposta de erro).
> 2. A suíte do `users` (`npm test -- --testPathPattern=users`) continua 100% verde.
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir — regressão em código compartilhado é a pior categoria desta fase.
> **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco adversarial específico desta
> fase: **rodar a suíte completa do `users` [EXEMPLO]** e confirmar que o diff do
> `GlobalExceptionFilter`/`app.module.ts` não alterou nenhum contrato de resposta existente. Não
> aceitar "os testes passaram" sem mostrar a saída completa.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **04 — Schema TypeORM**. Marcar Fase 03 concluída. Registrar a mudança de
postura de config (fail-fast em tudo, incluindo `TRIO_AMOUNT_DIVISOR` sem default) como convenção
consolidada desta trilha.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/modules/finance-cash-balance/cash-balance.module.ts \
        src/modules/finance-reconciliation/reconciliation.module.ts \
        src/auth/permissions.constants.ts src/config/ src/architecture.spec.ts \
        src/common/filters/global-exception.filter.ts src/common/utils/date.util.ts \
        src/common/utils/tax-number.util.ts src/app.module.ts scripts/finance-dev-stubs.js \
        .env.example .env.test scripts/esqueleto-financeiro/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(finance): esqueleto não-funcional, allowlist e contrato de erro estendido

Fase 03/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 03 concluída, validada e enviada para `feature/migracao-finance`.**
Os 2 módulos existem vazios e registrados, env fail-fast, allowlist em vigor, filtro de erro estende
campos extras sem regredir o módulo `users`. Responder "sim" para iniciar a **Fase 04**.
