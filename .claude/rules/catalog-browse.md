---
paths:
  - "src/services/products.ts"
  - "src/services/ranking.ts"
  - "src/services/explore-facets.ts"
  - "src/lib/card-number-order.ts"
  - "src/lib/user-preferences.ts"
  - "src/app/produkter/**"
  - "src/app/sets/**"
  - "src/jobs/rank-refresh.ts"
---
# Katalogvisning: rankning, sortering och sökning

- **"BÄST MATCHNING" = RELEVANS × KVALITET + DINA EGNA DATA (2026-07-29)**: katalogens standardsortering. "Mest
  populär" (ren 30-dagars engagemangsvolym) är BORTA ur filtret; volymen finns kvar som en INGREDIENS. Formen är
  branschens (eBay Best Match, Etsy, A9): hämta kandidater → poängsätt → efterjustera. Skillnaden är att de lär
  vikterna ur miljontals klick — MÄTT HÄR 2026-07-29: 4 användare, 8 sök-klick och 754 visningar på 30 dygn, 615 av
  22 457 produkter med någon händelse alls. ⛔ **Bygg därför ingen inlärd/klickbaserad rankning** förrän den datan
  finns; den hade anpassat sig till brus. Vikterna är handsatta och bor i EN ren, testad modul
  (`src/services/ranking.ts`) som både dygnsjobbet och sökvägen använder — ändra formeln där, ingen annanstans.
  **Kvalitet** (engagemang, bevakare, KÖPBAR nu, butiksbredd, bild, pris, setets färskhet) skrivs till
  `Product.rankScore` av `src/jobs/rank-refresh.ts` i scrape-all, EFTER `refreshPopularityScores()` (den fyller
  `viewCount`, som är en ingrediens). Egen kolumn därför att feeden pagineras i SQL — samma skäl som
  `Card.numberSortKey`. **Relevans** räknas i minnet över topp-`MAX_CANDIDATES` och belönar exakt titel/kortnamn och
  kortnummer i frågan; setnamnsträffar TRYCKS NED (samma fälla som setfiltret: setnamn är delsträngar av kortnamn).
  **Personligt** = bara dina egna bevakningar + samling (`analytics.ts` strippar userId med flit — ingen
  beteendelogg per användare finns eller ska byggas för det här).
  ⛔ **En OFILTRERAD katalog personaliseras INTE**: den vägen räknar i minnet och ser bara 500 rader, så
  "22 233 produkter" hade blivit 500 för varje inloggad besökare och den oändliga scrollen tagit slut där.
  Personligt lyft gäller när träffmängden ryms i fönstret (valt set/kategori) eller vid sökning. Personaliserade
  svar går dessutom FÖRBI `cachedRead`/CDN — annars ligger en användares ordning kvar i en delad cache.
- **"NYLIGEN TILLAGD" ÄR ADMIN-ONLY, OCH GRINDEN SITTER PÅ TRE STÄLLEN (2026-08-13)**: sorteringen
  ordnar katalogen på `Product.createdAt` (nyast först) och finns för att kunna granska vad en
  butiksvåg drog in. Alla tre grindarna behövs: (1) menyn i `/produkter` byggs ur en filtrerad
  lista så alternativet aldrig når klienten, (2) sorterings**uppslaget** i samma fil — annars gäller
  `?sortera=nyligen-tillagd` för alla som gissar eller får länken delad, (3) **feed-routen**, som
  levererar ALLT utom första sidan (infinite scroll). Punkt 3 är den som ser redundant ut och tas
  bort; utan den räcker det att scrolla en sida. Sidan är `force-dynamic` och läser redan sessionen,
  så grinden kostar ingen extra DB-fråga och rör inte de ISR-cachade sidorna.
  ⛔ **`createdAt`, ALDRIG `updatedAt`** — den senare rörs av varje prisuppdatering, så sorteringen
  hade blivit "nyligen prisändrad", dvs katalogen i nästan slumpmässig ordning, och felet syns inte
  förrän man jämför mot databasen. ⛔ **DB-sorterad** (i `DB_SORTABLE`): den beräknade vägen tar bara
  `MAX_CANDIDATES` rader valda på `updatedAt` — exakt fel urval för just den frågan.
  ⛔ **Aldrig i den delade CDN-cachen**: `jsonCached` nycklar på URL:en, så adminens riktiga svar
  och den tomma listan hade delat post. Kolumnen lämnas OINDEXERAD med flit (mätt mot prod: 59 ms
  över hela katalogen; en handkörd prod-migration är dyrare än så för en vy som körs sällan).
  Vaktat av `tests/unit/admin-sort-gate-sync.test.ts`.
