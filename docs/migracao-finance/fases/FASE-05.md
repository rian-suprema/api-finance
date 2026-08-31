# FASE 05 — Integração ClickHouse — conexão global
> **Configuração da sessão**
> Comando: `claude --model claude-sonnet-5` (`MODELO_SONNET` resolvido) · **max-turns 30**
> Limite: _3 arquivos · risco: interpolação de string na query (abre caminho a injeção via nome de mart/marca) em vez de `query_params` nomeados_
> Se o limite for atingido antes de concluir: parar, registrar ponto de parada em `progress.json` (campo `notes`), fechar a sessão e abrir nova com prompt focado no ponto exato de parada.
> ⛔ **Regras obrigatórias:** SOLID + nomes descritivos · **Dúvida arquitetural:** PARAR → **3 opções** no chat → aguardar escolha · **Inconsistência detectada:** PARAR IMEDIATAMENTE → descrever + **3 opções** → aguardar decisão

## Objetivo

Ao final desta fase, `src/clickhouse/` existe como módulo global com uma conexão única ao data
warehouse, expondo um `query<T>(sql, params)` que **nunca** aceita string interpolada — todo valor
dinâmico (data, marca, lista de documentos) entra via `query_params` nomeados do driver oficial.

## Pré-requisito

Fase 03 concluída — a regra de allowlist do `architecture.spec.ts` (`@clickhouse/client` só em
`src/clickhouse/**` e `infrastructure/clickhouse/**`) já existe e está verde; esta fase é a primeira a
efetivamente importar a dependência dentro da pasta permitida.

## ⚡ Pre-flight Check — Haiku antes de implementar

> **Invocar Agent com `model: claude-haiku-4-5-20251001` agora.**

### Arquivos a ler
- `src/architecture.spec.ts` — a regra `@clickhouse/client só existe em src/clickhouse/...`
- `package.json` — confirmar que `@clickhouse/client` ainda **não** está instalado

### Prompt para Haiku

> Leia os 2 arquivos. Esta fase instala `@clickhouse/client` e cria `src/clickhouse/clickhouse.module.ts`
> + `clickhouse.service.ts`.
>
> Verifique:
> 1. A regra de allowlist do `architecture.spec.ts` aceita arquivos dentro de `src/clickhouse/**` —
>    confirme o texto exato da condição (`file.directory.includes('src/clickhouse')`).
> 2. `@clickhouse/client` não está em `package.json` ainda (para não haver conflito de versão com
>    outra sessão).
>
> Responda apenas: **APROVADO** ou **BLOQUEADO: [conflito específico]**.

> **Se BLOQUEADO:** resolver antes de prosseguir. **Se APROVADO:** continuar abaixo.

## Testes a escrever

1. **`isConfigured` reflete a config:** com `CLICKHOUSE_URL` presente (via `ConfigService` mockado),
   `isConfigured === true`.
2. **`query()` usa `query_params`, nunca interpola:** teste com mock do client
   (`jest.mock('@clickhouse/client')`) captura a chamada e confirma que o argumento `query` é uma
   string **fixa** (sem `${}`) e que valores variáveis chegam só em `query_params`.
3. **`query()` propaga falha como `ServiceUnavailableException`:** o client mockado rejeita a
   promise → o método lança `ServiceUnavailableException('Data warehouse indisponível')`, nunca o
   erro cru do driver (que poderia conter a URL/credencial na mensagem).
4. **`onModuleDestroy` fecha a conexão:** `client.close()` é chamado no destroy do módulo.
5. **Array em `query_params`:** um parâmetro do tipo `readonly string[]` (para `IN
   ({x:Array(String)})`) é aceito pela assinatura sem erro de tipo.

## 🔴 Teste Orgânico — RED antes da implementação

> Escrever `scripts/clickhouse-conexao/FASE-05-TESTE-ORGANICO.sh` agora. Resultado esperado: RED —
> `src/clickhouse/` ainda não existe.

