import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

/**
 * Bootstrap do OpenTelemetry — IMPORTADO ANTES DE TUDO no main.ts, porque a
 * auto-instrumentação funciona por patch das libs (http, express, pg, redis,
 * aws-sdk, pino): precisa acontecer antes de qualquer require delas.
 *
 * INTERRUPTOR (fail-safe por ambiente):
 * - Sem OTEL_EXPORTER_OTLP_ENDPOINT → o SDK NÃO inicia. Estado "desligado":
 *   nenhuma instrumentação ativa, nenhuma tentativa de rede. Dev local, unit
 *   e CI rodam assim por padrão.
 * - Com a env (values do chart, preenchida pelo SRE; ou o profile
 *   `observability` do compose) → traces + métricas exportados via OTLP/HTTP.
 *
 * FAIL-OPEN por desenho: a exportação é assíncrona e em lote
 * (BatchSpanProcessor) — Collector indisponível vira erro de log, NUNCA
 * exceção no caminho da requisição. O e2e prova isso apontando a env para um
 * endereço morto e exigindo a suíte inteira verde.
 *
 * Backend, dashboards, retenção e alertas são do SRE: o app só fala OTLP.
 */
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'api-finance',
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Probes a cada poucos segundos virariam ruído e custo — fora do trace.
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) => request.url?.startsWith('/health') ?? false,
        },
        // I/O de filesystem não é sinal útil neste serviço — só volume.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Drena spans/métricas pendentes no desligamento (SIGTERM do Kubernetes).
  process.on('SIGTERM', () => {
    sdk.shutdown().catch(() => undefined);
  });
}
