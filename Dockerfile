FROM oven/bun:1.3.14-alpine

WORKDIR /app

# The production start script uses Node; Prisma needs OpenSSL.
RUN apk add --no-cache nodejs openssl

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src

# Prisma reads DATABASE_URL during client generation but does not connect here.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    bunx --no-install prisma generate
RUN bun run build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Docker Compose loads the real hosted DATABASE_URL from the VPS .env.
CMD ["sh", "-c", "bunx --no-install prisma migrate deploy && exec node dist/index.js"]
