import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

import { appConfig } from '../../config/configuration';

/**
 * Timeout global de requisições de entrada: nenhuma request fica pendurada
 * indefinidamente segurando conexão e recursos. Estouro → 408.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.config.httpRequestTimeoutMs),
      catchError((error: Error) =>
        throwError(() =>
          error instanceof TimeoutError ? new RequestTimeoutException('Request timed out') : error,
        ),
      ),
    );
  }
}
