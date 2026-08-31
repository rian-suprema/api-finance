import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Corpo de erro no contrato único do archetype: { code, message }, mais
 * campos extras estruturados que a exceção de origem carregar (ex.:
 * `pendingBanks` do registro do balanço, Fase 08).
 */
interface ErrorBody {
  code: string;
  message: string;
  [key: string]: unknown;
}

/** Chaves que o Nest já injeta em getResponse() por padrão — nunca duplicar. */
const NEST_DEFAULT_KEYS = new Set(['statusCode', 'message', 'error']);

/**
 * Filtro global de exceções (catch-all).
 *
 * - HttpException (inclui erros do ValidationPipe) → status + mensagem originais,
 *   normalizados para o contrato { code, message } da spec.
 * - Qualquer outro erro → 500 genérico; o detalhe vai para o log, nunca para o
 *   cliente (não vazar stack trace é prática básica de hardening).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = { code: 'INTERNAL_ERROR', message: 'Unexpected error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        code: HttpStatus[status] ?? `HTTP_${status}`,
        message: this.extractMessage(exception),
        ...this.extractExtraFields(exception.getResponse()),
      };
    } else {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `Erro não tratado em ${request.method} ${request.url}: ${error.message}`,
        error.stack,
      );
    }

    response.status(status).json(body);
  }

  private extractMessage(exception: HttpException): string {
    const res = exception.getResponse();
    if (typeof res === 'string') {
      return res;
    }
    const message = (res as { message?: string | string[] }).message;
    // ValidationPipe devolve message: string[] — uma violação por item
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    return message ?? exception.message;
  }

  /**
   * Campos estruturados extras do payload da exceção (ex.: `pendingBanks`),
   * excluindo as chaves que o Nest já injeta em getResponse() por padrão.
   */
  private extractExtraFields(res: unknown): Record<string, unknown> {
    if (typeof res !== 'object' || res === null) return {};
    return Object.fromEntries(
      Object.entries(res as Record<string, unknown>).filter(([key]) => !NEST_DEFAULT_KEYS.has(key)),
    );
  }
}
