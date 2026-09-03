/**
 * Setup do e2e (jest setupFiles — roda ANTES de qualquer import da suíte):
 * liga o OpenTelemetry apontando para um Collector propositalmente MORTO.
 *
 * É a prova de FAIL-OPEN: com o SDK ativo e o destino inalcançável, a suíte
 * inteira precisa continuar verde — exportação é assíncrona/batch e falha de
 * exporter é log, nunca exceção no caminho da requisição. Se telemetria
 * derrubar boot ou request, o e2e denuncia aqui.
 */
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:1';
process.env.OTEL_SERVICE_NAME = 'api-finance-e2e';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../src/telemetry/otel');