- **FUZZY SÖK = RÄDDNING, INTE FÖRBÄTTRING (2026-07-29)**: `pg_trgm` (migration 20260729180000) används BARA när den
  exakta ordsökningen ger NOLL träffar. Påslaget för lyckade sökningar hade "charizard" dragit in "charmander"
  (likhet ~0,35). Reserven är en UNION av två mått, för de missar olika saker (mätt): `similarity()` (hela titeln)
  hittar "pikatchu" men inte "prismatik" i en lång titel; `word_similarity()` (bästa ordföljd) tvärtom. GIN-indexet
  på `normalizedTitle` gör dessutom att den vanliga delsträngssökningen slipper seq-scanna 22k rader.
- **A–Ö/Ö–A SORTERAS PÅ `normalizedTitle`** (inte `title`): den är redan gemener utan diakriter (`[a-z0-9 /-]`) och
  indexerad, så ordningen blir densamma i databasens C.UTF-8-collation som i JS — och sorteringen paginerar över hela
  katalogen i SQL. Mätt före bygget: bara 186 av 22 457 titlar börjar på "pokemon", så listan klumpar inte ihop sig.
  In-memory-vägen jämför med rak kodpunktsjämförelse, ALDRIG `localeCompare` (annan ordning än databasens).
- **Kortnummer-sortering = GENERERAD KOLUMN, inte app-logik (2026-07-28)**: `Card.number` är TEXT ("93", "TG28",
  "143a", "MEP 074", "A"), så en rak sortering ger 1, 10, 100, 101, 102, 11 — inte pärmordning. `/produkter`
  pagineras i SQL, så ordningen MÅSTE finnas i databasen; att sortera i minnet hade bara sorterat den sida vi råkat
  hämta (den beräknade vägen tar bara `MAX_CANDIDATES`=500 senast uppdaterade). Nyckeln `Card.numberSortKey` är
  därför `GENERATED ALWAYS ... STORED` (migration 20260728210000): **Postgres äger den**, för en kolumn som varje
  import måste minnas att fylla i är en vakt som failar öppet — nya kort hade sorterats fel, tyst. Formen är
  `[prefix 4][tal 7][suffix 3]` och utfyllnaden är `'0'`, ALDRIG mellanslag (mellanslag är ignorerbara i icke-C-
  collation → olika ordning i olika miljöer; siffror < bokstäver i både C och en_US, vilket ger huvudnumreringen
  före delserierna). `src/lib/card-number-order.ts` är samma ordning i JS för redan hämtat data (setsidan);
  testet jämför dem parvis, och båda verifierades mot ALLA 20 563 kort i prod (0 avvikelser). Sealed (utan kort)
  ligger sist i BÅDA riktningarna via `nulls: "last"`; Unowns alfabet (A–Z, "!", "?") sorteras alfabetiskt efter
  setets numrerade kort. **Setsidan sorterar KLIENT-SIDA** (`set-product-grid.tsx`) — den är ISR-cachad och får
  inte läsa searchParams, se Caching/ISR.
- **SET-FILTRET: EN RUBRIK PER SERIE, DATUMLÖSA SET SIST (2026-07-29)**: set-sheeten grupperade på LÖPANDE serie, och
  eftersom listan är sorterad på releaseDate ligger promo-/POP-set inklämda mitt bland huvudserierna (SWSH Black Star
  Promos 2022-08-03 mellan två Sword & Shield-set) → 65 rubriker för 17 serier, "Sword & Shield" nio gånger. Det LÄSTE
  som att seten låg i fel serie. Grupperingen är nu en `Map` (samma som /sets-sidan): serieordning = där seriens nyaste
  set ligger, nyast först inuti serien. Och `orderBy` är `{ releaseDate: { sort: "desc", nulls: "last" } }` — Postgres
  lägger NULL FÖRST vid DESC, så ett datumlöst set (MEP Black Star Promos) låg överst som om det vore nyast.
- **ONBOARDINGENS FAVORITSET ÄR EN RANKNINGSSIGNAL, INTE EN ENKÄT (2026-08-06)**: `preferences.favoriteSets` skrevs
  av `/api/users/me/onboarding` och lästes ALDRIG av någon kod — steget bad om något vi kastade. De adderas nu till
  samma `affinitySetIds` som bevakningar och samling bygger (`loadPersonalContextUncached`, `services/products.ts`).
  ⛔ Ingen egen vikt: ett kryss vid registreringen säger inte mer eller mindre än en bevakning, och att kalibrera
  två vikter mot varandra kräver underlag vi inte har (mätt 2026-07-29: 4 användare, 8 sökklick/30 dygn).
  ⛔ `preferences` är otypad JSON skriven av flera versioner av onboardingen → `favoriteSetIds()`
  (`src/lib/user-preferences.ts`) kastar aldrig; en trasig rad hade annars sänkt HELA katalogfeeden för just den
  användaren, bara för inloggade, bara i produktion. ⚠️ Lyftet syns vid SÖKNING och i FILTRERADE vyer — en
  ofiltrerad katalog personaliseras inte (`MAX_CANDIDATES`, se "Bäst matchning"). Setvalet visar setlogotyper
  (samma bricka som setfiltret och "Bevakade set"), och det finns ingen väg att ändra valet efteråt.
