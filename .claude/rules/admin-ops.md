---
paths:
  - "src/app/admin/**"
  - "src/services/admin/**"
  - "src/lib/ai-pricing.ts"
  - "src/lib/notification-settings.ts"
---
# Adminvyer och kostnadsredovisning

- **KOSTNAD PER ANVÄNDARE OCH FUNKTION I ADMIN (2026-08-14)**: `/admin/anvandare` visar kostnad per
  användare, och en ny detaljsida `/admin/anvandare/[id]` bryter ner den per funktion tillsammans
  med hela profilen (notisinställningar, enheter, kopplingar, aktivitet). Beloppet = leverantörens
  publicerade pris per MTok (`src/lib/ai-pricing.ts`) × API:ts EGNA tokental, aldrig en schablon.
  ⛔ **TRE UTFALL, ALDRIG TVÅ** — varje jobbrad är KOSTNADSFÖRD, GRATIS (`costModel: null`, dvs
  bilden/streckkoden avgjorde och inget API-anrop gjordes) eller **OMÄTT** (avtrycket saknas helt:
  allt före 2026-08-14, plus modeller utan pris). Slås GRATIS och OMÄTT ihop ser en tung användare
  gratis ut — precis fel håll för en kostnadsvy — så "omätta" visas alltid bredvid beloppet.
  ⛔ **AVTRYCKET SKRIVS FÖR ALLA ANVÄNDARE**, till skillnad från skannerns diagnostik (som är
  admin-only av dataminimeringsskäl). Det är två heltal + ett modellnamn, ingen kortdata. Skrivs på
  ALLA fyra skanningsvägar (`identify`, `identify-gtin`, bulk, `upload`) och i graderingen —
  glöms en väg blir den ett PERMANENT hål, inte bara ett historiskt.
  ⛔ **MODELLNAMNET MÅSTE MED IN I DB:N.** Leverantörsnamnet ("claude") duger inte: samma adapter kör
  Haiku ($1/$5) eller Sonnet ($3/$15) beroende på `precise`, dvs en faktor tre. Därav
  `OcrAdapter.model` och `GradeResult.usage`.
  ⛔ **RÅ SQL I `services/admin/user-costs.ts`** — en admin-rad i `ScannerJob.result` bär konstavtryck
  (~5,6 kB); att hämta hela kolumnen för 25 användare hade dragit megabyte per sidladdning för att
  läsa fyra heltal. Och `->>` skiljer INTE "nyckeln saknas" från "värdet är null", vilket är exakt
  gränsen mellan OMÄTT och GRATIS — därför `jsonb_exists()` som egen kolumn; ta inte bort den.
  ⛔ **`getRatesOre()`, inte `getCachedRatesOre()`**: den synkrona ger FALLBACK-kursen (10,50 kr/USD) i
  en process som inte redan hämtat kursen, och en webbrequest har inte gjort det (mätt: verklig kurs
  9,56). ⛔ **INGA INFRAKOSTNADER FÖRDELAS** — Neon debiteras per VAKEN TID, så den som råkar vara
  först på morgonen "orsakar" hela väckningen. Larm redovisas som ANTAL, inte kronor.
  MÄTT före ship mot riktiga rader: 12 Haiku-skanningar = 46 öre, 3 Gemini-graderingar = 11,38 kr,
  gratis/omätt klassade rätt, okänd modell listad i `unpricedModels`. Prislistan är FÄRSKVARA och
  `AI_PRICE_OVERRIDES` (JSON, env) rättar ett pris utan deploy. **Fakturan är facit** — stämmer de
  inte överens är det tabellen som ska rättas.
- **"SENAST SEDD" ÅKER SNÅLSKJUTS PÅ EN LÄSNING SOM ÄNDÅ SKER (2026-08-14)**: `User.lastSeenAt`
  skrivs BARA i jwt-callbackens stale-gren, som redan hämtat användarraden (var 30:e min per aktiv
  session), och bara när värdet är äldre än `LAST_SEEN_THROTTLE_MS` (15 min). ⛔ En egen ping-endpoint
  per sidladdning hade varit precis det misstag som höll computen vaken dygnet runt 2026-07-07 —
  Neon debiteras per VAKEN TID, minst 300 s per väckning. Följden är att fältet är UNGEFÄRLIGT (upp
  till ~15 min eftersläpning) och att den som bara läser publika ISR-sidor inte syns alls; vyn säger
  därför **"senast sedd"**, aldrig "online nu". ⛔ Fel SVÄLJS (samma regel som sessionsförnyelsen):
  ett statistikfält får inte ge 500 på varje sida för alla inloggade. Kolumnen är OINDEXERAD med
  flit och ligger i GDPR-exporten (det är en uppgift om personen).
  ⛔ **"APPEN INSTALLERAD" BEVISAS AV EN PUSH-TOKEN, OCH FRÅNVARO BEVISAR INGET**: `PushToken` skapas
  bara av `/api/push/subscribe`, som bara kan nås inifrån appen — men en användare kan ha appen och
  ha nekat push. Texten säger därför "Ingen enhet registrerad", aldrig "Ingen app".
- **`notificationSettings` HAR EN LÄSARE, INTE FYRA (2026-08-14)**: `src/lib/notification-settings.ts`.
  Kolumnen lästes med tre handskrivna parsers (notifications.ts, /installningar, adminvyn på väg in)
  och två av dem kände inte ens samma fält — notifications.ts läste bara `email`/`push`, resten även
  `allRestocks`. Defaultvärdena (`email: true`, `push: false`) är PRODUKTBESLUT som speglar
  `@default` i schema.prisma; ändras de på ena stället utan det andra beter sig gamla och nya konton
  olika. Samma sak gjordes med `startOfMonthUtc()` (låg som privat kopia i BÅDE scanner/index.ts och
  grading/index.ts) → nu i `src/lib/utils.ts`: **kvotfönstret måste vara samma gräns i kvoten och i
  kostnadsvyn**, annars visar admin ett annat antal skanningar än kunden ser.
