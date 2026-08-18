# P9 — Observabilidade (manual §7)

Data: 2026-08-17 · Agente: P9 — Observabilidade · Cluster: `docker-desktop` (WSL2) · Namespace: `observability`

## Dono no ambiente real

O **SRE / time de plataforma** é o dono de tudo que existe **depois do app emitir OTLP**:

- Fornece o endpoint do **Collector deles** nos values do chart (insumo nº 4 do handoff) — o app não conhece nem escolhe backend.
- Define **sampling** (ex.: `0.1`) conforme volume e custo.
- É dono do **backend de telemetria** (Tempo/Loki/Mimir, Datadog, etc.), **dashboards**, **retenção** e **alertas**.

**Fronteira contratual:** o app só fala OTLP, ligado por variável de ambiente (interruptor fail-safe — sem env, telemetria desliga e o app segue funcionando). Tudo após o Collector é responsabilidade do SRE.

## Como executamos (POC local)

O P4 já apontou o app para `http://otel-lgtm.observability.svc.cluster.local:4318` via `OTEL_EXPORTER_OTLP_ENDPOINT`. Este trabalho materializou esse destino com a **mesma stack all-in-one** que o repo usa no `docker-compose.yml`: **`grafana/otel-lgtm:0.30.1`** (versão pinada do compose, linha `image: grafana/otel-lgtm:0.30.1`).

Passos executados (todos com `--context docker-desktop`):

1. **Check de contexto (guardrail):** `kubectl config current-context` → `docker-desktop`; nó `desktop-control-plane` **Ready** (v1.36.1).
2. **Namespace:** `kubectl create namespace observability`.
3. **Deployment** (1 réplica, imagem `grafana/otel-lgtm:0.30.1`) + **Service ClusterIP `otel-lgtm`** expondo `4317` (OTLP gRPC), `4318` (OTLP HTTP) e `3000` (Grafana UI), aplicados via `kubectl apply -f -` (heredoc).
4. **Rollout:** `kubectl rollout status deployment/otel-lgtm -n observability` → `successfully rolled out`; pod `1/1 Running`.
5. **Validação do endpoint:** de um pod efêmero (`curlimages/curl:8.9.1`), `POST` vazio em `http://otel-lgtm.observability.svc.cluster.local:4318/v1/traces` → **HTTP 415** (Unsupported Media Type). 4xx prova que o listener OTLP HTTP está de pé e respondendo — o corpo vazio é rejeitado pelo próprio receiver, como esperado.

### Acesso à Grafana UI

```bash
kubectl --context docker-desktop port-forward svc/otel-lgtm -n observability 3300:3000
```

→ Grafana em <http://localhost:3300> (datasources Tempo/Loki/Prometheus já provisionados pela imagem otel-lgtm).

## Como seria no ambiente real

- O **app é IDÊNTICO**: mesma imagem OCI, mesmo interruptor por env (`OTEL_EXPORTER_OTLP_ENDPOINT` + demais `OTEL_*`). Nada muda no código nem no chart do app.
- Em vez do all-in-one `otel-lgtm`, o SRE injeta nos **values** o endpoint do **OpenTelemetry Collector corporativo** (normalmente um agent/DaemonSet ou gateway gerenciado por eles), ex.: `http://otel-collector.observability:4318`.
- O SRE configura **sampling** (ex.: `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.1`) para controlar volume.
- Atrás do Collector, o SRE roteia para o backend que escolher (LGTM distribuído, vendor SaaS, etc.) e mantém dashboards, retenção e alertas — invisível para o app.

## Diagrama comparativo

```
POC (local, docker-desktop)
┌──────────────┐  OTLP HTTP :4318   ┌──────────────────────────────────────┐
│ users-api    │ ─────────────────▶ │ otel-lgtm (all-in-one, 1 pod)        │
│ (ns: apps)   │                    │ Collector + Tempo + Loki + Mimir     │
└──────────────┘                    │ + Grafana :3000 (ns: observability)  │
        env: OTEL_EXPORTER_OTLP_    └──────────────────────────────────────┘
        ENDPOINT=http://otel-lgtm.observability.svc.cluster.local:4318

REAL (produção)
┌──────────────┐  OTLP (mesmo protocolo,  ┌────────────────────┐   ┌───────────────────────┐
│ users-api    │  mesmo interruptor env)  │ OTel Collector     │──▶│ Backend do SRE        │
│ (mesma       │ ───────────────────────▶ │ do SRE (endpoint   │   │ (Tempo/Loki/Mimir,    │
│  imagem)     │  sampling ex.: 0.1       │ vem nos values —   │   │ vendor…) + dashboards │
└──────────────┘                          │ insumo nº 4)       │   │ + retenção + alertas  │
                                          └────────────────────┘   └───────────────────────┘
   fronteira do app ────────────────────▶ │◀──────────── domínio do SRE ────────────────────
```

## Divergências assumidas e riscos

| Divergência (POC) | No real | Risco se levado ao real |
| --- | --- | --- |
| Stack all-in-one `otel-lgtm` num único pod, sem persistência | Collector + backend distribuídos, HA, storage durável | All-in-one perde dados no restart; não escala; single point of failure |
| Sem sampling (100% dos traces) | SRE define sampling (ex.: 0.1) | Custo/volume explodem em produção sem sampling |
| Grafana sem auth exposta só via port-forward | Grafana/backend com SSO, RBAC e rede privada | Exposição de telemetria sem controle de acesso |
| Sem retenção/alertas configurados | SRE define retenção e alertas | POC não valida operação contínua, só o transporte OTLP |
| Endpoint fixo apontado pelo P4 no manifest local | Endpoint vem dos values do chart (insumo nº 4 do handoff) | Hardcode de endpoint quebraria a fronteira app/SRE |

Nenhuma divergência afeta o **app**: ele é idêntico nos dois mundos — a POC prova exatamente a fronteira (app → OTLP → Collector).

## Evidências

```text
$ kubectl config current-context
docker-desktop

$ kubectl --context docker-desktop get nodes
NAME                    STATUS   ROLES           AGE   VERSION
desktop-control-plane   Ready    control-plane   45h   v1.36.1

$ grep image: docker-compose.yml | grep otel
    image: grafana/otel-lgtm:0.30.1

$ kubectl --context docker-desktop create namespace observability
namespace/observability created

$ kubectl --context docker-desktop apply -f -   # Deployment + Service (heredoc)
deployment.apps/otel-lgtm created
service/otel-lgtm created

$ kubectl --context docker-desktop rollout status deployment/otel-lgtm -n observability
deployment "otel-lgtm" successfully rolled out

$ kubectl --context docker-desktop get pods,svc -n observability
NAME                             READY   STATUS    RESTARTS   AGE
pod/otel-lgtm-7b9cbf94b7-4c5vl   1/1     Running   0          100s

NAME                TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)                      AGE
service/otel-lgtm   ClusterIP   10.96.195.118   <none>        4317/TCP,4318/TCP,3000/TCP   100s

# pod efêmero curlimages/curl:8.9.1 →
# POST vazio http://otel-lgtm.observability.svc.cluster.local:4318/v1/traces
HTTP_CODE=415   # 4xx = endpoint OTLP HTTP escutando e respondendo
```
