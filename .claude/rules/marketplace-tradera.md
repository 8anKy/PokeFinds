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