## Arquivos a criar

### `src/clickhouse/clickhouse.module.ts`
**Motivo:** conexão única e global — duas telas (balanço e conciliação) vão consultar o warehouse, e
a conexão não pode ser uma por consumidor.
```ts
@Global()
@Module({
  providers: [ClickHouseService],
  exports: [ClickHouseService],
})
export class ClickHouseModule {}
```
Registrar em `app.module.ts` (import) — **fora do escopo desta fase tocar o `app.module.ts` de novo**
se já foi registrado na Fase 03; se não foi, adicionar aqui.

### `src/clickhouse/clickhouse.service.ts`
**Motivo:** porta `src/clickhouse/clickhouse.service.ts` da origem literalmente. Regras que **não**
podem regredir na tradução:
```ts
@Injectable()
export class ClickHouseService implements OnModuleDestroy {
  get isConfigured(): boolean
  async query<T>(query: string, params: Record<string, string | readonly string[]>): Promise<T[]>
  async onModuleDestroy(): Promise<void>
}
```
- Construído a partir de `clickhouseConfig` (Fase 03) via `@Inject(clickhouseConfig.KEY)`.
- Se `url` ausente: `client = null`, `isConfigured = false`, `logger.warn(...)` — **mas** como a Fase
  03 já tornou `CLICKHOUSE_URL` obrigatório no Joi (fail-fast), este caminho só é alcançável em teste
  unitário com `ConfigService` mockado, nunca em boot real. Documentar isso no comentário do arquivo
  para não confundir uma sessão futura.
- `query()`: **nunca** concatenar `params` na string SQL. Passa `query_params: params` para
  `client.query({ query, query_params: params, format: 'JSONEachRow' })`.
- Qualquer erro do driver: logar (`this.logger.error`, só a mensagem, nunca o payload/credencial) e
  lançar `ServiceUnavailableException('Data warehouse indisponível')`.

### Spec colocalizado
`clickhouse.service.spec.ts` — mock de `@clickhouse/client` (`jest.mock`), um `it()` por cenário acima.

## Atualizar arquivo de registro de rotas/servidor

`src/app.module.ts` — adicionar `ClickHouseModule` a `imports` (se ainda não estiver, confirmar com o
Pre-flight se a Fase 03 já cobriu isso; se não, este é o lugar).

## Documentação

Não aplicável — esta fase não expõe rotas nem componentes.

## Teste Orgânico — Claude Executa

**Arquivo:** `scripts/clickhouse-conexao/FASE-05-TESTE-ORGANICO.sh`

```bash
#!/usr/bin/env bash
# FASE 05 — Teste Orgânico: Integração ClickHouse
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }

echo ""
echo "=== FASE 05 — Integração ClickHouse ==="
echo ""

OUTPUT=$(npx jest src/clickhouse --verbose 2>&1)
STATUS=$?
[ "$STATUS" -eq 0 ] && ok "npx jest src/clickhouse — exit 0" || fail "specs falharam — exit $STATUS"

echo "$OUTPUT" | grep -qi "query_params\|nunca interpola" \
  && ok "cenário de query_params (nunca interpolação) presente" \
  || fail "cenário de query_params ausente do relatório"

# Estrutural: nenhuma interpolação de template literal dentro de clickhouse.service.ts na query
if grep -nE '\`[^\`]*\$\{[^}]*\}[^\`]*\`' src/clickhouse/clickhouse.service.ts | grep -qi "select\|SELECT"; then
  fail "possível interpolação de SQL dentro de clickhouse.service.ts"
else
  ok "nenhuma interpolação de SQL encontrada em clickhouse.service.ts"
fi

# Regra de allowlist do architecture.spec.ts continua verde
npx jest src/architecture.spec.ts 2>&1 | grep -q "Tests:.*failed" \
  && fail "architecture.spec.ts com falhas" \
  || ok "architecture.spec.ts 100% verde (allowlist ClickHouse respeitada)"

echo ""
[ "$FAIL" -eq 0 ] \
  && echo "✅  FASE 05 — PASSOU ($PASS testes)" \
  || echo "❌  FASE 05 — FALHOU ($FAIL/$((PASS+FAIL)) testes)"
exit $FAIL
```

