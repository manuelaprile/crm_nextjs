# ---- dependencias ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---- build ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web ./
COPY packages/db/migrations ../../packages/db/migrations
# Estas no son secretos reales: Next las necesita presentes para compilar.
# Los valores de verdad llegan en runtime desde docker-compose.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    SYSTEM_DATABASE_URL=postgres://build:build@localhost:5432/build \
    INGEST_SECRET=build WORKER_SECRET=build ANTHROPIC_API_KEY=build \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# No corre como root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migraciones y scripts, para poder correrlos con `docker compose exec`.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules/.bin/tsx ./node_modules/.bin/tsx
COPY packages/db/migrations /packages/db/migrations
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
