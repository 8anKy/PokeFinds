# Installation & utvecklingsmiljö

Detaljerad guide för att få igång PokeFinds lokalt.

## Förkrav

- **Node.js 20+** (LTS rekommenderas)
- **Docker Desktop** (för PostgreSQL och Redis) — alternativt egna lokala installationer
- **Git**

## Steg för steg

```bash
# 1. Starta databastjänster
docker compose up -d db redis

# 2. Installera beroenden
npm install

# 3. Skapa din lokala miljöfil
cp .env.example .env

# 4. Migrera databasen (skapar alla tabeller)
npx prisma migrate dev

# 5. Seeda demodata (sets, kort, produkter, priser, demokonton)
npx prisma db seed

# 6. Starta dev-servern
npm run dev
```

Öppna `http://localhost:3000` och logga in med `demo@pokefinds.se` / `demo1234`.

### Allt i Docker

```bash
docker compose --profile full up
```

Bygger appen i container och kör den mot containrarnas Postgres/Redis. OBS: kör fortfarande `npx prisma migrate dev && npx prisma db seed` mot databasen första gången (port 5432 är exponerad mot värddatorn).

## Windows-noteringar

- `cp .env.example .env` fungerar i Git Bash/WSL. I PowerShell: `Copy-Item .env.example .env`.
- Kör gärna kommandona i **Git Bash** eller **WSL2** för bäst kompatibilitet med npm-scripts.
- Docker Desktop kräver WSL2-backend på Windows Home.
- Om `npx prisma generate` låser filer (EPERM på `query_engine-windows.dll.node`): stäng dev-servern/editorn som håller filen och kör igen.
- Sökvägar med mellanslag (t.ex. `D:\AI Hemsidor\PokeFinds`) fungerar, men citera dem alltid i terminalen.

## Miljövariabler (.env)

Alla variabler finns i `.env.example`:

| Variabel | Krävs | Beskrivning |
| --- | --- | --- |
| `DATABASE_URL` | Ja | PostgreSQL-anslutning. Default matchar docker-compose: `postgresql://pokefinds:pokefinds@localhost:5432/pokefinds?schema=public` |
| `NEXTAUTH_URL` | Ja | Appens bas-URL, `http://localhost:3000` i dev |
| `NEXTAUTH_SECRET` | Ja | Slumpad hemlighet för JWT-sessioner. Generera: `openssl rand -base64 32` |
| `REDIS_URL` | Nej | Redis för kö/cache (BullMQ). **Valfri** — utan Redis används in-memory fallback (`src/lib/queue.ts`) |
| `EMAIL_MODE` | Ja | `console` (loggar mejl till terminalen, dev) eller `smtp` (riktig sändning) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Vid `smtp` | SMTP-uppgifter för utgående e-post |
| `EMAIL_FROM` | Ja | Avsändaradress, t.ex. `PokeFinds <noreply@pokefinds.se>` |
| `OCR_PROVIDER` | Ja | `mock` i MVP. Koppla riktig vision-API senare (se docs/SCANNER.md) |
| `OCR_API_KEY` | Vid riktig OCR | API-nyckel till vald OCR-leverantör |
| `STRIPE_ENABLED` | Ja | `false` i MVP — betalmodulen är förberedd men avstängd |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Vid Stripe | Stripe-nycklar (används först när `STRIPE_ENABLED=true`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Nej | Web push (förberett, kräver VAPID-nyckelpar) |
| `CRON_SECRET` | Ja (för cron) | Hemlighet för `/api/cron/scrape` — anropet måste skicka headern `x-cron-secret`. Utan satt variabel är cron-routen avstängd (503) |
| `NEXT_PUBLIC_APP_URL` | Ja | Publik bas-URL (används bl.a. i e-postlänkar) |
| `NEXT_PUBLIC_APP_NAME` | Ja | Appnamn, `PokeFinds` |

## Felsökning

### Databasanslutning misslyckas (`P1001: Can't reach database server`)

1. Kontrollera att containern kör: `docker compose ps` — `db` ska vara `healthy`.
2. Kontrollera `DATABASE_URL` i `.env` (host `localhost`, port `5432`, användare/lösen `pokefinds`).
3. Portkrock? Se nedan.
4. Starta om: `docker compose restart db`.

### "Environment variable not found: DATABASE_URL"

`.env` saknas — kör `cp .env.example .env`. Prisma CLI läser `.env` i projektroten.

### Redis-fel / `ECONNREFUSED 127.0.0.1:6379`

Redis är **valfri**. Antingen starta den (`docker compose up -d redis`) eller ignorera — koden faller tillbaka på en in-memory-kö. Tom/utelämnad `REDIS_URL` stänger av Redis helt.

### Portkonflikter

- **3000** (appen): `npm run dev -- -p 3001` och uppdatera `NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL`.
- **5432** (Postgres): ändra portmappningen i `docker-compose.yml` (t.ex. `"5433:5432"`) och `DATABASE_URL` därefter.
- **6379** (Redis): samma princip, eller stäng av Redis.

### Prisma client i osynk efter schemaändring

```bash
npx prisma generate
```

Starta sedan om dev-servern.

### Seed misslyckas / vill börja om

```bash
npx prisma migrate reset   # VARNING: raderar all data, migrerar + seedar om
```

### Mejl syns inte

I dev är `EMAIL_MODE=console` — mejlen loggas som JSON i terminalen där `npm run dev` kör.