### 1. Executar (deve estar GREEN agora)
```bash
bash scripts/clickhouse-conexao/FASE-05-TESTE-ORGANICO.sh
```

### 2. Regressão
```bash
bash scripts/schema-financeiro/FASE-04-TESTE-ORGANICO.sh
npm test -- --testPathPattern=architecture
```

### 3. Criar documento de teste
`scripts/clickhouse-conexao/FASE-05-TESTE-ORGANICO.md`.

## Critérios de aceite

- [ ] `bash scripts/clickhouse-conexao/FASE-05-TESTE-ORGANICO.sh` — passa 100%
- [ ] Teste Orgânico escrito e confirmado RED antes da implementação
- [ ] Regressão: Fase 04 passa 100%; `architecture.spec.ts` continua 100% verde
- [ ] Documentação: não aplicável — sem rotas/componentes
- [ ] `query()` nunca interpola valor dinâmico na string SQL — só via `query_params`
- [ ] Erro do driver nunca propaga mensagem/credencial cru ao chamador — sempre `ServiceUnavailableException` genérica
- [ ] `onModuleDestroy` fecha a conexão
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
grep -rn "@clickhouse/client" src/ --include="*.ts" | grep -v "src/clickhouse\|infrastructure/clickhouse\|\.spec\.ts"
grep -n "query:" src/clickhouse/clickhouse.service.ts
```

### Prompt para Haiku

> Execute os comandos. O primeiro deve devolver **zero linhas** (nenhum arquivo fora de
> `src/clickhouse/`/`infrastructure/clickhouse/`/spec importa `@clickhouse/client`). Leia
> `clickhouse.service.ts` e confirme que todo `query:` passado ao client é uma string literal fixa por
> chamada (nunca montada por concatenação com uma variável de entrada do método).
>
> Resposta: **TODOS APROVADOS** ou **VIOLAÇÕES: [lista]**.

> **Se VIOLAÇÕES:** corrigir. **Se APROVADO:** continuar com `claude-sonnet-5` para a Verificação Adversarial.

## 🔎 Verificação Adversarial de Aceite

> Sub-agente novo: Critérios de Aceite + `git diff` + saída GREEN. Foco: procurar ativamente por
> qualquer caminho em que um valor vindo de fora (data, marca, lista de CPFs) pudesse chegar à string
> da query sem passar por `query_params` — inclusive em concatenações indiretas via template literal
> de nome de coluna/mart.
>
> Resposta: **CONFIRMADO** ou **REPROVADO: [motivo]**.

## 📊 Dashboard — Validação Pós-fase

Mesmos passos 1–5 já detalhados na Fase 01.

## Atualizar CLAUDE.md

Avançar "Fase atual" para **06 — Integração Trio**. Marcar Fase 05 concluída.

## 🔀 Git — Commit e Push da Fase

```bash
git add src/clickhouse/ src/app.module.ts package.json package-lock.json \
        scripts/clickhouse-conexao/ \
        CLAUDE.md docs/migracao-finance/fases/progress.json docs/migracao-finance/fases/dashboard.html
git commit -m "feat(clickhouse): conexão global read-only com query_params nomeados

Fase 05/17 — Migração Finance"
git push -u origin feature/migracao-finance
```

## ⏸️ PARADA OBRIGATÓRIA

**Fase 05 concluída, validada e enviada para `feature/migracao-finance`.**
A conexão global com o ClickHouse existe, nunca interpola string, e a regra de allowlist continua
verde. Responder "sim" para iniciar a **Fase 06**.
