# Build stage: install everything, generate the Prisma client, compile TS.
FROM node:20-alpine AS builder

WORKDIR /app

# openssl for Prisma engines; python3/make/g++ only if bcrypt has to compile.
RUN apk add --no-cache openssl python3 make g++

COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime stage: same base image, so the generated Prisma engine matches.
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json prisma.config.ts ./

RUN mkdir -p /app/uploads

EXPOSE 4000

# Applies pending migrations on start. Set SKIP_MIGRATIONS=1 when pointing at a
# database whose migration history differs from prisma/migrations (see master_prompt.md).
CMD ["sh", "-c", "if [ \"$SKIP_MIGRATIONS\" != \"1\" ]; then npx prisma migrate deploy; fi && exec node dist/server.js"]
