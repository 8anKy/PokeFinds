# Foilio — Pokémon TCG-marknadsplattform för Sverige

## Vad är detta?
En komplett SaaS-webbplattform för svenska Pokémon TCG-samlare: prisbevakning, restock-alerts,
marknadsdata, samlingsvärde, kortskanning och community. Helt eget varumärke ("Foilio"),
egen design, egen copy (svenska). Nämn ALDRIG inspirations-/konkurrentsidor i kod, copy eller docs.

> Historik: detaljerade dagboksanteckningar per session ligger i git-historiken (commits + tidigare
> versioner av denna fil). Den här filen håller bara NULÄGE, durabla beslut och vad som är kvar.

## Nuläge
- **LIVE i produktion** på https://www.foilio.se — **Railway** (projekt `divine-reflection/PokeFinds`) + Neon serverless
  Postgres (Frankfurt). Deploy = `git push origin main` (Railway auto-bygger via Dockerfile, node:22-slim). INGEN `vercel --prod`
  längre — vi har lämnat Vercel. Railway BLOCKAR SMTP-portar → mejl skickas via Resend HTTP API (se `src/lib/mailer.ts`).
  OBS: apex `foilio.se` resolvar inte (NXDOMAIN) — använd `www.foilio.se` i länkar tills apex-DNS:en kopplas.
- **Katalog komplett**: ~173 set, ~20k singlar + ~1558 sealed-produkter (0 saknade set/kort mot pokemontcg.io).
- **Priser**: singlar = Cardmarket engelska NM-"From" (RapidAPI) × live-kurs; sealed = CM `lowest`. Graf/historik = CM trend.
- **Auto-uppdatering** via GitHub Actions (repot är publikt → obegränsade Actions-minuter):
  `cardmarket-refresh` (dagl 13:00 UTC) + `hot-card-refresh` (21:00), `tradera-sweep` (dagl 04:00), `scrape-all` (dagl 02:00),
  `restock-watch` (var 10:e min via extern pinger) + `restock-watch-manatorsk` (snabbfil var 2:a min).
  Jobben kör DB-skrivningar med `mapPool`-samtidighet så de hinner klart innan timeout.
  **restock-watch** = `runRestockScan()` i `src/scrapers/runner.ts` (ej längre tunga runScrapeJob-loopen): hämtar de
  restock-bevakade butikernas (config.restockWatch) kataloger PARALLELLT (bara HTTP → Neon sover), läser sedan befintliga
  offers EN gång och diffar lagerstatus per URL i minnet. Skriver BARA lagerövergångar (+ restock-alerts), inga pris-/
  observationsskrivningar. **KÄLL-CACHE (2026-07-07)**: källistan läses från diskcache (`<fingerprintfil>.sources.json`,
  TTL 24h, samma actions/cache-katalog) — innan dess väckte redan källist-uppslaget Neon på VARJE körning, så 2-min-
  snabbfilen höll computen vaken dygnet runt (~180 CU-h/mån). Oförändrad feed = ren HTTP, Neon sover. Täcker ALLA
  sealed-produkter butikerna aktivt säljer (singlar/marknadsplats-only = Cardmarket/Tradera = ej restockWatch). **AUTO-IMPORT (2026-07-05)**: en sealed
  butiks-URL utan Offer skapar/länkar nu automatiskt en katalogprodukt + offer via `ensureListingProduct()` (`src/scrapers/runner.ts`)
  — nya SKU:er dyker upp i appen utan manuell import, och feed-först-larmen länkar till VÅR produktsida (`Alert.productId`), inte butikens URL.
  Priser uppdateras av scrape-all/cardmarket-refresh. Kräver RESEND_API_KEY i workflow (annars console-mode = inga mejl).
  **Restock-alerts = Pro-only**: PRO-bevakare av produkten (`WatchlistItem.restockAlert` + `user.planTier=PREMIUM`) UNION Pro-användare med
  `notificationSettings.allRestocks=true` (opt-in "Alla restocks", default AV — larm för VILKEN sealed-produkt som helst). Gratisanvändare får
  INGA restock-larm. Union+dedup i `checkRestockAlerts` (`src/services/alerts.ts`). Master e-post-toggle respekteras ändå i `dispatchPendingAlerts`.
- **Funktioner live**: watchlist/prisbevakning, restock-alerts (8 butikskällor), samlingsvärde (live),
  AI-gradering (`/gradera`, Claude vision), live kort-skanner (`/skanna`, capture-baserad), community, admin, PWA.
- **Status**: 689/689 unit-tester gröna, `npm run build` grön.

## Öppna ärenden / Nästa steg
- **Neon-CU + Vercel Active CPU sänkta (2026-06-20)**: publika katalogsidor cachas nu (ISR) och chrome läser session
  klient-sida → drastiskt färre dynamiska renders + Neon-läsningar. Se "Caching/ISR" under Tekniska beslut. Kvar att bevaka:
  Neon free-tier transfer-tak (5 GB/mån) — om det fortsatt slår i taket: minska egress mer eller byt plan. Se docs/HOSTING.md.
- **Neon kostnadspass 2 (2026-07-07)**: (1) `computeChanges` (marknad/trend) aggregerar nu i SQL + delad 1h-cache —
  hämtade tidigare ~150k snapshot-rader per anrop ×3 anropare var 10:e min = merparten av ~30 GB egress/6 dgr;
  (2) startsidans showcase-groupBy (fullskan av PriceSnapshot) 24h-cachad; (3) /produkter-facetter 1h-cachade
  (force-dynamic-sidan körde 3 frågor per crawl-träff → ~900k CardSet-skanningar); (4) restock-snabbfilens käll-
  cache (se Auto-uppdatering) → scale-to-zero funkar igen; (5) robots.txt blockerar /produkter?-facettcrawl
  (oändlig dynamisk URL-rymd), sitemap = hela katalogen med weekly changefreq. Bevaka Neon-grafen efter deploy:
  compute ska nu vara piggar (batch-fönster) istället för 0,25 CU dygnet runt.
- **Restock Wave 3** (kvar): custom/JS-butiker maxgaming, sweetnerds, Spel & Sånt, playoteket, arcadedreams — fragila HTML/SPA,
  byggs en i taget MED verifiering. Spel & Sånt + Spelbutiken saknar adapter. Se [[project-pending-store-adapters]].
- **Mobilapp via Capacitor** (`android/` finns): kräver Apple/Google-konton; iOS-bygge kräver Mac/cloud-build (användaren på Windows).
- **Sealed CM-trendrad i pristabellen** kan vara fel pga felmappad `idProduct` (headline-lägsta är ändå rätt — butik vinner);
  kräver bättre sealed→idProduct-mappning.
- **Auto-import av sealed butiks-SKU:er = LIVE (2026-07-05)**: restock-skanningen skapar/länkar nu automatiskt en katalogprodukt
  för varje sealed butiks-URL utan Offer (`ensureListingProduct()`, dedup via `matchProduct`≥0.85 annars ny produkt). Nya sealed-
  produkter dyker alltså upp i appen utan manuell körning. **DUBBLETT-SKYDD (2026-07-07)**: (1) cross-produkt-URL-vakt — en
  butiks-URL som redan ägs av en produkt återanvänds, aldrig ny stub; (2) `cleanListingTitle()` (matching.ts) rensar butiksjunk
  ("MAX 1 per kund", "förhandsbokning", "(kopia)") innan matchning/namnsättning; (3) veckovis LLM-dedup (`src/jobs/dedupe-stubs.ts`,
  Haiku ~2 titlar/anrop, körs i store-health.yml) merge:ar stubbar som är samma SKU med annan butiksfrasering. Länk-revision =
  `scripts/audit-links.ts` (också veckovis, röd körning vid säkra fel).
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
- **SET-FILTRET: EN RUBRIK PER SERIE, DATUMLÖSA SET SIST (2026-07-29)**: set-sheeten grupperade på LÖPANDE serie, och
  eftersom listan är sorterad på releaseDate ligger promo-/POP-set inklämda mitt bland huvudserierna (SWSH Black Star
  Promos 2022-08-03 mellan två Sword & Shield-set) → 65 rubriker för 17 serier, "Sword & Shield" nio gånger. Det LÄSTE
  som att seten låg i fel serie. Grupperingen är nu en `Map` (samma som /sets-sidan): serieordning = där seriens nyaste
  set ligger, nyast först inuti serien. Och `orderBy` är `{ releaseDate: { sort: "desc", nulls: "last" } }` — Postgres
  lägger NULL FÖRST vid DESC, så ett datumlöst set (MEP Black Star Promos) låg överst som om det vore nyast.
