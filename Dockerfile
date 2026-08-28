# ==============================================================================
# Build multi-stage: imagem final enxuta, só com deps de produção.
# `npm ci` (não `npm install`): instala EXATAMENTE o package-lock.json —
# parte da defesa contra supply chain (ver README §Segurança de dependências).
# ==============================================================================
# Base PINADA por versão (node) + minor do Alpine — build reprodutível.
# A tag flutuante `node:22-alpine` muda sem aviso; o pin fixa o que entra no scan.
FROM node:22.23.2-alpine3.24 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22.23.2-alpine3.24 AS production
ENV NODE_ENV=production
# Patches de SEGURANÇA do SO no build: a imagem base ainda traz pacotes com
# advisory (ex.: openssl libcrypto3/libssl3 3.5.7-r0 → CVE-2026-14456, corrigido
# em 3.5.8-r0 já disponível no repositório do Alpine 3.24). `apk upgrade` puxa
# o fix sem esperar a base ser rebuildada — mantém o gate Trivy (HIGH/CRITICAL)
# verde. Roda como root, ANTES do `USER node`.
RUN apk upgrade --no-cache
WORKDIR /app
COPY package*.json ./
# Após instalar as deps de produção, o toolchain npm/corepack/yarn é REMOVIDO:
# o runtime é só `node dist/main`. Motivo duplo — (1) superfície de ataque menor;
# (2) o npm embutido na base traz dependências próprias (tar, sigstore, ip-address…)
# que aparecem no scan Trivy como HIGH/CRITICAL sem terem NADA a ver com a
# aplicação (o npm audit do projeto segue sendo a fonte sobre as deps do app).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules \
              /usr/local/bin/npm /usr/local/bin/npx \
              /usr/local/bin/corepack \
              /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn*
COPY --from=build /app/dist ./dist
# Processo sem root (prática padrão de hardening de imagem)
USER node
EXPOSE 3005
CMD ["node", "dist/main"]
