# Debian (glibc) i stället för Alpine (musl): Prismas query-engine + openssl-
# detektering strular på Alpine (PrismaClientInitializationError vid bygget).
# node:22-slim ger Node 22 + glibc; openssl läggs till för Prisma. Railway använder
# denna Dockerfile automatiskt (inte Railpack).
FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

FROM base AS build
# Build-args måste deklareras före användning. DATABASE_URL behövs för ISR-statisk
# generering av /, /marknad, /sets; NEXT_PUBLIC_* bakas in i klientbunten.
ARG DATABASE_URL
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_URL
# RevenueCat-nycklarna måste bakas in i klientbunten (annars = "Kommer snart" i app:en).
ARG NEXT_PUBLIC_RC_IOS_KEY
ARG NEXT_PUBLIC_RC_ANDROID_KEY
ENV NODE_ENV=production \
    DATABASE_URL=$DATABASE_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_RC_IOS_KEY=$NEXT_PUBLIC_RC_IOS_KEY \
    NEXT_PUBLIC_RC_ANDROID_KEY=$NEXT_PUBLIC_RC_ANDROID_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
# NODE_OPTIONS sätts i RUNNER-steget, aldrig i build-steget: `next build` behöver
# långt mer än taket nedan och skulle OOM:a mitt i bygget.
#
# VARFÖR ETT HEAP-TAK (kostnads-kritiskt, mätt 2026-07-26): Railway fakturerar
# MINNE ($10/GB-månad) och det är ~92 % av hela notan (juli: $2,97 av $3,24 —
# CPU $0,04, egress $0,23). Containern har 8 GB gräns, så Node dimensionerar
# sin gamla generation efter DEN och skjuter upp major-GC nästan hur länge som
# helst. Följden är en RSS som DRIVER uppåt med upptid utan att appen gör något:
# mätt 63 MB vid boot → 190 MB (5 h) → 259 MB (11 h) → 345 MB (13 h) med enbart
# cron-pingar som trafik, och 725 MB som dygnssnitt en vanlig dag. Det är inte en
# läcka i vår kod (Sentry-tracing är av, ioredis har enableOfflineQueue: false,
# rate-limit-mappen är liten) — det är skräp som V8 aldrig får anledning att städa.
# Ett tak tvingar fram GC vid en vettig nivå. Vi har råd med den CPU:n: tjänsten
# använder 0,2 % av EN kärna, och CPU kostar oss $0,04/mån.
#
# 512 MB = ~8× det uppmätta arbetssättet vid boot (63 MB) och bekvämt över natt-
# platån (190–260 MB). Topparna vi sett (725 MB dygnssnitt, 2 GB under en
# 150 req/min-skur) var skräp, inte levande data. Sänk till 384 först efter att
# ha bevakat `railway metrics` — en OOM-omstart på en live-sajt är dyrare än
# den dollar det sparar.
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512"
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