- **Skannern: MÄT BILDMATCHNINGEN PÅ RIKTIGA FÅNGSTER (2026-07-29)**: konstavtrycket är live men dess verkliga
  träffsäkerhet är OMÄTT — alla siffror kommer från frågor härledda ur samma filer som referenserna (ett tak).
  Diagnostikraden i skannern visar `bild <likhet>` för admin; nästa steg är att samla riktiga fångster och jämföra
  bildens förslag mot vad text-matchningen valde. Ligger `bild` konsekvent högt för rätt kort kan `ART_WEIGHT` höjas
  och vision-anropet göras VALFRITT (Haiku behövs bara för att skilja tryckningar), vilket tar bort merparten av
  scan-kostnaden. Ligger den lågt: höj inte vikten, felsök avtrycket.
- **Skanner-modellen: MINDRE BRÅDSKANDE efter bildmatchningen (2026-07-29)**: Haiku 4.5 behövs nu bara för att läsa
  samlarnumret när det ÄR läsbart (för att välja tryckning), inte för att identifiera kortet. Kostnad/scan om det ändå
  ska bytas: Haiku 4.5 $0,0023 (+närbild ≈ $0,0029) · Sonnet 5 @1280px $0,0069 (intro $0,0046 t.o.m. 2026-08-31) ·
  Sonnet 5 @2576px högupplöst $0,016 · Opus 5 @2576px $0,027. Per Pro-användare vid kvottaket 100 scans/mån: $0,23 /
  $0,69 / $1,63 / $2,72 mot 49 kr (~$4,60) i intäkt. Gratis (30 scans, noll intäkt): $0,07 / $0,21 / $0,49 / $0,82.
  ⛔ Byter man modell: `max_tokens` är 256 i `claude-vision.ts`, och på Sonnet 5 är adaptivt tänkande PÅ som standard
  med `max_tokens` som tak för tänkande + svar — 256 trunkerar före verktygsanropet. Höj till ~2000 eller sätt
  `thinking: { type: "disabled" }`.
- **Genuint utan CM-marknadsdata**: ~868 singlar + ~24 sealed → ärlig "–"/döljs tills data finns.
- **Prishistorik byggs FRAMÅT** — ingen legitim källa ger äkta retroaktiv daglig historik (CM-graf får ej skrapas, RapidAPI ger bara 7d/30d-snitt).
- Stripe avstängd (`STRIPE_ENABLED=false`); web push förberett men kräver VAPID-nycklar.
- **Launch-readiness + kostnad-vid-skala**: levande checklista i `docs/LAUNCH-CHECKLIST.md` (Section 0 =
  kostnadshetspunkter vid samtidig trafik; bocka av `- [x]` allt eftersom). Öppna kostnadsposter: offers-refetch
  per produktvisning, `force-dynamic` på alla `/api/*`, ingen rate limiting, collection-värde live-compute.
- Övrigt: se docs/TODO.md.

## Tekniska beslut (VIKTIGA — ändra inte utan skäl)
- **GTIN = exakt cross-store-nyckel (2026-07-13)**: premissen "vi har ingen universell produkt-identifierare" var FEL.
  5 av 7 butiker publicerar tillverkarens streckkod (GS1-prefix `196214` = The Pokémon Company International, `4521329…`
  = Pokémon Japan). **Uppmätt täckning på riktiga prod-offers: 73%.** Vägar (varje butik sin egen — `src/scrapers/gtin-source.ts`):
  Shopify (DL/Speltrollet/Goblinen/Manatörsk/Samlarhobby) → `/products/{handle}.js` → variantens `barcode`
  (**`/products.json` innehåller INTE barcode** — ett negativt svar därifrån bevisar ingenting). **TA ALDRIG `variants[0]`**:
  en sortimentssida säljer flera SKU:er med var sin kod. Pekar URL:en ut en variant (`?variant=`) är koden DEN variantens;
  gör den inte det och varianterna är oense → INGEN kod (hellre ingen än fel). Samma fälla i JSON-LD-butikerna, fast osynlig:
  MaxGamings sortimentssida publicerar EN kod (Emboars) för tre boxar — den smittade Mega Meganium ex Box i katalogen.
  **En kod hämtad från en sida som säljer flera SKU:er identifierar ingen av dem.** Alphaspel/MaxGaming/
  Spelexperten → JSON-LD i **rå** HTML (`gtin` / `gtin8` / `gtin12` — MaxGamings nyckel heter gtin8 men värdena är 12–13
  siffror, längdvalidera ALDRIG till 8); Webhallen → `/api/product/{id}` → `eans[]`. Swepoke/Shinycards (Quickbutik) har
  ingen kod alls → permanent titelmatchning.
  **Normalisering är inte valfri** (`src/lib/gtin.ts`): samma vara skrivs `196214135017` OCH `0196214135017`; Webhallen
  skickar båda kodningarna i `eans[]`. Allt vänsterpaddas till GTIN-14 + GS1-checksiffra verifieras.
  **Arkitektur**: GTIN-träff → exakt join, hoppar över BÅDE fuzzy-poängen och Haiku-domen. GTIN-konflikt → **blockerar
  MERGE, aldrig LÄNKEN** (en falskt blockerad länk är värre än en felmatch — den syns aldrig). Titelmatchningen är
  DEGRADERAD, aldrig borttagen: den är svansens enda väg (Samlarhobby, Swepoke, äldre sortiment).
  **Hämtas ALDRIG i restock-lanen** (den kör var 2:a min → hundratals extra requests per körning). Bara vid auto-import
  av NYA SKU:er + `scripts/backfill-gtin.ts` (dagligen i scrape-all).
  **Gratis biprodukt**: `scripts/gtin-report.ts` — felaktiga butikslänkar (samma produkt, olika koder) och dubbletter
  (olika produkter, samma kod) med REN SQL, noll LLM-tokens.
  **Artikelnummer/SKU är fortfarande DÖTT** (ommätt: 14 av 1656 delas mellan butiker; DL kör egen räknare). MPN
  (`POK10407-101`) ser cross-store ut men butikerna hittar på egna (MaxGaming: `POK-AB-EYE-BB`). GTIN är en ANNAN
  identifierare — blanda ALDRIG ihop dem.
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
  (60) → inget larm (den lämnade aldrig hyllan); **(B) flapp** — fler än `RESTOCK_FLAP_MAX_TRANSITIONS` (6)
  övergångar/dygn → cooldown blir `RESTOCK_FLAP_COOLDOWN_HOURS` (24), dvs ett besked per dygn i stället för ett
  varannan timme. Tystar ALDRIG helt: att en het vara trillar in med jämna mellanrum är i sig information.
  MÄTT mot 21 dygns facit före ship (470 händelser): 177 → 147 larmtillfällen, värsta paren 12/6 → 7/3, och de enda
  par som blir helt tysta hade bara 30-minutersblinkar. Ren dom = `evaluateStockFlap` (testad utan DB).
  Själva historiken (produktsidan, /marknad, dashboard, `/api/market/restocks`) är ADMIN-ONLY — en lista där
  "i lager för 4 min sedan" oftast leder till en slutsåld sida är driftlogg, inte produktfunktion. Rollen läses
  KLIENT-sida (`useIsAdmin`, `restock-history.tsx`) och datat ligger INTE i ISR-payloaden — produktsidan hämtar
  det on-demand från det admin-grindade API:t. Sätt aldrig `auth()` i de ISR-cachade sidorna för detta.
