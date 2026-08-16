# Deployment-guide

> Uppdaterad 2026-08-16. **Produktionen kör Railway + Neon** — resten av filen är
> historiska alternativ och beskriver inte hur foilio.se faktiskt driftas.
> Durabla driftbeslut bor i CLAUDE.md.

## Krav
- **Node 22** (`package.json` → `engines: 22.x`, Dockerfilen kör `node:22-slim`, CI kör 22).
  ⛔ Hålls alla tre i fas: en CI på annan major kan gröna ett bygge som beter sig
  annorlunda i prod.
- PostgreSQL 14+ (prod = Neon serverless, Frankfurt), (valfritt) Redis 7+

## Miljövariabler (produktion)
Sätt alla från `.env.example`. Viktigast:
- `DATABASE_URL` — Postgres-anslutning
- `NEXTAUTH_SECRET` — lång slumpad sträng (`openssl rand -hex 32`)
- `NEXTAUTH_URL` + `NEXT_PUBLIC_APP_URL` — publika URL:en. ⛔ **Peka på apex
  (`https://foilio.se`), aldrig på `www`** — `www` är en Cloudflare-301 och maskinella
  klienter följer den inte.
- `RESEND_API_KEY` + `EMAIL_FROM` — riktig e-post. ⛔ **Inte SMTP**: Railway blockerar
  SMTP-portarna, `src/lib/mailer.ts` går över Resends HTTP-API. `EMAIL_MODE=console`
  loggar i stället för att skicka (dev).
- `CRON_SECRET` — för schemalagd scraping och `/api/revalidate`
- `REDIS_URL` — om Redis används (rekommenderas i prod; annars in-memory-fallback)

## Migrationer — spaken `RUN_MIGRATIONS`

**Normalvägen är MANUELL, före push:**

```bash
node scripts/with-prod-db.mjs npx prisma migrate deploy
```

⛔ **Migrationen måste ligga FÖRE koden.** Ny kod som `select`:ar nya kolumner mot en
omigrerad databas ger 500 för ALLA.

Containern kör **inte** `prisma migrate deploy` vid start som standard. Anledningen är
kostnad: med scale-to-zero körs CMD vid varje cold start, och en migrationskoll öppnar en
anslutning mot Neon och väcker computen — minst 300 s debiterad tid — även när första
besökaren bara skulle ha fått en ISR-cachad sida.

| `RUN_MIGRATIONS` | Vid boot |
|---|---|
| saknas / annat värde (**default**) | ingen DB-anslutning; appen startar direkt |
| `1` eller `true` | `npx prisma migrate deploy \|\| true`, därefter start |

⛔ `|| true` står kvar i den påslagna grenen med flit: en långsam/kall Neon-anslutning
fick en gång `&&` att döda containern (CRASHED). Boot-migrationen är därför
icke-blockerande och kan **inte** användas som grind — den kan tiga ihjäl felet. Slå bara
på spaken tillfälligt, t.ex. vid en engångsåterställning utan CLI-åtkomst, och slå av den
igen efteråt.

## Alternativ

### Railway (det vi kör)
- Railway bygger på repots `Dockerfile` (inte Railpack). `git push origin main` = deploy.
- Postgres = Neon (extern), inte en Railway-tjänst.
- Bakgrundsjobben körs av **GitHub Actions**, inte av en egen worker-tjänst.
  `npm run jobs:worker` (BullMQ) är kvar för lokal körning.
- ⛔ Registrera aldrig `www` som custom domain — apex är kanonisk.

### Fly.io / Render (allt-i-ett)
- Samma `Dockerfile`. Sätt `RUN_MIGRATIONS` bara om plattformen saknar en CLI-väg till DB:n.
- Lägg till Postgres + Redis som tjänster.

### Vercel
Används **inte** (`vercel.json` är historik). ISR-sidorna prerendras vid bygget och läser
DB:n, så byggsteget behöver en nåbar `DATABASE_URL` oavsett plattform.

### Egen VPS
```bash
docker compose --profile full up -d   # app + db + redis
```

## CI/CD
Grinden finns redan: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Den kör på
push till `main` och på pull requests:

| Jobb | Steg |
|---|---|
| `verify` | `npm ci` → `prisma generate` → `prisma migrate deploy` (CI-Postgres) → `vitest run` → `npm run lint` → `next build` → `npm audit` (informativt) |
| `e2e` | Playwright chromium, `tests/e2e/smoke.spec.ts`, parallellt med `verify` |

Noter:
- Bygget körs mot en **riktig, migrerad** Postgres-tjänst — ISR-sidorna prerendras och
  läser DB:n. En tom databas räcker (noll rader, men koden körs).
- `npm run lint` (`next lint`) kräver `.eslintrc.json` i repo-roten. Utan den ställer
  Next en **interaktiv** fråga och jobbet hänger tills det timar ut.
- `npm audit` blockerar inte: de kända sårbarheterna är transitiva och väntar på
  uppströms-fixar (se `docs/TODO.md`).
- `tests/e2e/auth.spec.ts` körs **inte** i CI — inloggningstestet kräver ett seedat
  demokonto och att `SEED_DEMO_PASSWORD` sätts till samma värde som vid seedningen.
  Saknas variabeln hoppar testet över sig självt (avsiktligt: repot är publikt).

## Logging & monitoring
- App-loggar: stdout (samlas av plattformen)
- Jobbloggar: `ScrapeJob.logs` i DB + adminpanelen `/admin/jobb`
- Felspårning: Sentry (server + edge) via `SENTRY_DSN`. ⚠️ Kräver att
  `next.config.mjs` finns i runner-imagen — utan den laddas `instrumentation.ts` aldrig.
- Uptime: monitorera `https://foilio.se/api/health` (liveness, ingen DB-ping → väcker
  inte Neon). Apex, inte `www`.
