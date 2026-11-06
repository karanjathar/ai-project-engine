# syntax=docker/dockerfile:1.7
# StockSync — single image serving the API (/api, /webhooks) and the built React SPA.

# ---------- build: install all deps, type-check-free production build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/api/package.json src/api/
COPY src/web/package.json src/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY src/api src/api
COPY src/web src/web
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && mkdir -p src/api/node_modules

# ---------- runtime: minimal, non-root ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/src/api/package.json ./src/api/
COPY --from=build --chown=node:node /app/src/api/node_modules ./src/api/node_modules
COPY --from=build --chown=node:node /app/src/api/dist ./src/api/dist
COPY --from=build --chown=node:node /app/src/api/migrations ./src/api/migrations
COPY --from=build --chown=node:node /app/src/web/dist ./src/web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "src/api/dist/index.js"]
