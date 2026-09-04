---
paths:
  - "src/scrapers/tradera*"
  - "src/jobs/tradera-*.ts"
  - "scripts/tradera-*.ts"
  - "src/services/deal-verify/**"
---
# Tradera: skena, sålt-serien och verifiering

- **"TRADERA · SÅLT" ÄR EN EGEN SERIE — BETALT, INTE BEGÄRT (2026-08-06, OMBYGGD 2026-08-12)**: prisgrafen ritar
  genomförda Tradera-affärer vid sidan av annonskurvan (`src/jobs/tradera-sold-sweep.ts`, källa
  `TRADERA_SOLD_SOURCE_NAME` = "Tradera sålt").
  ⛔ **SVEPET HADE ALDRIG KÖRTS FÖRE 2026-08-12**: det låg som FJÄRDE `workflow_run`-led i nattkedjan, och
  **GitHub fyrar högst TRE led från roten** — länk 4 fyrar ALDRIG, helt tyst (0 körningar någonsin; led 3 körde
  varje natt). All sålt-data var 08-06-seedens 566 affärer. Svepet är nu ett STEG sist i `tradera-sold-sync.yml`
  (`!cancelled()` — synkfel får inte svälja svepet); `tradera-sold-sweep.yml` är enbart manuell/backfill och
  `cron-chain-sync.test.ts` vaktar att ingen lägger tillbaka länk 4. **Nya nattjobb blir STEG i ett befintligt
  led, aldrig en fjärde länk.**
  **TVÅ BEVISVÄGAR (2026-08-12)**: (1) auktion med bud bär vinnande budet i `MaxBid` — direkt ur sök-svaret,
  som förut. (2) **Köp nu/butiksannonser bevisas via `PublicService.GetItem`**: i SÖK-svaret är såld och utgången
  `PureBuyItNow` identiska (`HasBids=false`, `BuyItNowPrice == MaxBid`, mätt 2 109 av 2 768), men GetItem svarar
  `GotWinner=true` + `RemainingQuantity=0` för sålda och `GotWinner=false` för utgångna (verifierat mot Traderas
  egen "Sålda"-filtrering). Pris: `TotalBids>0` ⇒ `MaxBid` (ett accepterat bud kan ligga UNDER utropet — mätt:
  BIN 250 kr, betalt 198), annars `BuyItNowPrice`. GetItem görs SIST i vaktkedjan (efter match + kategori +
  prisvakt) så kvoten (10k/dygn/metod, tak `TRADERA_SOLD_GETITEM_MAX` 2500) bara går till blivande grafpunkter.
  ⛔ **INGA SÖKORD** (`SearchWords` tomt): kategorierna ÄR Pokémon-scopade och ordet "pokemon" gömde 2/3 av
  annonserna (118 543 mot 346 023 avslutade i singel-kategorin — "Mega Darkrai ex 120/084" bär inte ordet).
  **DJUPET ÄR TIDSSTYRT** (`TRADERA_SOLD_LOOKBACK_DAYS` 3, sidtak 200): singlar avslutar ~8 900/dygn ≈ 178
  sidor — gamla "10 sidor/kategori" såg 500 av dem. ⚠️ API:t SERVERAR bara ~200 sidor per fråga oavsett
  `TotalNumberOfItems` (sida 300 = tomt, mätt) — längre backfill kräver prisband, inte fler sidor.
  ⛔ Pagineringen bryter på RÅA radantalet (`rawRows`), aldrig på filtrerad längd — en sida full av
  bortfiltrerade rader är inte en tom sida. **Dry-run-facit** (2,4 h-fönster): 46 affärer på 37 produkter,
  23 budbevisade + 23 GetItem-bevisade, 17 korrekt avvisade som utgångna.
  ⛔ **ERSÄTTER INTE ANNONSKURVAN** (ägarbeslut, mätt före bygget): annonskurvan täcker 19 561 produkter på
  30 dygn (17 134 med fler än en punkt), sålt några hundra och nästan bara hett sealed — ett byte hade tömt
  Tradera-kurvan för ~9 av 10 produkter som har en. Och storheterna är olika: hammarpris är vad någon BETALADE,
  Cardmarket-serien vad någon BEGÄR; i samma kurva blir det samma skarv som trend/golv.
  ⛔ **SÅLT BUCKETAS SOM DAGENS MEDIAN, inte dagens lägsta.** Det är samma regel på en annan storhet: annonser
  samma dag beskriver SAMMA sak (vad varan kostar nu) och den billigaste är svaret; försäljningar samma dag är
  OLIKA affärer, alla lika sanna, och den billigaste hade ritat "vad det gick att fynda för". Underrubriken
  (`historyQuality`) säger därför inte längre "dagens lägsta per källa".
  ⛔ Ingen `fillForward` — en försäljning är en HÄNDELSE, inte ett tillstånd. ⛔ Skriver ALDRIG en `Offer`: en såld
  annons går inte att köpa, och länk + karusell ("Fler annonser på Tradera") kommer fortsatt från det aktiva
  svepet. ⛔ **IDEMPOTENT PÅ `itemId`**: ended-sökningen når ~39 dygn bak, så en daglig körning ser samma affär om
  och om igen; dedup-fönstret och urvalsfönstret är SAMMA konstant (`SOLD_WINDOW_DAYS`) — glider de isär skrivs
  gamla affärer in på nytt och dagens median blir fel. `observedAt` = affärens EGEN sluttid, aldrig körningens.
  Chipsen heter "Tradera · annons" och "Tradera · sålt" (ett ensamt "Tradera" blev tvetydigt med två serier).
  Seedat 2026-08-06: 566 affärer på 259 produkter. Täckningsmätning = `scripts/tradera-sold-probe.ts`.