- **Caching/ISR (kvot-kritiskt)**: publika läs-sidor är ISR-cachade, INTE `force-dynamic` (`revalidate=3600`): startsidan, `/marknad`,
  `/sets`, `/sets/[id]`, `/produkter/[slug]`. Data ändras ~1×/dygn så cache är osynlig; live-priser/offers uppdateras ändå klient-sida
  via polling. **Sätt ALDRIG tillbaka `force-dynamic` på dessa** utan skäl — det var orsaken till hög Vercel Active CPU + Neon-CU.
  Förutsättning: ingen server-`auth()`/`cookies()` i den delade chrome:n. Session läses därför KLIENT-sida i `header-auth-actions.tsx`,
  `bottom-tabs.tsx` (self-gate + egen klarerings-spacer) och `live-product-pricing.tsx` (admin-knapp). Rot-layouten + marketing-layouten
  + `SiteHeader` får INTE kalla `auth()` (då blir HELA appen dynamisk igen). `/produkter` är dynamisk med flit (läser searchParams).
  Produktsidans prishistorik: servern hämtar HELA serien en gång (`MAX_DAYS`), `product-price-card.tsx` filtrerar perioden i klienten
  (ingen URL-param → ISR-bar, ingen extra hämtning per periodbyte).
- **Stack**: Next.js 14 App Router, React 18, TypeScript strict, Tailwind CSS, Prisma, PostgreSQL
- **Växelkurs**: live via `src/lib/exchange-rate.ts` (`getRatesOre()` → Frankfurter, dygnscache, fallback 1150/1050 öre). Anropa i början av en ingest-körning; synkrona pris-funktioner läser `getCachedRatesOre()`. `EUR_SEK`-env pinnar kursen. Hårdkoda ALDRIG 11.50 igen — använd modulen
- **Singelpris**: `Offer.price` på singlar = Cardmarkets engelska **NM-lägsta ("From")** × live-kurs, hämtat från **CardMarket API TCG (RapidAPI Pro)** — `CARDMARKET_RAPIDAPI_*` i .env, fältet `prices.cardmarket.lowest_near_mint` (DECIMAL EUR; bas-fältet är engelska, `_DE`/`_FR`/`_ES`/`_IT` = språk-överstyrningar). Detta ÄR det engelska From-pris som löste det gamla lowPrice-problemet (pokemontcg.io `lowPrice` = all-språk/all-skick-golv som grovt underskattade — använd ALDRIG). Fyll via `scripts/rapidapi-fill-singles.ts` (set-paginering `/pokemon/episodes/{id}/cards`, matcha på `tcgid`=`tcgExternalId`, ~1000 anrop för hela katalogen). Exakt uppslag = `?tcgid={id}` (1 träff). **GOLVET RAKT AV — HELA REGELN (ägarbeslut 2026-07-24, OMBEKRÄFTAT 2026-07-27)**:
  priset = `lowest_near_mint` EXAKT som fältet står, även när CM:s billigaste NM-engelska annons är en enstaka feldyr/graderad
  (Rayquaza ★ · Deoxys: 37 000 € PSA 7-ask visas som 37 000 €). **INGENTING får byta ut det värdet.** `singlesHeadlineEur`
  är därför en enda rad: finns From publiceras From. Fallback BARA när From SAKNAS HELT: **medianen** av (guide.trend,
  guide.avg, guide.avg30, RapidAPI 30d) — ALDRIG guidens `low`, och aldrig en prioritetsordning (vilket fält som är korrupt
  varierar: guide.trend = 0,02 € på N · Noble Victories, RapidAPI 30d = 10,46 € på en Base-Charizard som guiden sätter till
  2 506 €). Uppskattningen märks **OUT_OF_STOCK** och rubriken byter till "Uppskattat värde · ingen aktiv annons" (469 singlar,
  258 sealed 2026-07-27).
  ⛔ **BYGG ALDRIG EN PER-KORT-VAKT PÅ `price_guide_6.json` IGEN.** Tre försök i rad har rivits, alla för att guiden inte är
  CM:s From: `fromElseTrend` (07-18→07-24, visade trenden under rubriken "Lägsta pris"), `fromContradictsCardmarket`→guidens
  `low` (07-25→07-27) och `fromExceedsCardmarket`→`cmGuideMedianEur` (07-27, levde ett dygn). **Beviset**: för Rayquaza Gold
  Star (idProduct 276510) säger guiden `low` = 2 900 € medan CM:s EGEN produktsida samma dag visar **From 37 000 €** för
  NM+engelska — precis vad feeden sa. Guidens `low` var 12x fel om det enda fall vi kunde kontrollera, och HELA golv-vaktens
  premiss ("engelska+NM ⊆ alla annonser ⇒ From ≥ guidens low") vilar på att `low` är produktens lägsta annons. Taket, byggt på
  samma fil, sänkte Rayquaza ★ till ~5 600 € och audit-skriptet vidare till **215,61 kr**. Att `lowest_near_mint` ÄR det
  engelska fältet syns i API:ts eget dokexempel: basen (1,00) ligger ÖVER `lowest_near_mint_DE` (0,90), vilket vore omöjligt
  om basen var "alla språk". **Skyddet mot korrupt feed ligger på KÖRNINGSNIVÅ**, inte per kort: `feedMoveShares` (>5 % av
  singlarna ≥10x på ett dygn → körningen avbryts RÖD utan skrivningar, `CM_FEED_BREAKER_*`-env). Ingen per-kort-dagklämma
  (kan inte skilja äkta ask-hopp från glitch utan att bli spärrhake).
  **IDENTITETSVAKT, TVÅ FRÅGOR (2026-07-26)** — gäller nu bara UPPSKATTNINGEN, men behövs precis lika mycket där:
  (1) `guideRowIsSingle` — är guide-radens `idProduct` ens en SINGEL enligt CM:s egen singel-katalog? RapidAPI gav Pidgey ·
  Flashfire 75/106 `cardmarket_id` 271938, som är en SEALED-produkt (finns i sealed-listan, saknas bland de 71 586 singlarna);
  radens `low` 295 € publicerades som kortets pris (3 262,70 kr för en common). Tom katalog (CDN-fel) = vakten står över
  körningen, aldrig "kasta alla rader". Vakten finns i BÅDA singel-jobben (cardmarket-refresh + hot-card-refresh).
  (2) `guideNameMatches` — är raden VÅRT kort? RapidAPI:s `cardmarket_id` kan peka på ett annat kort (`base1-2` Blastoise →
  291582 = "Rayquaza [Dual Claw | Dragon Blast]"). Döm ALDRIG identitet på prisavstånd — det kastar den rätta raden när det
  är RapidAPI som är trasig.
  **REVISION (rapport, aldrig reparation)**: `scripts/cm-range-audit.ts` (gratis, CM:s guide, ingen RapidAPI-kvot) listar
  priser långt utanför CM:s spann. `--apply` ÄR BORTTAGET: det skrev guide-medianer (fel policy) OCH band identiteten på ett
  normaliserat namn som fäller ihop olika CM-produkter — vårt "Rayquaza ★" blev "rayquaza" och matchade CM:s vanliga Rayquaza
  i EX Deoxys, varpå 160 rader skrevs om 2026-07-26 22:11 UTC. Rapporten hoppar nu över namn som är PREFIX till ett annat
  namn i expansionen (Rayquaza ⊂ Rayquaza Gold Star). Ett fynd betyder "kontrollera länken på Cardmarket", aldrig "skriv om
  priset" — golvet-rakt-av ligger med flit ibland utanför guidens spann. Ångra en sådan skrivning med
  `scripts/revert-guide-median-prices.ts` (återställer ur VÅR egen historik, ingen RapidAPI-kvot).
  ⛔ Cardmarket delar INTE längre ut API-nycklar; RapidAPI är enda vägen till `lowest_near_mint`.
