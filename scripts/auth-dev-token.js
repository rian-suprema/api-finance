/**
 * Assina um JWT de DESENVOLVIMENTO com keys/private.pem, simulando a SayPlus.
 * Uso:
 *   npm run auth:token                                   # todas as permissões do módulo
 *   node scripts/auth-dev-token.js petshop.users.read    # só os codes passados
 *
 * Os codes espelham src/auth/permissions.constants.ts (fonte canônica).
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const jwt = require('jsonwebtoken');

const ALL_PERMISSIONS = [
  'petshop.users.read',
  'petshop.users.create',
  'petshop.users.edit',
  'petshop.users.delete',
];

let privateKey;
try {
  privateKey = readFileSync(join(__dirname, '..', 'keys', 'private.pem'), 'utf8');
} catch {
  console.error('keys/private.pem não encontrada — rode antes: npm run auth:keys');
  process.exit(1);
}

const requested = process.argv.slice(2);
const token = jwt.sign(
  {
    email: 'dev@local',
    tenantId: 'tenant-dev',
    permissions: requested.length > 0 ? requested : ALL_PERMISSIONS,
  },
  privateKey,
  {
    algorithm: 'RS256',
    subject: 'dev-user',
    issuer: 'sayplus',
    audience: ['sayplus', 'petshop'],
    expiresIn: '8h',
  },
);
console.log(token);
