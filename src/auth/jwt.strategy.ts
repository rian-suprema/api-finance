import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { JwtPayload } from './jwt-payload.interface';
import { SAYPLUS_JWT_PUBLIC_KEY } from './jwt-public-key.provider';

/**
 * Validação PASSIVA do JWT da SayPlus — criptografia pura, zero I/O:
 * assinatura RS256 contra a chave pública + issuer + audience + expiração.
 * Nenhuma chamada de rede: quem emite/revoga/gerencia sessão é a SayPlus.
 *
 * RS256 é requisito, não opção: `algorithms` fixo impede downgrade para
 * HS256 (token forjado usando a chave PÚBLICA como segredo simétrico —
 * ataque clássico contra validadores mal configurados).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, @Inject(SAYPLUS_JWT_PUBLIC_KEY) publicKey: string | null) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      algorithms: ['RS256'],
      issuer: config.get<string>('auth.issuer'),
      audience: config.get<string>('auth.audience'),
      // Evolução registrada (IdP federado/Keycloak como emissor direto): a
      // troca para JWKS acontece AQUI — este secretOrKeyProvider passa a usar
      // jwks-rsa (cache + kid) apontando para /.well-known/jwks.json, e o
      // volume da chave sai do chart. Guards/decorators/claims não mudam.
      // Sem chave configurada → toda validação falha → 401 (fail-closed;
      // o alarme já gritou no boot, em jwt-public-key.provider.ts)
      secretOrKeyProvider: (
        _req: unknown,
        _raw: unknown,
        done: (err: Error | null, key?: string) => void,
      ) => (publicKey ? done(null, publicKey) : done(new Error('JWT public key não configurada'))),
    });
  }

  /** Token já validado criptograficamente — o retorno vira `request.user`. */
  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
