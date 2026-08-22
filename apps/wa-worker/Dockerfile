FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/wa-worker/package.json apps/wa-worker/package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/wa-worker ./
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001
COPY apps/wa-worker/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder --chown=worker:nodejs /app/dist ./dist
USER worker
EXPOSE 4000
CMD ["node", "dist/index.js"]