- **RUBRIKEN NAMNGER KÄLLAN, DEN PÅSTÅR INGET (2026-07-26, utökad 07-27)**: "Lägsta pris · NM engelska (Cardmarket)" gäller BARA när
  den vinnande offern faktiskt är Cardmarkets OCH är I LAGER; vinner en marknadsplats/butik står "Lägsta pris · {källa}",
  och är den vinnande offern slutsåld står "Uppskattat värde · ingen aktiv annons ({källa})" (`lowestOfferSource` returnerar
  `{name, live}`, `src/lib/offer-source.ts` — samma urvalsregel som servern, och namnger källan bara om den bevisligen gav den
  visade siffran). En OUT_OF_STOCK CM-offer bär per definition en uppskattning, och "lägst bland NM-engelska annonser" är då ett
  påstående om annonser som inte finns — samma sorts fel som taket 07-27 gjorde med själva talet.
  Rubriken stod förut hårdkodad på varje singel: 2 751 singlar visade en Tradera-annons under rubriken "Cardmarket", och tre
  hela set hade ingen CM-offer alls. Samma sak i grafens underrubrik — den följer nu `trendSource` även för singlar
  (`rawSubtitleTradera`/`rawSubtitleStores`), tom serie = "Ingen prishistorik ännu". **MATCHNINGEN FÅR INTE HÄNGA PÅ `tcgid`**:
  RapidAPI publicerar tre lägen — rätt id (`me2-1`), CM:s setkod (`POR-1`, `CRI-1`) och `null` (hela Pitch Black) — så 366
  singlar i tre av de nyaste seten hade noll CM-data. Ordningen är nu tcgid → cardmarket_id → **set+samlarnummer+kortnamn**
  (SET+NUMMER-RESERVEN i cardmarket-refresh.ts). Namnvakten (`cmCardNameAgrees`) är hela poängen: CM listar Chaos Rising 77
  som "Great Haul Net" där vår katalog har "Emma" (78 omvänt) → numret ensamt hade prissatt fel kort, och vid oenighet
  prissätts INGET. Undantag bara för energityp som symbol vs utskriven ("Shadowy [D]" = "Shadowy Darkness"). Och `cards_total`
  i episodlistan LJUGER (0 för både MEP 412 och Pitch Black 415) → sidantalet läses ur svarets `paging.total`, aldrig ur
  metadatan. **GRAFEN** = publicerat headline-värde per dag; CM-serien visar SISTA observationen per dag, aldrig dagsmedel (`bucketObservationsBySource` — dagsmedel av en avbruten + en omkörd körning gav 175 439 kr som aldrig funnits). **DURABILITET + AUTO**: `runner.ts` låter inte trend-källan (Pokémon TCG API/TCGdex) skriva över singel-offer-priset; istället auto-uppdateras From dagligen av `src/jobs/cardmarket-refresh.ts` (`runCardmarketRefresh()`). Sealed-pris = CM `lowest` exakt via samma modul + `scripts/rapidapi-fill-sealed.ts` (matchnings-vakter behålls: boosterbox kräver "booster" i API-namn, poäng ≥0,55, butik-cross-check ×2.5 — men INGEN pris-utjämning)
- **BASE = TRE KATALOGPOSTER PER KORT (2026-07-28)**: Unlimited, Shadowless och 1st Edition är olika varor (Ponyta
  5,74 / 47,36 / 292,56 kr) och har egna produkter via `variantLabel` (`src/lib/print-variant.ts`). Den BEFINTLIGA
  produkten blev **Unlimited** — den behåller id, slug, historik, bevakningar och samlingsposter — och de två andra är
  nya. **101 av 102 kort delade** (304 produkter). Uppdelning = `scripts/split-base-printings.ts` (torrkörning default).
  **LÄNKEN PER TRYCKNING**: CM har TVÅ produkter per Base-kort — den ursprungliga (ordinarie) och en tillagd
  2022-05-24 där Shadowless OCH 1st Edition bor (1st Edition är en flagga på annonsen, inte en egen produkt). Paret
  bestäms av TVÅ oberoende signaler som måste vara ense: datumbatchen OCH att 2022-produkten är dyrare i CM:s guide.
  RapidAPI:s `cardmarket_id` DUGER INTE till det här: Chansey 1st Ed bär 273698 (den ORDINARIE produkten) och
  Blastoise bär 291582 (en Rayquaza) — MÄTT: 38 av 147 Base-rader pekar på fel CM-produkt, så feeden får aldrig
  sätta en tryckningsprodukts länk (`cardmarket-refresh` faller INTE tillbaka på `cardmarket_id` för dem).
  **PARET ÄR BATCHEN, INTE ANTALET (2026-07-28)**: regeln var först "exakt två CM-produkter med det namnet", vilket
  lämnade 10 kort odelade. Expansion 1523 har 104 produkter daterade `0000-00-00` (ordinarie), 103 daterade
  2022-05-24 (shadowless/1st Ed) och fyra udda — tre starters med en extra produkt från 2021-03-04 (prissatta som
  Unlimited i guiden, alltså varken Shadowless eller 1st Edition) och en Pikachu från 2018. Paret är därför den ENDA
  produkten i vardera batchen; övriga batchar är något tredje som vi inte modellerar. Prissignalen röstar över
  `trend`/`avg`/`low` med majoritet: enstaka guide-fält är mätbart trasiga (Drowzee och Machop har `trend` = 0,02 €
  på 2022-produkten medan `avg` och `low` säger tvärtom), så ett enfältstest läste fyra kort som "oense".
  Regeln validerad mot facit före körning: den reproducerar alla 270 befintliga länkar, 0 avvikelser.
  **PIKACHU 58 DELAS INTE**: CM har SEX produkter (V1–V6) där röda/gula kinder korsar tryckningarna — tre i
  ordinarie batchen, två i 2022-batchen. Det finns inget entydigt par att peka på, och hellre ett odelat kort än
  tre produkter med fel länkar. Kräver CM:s versionsetiketter (bara synliga på webben) för att lösas.
  **VARJE SINGEL-LÄNK SÄGER SITT TRYCKNINGSLÄGE UTTRYCKLIGEN** (`withFirstEd`, `src/lib/marketplace-urls.ts`):
  1st Edition-produkter → `isFirstEd=Y`, ALLA andra singlar → `isFirstEd=N`. ⛔ Att utelämna parametern är INTE
  "inget filter": CM lägger filtret i besökarens SESSION och stämplar tillbaka det på nästa produktsida hen öppnar.
  MÄTT 2026-07-28: en förfrågan till `?idProduct=273696&language=1&minCondition=2` — helt utan isFirstEd — landade
  på `.../Alakazam-V1-BS1?…&isFirstEd=N`, och samma dag fick ett annat kort tillbaka `&isFirstEd=Y`. Följden var att
  den som klickat på EN 1st Edition-länk sedan såg 1st Edition-annonser även på Unlimited-kortet (ägaren rapporterade
  det på Alakazam). För Shadowless är N dessutom rätt i sak: den delar CM-produkt med 1st Edition, och N är precis
  "allt utom 1st Edition-annonserna". `withFirstEd` är idempotent OCH korrigerande (skriver över fel läge).
  Sealed lämnas orört — CM stämplar in parametern där också, men sealed-sidan har varken skick- eller 1st
  Edition-filter i panelen och listan påverkas inte (verifierat: S&V Booster, 3 204 annonser med isFirstEd=N).
  ⛔ FILTRET STYRS AV PRODUKTEN, ALDRIG AV FEED-RADEN: villkoret stod först på radens `version`, så en 1st
  Edition-rad som prissatte en icke-tryckningsprodukt satte Y på DESS länk (Pikachu 58 fick det direkt).
  Engångsstädning = `scripts/fix-cm-firsted-links.ts`; de dagliga jobben håller nya länkar rätt.
  ⛔ **`?tcgid=` SVARAR BARA MED 1st EDITION-RADEN i vintage-seten** (mätt 2026-07-28: `?tcgid=base1-1` → EN rad,
  "1st Edition Shadowless"; `?tcgid=neo1-1` → "1st Edition"; ett modernt kort → omärkt rad). `runHotCardRefresh`
  tog `data[0]` och publicerade därför 1st Edition-priset på det ORDINARIE kortet varje kväll — några timmar efter
  att dagliga körningen valt rätt tryckning — och efter uppdelningen hade alla tre Base-tryckningarna fått samma
  rad. Jobbet kan INTE välja tryckning som dagliga körningen (den läser hela episoden och kan jämföra; här finns
  bara en rad), så regeln är konservativ: **raden måste VARA produktens tryckning**, annars skrivs ingenting och
  dagliga körningens värde står kvar (`pickRowForProduct`, testad utan DB). Följd: vintage-kort får ingen
  intradagsuppdatering — hellre det än ett pris från fel tryckning. Samma urval används av
  `scripts/repair-single-prices.ts`. Guide-raden för en tryckning hämtas ur OFFERNS `idProduct`, aldrig ur feedens
  `cardmarket_id`.
  **CM:s EGEN STAVNING** (`CM_SPELLING` i cardmarket-refresh.ts): CM skriver "Imposter Professor Oak" där katalogen
  har "Impostor" (Base 73) → namnvakten avvisade CM:s Unlimited-rad och produkten blev kvar på 1st Edition-radens
  pris (1 382 kr i stället för ~105 kr) efter uppdelningen. Tabellen är EXPLICIT: en generell stavningstolerans hade
  fällt ihop kort som verkligen är olika. Vakten hade rätt — den saknade bara ordboken.
  **ROUTNING** i cardmarket-refresh: `tcgid|etikett` → `idProduct|etikett` → `setId|nummer|etikett`. Alla tre behövs —
  i Base bär BARA 1st Edition-raden `tcgid`, och holornas Unlimited-rader heter `card_number: "BS 4"` (inte "4") så
  nummerreserven missar dem. Utan idProduct-nyckeln stod Charizard Unlimited kvar på ett gammalt 1st Edition-pris
  (3 205 € i stället för 340 €).
  **BARA UNLIMITED FÅR UPPSKATTAS**: Shadowless och 1st Edition delar CM-produkt ⇒ samma guide-rad ⇒ en uppskattning
  hade gett båda SAMMA värde. De publiceras bara med ett äkta From; annars pris "–". Unlimited har en egen CM-produkt
  och uppskattas som vanligt (annars hade 85 av 92 Base-kort tappat sitt pris). Guide-raden hämtas från OFFERNS
  länkade `idProduct`, aldrig från feed-radens `cardmarket_id`.
  **SYNLIGHET**: `buildProductWhere` gömmer prislösa produkter — tryckningar är UNDANTAGNA, annars hade en sökning på
  "charizard base" visat en av tre. **TRADERA-VAKT** (`printLabelInTitle`): de tre delar kortnamn OCH kortnummer, så
  singel-identiteten gav tre lika starka träffar och fuzzy-poängen fick avgöra. En annons som inte SÄGER "1st
  edition"/"shadowless" är per konvention Unlimited.
  ⛔ **VAKTEN FAILADE ÖPPET FÖRSTA DYGNET (2026-07-28)**: `variantLabel` var ett VALFRITT fält på
  `matchListingToProduct`, och INGEN anropare valde ut det ur databasen → `undefined` föll rakt igenom
  `isPrintVariantLabel` och vakten var bortkopplad i BÅDA Tradera-vägarna (svepets `pickRailCandidates` och
  `findReplacementListing`). Mätt morgonen efter uppdelningen: 84 Shadowless- och 39 1st Edition-produkter fick en
  offer från en annons som bara sålde det ordinarie kortet (Blastoise 1st Edition visade 119 kr; två annonser sa
  uttryckligen "base set unlimited"), plus 1 156 skena-rader och 128 grafpunkter. Fältet är nu OBLIGATORISKT — samma
  miss blir ett TYPFEL i stället för en tyst felmatchning. Samma lärdom som tcgid-incidenten: **ett fält som saknas
  på objektet gör att vakten failar öppet**, så vakter ska kräva sina indata, inte hoppas på dem.
  **ATT TA BORT OFFERN RÄCKER INTE**: svepet skriver en `PriceObservation` per offer och produktsidans graf ritar en
  serie PER KÄLLA ur dem — felmatchens pris låg alltså kvar som en Tradera-KURVA på kort där bara Cardmarket har ett
  pris. `scripts/repair-marketplace-offers.ts` har därför en **Fas 4** som vetar historiken med samma matchare
  (annonstiteln finns i `rawData`), tidsfönster `OBS_DAYS`=7 (~24k rader; hela historiken är ~170k). **SKANNERN** rör inte tryckningar: den matchar på Card och
  `getCardValues` tar lägsta produkten (= Unlimited); vill man ha en specifik tryckning lägger man till den från dess
  produktsida (produktsidan listar redan syskonvarianterna).
