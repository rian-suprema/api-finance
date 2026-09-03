import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import jwt from 'jsonwebtoken';

/**
 * Emissor de tokens para os testes orgânicos (Docker completo, ambiente
 * persistente): assina com `keys/private.pem`, a mesma chave que o
 * container `api` já validou via `keys/public.pem` montado
 * (`npm run auth:keys`, ver PLANO-TESTES-ORGANICOS-FINANCE.md §3). Não gera
 * par efêmero como `test/auth-helper.ts` — aqui a aplicação já está viva num
 * processo separado, então a chave tem de ser a que ela já conhece.
 */

const PRIVATE_KEY_PATH = join(__dirname, '..', '..', 'keys', 'private.pem');

function loadPrivateKey(): string {
  try {
    return readFileSync(PRIVATE_KEY_PATH, 'utf8');
  } catch {
    throw new Error(
      `keys/private.pem não encontrada — rode "npm run auth:keys" antes do test:organic`,
    );
  }
}

export interface OrganicSignOptions {
  permissions?: string[];
  sub?: string;
}

/** Todos os codes do módulo — "Marina com acesso total". */
export const ALL_FINANCE_PERMISSIONS = [
  'finance.cash-balance.summary.read',
  'finance.cash-balance.banks.read',
  'finance.cash-balance.banks.confirm',
  'finance.cash-balance.register.create',
  'finance.reconciliation.read',
  'finance.reconciliation.run',
  'finance.reconciliation.resolve',
];

/**
 * `sub` decide o que o stub de identidade (`scripts/finance-dev-stubs.js`)
 * devolve em `/auth/me`: `user-limited-brands` → só a marca Ultra; qualquer
 * outro `sub` → as 3 marcas. Ver PLANO-TESTES-ORGANICOS-FINANCE.md §3.
 */
export function signOrganicToken(options: OrganicSignOptions = {}): string {
  const privateKey = loadPrivateKey();

  return jwt.sign(
    {
      email: 'marina.organic@suprema.group',
      tenantId: 'tenant-organic',
      permissions: options.permissions ?? ALL_FINANCE_PERMISSIONS,
    },
    privateKey,
    {
      algorithm: 'RS256',
      subject: options.sub ?? 'marina-organic',
      issuer: 'sayplus',
      audience: ['sayplus', 'petshop'],
      expiresIn: '2h',
    },
  );
}
