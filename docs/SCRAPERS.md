# Scraper- och adapterarkitektur

Datainsamlingen är adapterbaserad: varje datakälla implementerar `SourceAdapter` (`src/scrapers/types.ts`) och kan köras, testas och stängas av isolerat.

## Prioritetsordning för datakällor
1. Officiella API:er
2. Partnerfeeds
3. Produktfeeds
4. Tillåten scraping av publika produktsidor
5. Manuell adminimport

## Etiska regler (obligatoriska — inbyggda i `src/scrapers/http.ts`)
- **robots.txt respekteras** (`checkRobotsTxt`) — blockerade paths hämtas aldrig
- **Tydlig user-agent**: `FoilioBot/1.0 (+kontakt: hej@foilio.se)`
- **Delay mellan requests** per host + exponential backoff (1s/2s/4s)
- **Auto-stopp** vid >20 fel i ett jobb
- **Aldrig**: captcha-bypass, inloggning, betalväggar, persondata, aggressiv trafik

## Flöde (`src/scrapers/runner.ts`)
1. `ScrapeJob` skapas (RUNNING)
2. Adapter hämtar produkter → valideras (`validateResult`)
3. Fuzzy-matchning mot interna produkter (`src/scrapers/matching.ts`, Dice-koefficient på bigram + setnummer-boost)
4. `Offer` upsertas — lagerändring OUT_OF_STOCK→IN_STOCK skapar `RestockEvent` + triggar restock-alerts
5. Rå data sparas i `PriceObservation.rawData` (separat från normaliserad data)
6. Dagligt `PriceSnapshot` (min/max/snitt/volym) uppdateras
7. Prisfall under bevakares målpris triggar pris-alerts
8. Jobbet loggas (itemsFound, itemsUpdated, fel, körtid)

## Lägga till en riktig adapter
1. Skapa `src/scrapers/adapters/min-kalla.ts` som implementerar `SourceAdapter`
2. Registrera i adapter-väljaren i `src/scrapers/runner.ts`
3. Lägg till källan i adminpanelen (`/admin/kallor`) med rätt `type`
4. Testa isolerat, kör sedan via "Kör nu" i admin

## Schemaläggning
- Med Redis: BullMQ repeatable jobs (varje 60 min) — kör `npm run jobs:worker`
- Utan Redis: setInterval-fallback i workern, eller extern cron → `POST /api/cron/scrape` med header `x-cron-secret: $CRON_SECRET`

## Mock-adaptern
`src/scrapers/adapters/mock-adapter.ts` genererar simulerad prisdrift (±3 %) och slumpmässiga lagerändringar (~10 %) utifrån befintliga produkter i databasen. Används för utveckling/demo.