- **TRYCKNINGEN ÄR IDENTITET, INTE EN PRISNIVÅ (2026-07-28)**: RapidAPI publicerar EN RAD PER TRYCKNING (`version`:
  "1st Edition", "1st Edition Shadowless", "Shadowless", "Unlimited") i de tio WOTC-episoderna — och hänger `tcgid`
  på **1st Edition**-raden. Vår starkaste nyckel valde därför systematiskt den dyraste tryckningen fast katalogen
  (pokemontcg.io, en post per kort) bara innehåller det ORDINARIE kortet: Ponyta · Base 60/102 publicerades som
  26,50 € i stället för 4,29 € (292,56 kr mot 47,36 kr). `printRank()` rangordnar därför Unlimited/omärkt > Shadowless
  > 1st Edition, och `feedRowWins` väger TRYCKNINGEN före nyckelstyrkan. Mätt över alla tio episoderna (1 983 rader,
  940 av våra kort): 154 kort prissätts nu av den ordinarie tryckningen; värst var Bill · Base 91 (220,80 → 0,22 kr),
  Super Potion · Base 90 (662 → 0,77 kr) och Ninetales · Base 12 (11 040 → 221 kr).
  ⛔ **BARA en rad med BEVISAT äkta `lowest_near_mint` får vinna på tryckning.** Låter man rätt tryckning vinna utan
  det villkoret faller `singlesHeadlineEur` till guide-medianen på radens `cardmarket_id` — ofta fel produkt. Mätt i
  produktion: Sabrina's Gaze · Gym Heroes 125 skrevs 0,55 € → **434,04 €** (Unlimited-radens 30d-snitt) innan villkoret
  satt. `undefined` är INTE bevis för att From saknas — kandidaten måste bära `from` på toppnivå, inte bara i `op`
  (det var exakt buggen). Saknas From på den ordinarie tryckningen behåller vi hellre dagens pris än gissar.
  Reserv-nyckeln (set+nummer) KONSUMERAS INTE längre: i Base svarar tryckningarna i block, så Shadowless-raden åt upp
  nyckeln och Unlimited-raden föll bort innan den fick tävla. Flera rader mot samma produkt är ofarligt när exakt en
  kan vinna.
