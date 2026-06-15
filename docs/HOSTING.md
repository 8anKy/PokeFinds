# Hosting — gratis, 24/7 i molnet

Det här gör att data samlas in och uppdateras **även när din dator är avstängd**,
och att sajten är publik. Allt nedan ligger på gratisnivåer.

## Arkitektur

| Del | Tjänst | Kostnad |
| --- | --- | --- |
| Databas (PostgreSQL) | **Neon** (serverless) | Gratis — 0,5 GB (DB:n är ~181 MB) |
| Bakgrundsjobb (CM/Tradera/restock) | **GitHub Actions** schemalagda workflows | Gratis — 2000 min/mån (privat repo) |
| Webbsajt (Next.js) | **Vercel** Hobby | Gratis |

Jobben körs av GitHub Actions (`.github/workflows/`) mot Neon-databasen — **ingen
egen server, ingen påslagen dator**. Sajten på Vercel läser från samma databas.

Schemalagda jobb (alla har även en manuell **Run workflow**-knapp):
- `cardmarket-refresh.yml` — singel- + sealed-priser, dagligen 05:00 UTC
- `tradera-sweep.yml` — Tradera-annonser, dagligen 04:00 UTC
- `restock-watch.yml` — svenska butiker + restock-alerts, var 2:e timme
- `scrape-all.yml` — full butiks-/prisguide-insamling, dagligen 02:00 UTC

---

## Steg 1 — Databas på Neon

1. Skapa konto på <https://neon.tech> (gratis, GitHub-login funkar).
2. **Create project** → välj region nära Sverige (t.ex. *Europe (Frankfurt)*).
3. Kopiera **connection string** (ser ut som
   `postgresql://USER:PASS@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`).
   Det här är din `DATABASE_URL` i molnet.

## Steg 2 — Flytta schema + data till Neon (en gång)

Din lokala Postgres har all data. Kopiera den till Neon med `pg_dump` (följer med
din PostgreSQL 18-installation):

```bash
pg_dump "postgresql://postgres:pokefinds-local@localhost:5432/pokefinds" \
  --no-owner --no-acl --no-comments \
| psql "DIN_NEON_CONNECTION_STRING"
```

- Kör i Git Bash. Tar någon minut (~181 MB).
- Klagar `pg_dump` på version? Lägg din PG18 `bin`-mapp först i PATH, eller be mig
  köra migreringen åt dig (klistra in Neon-strängen så sköter jag dump + verifiering).
- Vill du hellre bygga schemat rent och seeda om: `DATABASE_URL=neon... npx prisma db push`
  följt av importskripten. `pg_dump` ovan är dock snabbast och behåller exakt nuläge.

## Steg 3 — GitHub Actions secrets (bakgrundsjobben)

I repot: **Settings → Secrets and variables → Actions → New repository secret**.
Lägg till:

| Secret | Värde |
| --- | --- |
| `DATABASE_URL` | Neon connection string (steg 1) |
| `CARDMARKET_RAPIDAPI_HOST` | `cardmarket-api-tcg.p.rapidapi.com` |
| `CARDMARKET_RAPIDAPI_KEY` | din RapidAPI-nyckel |
| `TRADERA_APP_ID` | ditt Tradera-app-id |
| `TRADERA_APP_KEY` | din Tradera-app-nyckel |
| `EUR_SEK` | *(valfritt — lämna tomt för live-kurs)* |

Testa direkt: **Actions**-fliken → välj t.ex. *Cardmarket-priser* → **Run workflow**.
Den ska bli grön och uppdatera priser i Neon.

## Steg 4 — Webbsajt på Vercel

1. Skapa konto på <https://vercel.com> med GitHub.
2. **Add New… → Project** → importera `8anKy/PokeFinds`.
3. Under **Environment Variables**, lägg till (Production):

   | Variabel | Värde |
   | --- | --- |
   | `DATABASE_URL` | Neon connection string |
   | `NEXTAUTH_URL` | din Vercel-URL (t.ex. `https://pokefinds.vercel.app`) |
   | `NEXTAUTH_SECRET` | en lång slumpsträng (`openssl rand -base64 32`) |
   | `NEXT_PUBLIC_APP_URL` | samma som NEXTAUTH_URL |
   | `NEXT_PUBLIC_APP_NAME` | `PokeFinds` |
   | `OCR_PROVIDER` | `claude` (för riktig kortidentifiering) |
   | `ANTHROPIC_API_KEY` | din Anthropic-nyckel (skanner + gradering) |
   | `GRADING_PROVIDER` | `claude` |
   | `CARDMARKET_RAPIDAPI_HOST` / `CARDMARKET_RAPIDAPI_KEY` | som ovan |
   | `TRADERA_APP_ID` / `TRADERA_APP_KEY` | som ovan |
   | `EMAIL_MODE` | `console` tills SMTP är satt (se nedan) |
   | `SCRAPE_INTERVAL_MINUTES` | `0` |
   | `RESTOCK_WATCH_MINUTES` | `0` |

   > **Viktigt:** `SCRAPE_INTERVAL_MINUTES=0` + `RESTOCK_WATCH_MINUTES=0` stänger av
   > den in-process-schemaläggningen på Vercel (serverless kan inte köra loopar) —
   > GitHub Actions sköter all schemaläggning istället.

4. **Deploy**. Klart — sajten är live på din Vercel-URL.

## Steg 5 — Verifiera

- Öppna Vercel-URL:en → katalogen visar produkter (läser från Neon).
- **Actions** → kör varje workflow manuellt en gång → grönt.
- Logga in med ett seedat konto och testa skanner/bevakningar.

---

## Kostnad, gränser & finjustering

- **GitHub Actions-minuter** (privat repo = 2000/mån): nuvarande cadence ligger
  bekvämt under. Vill du ha **restock var 45:e min** istället för var 2:a timme:
  gör repot **publikt** (obegränsade Actions) eller höj till en betald runner.
  Justera cadence i `cron:`-raden i respektive workflow.
- **Neon gratis** = 0,5 GB. DB:n växer långsamt med prishistorik; håll koll i Neons
  dashboard. Vid behov: betalnivå (~$19/mån) eller trimma gammal historik.
- **Vercel Hobby** är tekniskt icke-kommersiellt — helt OK före lansering. När du
  börjar ta betalt: uppgradera till Pro ($20/mån).
- **E-post/alerts**: sätt `EMAIL_MODE=smtp` + SMTP-uppgifter (gratis: Resend,
  Brevo) i Vercel + i GitHub-secrets så restock-/prisalerts mejlas på riktigt.
- **Egen domän**: lägg till i Vercel → Domains och peka DNS dit.
