---
paths:
  - "src/scrapers/**"
  - "scripts/setup-wave*.ts"
  - "scripts/run-wave*-import.ts"
  - "scripts/probe-*.ts"
  - "scripts/audit-store-*.ts"
  - "scripts/verify-instock-*.ts"
  - "src/jobs/verify-instock-buyable.ts"
  - ".github/workflows/restock-watch.yml"
  - ".github/workflows/scrape-all.yml"
---
# Skrapning, lagersignaler och restock-detektion

- **⛔ SHOPIFYS `available` ÄR INTE SAMMA SAK SOM "GÅR ATT KÖPA" (2026-08-15)**: ägaren hittade
  "Ascended Heroes Booster Bundle (ME2.5)" som i lager hos Kortarkivet medan butikens egen sida sa
  "Slut i lager". Alla tre källor vi litat på — `products.json`, `/products/{handle}.js` och sidans
  JSON-LD (`schema.org/InStock`) — kommer ur SAMMA Liquid-fält och kan därför inte motsäga varandra.
  Bara KÖPKNAPPEN vet: storefronten renderade `<button name="add" … disabled>`.
  **Uteslutet innan slutsatsen drogs** (metodläxan från `discontinued` 08-14): CDN-cache
  (`cf-cache-status: DYNAMIC` även med cache-buster), marknad/valuta (samma `localization=SE` som
  adaptern), och taggen `locked` (35 produkter bär den, 12 är köpbara). De två produkternas publika
  JSON är IDENTISK fält för fält utom taggar.
  `purchasableFromShopifyPage` (`stock-verify.ts`) läser `<form action="…/cart/add">`, väljer
  formuläret med RÄTT variant-id och dömer på knappens `disabled`/slutsåld-text.
  ⛔ **DEN HÅLLER MED ELLER AVSTÅR — DÄRFÖR BEHÖVS INGEN BUTIKSLISTA.** MÄTT mot 20 Shopify-butikers
  riktiga produktsidor (tre i lager + tre slutsålda per butik): **0 fall där den felaktigt motsade
  feeden**, 1 äkta träff, 4 butiker där den svarar null (temat renderar inget cart-formulär vi kan
  läsa: Card Club, Beam Cardshop, Mystery Shack, Dragon's Lair). `null` ⇒ LITA PÅ FEEDEN.
  **Tre inkopplingspunkter**: (1) varje övergång IN i lager i `runRestockScan` (både offer-grenen och
  feed-först-grenen, tak `RESTOCK_BUY_CHECK_MAX`=25/körning, fail open över taket), (2) före utskick i
  Discord-lanen, (3) `src/jobs/verify-instock-buyable.ts` som roterande nattlig kontroll i scrape-all.
  ⛔ **ROTATIONEN ÄR EN SKÄRVA AV OFFER-ID, INTE EN KOLUMN.** Det finns ~1 000 IN_STOCK-offers hos
  Shopify-butikerna och en produktsida är ~500 kB — att hämta alla varje natt vore ~500 MB ur
  butikernas servrar för ett fel som drabbar 5 av 1 000. En skärva per dygn (1/7) ger full täckning på
  en vecka utan migration.
  ⛔ **RÄTTELSEN SKRIVER INGEN RestockEvent.** Det är ett felaktigt TILLSTÅND som korrigeras, inte en
  lagerhändelse; skrivs den som händelse hamnar den i flapp-historiken och kan tysta nästa ÄKTA
  påfyllning.
  **Full svepning av alla 999**: 5 falska "i lager", ALLA hos Kortarkivet (butiken låser
  release-produkter), rättade i prod 2026-08-15. Verktyg:
  `scripts/verify-instock-buyable-run.ts` (`--all`, `--store=`, `--apply`) och
  `scripts/probe-shopify-buy-button.ts` (mäter detektorn mot en feed-dump).
- **⛔ `discontinued` HOS WEBHALLEN ÄR INTE EN LAGERSIGNAL — PRÖVAT OCH ÅTERSTÄLLT SAMMA DAG (2026-08-14)**:
  ägaren fick ett restock-larm på Mega Greninja ex Premium Collection och såg "Produkten har utgått ur
  sortimentet" på Webhallens sida. Jag drog slutsatsen att `stock.web` ljög, hittade produkt-API:ts
  `discontinued`-fält (värden 0 eller 2) och lät det slå lagersiffran. **Det var fel och deployades i ~40
  minuter innan ägaren visade motbeviset**: samma produkt hade samtidigt `discontinued: 2`, `web: 1`,
  "Lägg i varukorg" och "Webblager ✓ 1 st". Larmet var alltså KORREKT hela tiden.
  **Rätt tolkning**: `discontinued: 2` = varan har utgått ur SORTIMENTET (inget mer kommer in), inte att
  den är osäljbar. Kvarvarande exemplar säljs som vanligt, och rutan "har utgått" visas först när en
  utgången vara nått NOLL. En vakt på fältet stänger därför av larm för de SISTA exemplaren av utgående
  produkter — precis de larm som är mest värdefulla.
  ⛔ **`stock.web` ÄR rätt fält för köpbarhet.** Webhallen skickar FRÅN BUTIK, så en enhet i en fysisk
  butik räknas som webblager och är säljbar. `webStock["992"]` (rena webblagret) är 0 även för fullt
  köpbara varor (Pitch Black Booster Bundle) och 3 för en utgången pärm — använd inte heller det.
  ⚠️ **METODLÄXAN, VIKTIGARE ÄN FYNDET**: en produktsida i ett ÖGONBLICK bevisar inte vad som gällde när
  larmet gick. Jag byggde en vakt på en skärmbild + ett fältnamn som lät självklart, och räknade 20
  lagerflippar som stöd — men flipparna var ÄKTA lagerrörelser på en vara med ett fåtal exemplar.
  Innan en lagervakt byggs: bevisa att fältet motsvarar KÖPBARHET, genom att hitta ett fall där de
  skiljer sig åt. Här fanns inget sådant fall.
  ✅ **Det enda som behölls** är höjt `LIVE_POLL_MAX` (40 → 80, feeden är 59 rader) med VARNING vid
  kapning — det gamla taket kapade tyst, alltid samma rader i feed-ordning.
  **Kvar som verktyg**: `scripts/audit-restock-truth.ts` (rapport-only) rangordnar (produkt, butik)-par
  på flippar/dygn och listar butiker utan en enda slutsåld offer. ⚠️ Ett högt tal är en MISSTANKE, inte
  en dom — Webhallens 7,1 flippar/par såg ut som en bugg och var det inte.
- **SEX BUTIKER KAN ALDRIG GE ETT RESTOCK-LARM (mätt 2026-08-14 mot alla 42 feedar)**:
  `scripts/audit-store-stock-signals.ts` hämtar varje bevakad butiks feed live (fas 1, rör aldrig DB:n)
  och ställer EN fråga: kan feeden över huvud taget uttrycka "slut i lager"? Svarar den nej står varje
  offer permanent på IN_STOCK, OUT→IN inträffar aldrig, och butiken kan bara någonsin ge "ny produkt i
  lager". Felet är TYST — butiken ser frisk ut i alla hälsomått (färsk `lastSeenAt`, inga adapterfel).
  **Utfall: Cardlevels (78 annonser), The Swedish Fish (41), Leksaksaffären (37), Pocketmonsters (36),
  Pokexclusive (31), Packs on Packs (28) — alla med NOLL slutsålda.** Övriga 36 har frisk blandning.
  ⚠️ **KÖR REVISIONEN LUGNT**: 42 butiker på en gång fick Shopify att 429:a oss, och två butiker såg
  då "trasiga" ut. Kontroll mot `Offer.lastSeenAt` i prod visade att båda setts 12 min tidigare —
  döm aldrig en butik trasig utifrån en egen burst-körning utan att kolla prod-färskheten först.
  ⏭️ Leksaksaffären: 8 offers med 42 h gammal `lastSeenAt` medan feeden ger 37 annonser (URL:erna
  troligen utbytta) och butiken saknar strategi i `STORE_STOCK_STRATEGY` → går inte att verifiera.
  ✅ **STRATEGIHÅLET STÄNGT 2026-08-15**: `resolveStockStrategy` härleder numera strategin ur URL:ens
  FORM när butiken saknar en handskriven rad — `…/products/{handle}` ⇒ `shopify-js` (faller tillbaka
  på JSON-LD om `.js` inte finns, så Quickbutik-butiker med samma URL-form hamnar ändå rätt), allt
  annat ⇒ `json-ld`. Tabellen skrevs när vi hade elva butiker; wave 4 och 5 lade till 31 utan att
  någon fick en rad, så **30 av 42 butiker gick inte att verifiera**. MÄTT efter fixen mot riktiga
  produktsidor: The Swedish Fish, Pocketmonsters, Packs on Packs, NordicTCG, Coolcard och Spelexperten
  ger nu RIKTIGA svar (tidigare null), och **varje svar stämde med feeden** — noll motsägelser.
  Kvar utan svar: Leksaksaffären, Mystery Shack, CardGame (ingen JSON-LD) och Swepoke (uttryckligt
  `none`). En uttrycklig rad i tabellen vinner alltid, inklusive `"none"`.
- **FRÅNVARO UR FEEDEN KOLLAS, DEN TOLKAS INTE (2026-07-28)**: en offer vars URL försvann ur butikens feed
  nollades förr till UNKNOWN ("Okänd" i pristabellen bredvid ett dagsgammalt pris) — ärligt men blint, OCH
  eftersom UNKNOWN→IN_STOCK inte är en äkta övergång larmade en efterföljande restock ALDRIG. Sådana offers
  slås nu upp mot butikens EGEN produktsida (`verifyStockForUrl`, `src/scrapers/stock-verify.ts`): Shopify
  `/products/{handle}.js` → `variants[].available` (`?variant=` gäller DEN variantens lager, aldrig sidans),
  JSON-LD `offers.availability` (Alphaspel/MaxGaming/Spelexperten/Shinycards), Webhallen `/api/product/{id}`.
  **Swepoke = `none`**: produktsidan renderas av Alpine.js (`outOfStock === false` är en template-gren, inte ett
  tillstånd) — knapptexten står i markupen oavsett lager. Deras KATEGORISIDA bär äkta markörer, så feeden är
  källan där. Tvetydig sida (flera Product-noder med olika svar) → null, aldrig en gissning.
  **Kostnaden är avgränsad av `lastSeenAt`**: bara offers som saknats längre än karensen (24h) frågas, och
  ankaret bumpas efter uppslaget → varje offer frågas högst en gång per karensfönster hur ofta lanen än kör
  (~20-40 requests/dygn totalt, tak `RESTOCK_VERIFY_MAX`=20/körning, äldst först).
  **INGET SVAR ≠ NY KUNSKAP** (`statusAfterVerify`): ett 429 får inte skriva över ett känt OUT_OF_STOCK med
  UNKNOWN — torrkörningen gjorde precis det med 5 av 18 kandidater innan regeln fanns. Bara ett obackat
  "i lager" faller till UNKNOWN. Urvalet (`offersToVerify`) filtrerar med flit INTE på status: en slutsåld
  Speltrollet-vara ligger inte i deras Pokémon-kollektioner alls, så feeden kan aldrig visa att den kommit
  tillbaka — utan uppslaget vore de varorna permanent osynliga för restock-larmen.
- **Quickbutik-parsern får ALDRIG låsa URL-djupet (2026-07-28)**: produktlänken i ett `data-pid`-block matchades
  mot `/pokemon/{kat}/{slug}` — men butikerna är inte konsekventa: Swepoke `/alla-produkter/{slug}` (2 segment),
  Shinycards `/pokemon/tins/{slug}` (3) OCH `/pokemon/mega-evolution/chaos-rising/{slug}` (4). Mönstret kastade
  tyst 9 av 18 produkter på Swepokes ETB-sida och 7 av 15 på Shinycards ETB-sida; de föll ur feeden och blev
  "Okänd". `productHrefInBlock` väljer nu den vanligaste vägen i blocket (produktlänken står två gånger, bild +
  titel; ankare och systemsidor står en gång) → självvaliderande, tål att butiken byter struktur igen.
  Feeden växte 74 → 115 annonser för Swepoke. Fallback-parsern delar nu slutsåld-markörer med primärparsern:
  den kollade bara "Ej tillgänglig" och antog i lager annars → en produkt vars knapp sa "Slutsåld" rapporterades
  som I LAGER.
- **Restock-larm är FLAPP-DÄMPADE + historiken är ADMIN-ONLY (2026-07-26)**: butiker pytsar ut heta varor.
  Dragon's Lair togglade Pitch Black ETB/Booster Box 28 resp. 45 gånger på tre dygn — verifierat i DL:s EGEN feed
  (kollektions-JSON och produktens `.js` sa samma sak), alltså butikens riktiga lager som studsar, inte vår sampling.
  2h-cooldownen ensam gav då ett mejl varannan timme i all oändlighet. `checkRestockAlerts` läser nu paret
  (produkt, butik)-egen RestockEvent-historik: **(A) blink** — tillbaka i samma status inom `RESTOCK_MIN_AWAY_MINUTES`
  (**20 sedan 2026-08-10**, var 60 — ägarbeslut: 60-blinken åt ett ÄKTA larm, TCG Stores Prismatic-bundle var borta
  30 min och fylldes på; defaulten bor i `flapPolicy()`, env-variabeln är nödventil) → inget larm (den lämnade
  aldrig hyllan); **(B) flapp** — fler än `RESTOCK_FLAP_MAX_TRANSITIONS` (6)
  övergångar/dygn → cooldown blir `RESTOCK_FLAP_COOLDOWN_HOURS` (24), dvs ett besked per dygn i stället för ett
  varannan timme. Tystar ALDRIG helt: att en het vara trillar in med jämna mellanrum är i sig information.
  MÄTT mot 21 dygns facit före ship (470 händelser): 177 → 147 larmtillfällen, värsta paren 12/6 → 7/3, och de enda
  par som blev helt tysta hade bara 30-minutersblinkar — med 20-tröskeln larmar de igen (avsiktligt).
  Ren dom = `evaluateStockFlap` (testad utan DB).
  Själva historiken (produktsidan, /marknad, dashboard, `/api/market/restocks`) är ADMIN-ONLY — en lista där
  "i lager för 4 min sedan" oftast leder till en slutsåld sida är driftlogg, inte produktfunktion. Rollen läses
  KLIENT-sida (`useIsAdmin`, `restock-history.tsx`) och datat ligger INTE i ISR-payloaden — produktsidan hämtar
  det on-demand från det admin-grindade API:t. Sätt aldrig `auth()` i de ISR-cachade sidorna för detta.
- **Shopify-sortiment = flera SKU:er på EN sida (2026-07-14)**: `ShopifyAdapter` splittar en produkt vars varianter
  bär KARAKTÄRSNAMN till en annons per variant (`?variant=…`, eget pris/lager — se `splittableVariants`). Grinden är
  smal med flit och MÄTT mot butikernas riktiga feedar: ~100 av Speltrollets flervariant-produkter är färgkartor
  (sleeves/pärmar/tärningar) — splittas de blir varje FÄRG en annons med huvudboksrad och ett "ny produkt"-larm.
  Kräv därför att VARJE variant nämner en Pokémon + tillbehörsvakten. Migrering av gammal data:
  `scripts/split-shopify-variants.ts` (torrkörning default).
- **BUTIKS-WAVE 6 = TCG PICKS (2026-08-17)**: ägaren såg en Storm Emeralda-restock i en KONKURRENTS
  Discord men inte i vår — butiken fanns inte som källa alls. `TcgPicksAdapter` (Shopify,
  `wholeCatalog`), registrering via `scripts/setup-wave6-sources.ts --apply --restock`. 43 bevakade.
  ⛔ **BAS-URL:EN ÄR `.com`**: `tcgpicks.se` 301:ar till `tcgpicks.com`, och adaptern bygger sina
  egna feed-URL:er — en 301 är gratis bara för webbläsare (samma regel som apex-domänen).
  **Mätt före påslag**: 888 produkter = **4 hämtningar** (sista sidan bryter loopen), 861 i lager,
  varav 55 sealed. Kollektionsvägen kan strukturellt inte fungera här — butikens sealed-hyllor heter
  "booster-boxes"/"elite-trainer-boxes"/"sealed-products"/"upc-spc-boxes", INGEN med "pokemon" i
  namnet, medan de fyra som matchar namnfiltret är singlar/graderat/displaystativ.
  ⚠️ **~60 PROMOSINGLAR PASSERAR `isSingleCardListing`** ("Chimchar 041 - Mega Evolution Black Star
  Promos" — namn + löst nummer, ingen "X/Y"-bråkform). De stoppas av KATEGORIGRINDEN i stället:
  alla landar i `OTHER`, som både auto-importen och Discord-lanen fäller. Vidgas OTHER någon gång
  måste den här klassen mätas om FÖRST.
- **BUTIKS-WAVE 5 + TÄCKNINGSREVISION (2026-08-13)**: ägaren pekade ut två konkurrentlistor + Carsmästaren.
  (1) **TÄCKNINGSREVISION AV ALLA 34** (fullständig rapport i sessionsloggen): namnfiltret på Shopify-
  kollektioner MISSADE stora delar av sortimentet — Speltrollet 281 sealed osynliga (butiken har slutat
  kurera kollektioner), TCG Store 198 (30-taket kapade 17 av 47 kollektioner, inkl. alla nyaste set),
  Samlarhobby 50 (typ-hyllor utan "pokemon" i namnet: "tins", "lösa boosters"), Hobbykort 45 (i INGEN
  kollektion alls), CardGame 32+ (JP/CN-hyllan på URL-djup 3–4 bakom en tom landningssida). Fixar:
  `wholeCatalog` på Samlarhobby/TCG Store/Pokétalk/Hobbykort/Kanto Vault, `wholeCatalog`+Pokémon-
  markörfilter på Speltrollet (MÄTT: 0 av 368 täckta föll ut — ⛔ Kanto Vault är MOTEXEMPLET, 349/422
  saknar markören), MAX_COLLECTIONS 30→60 + VARNING vid kapning (tysta tak var roten), Quickbutik-
  barn-nedstigning när en kategorisida renderar 0 produkter, Spelexperten sidtak 10→15 (11 sidor
  finns), Webhallen 5→8. ⛔ En utökad BEFINTLIG butiks feed måste omseedas TYST (`RESTOCK_SEED_SILENT=1`
  i run-wave5-import.ts) — annars mejlas hela utökningen som "Ny produkt i lager" till set-bevakare.
  (2) **WAVE 5**: Aquitaz (Shopify, >1000 sealed EN/JP/CN/KR — "pokemonkort"=3 896 singlar + rip&ship
  uteslutna per butik), Rogerz (rogerz.dk, Shopify Markets ⇒ verifierat SEK; vägda vintage-packs
  fällda av `dropTitles` — korslistade, kollektionsuteslutning ensam läckte 42), Yonko TCG
  (yonko-tcg.de, SEK verifierat), Firegames, Spelkortsbutiken (Quickbutik; singlar under
  /los-pokemon fällda av SINGLE_URL; ⚠️ temat kan sakna lagermarkör i listningen → status kan
  läsa falsk-OUT). PrestaShop-adapter (delad bas → Leksaksaffären 37 prissatta av 102 — OOS-rader
  saknar pris och faller ur feeden, restock syns först vid omprissättning; NordicTCG 47) +
  Starweb (Coolcard, 149 varor, "N st i lager"-text). Registrering =
  `scripts/setup-wave5-sources.ts --apply --restock`, engångsimport = `scripts/run-wave5-import.ts`.
  ⛔ **PLAYOTEKET ÄR FORTFARANDE ROBOTS-BLOCKERAD**: robots.txt SLUTAR med ett andra
  `User-agent: *`-block med `Disallow: /` — toppen ser ut som standard-PrestaShop och lurade två
  granskningar 08-13; läs alltid HELA filen. ⛔ **CARSMÄSTAREN EJ TILLAGD**: Abicart-JSON-RPC:n
  (webshop 89109) är verifierad fungerande, men varje värd som serverar den har `Disallow:
  /backend` — "dokumenterat publikt API vs robots" är ett ÄGARBESLUT som väntar.
  ⛔ **ARCADE DREAMS ÄR FORTFARANDE BLOCKERAD — noteringen 08-13 om att blanket-spärren var borta
  var FEL (omprövad 2026-08-17, hela filen läst).** robots.txt är ~180 rader: en `User-agent: *`
  med sökvägsregler i toppen, sedan en lång allow-lista för namngivna bottar (Googlebot,
  ClaudeBot, GPTBot …) — och SIST `# Block all other unknown bots` + `User-agent: * / Disallow: /`.
  Exakt samma form som Playoteket, och exakt samma fälla: filen ser tillåtande ut om man läser
  toppen eller mitten. **Läs alltid HELA robots.txt, och läs den igen innan en butik byggs** —
  två granskningar har nu gått på det här mönstret på tre olika sajter.
  (3) **REVISION AV KOHORTEN (samma dag, `scripts/audit-new-products.ts` — 7 mekaniska tekniker +
  2 LLM-domare, rapport utan DB-skrivningar; DB-läsningen cachas i `.audit-cache/` så domarna kan
  köras om utan att väcka Neon). 898 nya produkter, och två vakter hade hål:
  **118 BLOCKERADE SPRÅK SLANK IN** — Aquitaz taggar allt `(ENG)/(JP)/(KOR)` → 81 KOREANSKA
  (regeln kände bara `(KR)`), Yonko TCG taggar `[S-CHN]/[T-CHN]` → 37 KINESISKA (regeln kände
  `cn|ch|tw|hk`, varken `chn` eller hakparentes-prefixet). Alla 118 låg inne med `language: EN`
  (kolumnen ljuger — språket står bara i titeln) OCH var restock-bevakade, dvs de kunde larma
  Pro-kunder och postas i Discord. **172 DUBBLETTER UR EN MOMSREGEL** — Rogerz listar varje
  begagnad vara under BÅDA danska momsordningarna (`/ Brugtmoms` och `/ Alm. moms`); taggen ligger
  nu i `LISTING_TITLE_JUNK` bredvid omslagskonsten och är självläkande på samma sätt.
  ⛔ MÄTT mot alla 31 216 produkter som fanns FÖRE wave 5: noll träffar för alla tre mönstren.
  Bart versalt `KOR`/`CHN` utan parentes är FÖRBJUDET — avgränsningen gör tecknet entydigt.
  ⛔ **TVÅKÄLLSKRAVET ÄR MÄTT, INTE BYRÅKRATI**: klassen där BARA LLM-domaren flaggade (41 rader)
  var ~33 FALSKLARM — den läser innehållsordet som kategori och kallar "Tech Sticker Collection
  Blister", "Pin Blister" och "Eraser Blister" för merch/tillbehör fast alla innehåller riktiga
  booster packs och är CM-modellerade SKU:er. Hade domaren fått bestämma ensam hade 33 äkta SKU:er
  raderats. De 118 språkraderingarna är säkra just för att regel OCH domare pekade oberoende
  (domarens språkräkning gav exakt samma 81 + 37).
  ⛔ **DUBBLETTBEVIS TAS PÅ RÅTITELN** (`apply-new-product-cleanup-2026-08-13.ts`): tecken för
  tecken lika sedan känt brus + accenter fällts. `scoreSimilarity` godkände en gång "Mega Charizard
  X ex Tin" == "Y ex Tin" på 1,00. (`normalizeTitle` kastar för övrigt INTE korta tokens —
  kontrollprov: X/Y överlever — tvärtemot kommentaren i `merge-verified-duplicates.ts`.)
  ✅ **ÄGARENS EGEN GENOMGÅNG VERKSTÄLLD 2026-08-13** (`scripts/apply-owner-decisions.ts`, se
  "ÄGARENS BESLUTSFIL" nedan): 82 beslut → **327 rader sammanslagna + 28 raderade**, och 51
  herrelösa butiks-URL:er denylistade FÖRE körningen. Kontrollerat före ship: i alla 81 grupper
  hade noll bortplockade rader mer historik än sitt mål, och noll bar bevakningar/samlingsposter.
  ⏸️ **TEAM ROCKET 1st EDITION HÖLLS TILLBAKA** ur ägarens lista: "Team Rocket 1st Edition Booster
  Pack" (7 537 kr) mot "Team Rocket Booster" (Unlimited, CM 3 254 kr) är 2,3× isär — tryckningen är
  identitet, samma regel som håller Base Set delat i tre katalogposter. Kräver uttryckligt besked.
  ✅ **SPRÅKRENSNINGEN KÖRD 2026-08-13** (ägarbeslut): `purge-blocked-language.ts` raderade **93**
  produkter — 81 koreanska + 12 kinesiska. Två fler än titelsökningen på "CHN" gav: `CBB4C`/`CBB6C`
  "Gem Pack" fångas av den kinesiska produktlinje-regeln, inte av en språktagg. ALLA 93 var skapade
  2026-08-13, dvs enbart wave 5-kohorten, och ingen låg i någons bevakning eller samling. Omkörning
  ger nu "Inga blockade språk i katalogen (2 109 sealed granskade)". ⛔ Ingen denylist behövdes:
  `ensureListingProduct` grindar på `isBlockedListingLanguage` FÖRE allt annat, så den lagade
  detektorn ÄR den permanenta spärren.
  ✅ **OMGÅNG 2 (samma dag)**: ytterligare 88 beslut → **132 rader sammanslagna + 11 raderade**,
  39 nya denylist-URL:er. Facit: `docs/owner-decisions-2026-08-13-b.txt`. Kohorten är nu nere i 454
  av 898. ⛔ **1st EDITION-MERGARNA ÄR OFARLIGA — MEN INTE AV DET SKÄL MAN TROR**: oron att en 1st
  Edition-prislapp skulle landa på Unlimited-produkten gäller inte när butiken har en offer på BÅDA
  raderna. Stubbens offer KROCKAR då med målets (`Offer` unik på produkt/butik/skick/språk) och
  raderas av `mergeStubInto` i stället för att flyttas — mergen blir "ta bort raden + spärra URL:en".
  Kontrollera det i torrkörningens herrelös-lista innan en tryckningsmerge körs; saknar målet
  butikens offer FLYTTAS priset och då gäller oron igen.
  ⛔ **[LUJF]/[GVSE]/[SEGV]-boxkonsten överlevde** och ligger kvar som skilda produkter (5/2/7 offers)
  — de var MÅL i listan, aldrig stubbar. Regeln "merga aldrig dem" är intakt.
  ✅ **OMGÅNG 3**: 46 beslut → 50 rader sammanslagna + 36 raderade
  (`docs/owner-decisions-2026-08-13-c.txt`). Kohorten 898 → **386 kvar**.
  ✅ **OMGÅNG 4**: 29 beslut → 152 rader sammanslagna + 61 raderade + 41 återuppståndna rader rensade
  (`docs/owner-decisions-2026-08-13-d.txt`). Team Rocket 1st Edition är nu mergad (ägaren bekräftade).
  Kohorten 898 → **177 kvar**.
  ✅ **OMGÅNG 5**: 24 beslut → 23 mergade + 44 raderade, plus tre självdubbletter med IDENTISK titel.
  Efter den delar **noll** sealed-produkter normaliserad titel med en annan
  (`docs/owner-decisions-2026-08-13-e.txt` + `-f.txt`). Kohorten 898 → **115 kvar**, katalogen 31 314.
  Denylistningen hann före nästa skrapning: `purge-denylisted-products.ts` hittade 0 återuppståndna.
  ✅ **OMGÅNG 6**: 38 beslut → 41 mergade + 36 raderade (`docs/owner-decisions-2026-08-13-g.txt`).
  Mest japanska boosterboxar där butikens "(JP)"-form gick in i katalogens "…display booster box
  japansk", plus promo-paketen (GYM Vol., McDonald's, First Partner). Kohorten 898 → **43 kvar**,
  katalogen 31 239, fortfarande noll delade sealed-titlar och noll återuppståndna rader.
  ⏭️ **KVAR — väntar på ägaren**: de 74 LLM-dömda paren, och
  **omslagskonstfrågan**: Rogerz säljer vintage booster packs PER OMSLAG → 137 produkter på 38 set.
  MÄTT (`scripts/wrapper-art-report.ts`): 33 av 38 set har IDENTISKT pris på alla omslag, 2 skiljer
  2–16 kr (avrundning) — men i Expedition och WOTC 1999 Base Set kostar **Charizard-omslaget 754 kr
  mer** än Blastoise/Venusaur. Omslaget bär alltså prisinformation för marqueekonsten, inte för de
  andra 135. Katalogens dom 08-11 ("omslagskonst modelleras inte") gällde moderna varianter.
  ⚠️ EJ tillagda, ägarbeslut krävs: Cees Cards (EUR),
  Kelz0r (DKK), Poromagia (EUR) — pipeline antar SEK; PokéBooster (bot-vägg), CS Megastore
  (Cloudflare-utmaning), EvoKort (JS-skal utan data = NOT_VIABLE), Elgiganten/Jollyroom/Proshop/
  Spel & Sånt/Toyspace/Card Haven/Samlargrottan/Gimmick (custom/SPA — byggbara men var sin insats,
  se probe-rapporten).
- **BUTIKS-WAVE 4 = 23 NYA BUTIKER (2026-08-07)**: alla på tre ÅTERANVÄNDA plattformar — 17 Shopify, 3 Quickbutik,
  3 WooCommerce (`woocommerce-adapter.ts`, ny, publika Store API v1). Varje butik verifierades mot sin RIKTIGA feed
  före påslag med `scripts/probe-new-adapters.ts` (rapporterar feedstorlek + hur många annonser som passerar
  vaktkedjan, utan att röra DB). Registrering = `scripts/setup-wave4-sources.ts --apply`, engångsimport =
  `scripts/run-wave4-import.ts`.
  **RESTOCK-BEVAKNING PÅ FÖR ALLA 23 (ägarbeslut 2026-08-08)** → 34 bevakade butiker. Beslutet togs PÅ MÄTNING,
  inte på magkänsla: 14 dygns facit gav 75,2 lagerflippar/dygn över 11 butiker, varav **Dragon's Lair ensam
  63,1 (84 %)**, samlade i 33,7 distinkta 10-minutersfönster av 144 möjliga. Per offer UTAN DL: 1,27 flippar per
  100 offers och dygn ⇒ Wave 4:s 1 610 offers ≈ 20 flippar/dygn ≈ 11 extra väckningar (Neon är redan vaken 41 %)
  ≈ 13 CU-h/mån ≈ **1,50 $/mån** ovanpå ~14 $. Pessimistiskt ~5 $, absolut tak +20 $ (Neon somnar aldrig).
  Påslag: `scripts/setup-wave4-sources.ts --apply --restock` (flaggan slår bara PÅ, aldrig av).
  ⛔ **EN BUTIK KAN DOMINERA NOTAN** — DL står för 84 % av all churn med 22 % av offersen. Vilken av de 23 som
  blir nästa DL går inte att veta i förväg: **mät om efter några dygn** (flippar/dygn per butik + distinkta
  10-min-fönster) innan "det blev billigt" räknas som bekräftat.
  ⛔ **KÄLLISTAN ÄR DISKCACHAD I 24 h** — en ändrad restockWatch-flagga slår igenom först inom ett dygn. Det är
  med flit: ett DB-uppslag per körning var precis det som höll computen vaken dygnet runt (2026-07-07).
  `RESTOCK_SCAN_CONCURRENCY` höjd 4 → 8; MÄTT över alla 34 feedar: 107 s vid 4, 57 s vid 8 — båda ryms i
  tiominuterstakten, höjningen är headroom (workflowet har `cancel-in-progress: false`, så en överdragen körning
  KÖAR i stället för att ersättas).
  ⛔ **KVAR (10 butiker, en egen plattform var)**: playoteket (PrestaShop), coolcard (Starweb), samlargrottan (Wix),
  cardhaven + gimmick + toyspace + spelochsant (custom SPA), evokort (One.com), **cgpremium** (har ett riktigt
  JSON-API, `/api/v1/products`, 57 Pokémon-varor MED tillverkar-EAN — men `stock` är en förvrängd sträng, så
  lagerstatus blir UNKNOWN; kräver ägarbeslut om vi vill visa pris utan lager) och **arcadedreams, som vi INTE FÅR
  hämta**: deras robots.txt listar tillåtna bottar och avslutar med `User-agent: * / Disallow: /`. Vår egen
  robots-parser blockerar den redan korrekt — ta inte bort den grinden.
