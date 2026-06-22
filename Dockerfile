# Debian (glibc) i stället för Alpine (musl): Prismas query-engine + openssl-
# detektering strular på Alpine (PrismaClientInitializationError vid bygget).
# node:22-slim ger Node 22 + glibc; openssl läggs till för Prisma. Railway använder
# denna Dockerfile automatiskt (inte Railpack).
FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM base AS build
# Build-args måste deklareras före användning. DATABASE_URL behövs för ISR-statisk
# generering av /, /marknad, /sets; NEXT_PUBLIC_* bakas in i klientbunten.
ARG DATABASE_URL
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_URL
ENV NODE_ENV=production \
    DATABASE_URL=$DATABASE_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
EXPOSE 3000
# migrate får INTE blockera start: med App Sleeping (scale-to-zero) körs detta vid
# varje cold start, och en långsam/kall Neon-anslutning fick `&&` att döda containern
# (CRASHED). `|| true; ` → appen startar alltid; migrationer appliceras ändå vid en
# frisk boot. Vid faktiska schemaändringar: kör `npx prisma migrate deploy` manuellt.
CMD ["sh", "-c", "npx prisma migrate deploy || true; npm start"]
