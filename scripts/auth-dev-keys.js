/**
 * Gera um par RS256 de DESENVOLVIMENTO em keys/ (gitignorado).
 * Uso: npm run auth:keys
 *
 * Em produção nada disso existe: a chave pública REAL da SayPlus é montada
 * via Secret, e a privada nunca sai da plataforma.
 */
const { generateKeyPairSync } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = join(__dirname, '..', 'keys');
mkdirSync(dir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(join(dir, 'private.pem'), privateKey);
writeFileSync(join(dir, 'public.pem'), publicKey);
console.log('Par RS256 de DEV gerado em keys/ — NUNCA versionar (já está no .gitignore).');
console.log('Aponte JWT_PUBLIC_KEY_PATH=keys/public.pem no .env e gere tokens com: npm run auth:token');
