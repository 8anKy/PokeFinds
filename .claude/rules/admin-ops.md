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
- **ÖVERSIKTEN ÄR NYCKELTALSSIDAN (2026-08-26)**: `/admin` visar tillväxt, tratt, aktivitet,
  betalande kunder vid NAMN, inbjudningsgrafen (vem bjöd in vem) och räckvidd.
  `src/services/admin/overview.ts` hämtar allt i ETT `$transaction` + tre `date_trunc`-frågor.
  ⛔ **En fråga per siffra är förbjudet** — Neon debiteras per VAKEN TID (minst 300 s per väckning),
  och sidan är `force-dynamic`. ⛔ **`count(distinct "userId")` i rå SQL, aldrig
  `groupBy(["userId"]).length`** — det senare drar hela grupplistan till Node (2 615 skannerrader för
  att få fram talet 55).
- **⛔ "BETALANDE" HAR EN DEFINITION, `payingUserWhere()` i `src/lib/plan.ts` (2026-08-26)**. Den är
  INTE `proUserWhere()`: den frågan är "vem ska få förmånen" (admins, referral-bonus, allt), den här
  är "vem genererar en krona". **STAFF RÄKNAS ALDRIG, ÄVEN NÄR planTier SÄGER PREMIUM** — ägarens
  eget konto blåste upp MRR:en med 49 kr/mån ren bokföringsfiktion (mätt: 5 "betalande" varav 3 egna
  konton → 245 kr redovisat mot 98 kr verkligt). Rollen kan inte gå ut och är därför en pålitlig
  grind; planTier ägs av RevenueCat. ⛔ **En sandbox-prenumeration går INTE att se i databasen** —
  samma planTier, samma webhook-väg, bara daglig förnyelse i stället för månatlig, och att gissa på
  takten börjar tyst räkna bort riktiga kunder. Därför listas varje betalande konto vid NAMN:
  **tabellen är facit, siffran är en sammanfattning.**
- **⛔ EN BETALANDE KUND MED NOLL BEVAKNINGAR ÄR ETT LARM, INTE EN SIFFRA (2026-08-26)**. Båda
  kunderna som köpte i augusti hade 0 bevakningar, 0 set-bevakningar och 0 larm — de betalade för
  något de aldrig använt, och ingen siffra i den gamla översikten visade det. Kolumnen färgas och
  kortet bär en räknare. Tratten (`Konton → Verifierad → Skannat → Samling → Bevakar → Betalar`) är
  **ingen rangordning**: stegen är samma resa men garanterat monotona är de inte, och att understa
  stapeln inte är smalast av rätt skäl är precis vad vyn ska avslöja.
- **DIAGRAM: PALETTEN ÄR VALIDERAD, INTE VALD (2026-08-26)**:
  `src/components/features/admin/chart-palette.ts`. `#13a99b, #8b5cf6, #c2820a, #d4488a` klarar alla
  sex kontrollerna mot ren svart yta (sämsta granne deutan ΔE 14,2 · normalseende ΔE 21,3).
  ⛔ **Inte `holo.cyan` (#2dd4bf) som första färg**: turkos i den ljusstyrkan ligger på OKLCH L≈0,79
  och faller utanför bandet 0,48–0,67 ihop med violett/guld/rosa — serierna blir jämnljusa och skiljs
  bara på kulör, vilket är exakt det en färgblind läsare inte kan. Prisgrafen behåller
  varumärkesturkosen: EN serie, ingen separationsfråga. ⛔ **Färg följer entiteten, aldrig ordningen**
  (`seriesColor(key)`) — plockas färg på index målas kvarvarande serier om när en filtreras bort.
  ⛔ **Aldrig två y-axlar**: "nya per dag" och "totalt" är två LÄGEN i samma graf, inte två skalor.
  ⛔ `fillDays()` måste fylla tomma dygn med nollor — Postgres returnerar bara dygn som HAR rader, och
  recharts drar annars en rak linje genom en tyst vecka. ⛔ **Hover och klick är TVÅ tillstånd** i
  tratten: med ett enda `active` hann `onMouseEnter` slå på steget innan klicket kom fram, så klicket
  stängde av det igen och på datormus hände ingenting. ⚠️ recharts kör en ~1,5 s enter-animation —
  läser du DOM:en direkt efter ett filterklick ser staplarna ut att saknas.
