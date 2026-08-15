---
paths:
  - "scripts/apply-owner-*.ts"
  - "scripts/lib/owner-decisions.ts"
  - "scripts/merge-*.ts"
  - "scripts/dedupe-catalog.ts"
  - "scripts/purge-denylisted-products.ts"
  - "scripts/undeny-listing-url.ts"
  - "scripts/adopt-cm-names.ts"
  - "src/lib/offer-source.ts"
  - "src/jobs/adopt-cm-name.ts"
  - "scripts/set-from-cm-episode.ts"
  - "scripts/import-sealed-from-cardmarket.ts"
  - "scripts/import-tcg-data.ts"
  - ".github/workflows/import-new-sets.yml"
---
# Katalogstädning: ägarbeslut, mergar och denylist

- **ÄGARENS BESLUTSFIL: LÄNKAR IN, MERGAR UT (2026-08-13)**: ägaren går igenom katalogen och
  skriver sitt EGET format — `Duplicates` / länkar / `Go to` / länk, tomrad mellan grupper,
  `Delete`-rubrik för raderingar. `scripts/apply-owner-decisions.ts` läser filen; parsern bor i
  `scripts/lib/owner-decisions.ts` med 25 tester, för det är TOLKNINGEN som avgör vilken produkt
  som överlever. Torrkörning som default, och den skriver ut produkternas RIKTIGA titlar — en
  felklistrad länk syns bara om man ser vad den faktiskt pekar på.
  ⛔ **FLERA LÄNKAR PER RAD MÅSTE LÄSAS ALLA**: ägaren skriver "These &lt;A&gt; &lt;B&gt;", och en parser som
  tog den första hade TYST lämnat kvar B som en dubblett ingen visste fanns. Tyst bortfall är det
  farligaste utfallet här. ⛔ `go(?:es)?\s*to`, INTE `goes?` — det senare betyder "goe" med valfritt
  "s" och matchar aldrig "Go to", vilket är just vad ägaren skriver; MÅLET hamnade då i bort-listan.
  ⛔ **EN UPPREPNING ÄR INTE ALLTID ETT FEL**: samma URL två gånger i raderingslistan är harmlöst och
  dedupliceras. Det som fälls är motstridiga ROLLER — mål på ett ställe och bortplockad på ett annat,
  eller bortplockad i två olika mergar (vilket mål gäller?).
  ⛔ **HERRELÖSA URL:er ÄR HUVUDFÄLLAN, OCH DEN GÄLLER MERGAR OCKSÅ.** `Offer` är unik på (produkt,
  butik, skick, språk), så en stubs offer som krockar med målets RADERAS av `mergeStubInto` — URL:en
  blir herrelös och auto-importen skapar om stubben inom minuter (mätt 2026-07-14: tre stubbar
  återuppstod efter sju minuter). Efter titeltvätten är det värre: URL:en matchar numera MÅLET och
  skriver över dess offer varje körning, så länk och pris VÄXLAR mellan listningarna. MÄTT: 166 av
  wave 5:s 172 momsmergar drabbas. Ordningen är därför `--write-denylist` → commit + push → `--apply`,
  och raderingar VÄGRAR köra innan URL:en är nekad.
  ⛔ **BARA BUTIKS-OFFERS FLYTTAS (ägarbeslut 2026-08-13)**: `mergeStubInto` RADERAR stubbens
  Cardmarket-/Tradera-/CardTrader-offers i stället för att flytta dem (`NON_STORE_RETAILERS`,
  `src/lib/offer-source.ts`). Skälet är IDENTITET, inte pris: en butiks-offer är ett faktum om en
  URL, en marknadsplats-offer ett PÅSTÅENDE våra egna jobb fuzzy-matchat fram. Kanonprodukten har
  redan sin granskade länk; stubbens är ogranskad, och en överflyttning kan tyst ersätta ett rätt
  `idProduct` med ett fel — osynligt, för priset ser rimligt ut. Saknad länk återställs av de
  dagliga jobben; en FELAKTIG städas bara för hand. Gäller ALLA anropare, även veckans dedupe-stubs.
  ⛔ **FÖLJDREGEL: marknadsplats-URL:er hör inte hemma i denylistan** (den läses bara av
  `ensureListingProduct`, som hämtar ur butiksfeedar) — OCH raderingsvakten måste använda SAMMA
  urval. Räknar den marknadsplatslänkar väntar den på en denylist-post som aldrig skrivs; två
  raderingar i omgång 3 fastnade på en Tradera-SÖKlänk.
  ⛔ **HERRELÖSA URL:er RÄKNAS ÖVER HELA GRUPPEN, SEKVENTIELLT** (`orphanedOfferUrlsForMerge`).
  Slås N stubbar ihop till ETT mål som saknar butikens offer flyttas den FÖRSTA stubbens offer in —
  och de N−1 följande krockar då med DEN. En beräkning som jämför varje stub mot målet SOM DET SÅG
  UT INNAN gruppen kördes ser noll krockar, denylistar noll, och N−1 butiks-URL:er blir ägarlösa ⇒
  nästa skrapning skapar N−1 nya produkter. **Det var precis så dubbletterna "kom tillbaka"**
  (Rogerz Aquapolis: 8 varianter → 7 tysta raderingar → 7 nya produkter 16:46 samma dag).
  Siffran avslöjar felet: omgång 1 rapporterade 51 herrelösa på 82 beslut, omgång 4 rapporterade 210
  på 29 — varav 149 från just gruppkrockar.
  ⛔ **DENYLISTANS NORMALISERING AVGÖR HUR BRETT EN POST SLÅR** (`normUrl`): den strippade HELA
  queryn. Cardmarkets identitet ligger där (`?idProduct=`), så EN inlagd CM-URL nekade varje
  CM-produkt; och Shopifys `?variant=` ÄR annonsens identitet (vår adapter delar en sida i en annons
  per variant), så en nekad variant nekade hela sidan — inklusive den variant som lagligen satt på
  kanonprodukten. 22 kanoniska vintage-produkter hade sin LEVANDE Rogerz-offer nekad, och
  `runner.ts` hoppar över nekade URL:er ÄVEN när offern finns ⇒ priset hade frusit. `variant` bevaras
  nu, allt annat strippas. Regeln är inte "aldrig marknadsplatser" utan **"identiteten måste överleva
  normaliseringen"** — en Tradera-ITEM-URL bär den i sökvägen och är därför ofarlig.
  ⛔ **ATT NEKA EN URL RADERAR INGEN BEFINTLIG RAD**, och mellan radering och push hinner en redan
  startad Actions-körning återskapa det som togs bort (mätt: 43 produkter 20:55–20:58 mitt under
  omgång 3). Kör `scripts/purge-denylisted-products.ts` efter varje omgång — den raderar produkter
  vars SAMTLIGA butiks-URL:er är nekade och håller undan allt med historik/bevakning utan `--force`.
  ⛔ Efter en körning: `recompute-price-cache.ts` OCH en färsk ruttabell (workflow "Ruttabell för
  Discord-larm (manuell)") — annars länkar Discord-inlägg till produkt-id:n som inte finns kvar.
  ⛔ **TOMRAD AVSLUTAR GRUPPEN — även under en `DELETE`-rubrik.** Skriver man rubriken och sedan en
  tomrad läses varje följande länk som en dubblettgrupp UTAN mål, och hela filen faller på
  "dubblettgrupp utan mål". Kommentarrader (`#`) är däremot ofarliga och kan stå var som helst.
  ⛔ **`--write-denylist` FÅR INTE ANKRA PÅ NORMALISERARENS NAMN** (2026-08-14): ankaret var
  strängen `].map(normUrl)` och funktionen döptes om till `normalizeListingUrl` 08-13 → skrivningen
  hittade ingen insättningspunkt mitt i en städomgång. Ankaret matchar nu arrayens slut.
  ⛔ **MERGE ELLER RADERING SPELAR INGEN ROLL NÄR MÅLET REDAN HAR BUTIKENS OFFER** (2026-08-14):
  `Offer` är unik på (produkt, butik, skick, språk), så stubbens offer RADERAS i mergen i stället för
  att flyttas. Kolla alltså målets butikslista först — bär den redan butiken är radering + denylist
  exakt samma utfall som en merge, och enklare. Bär den INTE butiken flyttar mergen en riktig länk
  och radering hade kostat kanonprodukten en butik.
- **KATALOGSTÄDNING 2026-08-10 → TRE NYA VAKTER (alla MÄTTA mot facit före ship)**: ägaren pekade ut 16 dubbletter
  (mergade via `scripts/apply-owner-catalog-cleanup-2026-08-10.ts`; CM-länkar följer ALDRIG med — målen bar redan rätt)
  + 2 raderingar (denylistade). Rotorsakerna stängdes:
  (1) **JP-AUTOMAPPNINGENS TVILLINGVAKT + KINAFILTER** (`cardmarket-refresh.ts`): Storm Emeralda-stubbar mappades till
  Cardmarkets KINESISKA produkter ("CSM1aC: Storming Emergence", "Tidal Storm" — CM säljer kinesiskt och INGET i
  kandidatpoolen visste det) och skapade skräp-set. Roten: `ownedBy`-filtret tog bort det RÄTTA svaret (ägt av
  tvillingen) FÖRE likhetsjämförelsen → närmaste oägda lookalike vann. Nu: kandidater vars namn matchar `^CS…C:`
  utesluts (`isCmChineseName`, 163 träffar i CM-katalogen, kolon krävs = noll falska), och är bästa ÄGDA kandidat >
  bästa oägda + `JP_TWIN_MARGIN` (0,1) mappas inget ("TROLIG DUBBLETT" → dedupe). ⛔ MÄTT: 0/121 legitima mappningar
  blockerade; marginal 0 hade falskt blockerat "Black Bolt/White Flare JP Booster" (ägd EN-twin sim 1,00 mot rätt
  JP-kandidat 0,92) — sänk den inte.
  (2) **PLATSHÅLLARPRIS-GOLVET** (`isPlaceholderListingPrice`, `src/lib/listing-plausibility.ts`): Kanto Vault
  publicerar 1 kr på presale-sidor (verifierat i deras egen Shopify-JSON) och Pokétalk lät en box stå på 10 kr —
  blev offer-pris + "Average price 100 kr" eftersom CM-rimlighetsvakten är verkningslös precis när stubben är NY
  (inget facit finns än). Golv: < 5 kr = alltid platshållare; lådkategorier (BOX/ETB/COLLECTION_BOX/BUNDLE) < 50 kr.
  ⛔ MÄTT mot alla ≤30 kr-butiksoffers: exakt de 4 platshållarna fälls, Trick or Trade-minipacks på 10 kr överlever —
  höj inte styckgolvet till 10 kr. Appliceras på ALLA fyra skrivvägar: `upsertListingOffer` (skapandet är den
  kritiska — där finns inget CM-facit), StoreListing-huvudboken (larmtext), restock-transitionens prisskrivning och
  scrape-loopen. Platshållare ⇒ `price: null` (länk + lagerstatus behålls), aldrig skippa själva offern.
  (3) **TRADERA-DOMAR VERKSTÄLLS ÖVERALLT**: scrape-alls `TraderaAdapter`-väg (runner-loopen) konsulterade ALDRIG
  `TraderaMatch(ok=false)` → "tom ask"-annonsen på Mega Charizard X ex Tin (dömd 07-07) skrevs tillbaka som 100 kr-
  offer VARJE natt i en månad, och `verifyTraderaMatches` hoppade över paret som "redan avgjort" utan att titta på
  offern. Nu: runner-loopen slår upp fällda par per körning, och verify-matches NOLLAR en offer som MOTSÄGER en
  redan fälld dom (ingen ny LLM-dom — verdiktet är redan betalt). En dom utan verkställighet är ingen dom.
  **RUNDA 2 (2026-08-11, apply-owner-catalog-cleanup-2026-08-11.ts)**: fullkatalogsvep med fem detektorer.
  Starkaste detektorn = **två produkter med SAMMA CM-idProduct** (ren SQL, bevisade dubbletter): fångade
  Beam/TCG Store-vågens variantnamngivna ETB-stubbar ("Paradox Rift ROARING MOON ETB") — CM:s produkt på det
  delade id:t ÄR variantprodukten, så etablerade "generiska" ETB:er fick CM:s variantnamn efter mergen.
  11 merges totalt + DL:s karaktärslösa Destined Rivals-blister-URL bort (låg på TVÅ karaktärsblistrar).
  ⛔ Detektorn "olika idProduct men nästan samma namn" gav BARA falska positiva (US-versioner, mini tin-familjer,
  X/Y) — CM:s egen id-uppdelning är beviset att de SKA vara isär; bygg ingen automatik på den.
  ⚠️ Titelbaserad languageMismatch får ALDRIG användas på JP↔JP-kandidatpar: CM-namn bär ingen språkmarkör,
  så kollen fällde "Future Flash Booster Box (Japansk)" mot sin egen kanoniska produkt (fältet räcker).
  ⏭️ KVAR till nästa runda (ägaren återkommer om restock-alerts m.m.): misstänkta länkfel som INTE åtgärdades —
  Pokétalk "mega-charizard-x-ex-mep023…-promo" på X-tinen, Samlarhobby "…x-ex-tin…-red" på Y-tinen, Mystery Shack
  "kopia-…-gengar" på Clefable-tinen, Card Clubs singel-liknande URL:er ("bulbasaur-037" → GO-blister); kvarvarande
  CM-lösa (medvetet, inga dubbletter): XY/SM sleeved-boosterstubbar (CM saknar produkterna), Pokétalks Neo Genesis
  ARTWORK-varianter (Feraligatr/Meganium — wrapper-art modelleras inte; CM har EN produkt), Poké Ball Tin-årgångarna
  (2023/okt-2024/2026, olika GTIN men delar CM:s enda "Generic Poké Ball Tin"-id; RahTechs 2025-URL sitter på
  2026-produkten), presale-JP utan CM (Terastal Festival m.fl.). Genie Trio-blisterns "Card Club/Pokétalk-länkar"
  gick inte att hitta i DB (bara CM + CardGame, och CardGames "forces-of-nature-trio" ÄR genie-trion) — be ägaren
  peka igen.
- **KATALOGNAMN FÖR SEALED = CARDMARKETS NAMN (ägarbeslut 2026-08-09)**: en auto-importerad stub bär butikens
  fras bara tills CM-identiteten avgörs — då adopteras CM:s katalognamn (`adoptCmName`, `src/jobs/adopt-cm-name.ts`,
  ansluten i cardmarket-refresh EN-fuzzy-grenen + JP-auto-mappningen). Engångstvätt av befintlig data =
  `scripts/adopt-cm-names.ts` (körd: 313 omdöpta). ⛔ KOLLISIONSVAKT: bär en annan produkt (samma språk) redan det
  normaliserade namnet skrivs INGET — [GVSE]/[LUJF]-boxart och variant-ETB:er får aldrig kollapsa till samma titel.
  ⛔ Slug rörs ALDRIG (publicerade URL:er). Samma dag: produktsidans set-länkar går till `/produkter?set=` (inte
  `/sets/[id]`), och "Så fungerar Bäst matchning" i sorteringsarket är NEDTONAD men får ALDRIG tas bort
  (EU-rankningstransparens — ägaren valde "mindre synlig", inte "borta"). Prisgrafens Y-axelbredd räknas ur längsta
  ticketiketten (`yAxisWidth`, price-chart.tsx) — fast 48px klippte tusentalsgruppen ("3 284,91" → "284,91").
- **"TA BORT" PÅ EN BUTIKSLÄNK BETYDER BORTA (2026-08-14)**: admin-borttagningen raderade bara
  offer-raden. URL:en låg kvar i butikens feed och var inte nekad, så nästa skrapning (var 10:e
  minut) matchade den och skapade om offern — MÄTT: ägaren tog bort två länkar på Base Set Booster,
  båda fanns igen inom en minut. Går inte att lösa i `import-denylist.ts`: den är en KÄLLFIL och en
  körande container kan inte skriva i den. Därför tabellen **`DeniedListingUrl`**, som endpointen
  skriver till; `isDeniedListingUrl` läser BÅDA källorna (kodgranskad lista + admins egna).
  ⛔ **MODULEN RÖR ALDRIG DB:N SJÄLV** — `isDeniedListingUrl` anropas en gång PER ANNONS i loopar
  med tusentals varv. Runner hämtar raderna EN gång per jobb (`loadAdminDenylist` →
  `setDynamicDenylist`) och funktionen förblir synkron. Samma lärdom som restock-lanens källcache
  2026-07-07, där ETT uppslag per körning räckte för att hålla computen vaken dygnet runt.
  I restock-lanen laddas de EFTER `ensureDbAwake` — fas 1 förblir ren HTTP.
  ⛔ **BARA BUTIKS-OFFERS**: marknadsplatsannonser går redan genom purge-receptet (dom på annons-id).
  ⛔ **EN FEL LÄNK SKA FLYTTAS, INTE TAS BORT.** Knappen nekar URL:en permanent, vilket är rätt när
  listningen inte hör hemma alls — men fel när den bara sitter på FEL produkt. Aquitaz/Rogerz sålde
  "Scarlet & Violet: Base Set Booster Pack" med länken på Base Set Booster (WOTC 1999, CM 5 074 kr)
  ⇒ produktsidan visade "Lägsta pris 91 kr". Hade de nekats i stället för flyttats hade den RÄTTA
  produkten förlorat två av sina fjorton butiker. Ångra = `scripts/undeny-listing-url.ts`.

## Set-skapande och hands-off katalogflöde
- **Sealed CM-pris/trend är nu HANDS-OFF (2026-07-05)**: dagliga `runCardmarketRefresh` (`cardmarket-refresh.ts`) matchar
  set-LÖSA auto-importerade stubs mot HELA CM-katalogen (`bestSealedMatch`, global namn+form-match, tröskel `GLOBAL_MIN_SCORE`=0.72
  vs 0.55 set-scopat) → de får CM-offer, pris och daglig trendpunkt automatiskt (ingen manuell `rapidapi-fill-sealed` längre).
  Säkerhetsnät = befintlig store-cross-check (`priceOre > storeMin×2.5` → skip); stubs har alltid en butiks-offer så den är aktiv.
  Tradera-länkar + butikslänkar var redan automatiska (tradera-sweep matchar på titel; butiks-offer skapas vid import). CM-BILDEN
  hämtas bara vid EXAKT `idProduct`-match (fuzzy bild = för riskabelt) → stub visar butiksfoto tills dess. Ceiling: global namn-
  match kan sällan fel-länka udda titlar → höj `GLOBAL_MIN_SCORE`.
- **Nya set + singlar = HANDS-OFF (2026-07-16)**: `import-new-sets.yml` (söndagar 03:30 UTC) kör `TCG_NEW_ONLY=1
  npm run import:tcg` → nya set (CardSet + kort + SINGLE_CARD-produkter + bilder) skapas när pokemontcg.io lägger in dem;
  0 nya = snabb no-op. Priser/CM-länkar/graf fylls av dagliga cardmarket-refresh (upsertar offers på alla singlar med
  tcgExternalId). Sealed-importern (04:00, EFTER set-importen) sätter set-etiketter: backfill setId=null → episode-namn
  via exakt cmid (aldrig titelmatchning). Kvar manuellt: ingenting i katalogflödet — bevaka RapidAPI-kvot vid stora släpp.
- **KOMMANDE SET FINNS HOS CARDMARKET LÅNGT FÖRE pokemontcg.io (2026-07-29)**: pokemontcg.io lägger in ett set när det
  är SLÄPPT, men butikerna säljer förhandsboxar i månader innan — och vår sealed-import har då redan skapat produkterna
  med `setId=null`. De syns alltså varken i set-filtret eller på /sets. CM:s episodlista bär namn, serie, releasedatum
  OCH logotyp för dem: `scripts/set-from-cm-episode.ts --list` visar de nyaste, `--episode=<id>` torrkör, `--apply`
  skriver (fyller bara TOMMA fält på ett befintligt set; `--force` skriver över). Produkternas set-etikett sätter man
  INTE där — kör `import-sealed-from-cardmarket.ts` (RECENT_DAYS=90 APPLY=1), som binder produkt→set på exakt cmid.
  Så skapades "30th Celebration" (CM-episod 431, släpp 2026-09-16, 26 sealed-produkter) 2026-07-29.
  ⛔ **Sätt ALDRIG ett gissat `externalId` på ett sånt set.** Fältet lämnas NULL, och `import-tcg-data.ts` ADOPTERAR
  raden på namn när pokemontcg.io får setet (behåller id, produkter och etiketter). Ett gissat "me6" som visar sig fel
  ger två rader med samma namn i filtret — och produkterna sitter kvar på fel rad.
