# PokeFinds — Användarguide

Den här guiden visar hur du startar, testar och använder PokeFinds lokalt — funktion för funktion.

---

## 1. Starta webbplatsen

PostgreSQL körs redan som Windows-tjänst (`postgresql-x64-18`) — ingen Docker behövs.

```bash
npm install                # vid peer-konflikt: npm install --legacy-peer-deps
npx prisma migrate dev     # skapar/uppdaterar databastabellerna
npx prisma db seed         # fyller databasen med data
npm run dev                # startar dev-servern
```

Öppna **http://localhost:3000** i webbläsaren.

> **Riktig kortdata:** kör `npm run import:tcg` efter seed för att hämta riktiga set, kort, bilder och marknadspriser från det officiella Pokémon TCG-API:et.

### Demo-konton (skapas av seed)

| Konto | E-post | Lösenord | Roll |
|---|---|---|---|
| Admin | admin@pokefinds.se | admin1234 | SUPERADMIN |
| Demo | demo@pokefinds.se | demo1234 | USER |

---

## 2. Sidöversikt

### Öppna sidor (utan inloggning)

| Sida | URL | Vad den gör |
|---|---|---|
| Startsida | `/` | Marknadssnapshot, intro till tjänsten |
| Utforska produkter | `/produkter` | Katalog med sök och filter (set, typ, pris) |
| Produktsida | `/produkter/[slug]` | Prishistorik, erbjudanden per butik, lagerstatus |
| Set | `/sets` | Alla kortset med releasedatum |
| Marknad | `/marknad` | Trender: största prisrörelser, mest bevakat |
| Community | `/community` | Inlägg från samlare (läsläge utan konto) |
| Priser | `/priser` | Prisplaner |
| Logga in / Registrera | `/logga-in`, `/registrera` | Auth |

### Inloggade sidor

| Sida | URL | Vad den gör |
|---|---|---|
| Översikt | `/dashboard` | Din samlings värde, aktiva bevakningar, senaste alerts |
| Bevakningar | `/bevakningar` | Dina prisbevakningar och restock-alerts |
| Min samling | `/samling` | Lägg till kort/produkter, se totalvärde och utveckling |
| Skanna kort | `/skanna` | Ladda upp kortbild → identifiering (mock-OCR i dev) |
| Inställningar | `/installningar` | Profil, notiser, dataexport (GDPR), radera konto |
| Adminpanel | `/admin` | Endast admin: användare, källor, moderering, jobb |

---

## 3. Testa varje funktion (steg för steg)

### Registrering & inloggning
1. Gå till `/registrera`, skapa ett konto (e-postverifiering loggas i terminalen — `EMAIL_MODE=console`).
2. Logga in på `/logga-in`. Glömt lösenord-flödet skickar länk till terminalen.

### Prisbevakning
1. Logga in som demo-kontot.
2. Gå till `/produkter`, öppna valfri produkt.
3. Klicka **Bevaka** och sätt ett målpris (t.ex. under nuvarande lägsta pris).
4. Se bevakningen under `/bevakningar`. När priset går under målet skapas en notis (klockan uppe till höger).

### Restock-alerts
1. På en produktsida som är slutsåld, välj bevakning av lagerstatus.
2. Restock-händelser från datakällorna triggar notiser + (i dev) e-post i terminalen.

### Min samling
1. Gå till `/samling` → **Lägg till**.
2. Sök upp ett kort/en produkt, ange antal och skick (NM/LP osv.).
3. Totalvärdet beräknas från senaste marknadspriser och visas på `/dashboard`.

### Kortskanning
1. Gå till `/skanna`, ladda upp en bild (vilken bild som helst funkar i dev — mock-OCR svarar med ett matchat kort).
2. Bekräfta matchningen → kortet kan läggas till i samlingen.
3. Riktig OCR kopplas via `OCR_PROVIDER` i `.env` (se `docs/SCANNER.md`).

### Community
1. Gå till `/community` → skapa inlägg (kräver inloggning).
2. Gilla, kommentera, spara och rapportera inlägg.
3. Rapporter hamnar i adminpanelens modereringskö.

### Marknadsdata
- `/marknad` visar största prisrörelser (upp/ner), mest bevakade produkter och settrender.
- Prisgrafer på produktsidor visar historik från `PriceObservation`/`PriceSnapshot`.

### Adminpanel (logga in som admin@pokefinds.se)
1. `/admin` — översikt: användare, jobb, rapporter.
2. **Användare**: ändra roller, stäng av konton.
3. **Datakällor**: se scrape-källor, robots.txt-status, kör jobb manuellt.
4. **Moderering**: hantera rapporterade inlägg.

### GDPR-funktioner
- `/installningar` → **Exportera min data** (JSON-fil) och **Radera konto** (raderar all persondata).
- Cookie-bannern på första besöket styr analytics-samtycke.

---

## 4. Så fungerar systemet (kort)

- **Priser** lagras alltid i **öre** (heltal) och formateras med `formatPrice()`.
- **Datakällor** hämtas via adapter-mönstret i `src/scrapers/` — alla adapters respekterar robots.txt, rate limits och identifierar sig som `PokeFindsBot/1.0`. Ingen captcha-/login-bypass.
- **Kortdata & bilder** kommer från det officiella Pokémon TCG-API:et (api.pokemontcg.io).
- **Notiser**: prisfall/restock skapar `Notification` (in-app) + e-post (terminal i dev).
- **Bakgrundsjobb** körs via BullMQ om Redis finns, annars in-memory fallback — Redis är valfritt.
- **Roller**: USER → MODERATOR → ADMIN → SUPERADMIN. Adminpanelen kräver minst ADMIN.

---

## 5. Tester

```bash
npm test           # 71 enhetstester (vitest)
npm run test:e2e   # Playwright end-to-end (kräver seedad DB + körande dev-server)
```

---

## 6. Felsökning

| Problem | Lösning |
|---|---|
| `npm install` failar på peer deps | `npm install --legacy-peer-deps` |
| DB-anslutning failar | Kontrollera att tjänsten `postgresql-x64-18` körs; `DATABASE_URL` i `.env` |
| Inga e-postmeddelanden syns | De loggas i terminalen (`EMAIL_MODE=console`) |
| Kortbilder saknas | Kör `npm run import:tcg` (kräver internet) |
| Redis-varning i loggen | Ofarligt — appen kör in-memory fallback |

Mer dokumentation finns i `docs/`: API.md, DATABASE.md, SCRAPERS.md, SCANNER.md, ADMIN.md, TESTING.md, DEPLOYMENT.md.
