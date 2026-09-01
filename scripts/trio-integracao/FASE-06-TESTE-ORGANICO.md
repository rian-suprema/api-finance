# FASE 06 — Teste Orgânico: Integração Trio
> Data: 2026-09-01 | Status: ✅ passou

## Como executar
```bash
bash scripts/trio-integracao/FASE-06-TESTE-ORGANICO.sh
```

## Pré-requisitos
- Nenhum serviço externo necessário — os testes mockam `axios` (`jest.mock('axios')`), sem
  requisição real à Trio.

## Resultados esperados
| Verificação | Resultado |
| --- | --- |
| `npx jest .../infrastructure/trio` — exit 0 | ✅ |
| Teste de regressão da bisseção (sem overlap/sem buraco) presente | ✅ |
| Teste de conta virtual ambígua (nunca escolhe) presente | ✅ |
| Nenhum log contém `clientId`/`clientSecret` | ✅ |
| `architecture.spec.ts` 100% verde (allowlist `axios` respeitada) | ✅ |

## PARADA HUMANA — resolvida
`TRIO_AMOUNT_DIVISOR` confirmado pelo usuário como **100 (centavos)**, alinhado com a documentação
do cliente. Registrado em `docs/migracao-finance/INFRA-FINANCE.md` §4.2 e
`docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md`. `.env`/`.env.example` locais atualizados; o
Secret/ConfigMap real de homologação/produção está fora do alcance desta sessão.

## Notas técnicas
- Teste do teto `REQUEST_BUDGET` (20.000): usa mock de `has_more` condicionado ao tamanho real da
  janela (comparação lexicográfica dos timestamps ISO de largura fixa), não um mock incondicional —
  ver aprendizado da Fase 06 no `CLAUDE.md` para o motivo (a bisseção por pilha/LIFO nunca atinge o
  teto com um mock "sempre true", só bate no erro de janela indivisível).
- Retry (429/5xx) testado com `jest.useFakeTimers()` + `jest.advanceTimersByTimeAsync`, evitando
  esperar os backoffs reais (até 6s no pior caso).
