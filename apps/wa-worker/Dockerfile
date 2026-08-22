# ---- dependencias completas (para compilar) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/wa-worker/package.json apps/wa-worker/package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---- dependencias de producción ----
# Se instalan acá, CON el package-lock.json, y después se copian a la imagen
# final. Antes la última etapa hacía `npm install` con solo el package.json:
# sin el lock, npm vuelve a resolver todo y una dependencia de Baileys apunta
# a un repositorio git — que esta imagen no tiene. Fallaba con:
#   npm error syscall spawn git / ENOENT
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY apps/wa-worker/package.json apps/wa-worker/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- compilación ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/wa-worker ./
RUN npm run build

# ---- imagen final ----
# No corre npm: solo copia lo ya resuelto. Más rápida de construir y sin
# depender de la red ni de git en el último paso.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001
COPY apps/wa-worker/package.json ./
COPY --from=prod-deps --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/dist ./dist
USER worker
EXPOSE 4000
CMD ["node", "dist/index.js"]
