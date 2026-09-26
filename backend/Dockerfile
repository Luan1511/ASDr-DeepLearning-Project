# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Ensure uploads directory exists
RUN mkdir -p /app/uploads

EXPOSE 4000

CMD ["npm", "run", "prisma:migrate", "deploy", "&&", "npm", "start"]