- **TRADERA-SKENAN: RÄDDNINGSSIDOR MOT SYSKONSKUGGA (2026-08-12)**: Fas 0 i `tradera-sweep.ts` läste bara
  SIDA 1 (50 träffar, PriceAscending) av produktens namn-sökning. För ett dyrt kort med ett billigt namnsyskon
  fylls sida 1 helt av syskonet — MÄTT på Mega Darkrai ex 120/084: sökningen träffar 68 annonser men sida 1 är
  bara 15–37 kr-exemplar av 048/084, `pickRailCandidates` avvisar korrekt alla 50 ⇒ produkten stod utan både
  skena och offer fast annonserna fanns (guldkortets låg på sida 2). Nu läses nästa sida när en sida ger NOLL
  kandidater, upp till `TRADERA_HOT_MAX_PAGES` (4) ur en delad extra-budget (`TRADERA_HOT_EXTRA_PAGES` 1500,
  håller Fas 0 under metodkvoten 10k/dygn). Första sidan MED kandidater räcker — sorteringen är PriceAscending,
  så billigare träffar finns inte längre fram.
- **Tradera-annonsens kortnummer måste vara produktens** (`matching.ts`): `cardNumberKey` behåller bokstavsSUFFIX (`115a` ≠ `115` — league-promo vs uncommon) och `bareCardNumbers` fångar nummer utan "/total" ("Milotic ex 42" får inte hamna på specialarten 217). Konservativ: setnamnet 151, "annons 2", mängd/pris och årtal filtreras bort. 707 gamla felmatchningar städade 2026-07-25 — alla bevisade (numret fanns som eget kort i samma set)
- ⛔ **`GetSellerItems` (PublicService) FILTRERAR INTE PÅ `categoryId` — ETT KATEGORI-ID GER TOMT SVAR** (mätt
  2026-09-03: en säljare vars annons bevisligen låg i 1001337 gav 0 rader för `categoryId=1001337`, men hela
  lagret på 260 rader med rätt `CategoryId` per rad för `categoryId=0`). Skicka ALLTID 0 och filtrera i koden
  (`isPokemonListingCategory` i svepet, `TRADERA_POKEMON_CATEGORY_IDS` i profil-libben). **Svaret är dessutom
  `ArrayOfItem` = `<Item>…</Item>`, inte SearchService-formen `<Items>…</Items>`, OCH `filterItemType=PureBuyItNow`
  TAPPAR BUTIKERNAS FASTPRIS — de är `ShopItem`** (toppsäljaren 2026-09-03: 4 745 aktiva Pokémon-annonser, 4 735
  ShopItem, 10 PureBuyItNow; PureBuyItNow-kuvertet gav 48 kB, All gav 18 MB). Svepets Fas 2 gjorde alla TRE felen
  och loggade "+0 nya" varje natt tills 2026-09-03 (100 anrop, 25 säljare, noll rader, tyst). Nu ett anrop per
  säljare (top 100) med `All`, kuvertet byggs av `buildGetSellerItemsBody`, parsern tål båda blockformerna, läser
  `Status/Ended` och bud via `TotalBids` (PublicService har varken `IsEnded` eller `HasBids`). ⛔ **Poolen är
  BUDGETSTYRD**: varje pool-annons kostar 2–4 Neon-frågor i matchningen (~4/s) och jobbet har 60 min, en butik
  kan ge 4 700 rader — `TRADERA_SELLER_ITEM_CAP` (1000/säljare) + `TRADERA_SELLER_POOL_BUDGET` (4000 totalt),
  höj först när körtiden är mätt i sweep-loggen. Sond: `scripts/tradera-seller-items-probe.ts` (2 Tradera-anrop,
  noll Neon). Vaktat av `tests/unit/tradera-sweep-seller-items.test.ts`.
