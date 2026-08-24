# ==============================================================================
# Build multi-stage: imagem final enxuta, só com deps de produção.
# `npm ci` (não `npm install`): instala EXATAMENTE o package-lock.json —
# parte da defesa contra supply chain (ver README §Segurança de dependências).
# ==============================================================================
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
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
