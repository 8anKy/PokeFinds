# Deployment-guide

## Krav
- Node 20+, PostgreSQL 14+, (valfritt) Redis 7+

## Miljövariabler (produktion)
Sätt alla från `.env.example`. Viktigast:
- `DATABASE_URL` — Postgres-anslutning
- `NEXTAUTH_SECRET` — lång slumpad sträng (`openssl rand -hex 32`)
- `NEXTAUTH_URL` + `NEXT_PUBLIC_APP_URL` — publika URL:en
- `EMAIL_MODE=smtp` + SMTP_* — riktig e-post
- `CRON_SECRET` — för schemalagd scraping
- `REDIS_URL` — om Redis används (rekommenderas i prod)

## Alternativ

### Vercel (frontend+API) + extern Postgres/Redis
1. Importera repot i Vercel
2. Sätt env-variabler
3. Build command: `prisma generate && next build`
4. Kör `npx prisma migrate deploy` mot databasen (CI-steg eller lokalt)
5. Worker: kör `npm run jobs:worker` på t.ex. Railway, eller använd extern cron (cron-job.org / GitHub Actions schedule) → `POST /api/cron/scrape` med `x-cron-secret`

### Railway / Fly.io / Render (allt-i-ett)
- Deploya med medföljande `Dockerfile` (kör `prisma migrate deploy` vid start)
- Lägg till Postgres + Redis som tjänster
- Separat process/tjänst för `npm run jobs:worker`

### Egen VPS
```bash
docker compose --profile full up -d   # app + db + redis
```

## CI/CD-förslag (GitHub Actions)
```yaml
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci --legacy-peer-deps
      - run: npx prisma generate
      - run: npx tsc --noEmit
      - run: npx vitest run
      - run: npm run build
```

## Logging & monitoring
- App-loggar: stdout (samlas av plattformen)
- Jobbloggar: `ScrapeJob.logs` i DB + adminpanelen /admin/jobb
- Förslag: Sentry för felspårning, Uptime-monitor mot `/api/market/stats`