- ⛔ **GRADERADE KORT ÄR EN EGEN VARA, EN EGEN TABELL OCH EN EGEN VAKT (2026-09-04)** — en PSA 10 och det
  ograderade kortet delar namn men inte pris, och de får ALDRIG dela kurva. Domen tas på ANNONSEN
  (`isGradedListing` / `detectGrading`, `src/lib/graded-listing.ts`), aldrig på Tradera-kategorin: säljaren
  väljer kategori, och **~1 % av annonserna i 1001337 (Löskort) är i själva verket slabbar** (mätt över 100
  annonser). Kategorin 1001338 säger alltså "leta här", inte "det här är graderat".
  **VAD SOM VAR TRASIGT**: `guessCategory` STÄMPLADE psa/bgs/cgc-titlar som `GRADED_CARD` — men ingen
  matchningsväg läste stämpeln, så den var ingen vakt. MÄTT I PROD 2026-09-04: **14 aktiva offers, 78
  skena-rader och 569 prisobservationer** låg på RÅA produkter, bl.a. en **CGC 6 för 30 000 kr som "lägsta
  pris"** på ett löskort och en RaukCard 10 för 2 400 kr på en Umbreon VMAX. Städat med
  `scripts/purge-graded-from-raw.ts` (dry run som default); de **80 SÅLDA** raderna KASTADES INTE utan
  FLYTTADES till `GradedSale` — det är vår egen insamlade data som bytte låda, inte en backfill.
  ⛔ **VAKTEN SITTER I PARSERN** (`parseItemsFromXml` i tradera-sweep, `toRaws` i adaptern), inte i
  matchningen — då täcker en rad alla tre vägarna (Fas 0, poolmatchningen, skenan). Sålt-svepet plockar upp
  samma annonser och skriver dem i `GradedSale` i stället.
  ⛔ **TRADERA BÄR STRUKTURERADE ATTRIBUT** — `pokemon_grading_issuer` / `pokemon_grade` /
  `pokemon_language` / `pokemon_era` som `TermAttributeValue` i sök-svaret (täckning mätt i 1001338: bolag
  83 %, betyg 77 %, båda 76 %). Läs dem FÖRE titeln. Vokabulären är PSA / CGC / Raukcard / ACE / Beckett /
  **Övriga** — SGC, TAG, HGA och GMA finns alltså inte som egna värden, så bolagsnamnet måste hämtas ur
  titeln när attributet säger "Övriga".
  ⛔ **ASPIRATIONSSPRÅK ÄR INTE EN GRADERING**: "PSA10 Kandidat", "möjligen psa 10", "perfekt for psa 1"
  (Tradera KAPAR slugen mitt i "psa-10") är OGRADERADE kort. Utan vetot raderar städningen riktiga råa
  priser — det hände i dry run och fångades bara för att listan lästes rad för rad.
  ⛔ **DEN RÅA PRISVAKTEN FÅR INTE RÖRA GRADERADE AFFÄRER**: `isPlausiblePriceFor` fäller en singel över
  4× referensen, dvs. exakt de affärer serien finns för. Graderat har BARA en undre gräns
  (`isPlausibleGradedPriceOre`, 15 % av CM-referensen) som fångar felmatchning.
  ⛔ **`gradeTenths` ÄR HELTAL** (100 = 10,0 · 95 = 9,5), aldrig float och aldrig sträng — "10" sorterar
  före "9" och skulle vända hela skalan. `null` = graderat men okänt betyg, visas "–", aldrig 0.
  ⛔ **`n` FÖLJER ALLTID MED UT I UI:t**: kategorin avslutar bara ~128 annonser/dygn för HELA Sverige mot
  ~20 000 singlar i katalogen, så de flesta kort landar på 0–2 affärer. Ett medianpris utan sitt urval
  låtsas vara en marknad. Tomt underlag ⇒ sektionen visas inte alls.
  Mät om med `scripts/audit-tradera-graded.ts` (kategorins innehåll) och `scripts/audit-tradera-graded-leak.ts`
  (hur mycket som ligger i råa kategorier). Vaktat av `tests/unit/graded-listing.test.ts` (tvåsidigt).
