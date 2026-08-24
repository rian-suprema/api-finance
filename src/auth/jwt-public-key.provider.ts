import { readFileSync } from 'node:fs';

import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Token de DI para a chave pública da SayPlus (string PEM) ou `null`. */
export const SAYPLUS_JWT_PUBLIC_KEY = 'SAYPLUS_JWT_PUBLIC_KEY';

/**
 * Carrega a chave pública UMA vez no boot (zero I/O no caminho de auth).
 *
 * Decisão de arquitetura (fail-closed sem derrubar o boot): chave ausente ou
 * ilegível NÃO impede o app de subir — probes de saúde são @Public e o
 * readiness passa —, mas TODA rota protegida responde 401 até a chave ser
 * montada. Deploy mal configurado vira alarme alto no log, nunca outage
 * (restart-loop) nem brecha (rotas abertas).
 */
export const jwtPublicKeyProvider: Provider = {
  provide: SAYPLUS_JWT_PUBLIC_KEY,
  inject: [ConfigService],
  useFactory: (config: ConfigService): string | null => {
    const logger = new Logger('SayplusAuth');
    const path = config.get<string>('auth.publicKeyPath');
    if (!path) {
      logger.warn(
        '🚨 JWT_PUBLIC_KEY_PATH não configurada — nenhum token será aceito: ' +
          'TODAS as rotas protegidas responderão 401 (fail-closed). ' +
          'Monte a chave pública da SayPlus e configure a variável.',
      );
      return null;
    }
    try {
      return readFileSync(path, 'utf8');
    } catch {
      logger.warn(
        `🚨 Chave pública ilegível em JWT_PUBLIC_KEY_PATH=${path} — nenhum token ` +
          'será aceito: TODAS as rotas protegidas responderão 401 (fail-closed).',
      );
      return null;
    }
  },
};
