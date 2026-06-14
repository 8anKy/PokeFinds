# PokeFinds

**Sveriges kontrollpanel för Pokémon TCG-marknaden.** Bevaka priser och lagerstatus, följ marknadstrender, värdera din samling, skanna kort och häng med communityn — allt på ett ställe, helt på svenska.

## Funktioner

- **Prisbevakning** — jämför priser från flera butiker, sätt målpris och få larm när priset når dit
- **Restock-alerts** — avisering direkt när en slutsåld produkt kommer tillbaka i lager
- **Marknadsdata** — trender, största prisfall, mest bevakade produkter och restock-historik
- **Samling** — registrera dina kort/produkter, följ totalvärde, vinst och värdeutveckling, CSV-export/-import
- **Kortskanning** — fota ett kort och få det identifierat (mock-OCR i MVP, riktig vision-API förberedd)
- **Community** — pulls, trades, frågor och marknadssnack med moderering
- **Aviseringar** — in-app + e-post (web push förberett)
- **Admin** — användare, datakällor, scrape-jobb, butiker och rapporthantering
- **GDPR** — dataexport, kontoradering, cookie-banner, dataminimering

## Teknikstack

| Lager | Teknik |
| --- | --- |
| Frontend | Next.js 14 (App Router), React 18, TypeScript (strict), Tailwind CSS, recharts, framer-motion |
| Backend | Next.js API routes, Zod-validering, NextAuth v4 (credentials + JWT) |
| Databas | PostgreSQL + Prisma ORM |
| Kö/cache | Redis + BullMQ (valfri — in-memory fallback utan Redis) |
| E-post | nodemailer (console-transport i dev, SMTP i prod) |
| Test | Vitest (unit) + Playwright (e2e) |

## Snabbstart

Krav: Node.js 20+, Docker (för Postgres/Redis).

```bash
docker compose up -d db redis   # starta Postgres + Redis
npm install
cp .env.example .env            # justera vid behov
npx prisma migrate dev          # skapa databastabeller
npx prisma db seed              # demodata (sets, kort, produkter, priser, användare)
npm run dev                     # http://localhost:3000
```

### Allt i Docker

```bash
docker compose --profile full up
```

Bygger och kör appen tillsammans med Postgres och Redis på `http://localhost:3000`.

## Demokonton (efter seed)

| Konto | Lösenord | Roll |
| --- | --- | --- |
| `admin@pokefinds.se` | `admin1234` | SUPERADMIN |
| `demo@pokefinds.se` | `demo1234` | USER |

## Kommandon

| Kommando | Beskrivning |
| --- | --- |
| `npm run dev` | Dev-server på :3000 |
| `npm run build` / `npm start` | Produktionsbygge / -server |
| `npm test` | Enhetstester (Vitest) |
| `npm run test:e2e` | E2E-tester (Playwright, kräver databas + seed) |
| `npm run db:migrate` | Prisma-migrering (dev) |
| `npm run db:seed` | Seeda demodata |
| `npm run db:studio` | Prisma Studio (DB-GUI) |
| `npm run jobs:worker` | Bakgrundsworker (scrape/alerts via BullMQ) |
| `npm run lint` | ESLint |

## Dokumentation

- [docs/SETUP.md](docs/SETUP.md) — detaljerad installation, miljövariabler, felsökning
- [docs/API.md](docs/API.md) — API-referens
- [docs/DATABASE.md](docs/DATABASE.md) — datamodell och konventioner
- [docs/SCRAPERS.md](docs/SCRAPERS.md) — adapter-arkitektur och etikregler för datainsamling
- [docs/SCANNER.md](docs/SCANNER.md) — kortskanning och OCR-adaptrar
- [docs/ADMIN.md](docs/ADMIN.md) — administratörsguide
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — driftsättning
- [docs/TESTING.md](docs/TESTING.md) — testning
- [docs/TODO.md](docs/TODO.md) — kända begränsningar och roadmap

## Viktiga konventioner

- **Priser lagras alltid i öre** (heltal) — aldrig flyttal. Formatera med `formatPrice()` i `src/lib/format.ts`.
- All copy på svenska.
- Inga hårdkodade hemligheter — allt via `.env` (se `.env.example`).