- **DE NIO ANDRA WOTC-SETEN GÅR INTE ATT DELA (mätt 2026-07-28)**: `version`-raderna är printningsspecifika BARA när
  CM har en egen produkt per tryckning. I Jungle/Fossil/Team Rocket/Gym/Neo har CM **en produkt per kort** (111 av 115
  kort delar `cardmarket_id` mellan tryckningarna), och feedens From gäller PRODUKTEN: av 123 kort med From på båda
  tryckningarna är **88 exakt identiska** och de övriga 35 skiljer 0,6–1,1x (8 mot 8,50 €). I Base — där CM la till en
  ANDRA produkt 2022-05-24 — är 0 av 23 identiska och skillnaden 6–66x (Hitmonchan 18,10 mot 1 200 €). En uppdelning
  av de nio seten skulle alltså ge två katalogposter med SAMMA pris, dvs en påhittad precision. Vill man ha äkta
  1st Edition-priser där krävs en källa som prissätter per tryckning; CM:s filtrerade sida (`isFirstEd=Y`) visar
  annonserna men API:t ger inte talet. ⚠️ Den gamla öppna posten ("~730 vintage-kort prissätts av fel tryckning,
  60 st ≥3x över pokemontcg.io:s trend") byggde på att version-raderna ÄR printningsspecifika — det stämmer inte i de
  här seten. Deras pris är den delade produktens NM-engelska golv, samma policy som resten av katalogen. Mät om innan
  någon agerar på den. Revision: `scripts/print-variant-audit.ts` (`--sweep` → `--fetch=…` → `--report`).
- **SKANNERN IDENTIFIERAR PÅ UTSEENDE, INTE PÅ TEXT (2026-07-29)**: samlarnumret trycks ~2 mm högt. På en fysisk
  kortbild går det att läsa; i en skärmfotografering eller ett suddigt foto FINNS informationen inte i bilden, och då
  kan ingen modell och ingen upplösning laga det — mätt i produktion svarade Haiku med kortets HP ("110", tryckt stort
  uppe till höger) och sedan med ett påhittat "172/167". `Card.artFingerprint` (264 byte = 8×11 celler × RGB, int8,
  `src/lib/art-fingerprint.ts`) matchar kortets FÄRGLAYOUT mot hela katalogen i stället.
  **MÄTT** (`scripts/art-audit/`, hela katalogen som referens = 20 431 bilder, 300 frågor försämrade som
  skärmfotograferingar): topp-15 **99,7 % mild / 96,0 % hård** försämring, topp-1 93,3 % / 86,0 %.
  ⛔ **FINARE RUTNÄT ÄR SÄMRE** — 24×33 (2 376 dim) ger 98,3 % mot 8×11:s 99,7 %, för självlikheten efter försämring
  faller 0,918 → 0,764: fin detalj överlever inte en dålig bild och bidrar med brus. Det är också skälet att INGET
  neuralt nät valdes (CLIP/DINOv2): deras styrka är finkorniga särdrag, och vi har MÄTT att finkorniga särdrag inte
  hjälper här. Höj inte rutnätet utan att köra om revisionen.
  **KOSTNADSFORMEN (ägarkrav: ingen stor Neon/Railway-träff)**: klienten räknar avtrycket i canvas och skickar **264
  byte UPP** — den laddar aldrig ner indexet (5,4 MB per besökare hade varit Railway-egress). Sökningen är en linjär
  genomgång i processminnet (`src/services/scanner/art-index.ts`), indexet hålls som **int8 (5,4 MB), inte float32
  (21,6 MB)** eftersom minne är ~92 % av Railway-notan, och det laddas **LATT vid första skanningen** — aldrig på
  toppnivå eller på timer, så Neons scale-to-zero bevaras. En delad in-flight-promise hindrar att två samtidiga
  skanningar läser 5,4 MB var vid kallstart. Per skanning går Neon-arbetet NER: bilden ger kort-id, så vi hämtar ~15
  rader på PRIMÄRNYCKEL i stället för ännu en genomsökning. Ingen pgvector — ett ANN-index sparar CPU vi inte saknar
  och kostar minne vi betalar för.
  ⛔ **EN ENDA implementation av avtrycket.** Servern läser 3 kanaler (sharp `.raw()`), klienten 4 (`getImageData`), och
  BÅDA anropar `fingerprintFromRgb`. All aritmetik inklusive nedskalningen (rent boxmedelvärde) ligger där: ett
  mellansteg med `resize()` hade smugit in bibliotekets omsamplingsfilter i nyckeln, och sharps lanczos är inte
  canvasens utjämning. Testet `art-fingerprint.test.ts` jämför 3- och 4-kanalsvägarna byte för byte — samma sorts vakt
  som `Card.numberSortKey` mot `cardNumberSortKey()`.
  **BILDEN FÖRESLÅR, NUMRET AVGÖR**: `ART_WEIGHT` (0,3) är medvetet LÄGRE än nummerbonusen (0,4–0,5). Ett läst
  samlarnummer är ett exakt bevis, bildlikhet en gradering — väger bilden tyngre börjar den välja fel TRYCKNING (Base
  Unlimited/Shadowless/1st Edition har identisk konst och skiljs BARA av numret). Kandidaterna läggs dessutom TILL
  text-matchningen, de ersätter den aldrig: bildmatchningens verkliga träffsäkerhet är omätt (alla siffror kommer från
  frågor härledda ur samma filer som referenserna, dvs ett tak), så värsta fallet ska vara att bilden inte hjälper.
  ⛔ **AVTRYCKET ÄR EN VAKT SOM FAILAR TYST.** `numberSortKey` räknas av Postgres (GENERATED) just för att ingen import
  ska kunna glömma den; ett avtryck kräver bildavkodning och kan inte genereras i databasen. Det byggs av
  `scripts/build-art-fingerprints.ts`, som körs i `import-new-sets.yml` EFTER set-importen. Tas det steget bort blir
  nya kort osynliga för bildmatchningen utan att något felar. Ändras rutnätet krävs `FORCE=1` för hela katalogen —
  avtryck med fel längd hoppas över (aldrig jämförda), så följden är tysta bortfall, inte fel träffar.
  ⛔ **MARGINALEN RUNT KORTET ÄR DEN ENSKILT STÖRSTA FELKÄLLAN (fix 2026-07-30)**: avtrycket räknades först på det
  MARGINALFÖRSEDDA utsnittet (`CROP_PAD` 6 %), medan indexet är byggt på katalogbilder som är EXAKT kortet. Vid ett
  8×11-rutnät smittar ytterringen **34 av 88 celler**. MÄTT på Falinks TG07 (hård försämring): utan marginal plats 1
  och likhet 0,989 — med 6 % marginal UTANFÖR topp-15, bästa träff 0,547. Över hela katalogen föll topp-15 från 96 %
  till **15 %**. Revisionen rapporterade ändå 96 %, för dess simulerade felbeskärning skär IN i kortet i stället för
  att lägga bakgrund runt om; profilen `padded` + `PAD=`-övrestyrningen finns nu så samma miss inte kan upprepas.
  Avtrycket räknas därför på ramen UTAN marginal (`fx/fy/fw/fh` i `captureFrame`) — bilden till modellen behåller
  marginalen, så ett snett kort inte tappar numret.
  **OCH DET RÄCKER INTE ATT TA BORT DEN FASTA MARGINALEN**: känsligheten är brutal (topp-15 mot marginal: 0 % → 96 %,
  1 % → 94 %, 2 % → 84 %, 4 % → 49 %, 6 % → 15 %) och en handhållen fångst sitter inte inom 1–2 %. Klienten skickar
  därför ett **INSET-SVEP** (`FINGERPRINT_INSETS` = 0 / 3 / 6 / 9 %): samma fångst beskuren fyra gånger, och servern
  tar varje korts BÄSTA likhet (`searchByFingerprints`). MÄTT: topp-15 blir **93 % oavsett marginal** (mot 87/51/18 %
  vid 2/4/6 % med ett enda avtryck). ⛔ Slå ihop varianterna med MAX, aldrig medelvärde — bara EN beskärning är den
  rätta, så ett medelvärde drar ner rätt kort med brus från de felbeskurna. Kostnaden är ~1 kB upp och fyra sökningar
  à ~10 ms; `getImageData` körs EN gång och insetet appliceras i `fingerprintFromRgb` (delad kod, samma aritmetik som
  indexet).
  **132 kort har döda bild-URL:er** uppströms (mcd17/mcd18 + en promo, 404 på både hires och liten variant) → de får
  inget avtryck och matchas som förut på namn/nummer.
- **SKANNERN: NUMRET ÄR IDENTITETEN, OCH KANDIDATURVALET VAR ETT SLUMPURVAL (2026-07-29)**: "skannern gissar fel kort"
  lästes som ett modellproblem (Haiku), men modellen var bara halva kedjan. `matchCards` hämtade kandidater med ett `OR`
  över namn-tokens och `take: 50` UTAN `orderBy` — Postgres returnerar då de 50 rader planen råkar ge. MÄTT mot prod:
  18 938 av 20 563 kort (92 %) delar namn med minst ett annat kort, "charizard" ger 111 kandidatrader och "pikachu" 178
  → rätt kort låg utanför urvalet ungefär varannan gång, och VILKA 50 varierade mellan körningar. Dessutom jämfördes
  numret som `parseInt(card.number, 10)`, vilket ger `NaN` för VARJE bokstavsnumrerat kort ("TG10", "GG08", "SWSH034",
  "SV075") och tappar suffixet på "130a" — alltså exakt de tryckningar någon bryr sig om att skanna (Trainer Gallery,
  Shiny Vault, promos); vanliga commons skannar man inte. Numret jämförs nu som STRÄNG mot `Card.numberSortKey`
  (indexerad GENERATED-kolumn) via `parseGuessedNumber().sortKey`, och kandidater hämtas ur TRE unionade källor:
  nummer+namn, bara nummer (räddar felstavat namn), bara namn (räddar oläst nummer). Namn-tokens matchas AND-först med
  OR som reserv — "Iron Valiant ex" som OR drog in varenda Iron Hands i katalogen. Bokstavsnummer UTAN siffror hanteras
  också ("H", "ONE"): 31 kort är Unowns eget alfabet, och "O/115" lästes förut som kort 115 (totalen).
  **FACIT** = `scripts/scanner-match-audit.ts` (matar matchCards med kortets EGET namn+nummer, dvs en felfri simulerad
  OCR; läser bara, n=400/profil): topp-1 86,5 % → **100 %** (uniformt urval) och 91,0 % → **99,8 %** (kort vars namn
  delas av ≥5 andra). Utan läsbart nummer: 21 % / 8,5 % topp-1 — strukturellt otillgängligt, det finns ingen annan
  särskiljare när 92 % delar namn. ⛔ Följden: HELA skannerns träffsäkerhet hänger nu på att modellen läser
  SAMLARNUMRET rätt. En modelluppgradering ska mätas mot det, inte mot "känns bättre".
- **SKANNERBILDEN BESKÄRS TILL KORTRAMEN (2026-07-29)**: `captureFrame` skickade hela videorutan trots att overlayen ber
  användaren lägga kortet i en ram som täcker ~1/3 av ytan — två tredjedelar av de vision-tokens vi betalade för var
  skrivbord och hand, och kortet fick ~0,4 MP av bildbudgeten. Utsnittet MÄTS nu med `getBoundingClientRect()` på både
  video- och ram-elementet och räknas om genom `object-cover`-matten till källpixlar (+6 % marginal). ⛔ Räkna ALDRIG på
  overlayens `w-[68%]`/`mb-[14vh]` i stället — hårdkodade tal börjar tyst beskära fel dagen någon rör ramen, och ett fel
  utsnitt kapar numret, vilket är värre än ingen beskärning alls. Kortet får ~2,7× fler pixlar till SAMMA token-kostnad
  (utsnittet skalas till samma längsta sida, `CAPTURE_MAX`). ⛔ Haiku 4.5 tar emot max 1568 px längsta sida (~1,15 MP)
  och skalar ner allt däröver SERVER-SIDE — att höja `CAPTURE_MAX` ger alltså ingenting på Haiku. Vägen till fler pixlar
  på numret är beskärning eller en modell med högupplöst vision (Sonnet 5 / Opus 5: 2576 px, ~4784 bildtokens).
- **Samlingsvärde**: live via `computeCollectionValue`/`valueCollectionItems` (`src/services/collection.ts`) → `getCardValues`/`getProductValues` (`src/services/products.ts`) = produktens lägsta pris (singel = CM-trend, sealed = butik) × live-kurs. Faller tillbaka på lagrat `estimatedValue` (ögonblicksbild vid tillägg) när live saknas. Skannade kandidater visar samma värde via `estimateCardValue`
- **AI-gradering**: adaptermönster i `src/services/grading/` (`GradingAdapter` + mock + Claude vision). Plan→modell: FREE = `GRADING_MODEL_FREE` (Haiku 4.5, max `GRADING_FREE_MONTHLY_LIMIT`=3/månad), PREMIUM = `GRADING_MODEL_PREMIUM` (Sonnet 4.6, max `GRADING_PREMIUM_MONTHLY_LIMIT`=15/månad). `GRADING_PROVIDER=mock` i dev. Strukturerat svar via tvingat verktyg (`report_grade`). Det är en UPPSKATTNING, aldrig en officiell PSA/BGS-grad — UI:t är tydligt med det
- **PWA/app**: installerbar via `public/manifest.json` + `public/sw.js` (registreras i prod av `src/components/pwa-register.tsx`). Vägen till app-butiker senare = Capacitor-wrapper runt samma Next-app (ingen UI-omskrivning)
- **CM-länkar = exakt slug med `?language=1`** (+ `&minCondition=2` på singlar): visa ALDRIG en bar `prices.pokemontcg.io/cardmarket/{id}`-redirect (302:n strippar language=1). Lös den till `cardmarket.com/.../Singles/...?language=1` via `resolve-cm-urls.ts` (streaming-pool, resumerbar). `isDirectOfferUrl()` döljer olösta redirects; `runner.ts` bevarar lösta slug-länkar framför inkommande redirects (annars skriver 8h-jobbet över dem). **Near Mint**: singel-länkar har även `&minCondition=2` (=NM och bättre) via `withNearMint()` — idempotent. Sealed: INGET minCondition (inget skick)
- **Designtokens**: SVART yta + turkos signaturaccent (`holo.cyan` = `#2dd4bf`). Allt färgsätts via tokens i `tailwind.config.ts` — undvik hårdkodade hex/`*-blue-*`-klasser i komponenter så att tema förblir centralt.
  **YTAN ÄR SVART SEDAN 2026-07-29** (var charcoal `#0a0a0c`/`#141417`): `surface` OCH `surface-raised` = `#000000`. Kortet ligger
  alltså på samma yta som sidan och separeras BARA av hårlinjen (`surface-border` `#2a2a30`) + inset-highlighten i `.card-surface`
  (`rgba(255,255,255,.03)` — `.02` räckte på charcoal men syns inte alls på svart). ⛔ **`surface-overlay` (`#1d1d21`) är INTE en
  bakgrund och ska INTE sänkas till svart**: den är en interaktiv FYLLNING — hover-rader (`hover:bg-surface-overlay/50`), aktiva
  flikar, progress-spår, skeletons, bild-platshållare. På svart försvinner alla de spåren. Följdregeln: en yta som ligger PÅ
  overlay (menypanelen i `dropdown.tsx`, träfflistan i `collection-client.tsx`) måste hovra till något LJUSARE än overlay
  (`surface-border/50`) — `surface-raised` är numera mörkare och gav en bakvänd hover. Samma sak för fyllda pillar utan kant:
  `bg-surface-raised` är osynlig på ett svart kort.
- **SIDANS VÅGRÄTA LUFT = 10px PÅ MOBIL (2026-07-29)**: varje sidbehållare kör `px-2.5 sm:px-6` — samma tal som
  rutnätets gap (10px), så luften utanför korten är exakt luften mellan dem. Den var 16px (`px-4`) och läste som en
  bred ram runt en smal app. Talet delas av ALLT som möter kanten: sidbehållarna (marketing + app-shellens `<main>`),
  `SiteHeader` och `SiteFooter` — annars ligger inte logotypen i linje med korten, och sökfältet (som bor i sidans
  behållare) blir bredare än rutnätet. ⛔ **Ändrar du talet måste varje kant-till-kant-rad följa med**: de bleeder med
  `-mx-2.5` + `px-2.5`/`pl-2.5` (chip-raden i `explore-filter-bar`, "Nyss släppt"-rälsen på /produkter, liknande
  produkter i `product-detail-view`, samlingsgrafen). Ett kvarglömt `-mx-4` mot en `px-2.5`-behållare skjuter 4px
  utanför viewporten på VARJE sida → hela sidan går att dra i sidled. ÅTERSTÄLLNING: taggen `kortlayout-v2` = exakt
  utseendet före det här passet.
- **APPEN ÄR LÅST TILL PORTRÄTT, OCH BREDD ENSAM BETYDER INTE DESKTOP (2026-07-29)**: native-appen är en WebView över
  den hostade webbappen, så en telefon i liggande läge (844–932px bred, ~430px hög) tog `md:`-grenen och webbens
  toppnavigering dök upp ovanför bottentabbarna — mitt i appen. Låset sitter på båda plattformarna:
  `android:screenOrientation="portrait"` (AndroidManifest, incheckad) och `UISupportedInterfaceOrientations` = bara
  porträtt för iPhone. ⛔ **iOS-låset bor i `codemagic.yaml`, inte i `ios/App/App/Info.plist`** — `ios/` är gitignorerad
  och genereras färskt av `cap add ios` vid varje bygge, så en ändring i plisten skrivs över (samma sak som
  kamera-usage-strings och entitlements redan gör där). iPad-nyckeln lämnas orörd — där ÄR desktop-layouten rätt.
  Båda kräver ett NYTT native-bygge; en `git push` räcker inte. Webben/PWA:n har samma regel på sitt eget sätt: `orientation: "portrait"` i
  `public/manifest.json` + skärmarna `sm-tall`/`md-tall` i `tailwind.config.ts`
  (`(min-width: …) and (min-height: 600px)`), som headerns navigering och "Översikt"-knappen använder i stället för
  `md:`/`sm:`. ⛔ Grinda desktop-chrome på HÖJD också när ytan bara kan vara en telefon på tvären — annars fixar låset
  bara appen och lämnar webben trasig (och skyddar inte om OS:et överstyr låset).
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
- **FUZZY SÖK = RÄDDNING, INTE FÖRBÄTTRING (2026-07-29)**: `pg_trgm` (migration 20260729180000) används BARA när den
  exakta ordsökningen ger NOLL träffar. Påslaget för lyckade sökningar hade "charizard" dragit in "charmander"
  (likhet ~0,35). Reserven är en UNION av två mått, för de missar olika saker (mätt): `similarity()` (hela titeln)
  hittar "pikatchu" men inte "prismatik" i en lång titel; `word_similarity()` (bästa ordföljd) tvärtom. GIN-indexet
  på `normalizedTitle` gör dessutom att den vanliga delsträngssökningen slipper seq-scanna 22k rader.
- **A–Ö/Ö–A SORTERAS PÅ `normalizedTitle`** (inte `title`): den är redan gemener utan diakriter (`[a-z0-9 /-]`) och
  indexerad, så ordningen blir densamma i databasens C.UTF-8-collation som i JS — och sorteringen paginerar över hela
  katalogen i SQL. Mätt före bygget: bara 186 av 22 457 titlar börjar på "pokemon", så listan klumpar inte ihop sig.
  In-memory-vägen jämför med rak kodpunktsjämförelse, ALDRIG `localeCompare` (annan ordning än databasens).
- **Offers = endast direkta länkar**: visa aldrig sök-/bläddringslänkar som offers. `isDirectOfferUrl()` vaktar både UI och prisstatistik. Butiksfilter kräver IN_STOCK + direkt länk. Direkta länkar UTAN pris visas ändå (pris "–")
- **TCG-import paginering**: använd ALDRIG `orderBy=number` i `fetchTcgCardsForSet` — pokemontcg.io:s string-sort tappar kort mellan sidor. Set kan ha >250 kort (totalCount), paginera stabilt utan orderBy
- **Auth**: NextAuth v4 med Credentials provider + JWT-sessioner. RBAC via `role` på User (USER/MODERATOR/ADMIN/SUPERADMIN)
- **DB**: PROD = Neon serverless Postgres (Frankfurt), connection-string i `.env` som `NEON_DATABASE_URL`. DEV = lokal PostgreSQL 18 (tjänst `postgresql-x64-18`), databas `pokefinds`, user `postgres`, lösen `pokefinds-local`. Docker behövs INTE. `DB_POOL`-env sätter `connection_limit` för batch-jobb
- **Prod-DB från CLI — ANVÄND ALLTID `scripts/with-prod-db.mjs`**:
  ```bash
  node scripts/with-prod-db.mjs npx tsx scripts/x.ts     # läser .env internt, skriver ut måldatabasen
  ```
  Gräv ALDRIG fram hemligheten i skalet (`DATABASE_URL="$(grep NEON_DATABASE_URL .env …)" npx tsx …`).
  Det mönstret materialiserar lösenordet i kommandoraden → terminalhistorik, loggar och
  agent-transkript. 2026-07-13 grep:ade en subagent fram connection-stringen och skrev ut delar
  av den i sitt verktygsutdata (lösenordet nådde aldrig disk — men det var tur, inte design).
  Wrappern skickar värdet som miljövariabel till barnprocessen; det passerar aldrig ett skal.
  `.claude/settings.json` NEKAR dessutom läsning av `.env` (Read + vanliga cat/grep) — en spärr
  i djupet, inte ett fullgott skydd: ett skal kan alltid läsa en fil på något sätt. Det riktiga
  skyddet är att ingen BEHÖVER hemligheten.
- **Cache/queue**: Redis valfri — koden degraderar graciöst utan Redis (in-memory fallback i `src/lib/queue.ts`)
- **Charts**: recharts (lazy-laddad via `PriceChartLazy`)
- **E-post**: nodemailer, console/JSON-transport i dev (`EMAIL_MODE=console`), SMTP i prod
- **Validering**: Zod överallt på API-gränser
- **Shopify-sortiment = flera SKU:er på EN sida (2026-07-14)**: `ShopifyAdapter` splittar en produkt vars varianter
  bär KARAKTÄRSNAMN till en annons per variant (`?variant=…`, eget pris/lager — se `splittableVariants`). Grinden är
  smal med flit och MÄTT mot butikernas riktiga feedar: ~100 av Speltrollets flervariant-produkter är färgkartor
  (sleeves/pärmar/tärningar) — splittas de blir varje FÄRG en annons med huvudboksrad och ett "ny produkt"-larm.
  Kräv därför att VARJE variant nämner en Pokémon + tillbehörsvakten. Migrering av gammal data:
  `scripts/split-shopify-variants.ts` (torrkörning default).
- **Scrapers**: Adapter-mönster i `src/scrapers/`. Riktiga adapters MÅSTE respektera robots.txt, rate limits, tydlig user-agent. Ingen captcha/login-bypass. Rå data sparas i `PriceObservation.rawData`. Samtidighet via `mapPool` (`src/lib/concurrency.ts`) i batch-jobben; runner-loopen lämnas sekventiell med flit (billigast-vinner + restock-dedup)
- **Skanning**: `src/services/scanner/` — OCR-adapter-interface med mock + `ClaudeVisionOcrAdapter`. Riktig vision via `OCR_PROVIDER=claude`
- **Priser**: lagras i öre (integer) för SEK, `currency`-fält. Visa via `formatPrice()` i `src/lib/format.ts`
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
- **Dygnsnyckel = UTC, aldrig lokal midnatt**: `PriceSnapshot.date` är `@db.Date` (UTC-datum). Använd `utcToday()`/`utcDaysAgo()` i `src/lib/utils.ts` — `d.setHours(0,0,0,0)` ger LOKAL midnatt, och på svensk tid (UTC+2) skriver en manuell jobbkörning då tyst på GÅRDAGENS rad (hände 2026-07-25: en lokal omkörning klobbrade 07-24 och lämnade 07-25 orörd). Actions kör i UTC så felet syns aldrig i drift
- **Tradera-annonsens kortnummer måste vara produktens** (`matching.ts`): `cardNumberKey` behåller bokstavsSUFFIX (`115a` ≠ `115` — league-promo vs uncommon) och `bareCardNumbers` fångar nummer utan "/total" ("Milotic ex 42" får inte hamna på specialarten 217). Konservativ: setnamnet 151, "annons 2", mängd/pris och årtal filtreras bort. 707 gamla felmatchningar städade 2026-07-25 — alla bevisade (numret fanns som eget kort i samma set)

## Kommandon
```bash
# Postgres körs redan som Windows-tjänst (postgresql-x64-18) — ingen Docker behövs
npm install                     # (--legacy-peer-deps vid peer-konflikt)
npx prisma migrate dev          # migrera
npx prisma db seed              # seeda
npm run dev                     # dev-server på :3000
npm test                        # vitest (83 tester, gröna)
npm run test:e2e                # playwright (kräver seedad DB)
npm run import:tcg              # hämta färsk kortdata från pokemontcg.io
npm run scrape                  # kör skrapare manuellt
```

## Demo-konton (lokal seed)
- admin@pokefinds.se / admin1234 (SUPERADMIN)
- demo@pokefinds.se / demo1234 (USER)
- OBS: dessa lösenord är ROTERADE på prod (repot publikt) — gäller bara lokal seed.

## Mappstruktur
```
src/
  app/           # Next.js App Router (sidor + api routes)
  components/    # UI-komponenter (ui/ = design system, features/ = sammansatta)
  lib/           # db, auth, format, queue, validation, concurrency, exchange-rate, marketplace-urls
  services/      # affärslogik (products, watchlist, alerts, collection, scanner, grading, community)
  scrapers/      # adapter-system + adapters/ (riktiga butiker)
  jobs/          # bakgrundsjobb (scheduler, worker, cardmarket-refresh, tradera-sweep, restock-watch)
  emails/        # e-postmallar
  types/         # delade typer
prisma/          # schema + seed
scripts/         # durabla CLI-verktyg (import, fill, refresh, runners) — engångsskript ligger i git-historiken
tests/           # unit + e2e
docs/            # all dokumentation
.github/workflows/  # schemalagda auto-uppdateringsjobb
```

## Regler
- All copy på svenska, premium men lekfull ton
- Inga hårdkodade hemligheter
- Priser i öre (int), aldrig float
- Mörkt tema som standard
- GDPR: dataminimering, export, radering måste alltid fungera
- Inga fabricerade priser/data — bara verifierade källor
