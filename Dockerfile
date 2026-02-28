FROM node:24-alpine AS builder
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix server && npm ci --prefix client

COPY server ./server
COPY client ./client

RUN npm run build --prefix client && npm run build --prefix server
RUN npm prune --omit=dev --prefix server

FROM node:24-alpine AS runner
WORKDIR /app

COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3001

CMD ["node", "server/dist/index.js"]
