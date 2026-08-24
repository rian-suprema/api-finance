import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import jwt from 'jsonwebtoken';

/**
 * Emissor de tokens PARA TESTES: gera um par RS256 efêmero em memória e
 * assina JWTs "como se fosse a SayPlus" — a aplicação só conhece a chave
 * pública (escrita em arquivo temporário e apontada por JWT_PUBLIC_KEY_PATH),
 * exatamente como em produção. Nada disso existe fora do processo de teste.
 */

export interface SignTokenOptions {
  permissions?: string[];
  tenantId?: string;
  sub?: string;
  email?: string;
  /** Sobrescreve o issuer — para forjar tokens inválidos nos testes. */
  issuer?: string;
  /** Sobrescreve a audience — para forjar tokens inválidos nos testes. */
  audience?: string | string[];
  expiresIn?: number;
}

export interface TestAuthContext {
  publicKeyPath: string;
  /** Chave privada efêmera — exposta para os testes de forja (Step 4). */
  privateKey: string;
  sign(options?: SignTokenOptions): string;
}

/**
 * Chamar ANTES de compilar o AppModule: define JWT_PUBLIC_KEY_PATH /
 * JWT_ISSUER / JWT_AUDIENCE no process.env (precedência sobre o .env).
 */
export function setupTestAuth(): TestAuthContext {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const publicKeyPath = join(mkdtempSync(join(tmpdir(), 'sayplus-jwt-')), 'public.pem');
  writeFileSync(publicKeyPath, publicKey);
  process.env.JWT_PUBLIC_KEY_PATH = publicKeyPath;
  process.env.JWT_ISSUER = 'sayplus';
  process.env.JWT_AUDIENCE = 'petshop';

  const sign = (options: SignTokenOptions = {}): string =>
    jwt.sign(
      {
        email: options.email ?? 'dev@suprema.group',
        tenantId: options.tenantId ?? 'tenant-a',
        permissions: options.permissions ?? [],
      },
      privateKey,
      {
        algorithm: 'RS256',
        subject: options.sub ?? 'user-test-1',
        issuer: options.issuer ?? 'sayplus',
        // Contrato SayPlus: aud é array e inclui o code do módulo no catálogo
        audience: options.audience ?? ['sayplus', 'petshop'],
        expiresIn: options.expiresIn ?? 300,
      },
    );

  return { publicKeyPath, privateKey, sign };
}
