# Debian (glibc) i stället för Alpine (musl): Prismas query-engine + openssl-
# detektering strular på Alpine (PrismaClientInitializationError vid bygget).
# node:22-slim ger Node 22 + glibc; openssl läggs till för Prisma. Railway använder
# denna Dockerfile automatiskt (inte Railpack).
FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
# ⛔ plugins/ FÖRE npm ci: `foilio-text-recognition` är ett file:-beroende
# (plugins/foilio-text-recognition, egen Capacitor-plugin). Saknas katalogen i
# lagret faller npm ci på ENOENT och hela bygget med den.
COPY plugins ./plugins
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
# ⛔ LÄSES VID BYGGET, INTE VID START. /priser och /villkor är STATISKT genererade,
# så `stripeEnabled()` och `legalEntity()` körs under `next build` och bakas in i
# HTML:en. Utan de här raderna är de undefined i byggsteget ⇒ köpknappen fastnar
# på "Kommer snart" och företagsblocket försvinner, hur rätt variablerna än står
# på Railway. Missen kostade en felsökningsrunda 2026-08-07.
# ⚠️ Följd: en ändring av dem kräver en OMBYGGNAD (Railway bygger om automatiskt
# vid variabeländring). Nödstoppet är ändå omedelbart — API-routen läser
# `stripeEnabled()` i RUNTIME, så checkout slutar sälja direkt; bara knappens
# utseende släpar tills bygget är klart.
ARG STRIPE_ENABLED
# Kampanjen "gratis Pro till nya konton": bannern är en klientkomponent, så datumet
# BAKAS IN här. Utan de här raderna är det undefined i bunten och remsan syns aldrig,
# hur rätt variabeln än står på Railway — exakt samma fälla som STRIPE_ENABLED ovan.
# Registreringen läser samma variabel i RUNTIME och påverkas inte.
ARG NEXT_PUBLIC_SIGNUP_BONUS_UNTIL
ARG NEXT_PUBLIC_SIGNUP_BONUS_MONTHS
ARG LEGAL_ENTITY_NAME
ARG LEGAL_ENTITY_ADDRESS
ARG LEGAL_ENTITY_VAT
ARG LEGAL_ENTITY_EMAIL
# Google-/Apple-inloggning: klient-id:na speglas till NEXT_PUBLIC_* i next.config.mjs
# och BAKAS IN i klientbunten — utan de här raderna renderar servern knapparna
# (den har variablerna i runtime) medan klienten hydrerar bort dem: SSR-HTML:en
# innehåller "Fortsätt med Google", sidan i webbläsaren gör det inte. Exakt den
# fällan kostade en felsökningsrunda 2026-08-29. Hemligheterna (CLIENT_SECRET,
# APPLE_PRIVATE_KEY) läses i RUNTIME och ska INTE hit.
ARG GOOGLE_CLIENT_ID
ARG GOOGLE_IOS_CLIENT_ID
ARG APPLE_CLIENT_ID
ENV NODE_ENV=production \
    DATABASE_URL=$DATABASE_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_RC_IOS_KEY=$NEXT_PUBLIC_RC_IOS_KEY \
    NEXT_PUBLIC_RC_ANDROID_KEY=$NEXT_PUBLIC_RC_ANDROID_KEY \
    STRIPE_ENABLED=$STRIPE_ENABLED \
    NEXT_PUBLIC_SIGNUP_BONUS_UNTIL=$NEXT_PUBLIC_SIGNUP_BONUS_UNTIL \
    NEXT_PUBLIC_SIGNUP_BONUS_MONTHS=$NEXT_PUBLIC_SIGNUP_BONUS_MONTHS \
    LEGAL_ENTITY_NAME=$LEGAL_ENTITY_NAME \
    LEGAL_ENTITY_ADDRESS=$LEGAL_ENTITY_ADDRESS \
    LEGAL_ENTITY_VAT=$LEGAL_ENTITY_VAT \
    LEGAL_ENTITY_EMAIL=$LEGAL_ENTITY_EMAIL \
    GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID \
    GOOGLE_IOS_CLIENT_ID=$GOOGLE_IOS_CLIENT_ID \
    APPLE_CLIENT_ID=$APPLE_CLIENT_ID
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
# 384 MB (512→384 2026-08-31, EFTER den mätning gamla kommentaren krävde):
# heapUsed låg på 166 MB efter 4,5 h drift medan RSS drivit till 432 MB — taket
# är budgeten V8 dimensionerar efter, inte behovet, så 512 lät RSS parkera nära
# en halv GB. 384 = 2,3× uppmätt levande heap. Nästa steg nedåt (320) kräver ny
# mätning av heapUsed via /api/health först — en OOM-omstart på en live-sajt är
# dyrare än dollarn den sparar. Syns "JavaScript heap out of memory" i
# deploy-loggen är 512 rollbacken.
# MALLOC_ARENA_MAX (2026-08-09): RSS nådde 6–8 GB TROTS heap-taket ovan under ett
# crawler-svep på ~7 req/s (Claude-SearchBot + GoogleOther) — dvs. minnet var INTE
# JS-heap utan glibc:s malloc-arenor. glibc skapar upp till 8 arenor PER KÄRNA
# (Railways värdar rapporterar många kärnor) och lämnar nästan aldrig tillbaka
# minne till OS:et → fragmenteringen växer med varje samtidig rendering och ser ut
# som en läcka. 2 arenor är standardreceptet för Node-containrar; CPU-kostnaden är
# försumbar för oss (0,2 % av en kärna). Railway fakturerar MINNE ($10/GB-mån).
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=384" \
    MALLOC_ARENA_MAX=2
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
# node_modules/foilio-text-recognition är en symlänk hit — annars dinglar den.
COPY --from=build /app/plugins ./plugins
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
# ⛔ next.config.mjs LÄSES OM AV `next start` VID RUNTIME — utan filen kör servern
# med DEFAULTS: experimental.instrumentationHook stängs av (instrumentation.ts
# laddas aldrig ⇒ Sentry.init körs aldrig — prod stod HELT utan felrapportering
# tills 2026-08-09) och cacheMaxMemorySize faller till 50 MB. headers()/redirects
# överlevde bara för att de bakas in i routes-manifest vid BYGGET. Ta inte bort.
COPY --from=build /app/next.config.mjs ./next.config.mjs
# Persistent ISR-cache (server/cache-handler.cjs) + chunk-arkivet som körs före
# start (server/isr-cache-boot.cjs). Aktiveras BARA när en volym är monterad
# (RAILWAY_VOLUME_MOUNT_PATH) — utan volym är båda no-ops.
COPY --from=build /app/server ./server
EXPOSE 3000
# ⛔ MIGRATIONEN KÖRS INTE VID START SOM STANDARD (RUN_MIGRATIONS saknas → hoppas över).
#
# VARFÖR AV (kostnad): med App Sleeping (scale-to-zero) körs CMD vid VARJE cold start.
# `prisma migrate deploy` öppnar en anslutning mot Neon och VÄCKER computen — och en
# väckning kostar minst 300 s debiterad tid. Det händer även när första besökaren bara
# skulle ha fått en ISR-cachad sida ur containerns disk, utan en enda DB-fråga. Vi
# betalade alltså compute för att fråga en migrationstabell som nästan alltid är i fas.
#
# VARFÖR DET INTE KOSTAR OSS NÅGOT SKYDD: CLAUDE.md kräver ändå att schemaändringar
# migreras MANUELLT före push (`node scripts/with-prod-db.mjs npx prisma migrate deploy`),
# just för att ny kod som `select`:ar nya kolumner mot en omigrerad databas ger 500 för
# ALLA. Boot-körningen var aldrig den grinden: den är avsiktligt icke-blockerande (se
# `|| true` nedan) och kunde tiga ihjäl exakt det fel den påstods fånga.
#
# ⛔ `|| true` STÅR KVAR i den grenen som körs: en långsam/kall Neon-anslutning fick
# `&&` att döda containern en gång (CRASHED). Migrationen får aldrig blockera start.
#
# SPAKEN: sätt RUN_MIGRATIONS=1 (eller "true") på Railway-tjänsten för att slå på
# boot-migrationen igen — t.ex. under en engångsåterställning där ingen har CLI-åtkomst.
# Dokumenterad i docs/DEPLOYMENT.md.
CMD ["sh", "-c", "node server/isr-cache-boot.cjs || true; if [ \"$RUN_MIGRATIONS\" = \"1\" ] || [ \"$RUN_MIGRATIONS\" = \"true\" ]; then npx prisma migrate deploy || true; fi; npm start"]
