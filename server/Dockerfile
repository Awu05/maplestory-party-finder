# Build context: repo root (see docker-compose.prod.yml)
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY server server
COPY web web
RUN npm run build -w web && npm run build -w server

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    WEB_DIST=/app/web/dist \
    UPLOAD_DIR=/data/uploads
# node_modules is kept whole: the start command needs the prisma CLI and tsx (migrate + seed).
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/index.js"]
