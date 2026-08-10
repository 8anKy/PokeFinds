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
  `restock-watch` (var 10:e min via extern pinger). ⛔ Manatörsk-snabbfilen (2-min) TOGS BORT 2026-08-09 (ägarbeslut) —
  Manatörsk täcks av 10-min-lanen som alla andra butiker. Tombstone i `/api/cron/dispatch` svarar 200 tills ägaren
  raderat cron-job.org-jobbet "Foilio restock Manatörsk fast".
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
  **TREDJE MOTTAGARKÄLLAN = SET-BEVAKNING (2026-08-06)**: `SetWatch` (userId+setId) larmar på ALLA sealed-produkter i ett set. Se
  "SET-BEVAKNING" under Tekniska beslut.
- **Funktioner live**: watchlist/prisbevakning, restock-alerts (8 butikskällor), samlingsvärde (live),
  AI-gradering (`/gradera`, Claude vision), live kort-skanner (`/skanna`, capture-baserad), community, admin, PWA.

## Öppna ärenden / Nästa steg
- **DISCORD-KOPPLINGEN ÄR BYGGD OCH DEPLOYAD, MEN AVSTÄNGD (2026-08-07)**: kod live, prod-migrationen körd,
  `DISCORD_ENABLED=false` i Railway + GitHub. Kvar, i ORDNING: (1) **integritetspolicyn** — jurist måste läsa
  `../PokeFinds-private/docs/PRIVACY-DISCORD-DRAFT.md`, som utöver Discord listar TRE leverantörer som
  behandlar personuppgifter i produktion i dag UTAN att stå i policyn (Stripe sedan 08-07, Google/Gemini sedan
  08-05, Tradera) — de är försenade oavsett Discord; (2) **testa flödet** med ett ANNAT konto än serverägarens;
  (3) `DISCORD_ENABLED=true`. Ägarbeslut tagna: roller tas bort men ingen kickas, och Pro-rollen följer hela
  `isPro()` (inkl. admin + referral-bonus). Se "DISCORD-ROLLEN" under Tekniska beslut.
- **LEVERANTÖRSSURVEY 2026-08-02 — SLUTSATS: byt inte prisfeed, lägg till TCGdex gratis**: `lowest_near_mint`
  (vår rubrik) finns hos INGEN annan än nuvarande leverantör. Men **TCGdex** (tcgdex.dev, MIT, ingen nyckel,
  domän från 2020) ger tre saker vi saknar, gratis: (1) **tryckningstaxonomin som förstklassiga rader** — alla
  102 Base-kort, 410 variantrader, **inklusive Pikachu 58:s `shadowless-red-cheek`** som vi gav upp på;
  (2) `tcgplayer.productId` per kort ⇒ **fixar de 132 döda bild-URL:erna** (verifierat: pokemontcg.io 404,
  TCGplayer-CDN 200 — ⚠️ licensläget för bilderna är OKÄNT); (3) `variants.reverse`, diskriminatorn nedan.
  🔑 **REVERSE HOLO — fältet betyder rätt sak men är SKRÄP där varianten inte finns.** Egen mätning: `-holo`
  finns på Base-kort som inte HAR reverse holo (Base Charizard `trend-holo` 123,63 mot `trend` 361,68), så
  kolumnen får inte läsas rakt av. `variants.reverse` från TCGdex säger vilka kort som faktiskt har en, och
  trianguleringen (TCGdex `-holo` = pokemontcg.io `reverseHoloSell/...` = samma sex kolumner) bekräftar att
  `-holo` ÄR reverse holo för Pokémon. ⛔ MEN guidens `-holo` är ALL-SKICK/ALL-SPRÅK — samma sorts tal som
  `lowPrice` som är förbjudet. Ett reverse-holo-pris av From-kvalitet finns inte hos NÅGON leverantör, så ett
  sådant pris måste rubriceras annorlunda än `lowest_near_mint`, aldrig blandas ihop med det.
  🚪 **CardTrader (Gray Fox SRL, Italien)** är enda öppna dörren till riktiga tryckningspriser: `reverse` och
  `first_edition` PER ANNONS, i EUR, och `mkm_id` joinar mot våra `idProduct`. Egen marknadsplats, inte
  Cardmarket ⇒ komplement, aldrig ersättare. Villkoren inbjuder uttryckligen till att fråga.
  ⚠️ **pokemontcg.io ÄGS NU AV SCRYDEX** — katalogryggraden tillhör leverantören vi förkastade, och dess
  CM-block är ~en månad inaktuellt (vi använder det inte till priser). ⚠️ Vår prisbas vilar på en ANONYM
  leverantör (TCGGO: inget bolagsnamn, ingen jurisdiktion, INGA villkor) — vi har alltså ingen dokumenterad rätt
  att lagra och återpublicera datan produkten bygger på.
- **⛔ tcg-cardmarket-api.com FÖRKASTAD (2026-08-02) — men den utredningen gav en GRATIS vinst**: tjänsten säljer
  Cardmarkets EGEN publika gratisfil (`price_guide_6.json`) vidare med omdöpta fält för €13,99/mån. Vi laddar
  redan ner exakt den filen dagligen. Den saknar `lowest_near_mint` (vår rubrik) och `version` (tryckningsidentitet),
  har INGA villkor alls (/terms, /legal → 404), fyra månader gammal domän på en Railway hobby-subdomän, och ingen
  katalog (kan alltså inte ersätta pokemontcg.io heller). Detaljer + återöppningsvillkor i minnesfilen.
  ✅ **FYNDET: reverse holo-priserna finns REDAN i filen vi hämtar varje dag** — `avg-holo`, `low-holo`,
  `trend-holo`, och **66 967 av 77 236 poster bär både bas- och holopris**. "Vi har inga reverse holos" är alltså
  ett MODELLERINGS-problem, inte ett datakällsproblem: det saknas en `Product`-rad per reverse holo-variant,
  exakt samma mönster som Base-uppdelningen. Noll licenskostnad. ⚠️ Spot-kolla `-holo`-fältets innebörd mot
  några kända kort innan något byggs på det.
  ⚠️ Vår NUVARANDE leverantör är TCGGO (`tcggopro`, host `cardmarket-api-tcg.p.rapidapi.com`) och de har en egen
  sajt, tcggo.com. "Direkt i stället för via RapidAPI" är en OUTREDD fråga (403 mot automatiserad hämtning).
- **HELA LEGALPAKETET OMSKRIVET OCH PUBLICERAT 2026-08-08 — juristgranskning återstår**: nya villkor
  (20 avsnitt: AI-utfall, larm-förbehåll, Tradera-sälj, Discord, rankningstransparens, ångerrätt,
  ansvarstak, inbjudningsvillkor, språkföreträde), omskriven integritetspolicy (alla mottagare
  deklarerade: Stripe, Google/Gemini, RevenueCat, Railway; sektion 7b för självständigt ansvariga —
  ⛔ Discord/Tradera/appbutikerna får ALDRIG in i biträdeslistan, den påstår biträdesavtal), rättad
  cookiepolicy (samtyckesvalet ligger i localStorage, inte i en cookie), "Så rankar vi" på /om
  (länkad från sorteringsarket per EU:s omnibusregler), företagsblock på /kontakt.
  Gamla villkoren PÅSTOD att annonslänkar finns och är märkta (falskt — affiliate är inte aktivt,
  ägarbeslut 2026-08-08: inte planerat heller) och att listan alltid sorteras på lägsta pris (falskt).
  ⛔ **ODR-hänvisningen är BORTTAGEN med flit** — EU-plattformen lades ner 2025-07-20 (förordning (EU)
  2024/3228). Lägg aldrig tillbaka den. ⛔ **Ångerrätten är den PROPORTIONELLA modellen** (pro rata vid
  ånger, digital tjänst-tolkningen) och checkout-samtyckestexten i `billing/checkout` säger SAMMA sak —
  de är en mekanism, ändra dem tillsammans. ⛔ Skäligt bruk-nyckeln heter nu `Terms.s11FairUse` (f.d.
  s6FairUse), vaktad mot `PREMIUM_FAIR_USE` av `tests/unit/terms-fair-use-sync.test.ts`.
  Sponsring (ägarbeslut): märkta placeringar som ALDRIG påverkar rangordningen — löftet står i både
  villkor §8 och /om. Status + assistentbeslut att pröva med jurist: `../PokeFinds-private/docs/
  TERMS-GAP.md` (statusblocket överst). Kvar: F2 (datalicenser, egen utredning) och community-klausulen
  (publiceras först när community lanseras — utkast §13 i TERMS-DRAFT-CLAUSES.md).
- **Deal-verifieraren kan bytas till Gemini med EN env-variabel (2026-08-02)**: `DEALS_VERIFY_PROVIDER=gemini` +
  `GEMINI_API_KEY`. Standard är fortsatt **claude** med flit — Geminis omdöme på just den här bedömningen är
  OMÄTT, och falska positiva blir fejkade "fynd" i en betalfunktion (2026-07-07 välsignade LLM-verifieringen tre
  felmatchningar). Besparingen är ~$1–2/mån, alltså inget skäl i sig. Vill man byta: mät först genom att döma om
  samma annonspar under båda leverantörerna. Prompt/schema/parsning delas (`src/services/deal-verify/contract.ts`)
  just för att en sådan jämförelse ska jämföra MODELLER och inte prompter.
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
- **SKANNERN: LÄS `docs/SCANNER-STATUS.md` FÖRE NÄSTA ÄNDRING (2026-07-30)**: lägesbilden med alla mätvärden,
  vad som är BEVISAT och vad som är MOTBEVISAT (finare rutnät = sämre, viktat konstfönster = sämre, neuralt nät =
  onödigt), plus de 26 riktiga skanningarnas utfall. Kortversion: helbildskort fungerar (4/4), klassiskt ramade kort
  fungerar INTE på skärmfoto (0/6) eftersom samlarnumret är ~3 px i en produktbild på skärm och färglayouten mättas
  inom en färgfamilj. **Modellen HITTAR PÅ nummer** — 16 av 26 var syntaktiskt giltiga och nästan inget korrekt, så
  `numberLegible` (ja/nej-fråga i verktyget) infördes 07-30 och är ÄNNU OMÄTT: mät med `scripts/scanner-telemetry.ts`.
  ⛔ Nästa riktiga mätning kräver FYSISKA kort — `scripts/art-audit/` kan inte modellera "en annan rendering av samma
  kort", vilket är precis det som fäller färgbaserad matchning.
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
- **Stripe (webbens Pro) BYGGT 2026-08-06, ej live**: kod klar och testad, men `STRIPE_ENABLED=false` tills
  (a) sandbox-nycklarna verifierats end-to-end och (b) juridisk person + ångerrätt står i appen (se
  användarvillkoren ovan — att ta kort av konsumenter gör e-handelslagen 8 § och distansavtalslagen bindande).
  Se "STRIPE" under Tekniska beslut. Web push förberett men kräver VAPID-nycklar.
- **Launch-readiness + kostnad-vid-skala**: levande checklista i `docs/LAUNCH-CHECKLIST.md` (Section 0 =
  kostnadshetspunkter vid samtidig trafik; bocka av `- [x]` allt eftersom). Öppna kostnadsposter: offers-refetch
  per produktvisning, `force-dynamic` på alla `/api/*`, ingen rate limiting, collection-värde live-compute.
- Övrigt: se docs/TODO.md.

## Tekniska beslut (VIKTIGA — ändra inte utan skäl)
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
- **STRIPE SKRIVER ALDRIG `planTier` (2026-08-06)**: webbens Pro bor i EGNA kolumner
  (`stripeCustomerId`/`stripeSubscriptionId`/`stripeProUntil`) och blir en FJÄRDE gren i `isPro()` och
  `proUserWhere()` — exakt samma mönster som referral-bonusens `bonusProUntil`, av exakt samma skäl:
  `planTier` ägs av RevenueCat-webhooken, vars `EXPIRATION` sätter FREE OVILLKORLIGT. En utgången
  Apple-sandbox hade annars sagt upp en kund som betalar oss med kort — och det felet är tyst (2026-07-08
  tystade just den mekanismen alla restock-larm i fyra dygn). ⛔ **Glöms grenen i `proUserWhere()` får
  webbkunden Pro i gränssnittet men INGA larm**: mottagarfrågorna går enbart via det filtret. ⛔ Varje
  DB-`select` som matar `isPro()` måste välja `stripeProUntil` — ett ovalt fält blir `undefined` och vakten
  failar ÖPPET (samma familj som `variantLabel` 07-28). Rättade vid bygget: `users/me` (BÅDA selecten) och
  `installningar/page.tsx`. Sessionsvägen bär fältet genom JWT:n (authorize → jwt → session).
  ⛔ **`subscription.current_period_end` FINNS INTE** i den API-version SDK:n (v22) pinnar — fältet flyttade
  till `items.data[].current_period_end`. En läsning på toppnivån ger `undefined` ⇒ INGEN får någonsin Pro,
  tyst och bara i drift. Enda vägen är `subscriptionPeriodEnd()` i `src/lib/stripe.ts` (tar senaste posten,
  faller tillbaka på toppnivån för äldre versioner). Verifierat mot node_modules, vaktat av test.
  ⛔ **Webhooken litar aldrig på eventets objekt** — den hämtar prenumerationen FÄRSK. Stripe garanterar inte
  leveransordning, och ett försenat `updated` med gammal status hade sagt upp en aktiv kund. Ett absolut datum
  (inte en boolean) gör skrivningen idempotent och självläkande: missas uppsägningen löper Pro ut ändå.
  Nåd = `GRACE_DAYS` 3 — avvägningen är osymmetrisk (för kort = betalande kund tappar larm, för lång = en
  avhoppare behåller Pro några dygn). `past_due` behåller Pro: ett nekat kort är inte en uppsägning.
  ⛔ **Bara webben.** Apple förbjuder egen checkout för digitala varor i app:en; `purchasesAvailable()` i
  `upgrade-button.tsx` är gränsen, och checkout-routen blockerar dubbeldebitering (`planTier=PREMIUM` = köpt
  via Apple). Uppsägning sker där köpet gjordes — webbkunder får Stripes kundportal, app-kunder App Store.
  ⛔ Klienten måste kalla `session.update()` efter återkomsten från Checkout: jwt-callbacken läser annars om
  planen först efter `TOKEN_REFRESH_MS` (30 min) och en betalande kund väntar en halvtimme utan att något felar.
  Moms via Stripe Tax (`automatic_tax`), priset sätts inkl. moms. Plan/kvot-namnet `PREMIUM` är oförändrat.
- **DISCORD-ROLLEN FÖLJER `isPro()`, OCH AVSTÄMNINGEN ÄR INTE VALFRI (2026-08-07)**: användaren länkar sitt
  Discord-konto i /installningar, går med i servern (`guilds.join`) och får rollen `Verifierad`; har hen Pro
  sätts även `Pro`. EN definition av Pro — `isPro()` — aldrig en egen regel för Discord.
  ⛔ **SYNKEN SKER PÅ TRE STÄLLEN OCH ALLA TRE BEHÖVS**: (1) vid länkningen, (2) i Stripe- OCH
  RevenueCat-webhookarna, (3) i en NATTLIG avstämning (`src/jobs/discord-reconcile.ts`, körs sist i
  scrape-all). Punkt 3 är den som folk tar bort för att den ser redundant ut: `bonusProUntil` och
  `stripeProUntil` är DATUM som löper ut UTAN att någon webhook fyras — utan avstämningen sitter Pro-rollen
  kvar i evighet hos den som slutade betala. Den ligger i scrape-alls fönster (inte egen cron) för att Neon
  debiteras per VAKEN TID.
  ⛔ **VI RÖR BARA KONTON VI SJÄLVA LÄNKAT** (`User.discordUserId`), aldrig serverns medlemslista. Ägaren hade
  redan delat ut `Pro` för hand till 3 medlemmar; ett jobb som utgick från Discord-sidan hade strippat dem vid
  första körningen. Vi tar aldrig bort en roll vi inte satt, och vi KICKAR ALDRIG — frånkoppling och
  kontoradering tar bort rollerna, medlemskapet är personens eget.
  ⛔ **INGEN OAuth-TOKEN LAGRAS** (till skillnad från `traderaToken`): användartoken behövs EN gång för
  `guilds.join` och slängs; all rollhantering går via bot-token. Scopes är exakt `identify guilds.join` —
  INTE `email`, INTE `guilds` (den läser varje server personen är med i). Vaktat av
  `tests/unit/discord-link.test.ts`, som är en regressionsvakt mot scope-krypning: allt vi hämtar måste
  deklareras i integritetspolicyn.
  ⛔ **BOT- OCH OAuth-KONFIGURATIONEN ÄR SKILDA** (`discordBotConfig()` / `discordOAuthConfig()`): nattjobbet
  gör aldrig ett OAuth-utbyte och ska därför inte kräva client secret i GitHub Actions. Färre kopior av en
  hemlighet = färre ställen att glömma vid rotation (jfr APNs-nyckeln, som lever i tre filer).
  ⛔ **DISCORD-ROLLHIERARKIN**: botens egen roll måste ligga ÖVER `Pro`/`Verifierad` i serverns rollista,
  annars svarar Discord 403 och rollen sätts tyst aldrig. Och serverns ÄGARE kan sannolikt inte få roller av
  en bot alls — testa med ett andra konto, annars går det inte att skilja konfigfel från hierarki.
  ⛔ **`guilds.join` returnerar 204 (inte 201) när personen REDAN är medlem, och applicerar då INTE `roles`
  i kroppen** — rollerna måste alltid sättas separat efteråt.
  **GDPR**: `discordUserId`/`discordUsername`/`discordLinkedAt` är personuppgifter; exporten fick
  `connectedAccounts` (och `traderaUserId`, som SAKNATS i exporten sedan Tradera-kopplingen byggdes).
  Kontoradering tar bort rollerna FÖRE raderingen — efteråt finns ingen rad att läsa id:t ur, och en Pro-roll
  utan konto är just en sådan kvarleva art. 17 handlar om.
  ⚠️ **MÖRKLAGD BAKOM `DISCORD_ENABLED` tills integritetspolicyn är uppdaterad.** Utkast + de tre ANDRA
  odeklarerade leverantörerna (Stripe, Google/Gemini, Tradera) ligger i `../PokeFinds-private/docs/
  PRIVACY-DISCORD-DRAFT.md`. ⛔ Discord får INTE bara läggas i `Privacy.s7Items`: den listan påstår att varje
  post är ett personuppgiftsbiträde bundet av biträdesavtal, och Discord är självständigt personuppgifts-
  ansvarig som aldrig tecknar ett sådant. Samma sak gäller Tradera.
  ⛔ **MIGRATIONEN MÅSTE LIGGA FÖRE KODEN**: `/installningar`, GDPR-exporten och kontoraderingen `select`:ar
  Discord-kolumnerna, så koden mot en omigrerad databas ger 500 för ALLA användare, inte bara Discord-användare.
  Dockerfilens `migrate deploy || true` är avsiktligt icke-blockerande och kan alltså tiga ihjäl felet — kör
  `node scripts/with-prod-db.mjs npx prisma migrate deploy` MANUELLT före push vid schemaändringar.
- **JAPANSKA SET KOMMER FRÅN CARDMARKETS EXPANSIONER (2026-08-07)**: katalogens set kommer från
  pokemontcg.io, som BARA har engelska set — alla 100 japanska produkter hade därför `setId = null` och
  japanska set gick inte att filtrera på. ⛔ **TCGGO stänger inte hålet**: episodlistan är 175 västerländska
  expansioner och `?language=japanese` ignoreras TYST (identiskt svar) — mätt 2026-08-07. Källan är i stället
  CM:s publika sealed-katalog (`products_nonsingles_6.json`), som JP-prisrefreshen redan laddar ner varje dag:
  varje produkt bär `idExpansion`, och CM namnger dem i LATINSK skrift ("Black Bolt JP Booster Box"). Setnamnet
  härleds ur det (`deriveJpSetName`, `src/lib/jp-set-name.ts`) och identiteten är `CardSet.cmExpansionId` —
  ingen titelmatchning i något led. 49 set, 96 av 100 produkter etiketterade. Jobbet (`jp-set-label.ts`) körs
  sist i `runJapaneseSealedRefresh` där katalogen redan ligger i minnet ⇒ noll extra hämtningar, ny japansk
  förhandsbox syns inom ett dygn. ⛔ **Namnet får ALDRIG komma från TCGdex**: deras japanska namn är japansk
  skrift OCH mätbart fel på minst ett set (`SV4a` bär Raging Surfs namn men Shiny Treasures datum). TCGdex ger
  bara SLÄPPDATUMET, och bara när koden är styrkt: butikstitelns egen setkod ("- sv6", "(s6K)") räknas som
  bevis (tillverkarens identifierare, samma logik som GTIN), medan tabellförslaget `JP_CODE_BY_NAME` måste
  klara datumfönstret -6..+71 dygn mot CM:s `dateAdded` (kalibrerat på de 39 set vars kod stod i titeln).
  25th Anniversary föll utanför (118 d) och står därför utan datum, sist i listan.
  ⛔ **VARJE NAMNBASERAT SETUPPSLAG MÅSTE FILTRERA PÅ `language`.** JP och EN delar latinska setnamn
  ("Black Bolt", "White Flare", "151"), och `import-tcg-data.ts` adopterar befintliga set PÅ NAMN när
  pokemontcg.io publicerar dem. Utan grinden hade den engelska importen svalt det japanska setet och tagit
  med sig dess produkter. Grindade: import-tcg-data (adoption), sealed-set-label, cardmarket-refresh
  (`setsByName`), import-sealed-from-cardmarket, set-from-cm-episode.
  ⛔ **`totalCards` är 0 på japanska set.** TCGdex vet att SV11B har 174 kort, men vi har inga japanska
  singlar — setsidan skriver ut talet rakt av och hade lovat kort som inte finns hos oss.
  **SERIE + BILD (2026-08-07)**: JP-fliken grupperas på SERIE precis som den engelska — serien kommer från
  TCGdex:s `serie.id` på den STYRKTA koden och skrivs med den latinska eran (`JP_SERIES_BY_TCGDEX_ID`:
  SV → "Scarlet & Violet" osv), samma skrivning som de engelska seten, så rubrikerna läser likadant i båda
  flikarna. Utfall: Mega Evolution 7 · Scarlet & Violet 25 · Sword & Shield 13 · Sun & Moon 3 · **Other 1**
  (25th Anniversary, vars kod aldrig styrktes). ⛔ Ingen era gissas: utan styrkt kod blir det "Other", som
  sorteras sist av sig själv (releaseDate nulls last).
  **SETLOGOTYPERNA ÄR HÄMTADE EN GÅNG OCH LIGGER I REPOT (2026-08-07)**: `public/set-logos/jp/{KOD}.png`,
  49 filer, 2,9 MB. INGEN leverantör publicerar japanska setlogotyper — TCGdex har 0 av 177
  (`assets.tcgdex.net/.../logo.png` = 404), TCGGO:s japanska endpoint svarar med tom lista, CardTrader har
  expansionerna men ingen bild, och den OFFICIELLA japanska sajten har bara 21 av våra 49 set, med bespoke
  hashade filnamn per sida (`hero-img-01-y25ri.png`) som inte går att härleda. Filerna hämtades därför en
  gång med `scripts/fetch-jp-set-logos.ts` och bor hos oss: ingen annans CDN belastas per sidvisning, och
  bilderna kan inte försvinna under oss. ⚠️ Artwork tillhör The Pokémon Company (samma sak som kortbilderna
  och de engelska setlogotyperna vi redan visar). Nya set får produktbilden tills någon kör skriptet igen.
  ⛔ **MATCHA ALDRIG LOGOTYP MOT SET PÅ NAMN.** Samma japanska set översätts olika av olika källor: ムニキスゼロ
  är "Nihil Zero" hos Cardmarket (vår skrivning) och "Munikis Zero" hos logotypkällan, 摩天パーフェクト är
  "Towering Perfection" respektive "Perfect Skyscraper", SM10b är "Sky Legend" respektive "Sky Legends" —
  7 av 49 föll på det. ⛔ Och KODEN duger inte heller ensam: källan märker "Future Flash" som SV4K, vilket är
  Ancient Roars kod, och "Lost Abyss" som S12, vilket är Paradigm Trigger. Automatiken kräver därför att
  BÅDA är ense (39 av 49); resten är granskade för hand genom att LÄSA den japanska ordbilden i logotypen och
  jämföra med TCGdex japanska namn (tabellen `VERIFIED` i skriptet, med det verifierade namnet per rad).
  Granskningen fångade en riktig förväxling: SV4K/SV4M var omkastade i källan, så utan den hade ett set fått
  fel logotyp och det andra ingen alls.
  **FALLBACK**: `pickJpSetImage` (BOOSTER_PACK före BOOSTER_BOX, CM-render före butiksfoto) används bara när
  ingen logotypfil finns — en japansk boosterpåse bär ändå setets logotyp på omslaget.
  ⛔ Filnamnet härleds av `jpSetLogoFileKey` — EN definition delad av skriptet och jobbet, annars slutar
  filerna hittas tyst den dag den ena sidan ändrar sin namngivning.
  **SJÄLVLÄKNING**: `refreshJpSetMetadata` fyller bara TOMMA fält och kör i varje jobbkörning — ett set skapas
  i samma andetag som sin första produkt och kan sakna bild då. ⛔ "Serien saknas" är formulerat som en MÄNGD
  (`series notIn [kända eror, "Other"]`), inte som en jämförelse mot den gamla platshållaren "Japanska set" —
  annars hade en legacy-sträng behövt leva i koden för alltid. Och utfallet skrivs även när det blir "Other",
  annars frågas TCGdex om samma set vid varje körning i evighet.
  **UI**: flikarna Engelska/Japanska i set-arket (visas bara när japanska set finns), desktopens `<select>`
  har en `optgroup` "Japanska" (platt där, precis som EN-listan i samma kontroll). `/sets`-galleriet är
  ENGELSKT tills vidare (JP-set har inga kortrader). Backfill/granskning = `scripts/label-jp-sets.ts`
  (torrkörning default, `--apply`).
  ⛔ **LLM-DOMAREN AVVISADE VARJE KORREKT JP-PAR (rättat 2026-08-07)**: `judgeSameProduct`s systemprompt
  säger — riktigt i allmänhet — att "japansk ≠ engelsk utgåva är ALLTID olika produkter". Men Cardmarket
  skriver ALDRIG ut språket i namnet på en japansk expansion, medan våra butikstitlar alltid gör det
  ("(Japansk)"). Domaren läste den saknade markören i B som en konkret motsägelse och svarade same=false på
  VARJE par: "VMAX Climax Booster" (sim 1,00!), "Storm Emeralda Booster Box" (0,91), "Jet Black Spirit
  Booster Box" (0,82). Följden: INGEN ny japansk SKU kunde någonsin auto-mappas — fyra produkter satt utan
  pris och utan set, och Storm Emeralda-setet fanns inte alls. Ledtråden säger nu uttryckligen att frånvaron
  av språkmarkör i B inte är ett bevis. ⛔ Men den fick inte göra domaren slapp: mätt på 9 kontrollfall
  (4 rätta par + 5 fällor) blev det först 7/9 — "Booster Box CASE" (en låda MED FLERA lådor) godkändes som
  "Booster Box". Den regeln ligger nu i SYSTEMprompten (gäller alla anropare) och kontrollen står på 8/9.
  Kvarvarande miss: internationella "151" mot japanska. Skyddet mot DEN är strukturellt och sitter ovanför
  domaren — `ownedBy` filtrerar bort varje idProduct som redan ägs, och vår engelska katalog är komplett,
  så CM:s internationella produkter når aldrig fram som JP-kandidater. **Domaren är andra linjen.**
  **KODEN KAN KOMMA FRÅN CARDTRADER (2026-08-07)**: ett japanskt set finns hos CM långt före TCGdex — Storm
  Emeralda låg i CM:s katalog 2026-07-02 medan TCGdex fortfarande slutade på M5, och butikstitlarna bar
  ingen kod. Setet skapades därför utan kod, era och datum. `cardTraderCode()` slår upp koden i CardTraders
  expansionslista (M6 ✓) och skriver in den i namnet, så TCGdex-uppslaget kan lyckas SENARE:
  `refreshJpSetMetadata` plockar upp varje datumlöst set igen, och "Other" uppgraderas till rätt era när
  TCGdex hunnit ikapp. ⛔ **Filtrera på `game_id === 5`** — listan spänner över alla spel CardTrader säljer,
  och "25th Anniversary" matchade en YU-GI-OH!-expansion (torrkörningen visade "25th Anniversary (25THYUG)").
  ⛔ Kräv ETT entydigt namn: CT listar både "Black Bolt | sv11B" (japanska) och "Black Bolt" (`blk`,
  internationella).
  **TVÅ TABELLER MED OLIKA BEVISKRAV** (`jp-set-name.ts`): `JP_CODE_BY_NAME` är FÖRSLAG som måste klara
  datumfönstret, medan `JP_CODE_VERIFIED` är koder kontrollerade mot setets EGEN ordbild (logotypen läst mot
  TCGdex japanska namn) och används utan datumprövning. 25th Anniversary hörde hemma i den senare: tre
  källor sa S8a (TCGdex-namnet 25thアニバーサリーコレクション, logotypens ordbild, logotypkällans `[S8A]`) men
  datumfönstret förkastade den för att CM la in produkterna 118 dygn före släppet. ⛔ Lägg aldrig en
  okontrollerad rad i `JP_CODE_VERIFIED` — "verkar rimligt" hör hemma bland förslagen.
  ⚠️ Läge 2026-08-07: 100 av 100 JP-produkter har set, 50 set, alla med logotyp. Serier: Scarlet & Violet 25,
  Sword & Shield 14, Mega Evolution 7, Sun & Moon 3, Other 1. Enda datumlösa: **Storm Emeralda (M6)** —
  TCGdex slutar på M5, så eran och datumet fylls i av sig själva när de publicerar M6.
- **SET-BEVAKNING ÄR EN STÅENDE REGEL, INTE EN ÖGONBLICKSBILD (2026-08-06)**: `SetWatch` (userId+setId, unik) ger
  restock-larm på ALLA sealed-produkter i ett set. ⛔ Expandera den ALDRIG till en `WatchlistItem` per sealed-produkt
  vid klick: auto-importen (`ensureListingProduct`) skapar sealed-SKU:er löpande, så en expansion vid klicktillfället
  hade missat exakt de nya förhandsboxarna som är hela poängen med att bevaka ett set. Regeln utvärderas därför vid
  LARMTILLFÄLLET, i BÅDA vägarna: `checkRestockAlerts` OCH `checkListingAlerts` — den senare är den VIKTIGASTE, för en
  helt ny låda har ingen Offer ännu och kommer in just där (samma lärdom som feed-först-larmen 2026-07-25).
  **Grindar**: bara sealed (`isSealedCategory`, `src/lib/product-category.ts` — EN definition, lagd för att inte bli en
  femte handskriven negativ lista; de fyra befintliga i products/marketplace-offers/cardmarket-refresh lämnas orörda,
  de sitter i prissättnings- och synlighetsvägar med egna skäl att skilja sig) och bara produkter som HAR ett `setId`.
  **SET-ETIKETTEN SÄTTS DÄR IDENTITETEN AVGÖRS (2026-08-06)** — `src/jobs/sealed-set-label.ts`, anropad ur
  `runCardmarketRefresh` sealed-loop. ⚠️ Den gamla raden här sa "~24h glapp"; det var FEL. Etiketten sattes bara av
  `import-sealed-from-cardmarket.ts`, som kör **veckovis** (sön 04:00) OCH kräver att ett CardSet med episodens namn
  redan finns — för ett osläppt set gör det oftast inte det (pokemontcg.io publicerar set först vid release). Uppmätt
  median ~4 dygn, värsta realistiska fall VECKOR. Nu sätts etiketten i samma andetag som CM-matchningen (dagligen
  13:00) ⇒ ≤24h, och saknas setet skapas det ur CM:s episodlista — men BARA när en produkt behöver det, så CM:s
  episodlista aldrig driver /sets på egen hand. ⛔ Ingen ny gissning: hoppet episod→set är CM:s EGET episodnamn för den
  matchade produkten, exakt som veckojobbet; fuzzy-steget (`bestSealedMatch` 0.72) fanns redan och avgör redan i dag
  vilket set produkten får. ⛔ Vakter (testade): aldrig skriva över befintlig etikett · tvetydigt episodnamn (två set
  normaliserar lika) → gör inget · episod utan serie → skapa inget set · delkörning (`CM_ONLY_EPISODES`) → etikettera
  men skapa aldrig · `externalId` lämnas NULL så `import-tcg-data.ts` adopterar raden på namn.
  ⚠️ Kvarvarande golv: en stub vars titel aldrig når 0.72 globalt får ingen CM-länk alls och därmed ingen etikett.
  ⛔ **Pro-grinden ligger även i MOTTAGARFRÅGAN**, inte bara i `addSetWatch`: planen kan ha gått ut sedan raden skrevs
  (RevenueCat EXPIRATION nollar planTier — se `proUserWhere()`).
  **VARFÖR-RADEN I MEJLET**: `Alert.reasonSetName` (nullable) skrivs NÄR beslutet fattas, aldrig härleds vid utskick —
  bevakningen kan vara borttagen däremellan och då hade mejlet påstått fel anledning. Sätts BARA för den som inte
  bevakar produkten själv (då är skälet uppenbart). `alert.message` når inte lager-mejlen — de fyra mallarna
  (restock/released/newListing/preorder) bygger egen copy, så skälet måste skickas in som parameter.
  **UI**: klocka i produktkortets övre HÖGRA hörn (fyndmärket äger det vänstra), kort tryck = varan, långtryck = samma
  bottenark som "+" med varan/hela setet. Bara sealed — en klocka på en singel hade lovat larm som aldrig kan komma.
  Knapp i setsidans rubrikrad + "Bevakade set" på /bevakningar (utan den listan är bevakningen osynlig och går inte att
  stänga av). ⛔ Setsidan förblir ISR: plan och tillstånd läses KLIENT-sida bakom `fo_auth`-hinten, och bevakade set-id:n
  hämtas EN gång per sida via `src/lib/watched-sets.ts` — en fetch per kort hade blivit 20-40 Neon-väckningar per vy.
- **GRATISKONTOTS BEVAKNINGSTAK = 5 (ägarbeslut 2026-08-06, var 10)**: `FREE_PLAN_WATCHLIST_LIMIT`. Sänkningen RADERAR
  ingenting — befintliga poster ligger kvar, taket bromsar bara nya tillägg. ⛔ **TALET ÄR PUBLICERAT** på sex ställen i
  två språk (prissidans `freeFeatures`, startsidans FAQ, nedgraderings-FAQ:n, klientens "listan är full") som fri text
  utan koppling till konstanten. `tests/unit/watchlist-limit-copy-sync.test.ts` failar om de glider isär — lös det ALDRIG
  genom att interpolera konstanten in i översättningarna: poängen är att någon TVINGAS läsa meningarna när talet ändras.
  ⚠️ Nedgraderings-FAQ:n lovade tidigare "bara de 10 senaste är aktiva" — en funktion som ALDRIG byggts (varken
  `watchlist.ts` eller RevenueCat-webhooken rör poster vid nedgradering). Texten säger nu vad koden faktiskt gör.
- **SINGEL-LÄNKARNA PEKAR PÅ CARDTRADER-VERIFIERADE idProduct (2026-08-07)**: en singel kunde länka till CM:s
  OVERSIZED-version av kortet (Rayquaza VMAX · Evolving Skies 111 gick till jumbo-produkten). ⛔ **CM:s egen
  data kan inte skilja dem åt** — alla "Rayquaza VMAX"-rader har identiskt namn och samma `idMetacard`, och
  10 060 av 57 964 namn+expansion-par har flera versioner. ⛔ Versionssuffixet i slugen duger inte som signal
  (4 155 länkar har ett, de flesta korrekta — Eevee V5/V6/V7 ÄR olika promos). ⛔ Och sidan går inte att
  kontrollera: **Cardmarket blockerar automatiserade sidhämtningar** (33 av 33 stickprov nekades).
  Lösningen är CardTraders katalog, som har ett blueprint PER samlarnummer med `card_market_ids`
  (Evolving Skies: 111 → 574159, 217 → 574275, 218 → 574276) — samma kedja som `recover-cm-idproduct.ts`, med
  samma två oberoende namnvakter. `scripts/verify-cm-single-links.ts` skriver om slug-länkar till
  `?idProduct=`-formen. **FAS 1 ÄR ETT FACIT, INTE EN REPARATION**: körningen jämför först CardTrader mot de
  1 499 länkar som redan bär ett uttryckligt idProduct — 1 435 överens (95,7 %), 64 oense, och av dem är bara
  6 sådana där CM:s EGEN katalog motsäger vårt id. Är oenigheten > 5 % avbryts körningen utan att skriva.
  ⛔ **Tryckningar (`variantLabel`) rörs aldrig** — Base Unlimited/Shadowless/1st Edition delar CM-produkter på
  ett sätt CardTrader inte modellerar, och deras länkar är satta för hand.
  ✅ Durabelt: dagliga `runCardmarketRefresh` återanvänder `entry.url` (skriver inte om den), och
  `resolve-cm-urls.ts` rör bara redirect-/sök-URL:er.
- **AUTO-IMPORTEN STÄLLER EN ANNAN FRÅGA ÄN PRISVÄGEN — DÄRAV "ANDRA CHANSEN" (2026-08-07)**: `matchProduct` säger
  nej av två helt olika skäl, och `ensureListingProduct` behandlade dem likadant: som "varan finns inte". Det stämmer
  bara för det ena. **(a)** ingen kandidat är i närheten → ny produkt är RÄTT. **(b)** kandidaten finns men får inte
  VINNA (täckningsgolv, marginalvakt, tvåsidiga vakter) → ny produkt är en DUBBLETT. Vaktkedjan är byggd för
  PRISVÄGEN, där en felaktig länk ger fel pris, och avstår med flit; auto-importen frågar i stället "har vi den här
  varan redan?", där ett falskt nej kostar en dubblett. `nearestCatalogCandidate` (matching.ts) plockar därför fram
  den bästa kandidaten när matcharen sagt null och lämnar över till **samma LLM-domare som redan avgör 0,55–0,85**.
  MÄTT på Wave 4:s första provimport: 3 nya produkter, varav **2 dubbletter** — "Prismatic Evolutions Super-Premium
  Collection **(SPC)**" (0,913, alla kandidater föll på vaktkedjan) och "Scarlet **of** Violet Booster pack"
  (0,945, butikens rena STAVFEL; `nonEraCoverage` blev 0,000 eftersom kandidaten inte har ETT ENDA icke-era-ord).
  Ett tredje fall, "Destined Rivals Booster Pack", föll på marginalvakten: 0,858 mot rätt post, 0,872 mot
  "Destined Rivals **Sleeved** Booster". Domaren svarade rätt på alla sju kontrollfall (3 samma, 4 olika).
  ⛔ **GOLVET (0,75) ÄR INGET BEVIS** — det finns bara för att slippa fråga om orelaterade varor. Domaren avgör.
  ⛔ **ensureListingProduct MÅSTE FÅ INDEXET.** Den anropade `matchProduct` utan det, dvs DB-vägen med `take: 200`
  utan `orderBy` — som filen själv dokumenterar som opålitlig. Indexet laddas LAT i `runRestockScan` (bara
  feed-först-grenen behöver det) så en körning utan nya URL:er inte betalar för 22k rader ur Neon.
  ⛔ **UTAN `ANTHROPIC_API_KEY` FELAR DET TYST.** `judgeSameProduct` returnerar null utan nyckel — omöjligt att
  skilja från "olika produkter" — och HELA gränsfallsbandet blir dubbletter. `scripts/with-prod-db.mjs` skickar
  BARA `DATABASE_URL`, så CLI-körningar måste ladda `.env` själva: `scripts/load-env.ts` + `requireEnv()`.
  Provimporten kördes med död domare innan det upptäcktes. Städverktyg för gammal data (använder samma nya regel
  bakåt): `scripts/merge-import-duplicates.ts` — torrkörning default, tre spärrar (målet måste vara rikare,
  stubben får aldrig bära mer meritlista, domaren måste säga samma).
  **DIAGNOSTIK**: `setMatchTracer()` i matching.ts + `scripts/diagnose-listing-match.ts "<titel>" --utan-nya=3`.
  Skriver ut poolstorlek, överlevare efter vaktkedjan, bästa/tvåan och VILKET utfall som gällde. Tre gånger nu har
  felsökningen fastnat på "kom kandidaten ens in i poolen?"; kroken gör frågan mätbar. Null i drift = noll kostnad.
- **NYA BUTIKER SÄLJER INTE BARA SEALED — VAKTERNA SATT I FEL KODVÄG (2026-08-07)**: `isSingleCardListing` fanns
  sedan länge i `productsConflict`, men ALDRIG i `ensureListingProduct`, den enda väg som SKAPAR produkter. Det gick
  an så länge butikerna vi hämtade sålde nästan bara sealed. De nya gör inte det: TCG Store har 754 singlar i sin
  feed, Pokétalk 105, Pocketmonsters 1 592 poster under "pokemonkort". En singel bär sällan formord ⇒ `guessCategory`
  landar på `OTHER` ⇒ som med flit räknas som sealed ⇒ varje singel hade blivit en egen katalogprodukt bredvid den
  riktiga. Samma hål, samma väg in, för MERCH — därav `isMerchandiseListing` (gosedjur, figurer, affischer, kläder).
  ⛔ **SEALED-ORDET VETAR MERCH-VAKTEN.** En riktig SKU kan bära ett merch-ord ("Ultra-Premium Collection" innehåller
  en figur); ett gosedjur bär aldrig "Booster"/"ETB"/"Tin". Asymmetrin är avsiktlig: ett falskt merch-ord kostar
  ingenting, ett glömt kostar en katalogprodukt. Bart "kalender" är FÖRBJUDET (adventskalendern är en äkta SKU).
  ⛔ **SAMLARNUMMER/TOTAL var det tecken som saknades**: `123/195`, `TG27/TG30`. MÄTT före påslag: 0 av 1 466
  sealed-titlar i de fem befintliga butikernas feedar och 0 av 1 633 sealed-produkter i katalogen träffas. Måttet ÄR
  kravet — tecknet sitter i `productsConflict`, och en falsk träff där blockerar en korrekt butikslänk, tyst.
  **FEED-NIVÅN**: Shopifys `pokemonCollections` och Woo-adapterns kategorifilter hoppar över singel-/graderat-/
  merch-hyllor. Mätt: 0 kollektioner och 0 produkt-handles förlorade i de fyra befintliga Shopify-butikerna.
  ⛔ **QUICKBUTIKS KATEGORIUPPTÄCKT ÄR UNION, ALDRIG ERSÄTTNING**: den gamla regeln (`/pokemon/{kat}`, exakt 2
  segment) står kvar orörd, och den generaliserade upptäckten LÄGGER TILL. En feed som tappar en URL nollar offern
  till "Okänd" efter 24h och nästa restock larmar aldrig. Biprodukt: Swepokes `/japanska-pokemon-produkter` och
  `/pre-order-pokemon` har aldrig hämtats förut och gör det nu.
- **MATCHNINGEN: KANDIDATURVALET VAR FELET, INTE POÄNGEN (2026-08-07)**: butiksdubbletter uppstod inte för att
  vakterna var svaga utan för att rätt tvilling ALDRIG kom in i kandidatpoolen. `significantTokens` tog de SEX
  FÖRSTA orden i titeln, och butiker skriver Pokémon-namnet SIST ("… Temporal Forces 3-Pack Blister **Cleffa**")
  → kvar blev era- och formord, som hämtas med `take: 200` UTAN `orderBy`, dvs ett godtyckligt urval. Dessutom
  bröt loopen vid 400 kandidater, så även efter omsortering åt "scarlet"/"violet" upp taket. Tokens väljs nu på
  SÄRSKILJNING (`ERA_TOKENS` sist), brytningen ligger ovanför 6×200, och en kandidat som passerat hela
  vaktkedjan OCH är identitetslik vinner över en med högre Dice — men bara när den är ENTYDIG.
  ⛔ **MARGINALEN AVGÖR, INTE POÄNGEN** (`AMBIGUITY_MARGIN` 0,03): en Tradera-annons "Crown Elite Trainer Box
  (ETB)" fick 0,800 mot Crown Zenith och 0,786 mot Stellar Crown — 0,014 isär — och sålde i själva verket en
  Stellar Crown. Följden var inte bara fel länk utan FEL PRIS: 1 150 kr blev Crown Zeniths rubrikpris. Ligger
  tvåan inom marginalen och identitetsorden skiljer sig ges ingen länk alls. Samma lärdom som skannerns
  bildmatchning redan bär. ⛔ **FÖRKASTAT**: en vakt som krävde att annonsen nämner produktens identitetsord —
  mätt mot befintliga länkar avvisade den mängder av KORREKTA ("… Time Gazer – s10D, Display / Booster Box
  (Japansk)" fick 0,50 för att era-, form- och språkord räknas som identitet).
  ⛔ **BLISTRAR IDENTIFIERAS AV KARAKTÄREN** (`blisterCharacterMismatch`): CM namnger alla 486 blistrar
  "Set: KARAKTÄR N-Pack Blister", så även en ENSIDIG karaktär är en motsägelse. Utan den band matcharen
  "…Checklane Blister Scraggy" till en generisk "Journey Together Premium Checklane Blister" på 0,95.
  ⚠️ "Checklane" = 1-pack (CM listar exakt en blister per set+karaktär; de fyra undantagen skiljer sig alla på
  ANTALET, aldrig på checklane mot 1-pack).
  **Katalogen ska inte innehålla tillbehör eller BUTIKSEGNA BUNDLES** (ägarbeslut): `isAccessoryListing` +
  `isStoreBundleListing` grindar importen. Den senare är smal med flit — katalogen har riktiga kort som heter
  Mystery Garden/Plate/Energy. ⛔ Radering räcker inte, URL:en måste in i `import-denylist.ts`.
  ⛔ **SAMMANSLAGNING KRÄVER MER BEVIS ÄN LÄNKNING**: `dedupe-catalog.ts` första version godkände
  "Mega Charizard X ex Tin" == "Mega Charizard Y ex Tin" (1,00) och "Base Set 2 Booster Pack" == "Base Booster
  Pack" (0,99) — `normalizeTitle` kastar korta tokens ("X", "Y", "2"), och en exakt normaliserad träff hoppar
  dessutom över HELA vaktkedjan. Beviset tas därför på RÅTITELN. Skriptet är en RAPPORT tills svepningen mätts
  i sin helhet; faktiska merges görs via `merge-verified-duplicates.ts` med granskade par.
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
- **NEONS NOTA ÄR VAKEN TID — RÄKNA VÄCKNINGAR, ALDRIG RADER (2026-08-05)**: compute är ~95 % av notan, egress
  är gratis vid vår volym (49 av 500 fria GB), och **varje väckning köper minst 300 s debiterad tid**. Autosuspend
  ligger redan på golvet (300 s är minimum på Launch — 90/120/150/180/240 s ger alla `412`). Två följder är
  inbyggda i koden nu: **(1) NATTKEDJAN** — scrape-all (02:00 UTC) → tradera-sweep → cardtrader-refresh →
  tradera-sold-sync är länkade med `workflow_run` i stället för fyra egna cron. Fyra spridda starter var fyra
  väckningar; kedjade blir de ett sammanhängande fönster, och glappet (runner-kö + checkout + npm ci) är minuter,
  alltså under autosuspenden. ⛔ `workflows:` matchar `name:`-FÄLTET i den andra filen — byter du namn på ett
  uppströmsjobb slutar de efterföljande köra TYST. `tests/unit/cron-chain-sync.test.ts` vaktar kedjan.
  ⛔ INGEN `conclusion`-grind: jobben är oberoende och delar bara tidsfönster; en success-grind hade bytt en synlig
  röd körning mot tre osynligt uteblivna. **(2) PERSONALISERADE SVAR CACHAS 60 s** (`PERSONAL_TTL_SECONDS`,
  `services/products.ts`) i stället för att gå helt förbi cachen. En inloggad besökare väckte förut computen vid
  varje sidladdning även när sidan i övrigt var ISR-cachad — vi betalade ett fast pris för att slippa 60 sekunders
  inaktualitet i en SORTERINGSORDNING. Egen cache-nyckel ("…Personal"), aldrig delad med den utloggade.
  ⛔ `loadPersonalIdsRaw` returnerar ARRAYER, inte Set: `unstable_cache` serialiserar till JSON och ett `Set` blir
  `{}` — `.has()` hade kastat, men bara vid cache-TRÄFF, bara i produktion, bara för inloggade. Samma familj som
  Date→sträng-fällan. (Manatörsk-2-min-lanen och dess fingerprintGate-risk försvann när lanen togs bort 2026-08-09.)
- **CRAWLER-UA-LISTAN ÄR EN FÄRSKVARA — NYA BOT-NAMN DYKER UPP OANMÄLT (2026-08-09)**: Neon var vaken 36 h I STRÄCK
  och Railway-RSS nådde 6–8 GB. Railways httpLogs (UA-aggregering, se scratchpad-receptet i minnesfilen) visade att
  **Claude-SearchBot** (NY Anthropic-UA, matchades inte av ClaudeBot/Claude-Web) svepte katalogen i 5,7 req/s = 63 %
  av ALL trafik, plus **GoogleOther** (Googles icke-sök-crawler) 28 %. Båda 403:as nu i `blocked-bots.ts` + står i
  robots.ts. ⛔ Googlebot (inkl. mobil-UA:n med Chrome-prefix) får ALDRIG in i blocklistan — sökindexeringen är hela
  poängen med SEO-arbetet; testet vaktar. Räkna med att detta händer IGEN med nästa nya bot-namn: symptomet är
  "Neon vaken dygnet runt utan att jobben kör" → kolla UA-fördelningen FÖRST. Railway-minnet var följdsymptom, inte
  läcka: heapen är capad till 512 MB, resten var glibc-malloc-arenor under crawl-lasten → `MALLOC_ARENA_MAX=2` i
  Dockerfile. **APP-RESUME (samma dag)**: `AppResumeRefresh` (rot-layouten) kör `router.refresh()` när appen varit
  dold ≥5 min — OS:et fryser WebView:en i bakgrunden (ingen CPU går till spillo), men uppvaknandet visade gammalt
  data och gamla Server Action-id:n efter deploys. ⛔ Aldrig `location.reload()` (Capacitor-Safari-fällan).
- **0 KR ÄR INGET PRIS (2026-08-05)**: `priceOreFromEur()` i `src/lib/exchange-rate.ts` är enda vägen från EUR till
  öre, och den returnerar `null` när resultatet inte är positivt. Två verkliga vägar till en nolla: källan säger
  noll (RapidAPI publicerar `"30d_average": 0` för kort utan engelska annonser — mätt på np-4 Grovyle · Nintendo
  Black Star Promos, vars guide-rad dessutom är helt tom) och AVRUNDNINGEN (ett äkta belopp < ~0,005 € blir 0 öre,
  och ingen `pos()`-vakt uppströms ser det — där VAR talet positivt). Följden var 0,00 kr i pristabellen plus 32
  grafpunkter på noll. ⛔ Konvertera aldrig med en bar `Math.round(eur * rates.eurToOre)` igen — vakten är
  bortkopplad för just det stället och syns inte förrän ett kort står på 0 kr i produktion. "–" läses som "vi vet
  inte", "0 kr" läses som "gratis". Städning av gammal data: `scripts/purge-zero-prices.ts`.
- **GRADERINGSHISTORIKEN VISAR KATALOGBILDEN, OCH BARA NÄR NUMRET STYRKT KORTET (2026-08-05)**: användarens foton
  sparas ALDRIG (`frontImageUrl = INLINE_UPLOAD`, dataminimering), så katalogbilden är den enda bild som finns.
  Kopplingen görs EN gång vid graderingen (`resolveGradedCard`, `services/grading/card-link.ts`) och lagras i
  `result` (cardId/cardImageUrl/cardSlug/cardLabel — ingen migration), aldrig per historikvisning.
  ⚠️ `result.cardName` är INTE ett bart kortnamn. Mätt i prod: `"Camerupt 028/217 · Scarlet & Violet: Obsidian
  Flames"`, `"Camerupt 028/217 · Ascending Heroes"`, `"Raboot 037/217 · ASC (Scarlet & Violet Promo / Astral
  set)"` — namn + nummer + en SETGISSNING som ofta är fel (28/217 är Ascended Heroes) och ibland öppet hedgad.
  Därför återanvänds skannerns MÄTTA `matchCards` rakt av; den ignorerar redan setnamn som inte stämmer, och
  `cardLabel` visar katalogens skrivning i stället för modellens gissning.
  ⛔ **UTAN NUMMER — INGEN BILD.** 92 % av korten delar namn med minst ett annat; på strängarna ovan fick
  namn+nummer 1,53 och fyra olika Camerupt fick 1,03 var. Träffen måste bära precis det numret OCH vara ensam om
  det. Fel bild bredvid en gradering är ett påstående om en tryckning vi inte känner — värre än ingen bild.
- **"TRADERA · SÅLT" ÄR EN EGEN SERIE — BETALT, INTE BEGÄRT (2026-08-06)**: prisgrafen ritar genomförda
  Tradera-auktioner vid sidan av annonskurvan (`src/jobs/tradera-sold-sweep.ts`, källa `TRADERA_SOLD_SOURCE_NAME`
  = "Tradera sålt", sist i nattkedjan). ⛔ **BARA AUKTIONER MED BUD GÅR ATT VERIFIERA.** En avslutad
  `PureBuyItNow` har `HasBids=false` och `BuyItNowPrice == MaxBid` oavsett om någon köpte den eller om den bara
  löpte ut — tillstånden är IDENTISKA i API-svaret (mätt: 2 109 av 2 768 avslutade utan bud bar exakt den
  likheten). En avslutad auktion med bud bär vinnande budet i `MaxBid`, i kronor. Allt annat vore fabricerad data.
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
- **`fo_auth`-HINTEN MÅSTE SÄTTAS AV SERVERN (2026-08-06)**: inloggningen bärs av TVÅ cookies — NextAuths
  session (server-satt, HttpOnly, 30 dygn) och `fo_auth`, UI-hinten som klient-chrome läser i stället för att
  anropa `/api/auth/session`. Hinten skrevs av KLIENTEN med `document.cookie` och samma 30 dygn. ⛔ **WebKit kapar
  sedan Safari 13.1 ALLA cookies skapade via `document.cookie` till 7 dygn** — iPhone-Safari, Chrome på iOS OCH
  Capacitor-appen (allt är WKWebView); server-satta first-party-cookies kapas INTE. Och hinten är inte kosmetisk:
  `AuthHintGate` gör `router.replace("/logga-in")` när den saknas. Följden var att varje iOS-användare kastades ut
  ur appen senast var sjunde dygn med en fullt giltig session, aldrig på desktop-Chrome — därför läste det som
  slumpmässigt. `syncAuthHint()` i `src/middleware.ts` jämför nu hinten mot sessionscookiens NÄRVARO vid varje
  sidladdning och rättar den med `Set-Cookie` från servern (beslutet är en ren funktion i `src/lib/session-cookie.ts`).
  ⛔ JWT:n verifieras INTE där — hinten är en gissning servern ändå överprövar, och en HMAC per publik sidvisning
  vore att betala krypto för ett UI-tips. ⛔ Chunkade namn (`…session-token.0`) måste räknas med: en JWT > 4 kB har
  inget oindexerat namn alls, och synken hade rensat hinten för en inloggad.
  **Generellt: en cookie som JS skriver har inte den livslängd du anger.**
- **SESSIONEN ÄR GLIDANDE — `maxAge` ÄR ETT INAKTIVITETSFÖNSTER (2026-08-06)**: `session.maxAge` var 30 dygn och
  ingenting förnyade cookien, så ALLA loggades ut exakt 30 dygn efter login oavsett hur aktiva de var. NextAuth v4
  förnyar när sessionen LÄSES, men `getServerSession` får ingen `res` i App Router och kan inte sätta cookies — och
  appen anropar aldrig `/api/auth/session` (hela poängen med `fo_auth`). Det var andra halvan av "helt plötsligt
  utloggad": WebKit-kapen tog iOS var sjunde dygn, det här tog alla var trettionde. `renewSession()` i
  `src/middleware.ts` skriver nu om cookien med färsk utgång, utan en enda DB-fråga. Talet
  (`SESSION_MAX_AGE` = 365 dygn) bor i `src/lib/session-cookie.ts` och används av BÅDE `authOptions` och
  middleware — förnyelsen måste skriva samma livslängd som NextAuth utfärdade. ⛔ Ett år, inte "för alltid": en
  JWT-session går inte att återkalla (ingen sessionstabell att radera ur), så en stulen cookie lever tills den går
  ut. ⛔ Förnyas ÄVEN på publika sidor (annars loggas den som mest bläddrar i katalogen ut trots daglig
  användning), men `getToken` körs BARA när en sessionscookie finns → utloggade besökare och crawlers kostar noll
  krypto, och skrivningen sker högst var 24:e timme (`SESSION_RENEW_AFTER`). ⛔ Chunkade cookies (`…token.0`) rörs
  inte: en tillbakaskriven ensam cookie hade lämnat gamla chunkar kvar och två källor hade konkurrerat om samma
  session. ⛔ Ett fel i förnyelsen SVÄLJS — den gamla cookien är giltig, och att kasta hade gett 500 på varje sida
  för alla inloggade. Enhetstestet kör riktiga `encode`/`decode` och vaktar att nyttolasten
  (`id`/`role`/`planTier`/`refreshedAt`) överlever; tappades den hade varje inloggad förlorat sin roll efter ett
  dygn, tyst och bara i produktion.
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
- **Caching/ISR (kvot-kritiskt)**: publika läs-sidor är ISR-cachade, INTE `force-dynamic` (`revalidate=3600`): startsidan, `/marknad`,
  `/sets`, `/sets/[id]`, `/produkter/[slug]`. Data ändras ~1×/dygn så cache är osynlig; live-priser/offers uppdateras ändå klient-sida
  via polling. **Sätt ALDRIG tillbaka `force-dynamic` på dessa** utan skäl — det var orsaken till hög Vercel Active CPU + Neon-CU.
  Förutsättning: ingen server-`auth()`/`cookies()` i den delade chrome:n. Session läses därför KLIENT-sida i `header-auth-actions.tsx`,
  `bottom-tabs.tsx` (self-gate + egen klarerings-spacer) och `live-product-pricing.tsx` (admin-knapp). Rot-layouten + marketing-layouten
  + `SiteHeader` får INTE kalla `auth()` (då blir HELA appen dynamisk igen). `/produkter` är dynamisk med flit (läser searchParams).
  Produktsidans prishistorik: servern hämtar HELA serien en gång (`MAX_DAYS`), `product-price-card.tsx` filtrerar perioden i klienten
  (ingen URL-param → ISR-bar, ingen extra hämtning per periodbyte).
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
  **EN NYCKEL SOM VÄLJER PRODUKT MÅSTE VAKTAS LIKA HÅRT SOM EN SOM VÄLJER PRIS (2026-08-05)**: de två vakterna ovan skyddade
  bara GUIDE-RADEN. Själva MATCHNINGEN på `cardmarket_id` hade ingen namnvakt alls — samma opålitliga fält fick alltså peka
  ut VILKEN PRODUKT som skulle prissättas, obevakat. MÄTT i MEP Black Star Promos: 13 av 139 rader bär ett trasigt
  `cardmarket_id` (null, ett id utanför CM:s katalog, eller ett id som tillhör ett annat kort), och raden "Mega Charizard X ex"
  (MEP 023) bar 873704 — som hos CM är en **N's Zekrom**, och som VI också har, korrekt länkad. Charizard-raden matchade
  därför vår Zekrom och skrev Charizards From (38,00 € = 416,48 kr) på den, medan Zekroms egen rad (60,07 €) förlorade
  arbitreringen. ⛔ **EN FELMATCHNING SKADAR ALLTID TVÅ KORT**: ett får fel pris, ett blir hemlöst. Charizard föll ur
  körningen, frös på 12 juli och plockades till slut upp av guide-reserven, som märker OUT_OF_STOCK ⇒ produktsidan visade
  "Sold out" + 647,63 kr (guidens avg30) fast feedens egen rad bar rätt From hela tiden. Vakten är nu den vanliga:
  `cmCardNameAgrees` på cmid-matchen, och vid oenighet får raden söka sig fram via nummerreserven i stället.
  **NUMMERRESERV FÖR KORT UTAN `tcgExternalId`** (`byNumberNoTcg` + `cmNumberKeyNoSetCode`): promo-korten (84 st, alla i MEP)
  saknar pokemontcg.io-id, så `cardmarket_id` var deras ENDA nyckel — huvudloopens `byNumber` ser dem inte, den frågar
  `card: { tcgExternalId: { not: null } }`. De har nu set+nummer+namn som reserv. ⛔ Nyckeln skalar av setkoden ("MEP 023" →
  "23") och den toleransen är en EGEN karta som ALDRIG får nå huvudkatalogen: där är prefixet ofta självaste numret, och
  "TG10" → "10" hade krockat med kort 10 i samma set. Villkoret är därför separatorn (`MEP 023`, `SWSH-045`), aldrig
  bokstäverna i sig. **REPARATION av felaktiga länkar**: `scripts/fix-promo-cm-links.ts` (torrkörning default, `--apply`) —
  kräver TVÅ bevis: nuvarande länk måste vara bevisat fel enligt CM:s egen singelkatalog OCH ersättaren bevisat rätt enligt
  både feeden (set+nummer) och samma katalog. Håller namnen ihop rörs raden aldrig — MEP 023 är rätt länkad hos OSS och fel i
  feeden, och ska absolut inte skrivas om. 1 av 84 var fel (Makuhita · MEP 068 låg på CM:s "Energy Switch" sedan 12 juli).
  ⚠️ N's Zekrom 031 (idProduct 873704) bär förorenade historikpunkter från ~12 juli till 5 aug (Charizards ~440 kr varvat med
  sitt eget ~660 kr). De är INTE städade: att skilja dem åt kräver en tvåbands-heuristik, och att skriva om historik på en
  gissning är precis det `cm-range-audit --apply` togs bort för.
  **REVISION (rapport, aldrig reparation)**: `scripts/cm-range-audit.ts` (gratis, CM:s guide, ingen RapidAPI-kvot) listar
  priser långt utanför CM:s spann. `--apply` ÄR BORTTAGET: det skrev guide-medianer (fel policy) OCH band identiteten på ett
  normaliserat namn som fäller ihop olika CM-produkter — vårt "Rayquaza ★" blev "rayquaza" och matchade CM:s vanliga Rayquaza
  i EX Deoxys, varpå 160 rader skrevs om 2026-07-26 22:11 UTC. Rapporten hoppar nu över namn som är PREFIX till ett annat
  namn i expansionen (Rayquaza ⊂ Rayquaza Gold Star). Ett fynd betyder "kontrollera länken på Cardmarket", aldrig "skriv om
  priset" — golvet-rakt-av ligger med flit ibland utanför guidens spann. Ångra en sådan skrivning med
  `scripts/revert-guide-median-prices.ts` (återställer ur VÅR egen historik, ingen RapidAPI-kvot).
  ⛔ **RÄTTAT 2026-08-02**: den gamla raden här sa att Cardmarket "inte längre delar ut API-nycklar". Halvfel.
  API:t LEVER och underhålls — det bytte domän 2026-01-30 (`api.cardmarket.com` → **410 Gone** med texten "Please
  switch to https://apiv2.cardmarket.com"; `apiv2.cardmarket.com/ws/documentation` svarar 200, och
  `/ws/v2.0/output.json/games` svarar 403, dvs den fungerar men kräver OAuth). Spärren är alltså POLICY, inte
  teknik, och den är trefaldig: (1) "we are not accepting applications for access"; (2) åtkomst är begränsad till
  PROFESSIONELLA SÄLJARE med manuell godkännandeprocess; (3) — den avgörande — vårt exakta användningsmönster är
  uttryckligen förbjudet: *"We explicitly do not allow that Dedicated App users constantly only request the public
  Marketplace resources (products, articles, prices, etc.) on consecutive days"*, med automatisk avstängning som
  påföljd. Det ÄR vår dagliga 20k-uppdatering.
  ⚠️ Värt att veta för framtiden: Cardmarkets API skulle lösa BÅDA våra luckor perfekt. `Article.isReverseHolo`
  och `Article.isFirstEd` är dokumenterade FÖR POKÉMON-SINGLAR, och de sitter på ANNONSEN, inte på produkten — så
  Shadowless kontra 1st Edition GÅR att skilja genom att partitionera den delade produktens annonser på
  `isFirstEd`. Det är precis det ingen återförsäljare av `price_guide_6.json` någonsin kan göra (guiden är keyad
  på `idProduct`). Kapaciteten finns alltså och är stängd — bygg inte mot den, men gissa inte heller att den inte
  existerar.
- **EN FRUSEN KURVA ÄR ETT TILLSTÅNDSFEL, INTE ETT RADFEL (2026-08-05)**: leverantören (TCGGO) slutar då och då
  leverera CM-koppling för enskilda kort — `cardmarket_id: null` och tom `prices.cardmarket` i EPISOD-feeden (verifierat
  på xy9-10 Growlithe · BREAKpoint, sm8-88, smp-SM191, sm11-10: helt vanliga kort som CM självklart har). Koden gjorde
  rätt PER RAD — den vägrar hitta på ett pris — men fel i TILLSTÅNDET: kortet föll ur körningen, offern rördes inte,
  ingen historikpunkt skrevs, och gårdagens tal stod kvar under rubriken "Lägsta pris" som om det vore dagens.
  **108 singlar hade frusit så, de äldsta sedan 2026-06-13.**
  ⚠️ **"Sista grafpunkt 2026-07-25" ÄR INTE SISTA MÄTNINGEN.** Ett engångs-backfill den dagen skrev en CM-punkt för
  20 153 singlar med deras BEFINTLIGA offer-pris — ett falskt livstecken som får varje sådan kurva att se ut att dö
  just då. **Mät på `Offer.lastSeenAt`** (bumpas bara när en körning faktiskt hittade kortet), aldrig på sista
  observationen. Rapport = `scripts/frozen-cm-report.ts` (läser bara, noll kvot, `--csv`).
  **GUIDE-RESERVEN** (`guideReserveEur` + blocket i `runCardmarketRefresh`) prissätter sådana kort ur CM:s EGEN
  gratisguide via det `idProduct` VÅR EGEN länk bär — spegling av EN-guide-fallbacken för sealed. Ingen ny prispolicy:
  värdet går genom samma `singlesHeadlineEur`, och utan From blir det per definition en UPPSKATTNING (`from: false`
  ⇒ OUT_OF_STOCK ⇒ "Uppskattat värde · ingen aktiv annons").
  ⛔ **ALDRIG PÅ EN DELKÖRNING.** Reserven definieras av "feeden prissatte INTE kortet i den här körningen" — i en
  riktad omkörning (`CM_ONLY_EPISODES`) är det sant om nästan hela katalogen. Utan den grinden hade en kvotsnål
  omkörning av ETT set bytt ~20 000 äkta From-priser mot guide-uppskattningar. Farligare än täckningsvakten, som
  bara larmar: det här SKRIVER. ⛔ Tom CM-katalog (CDN-fel) ⇒ ingen reserv den körningen; ett fruset dygn är rätt
  svar när identiteten inte kan styrkas. ⛔ Tryckningar är undantagna (delar CM-produkt ⇒ samma värde på två poster).
  **ÅTERSTÄLL SAKNADE `idProduct`** = `scripts/recover-cm-idproduct.ts` (torrkörning default, `--apply`): lösta
  slug-länkar bär inget id, och utan id kan reserven inte veta vilken CM-produkt kortet är. Kedjan är vårt set →
  CardTrader-expansion → blueprint på SAMLARNUMMER → `card_market_ids` → idProduct. **Noll RapidAPI-kvot** (CT gratis,
  CM:s filer publika). ⛔ **NUMRET ENSAMT ÄR INTE IDENTITET** — utan namnvakt gav kedjan rent skräp, mätt på riktiga
  produkter: "Charizard ex 196" → CT:s *Eevee*, "Xerneas ex 179" → *Basic Psychic Energy*, "Noctowl 141" → *Sky Field*
  (37 av 103 kandidater; promo-set numrerar olika hos olika leverantörer). Därför krävs att TVÅ OBEROENDE namn håller
  med: CardTraders eget blueprint-namn OCH CM:s singelkatalog. Med båda vakterna avvisades alla 37 och **0 föll på
  CM-ledet** — källorna var eniga varje gång de fick tala till punkt. 49 länkar återställda 2026-08-05.
  ⚠️ Kvar utan väg: de nyaste SV/SM-promosen (CT numrerar dem annorlunda) — de behåller sitt gamla pris tills
  leverantören kommer tillbaka, per ägarbeslut 2026-08-05. Listan står i rapporten ovan.
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
  **EN SÄKER BILDTRÄFF SLÅR MODELLENS NAMN — OCH MARGINALEN, INTE POÄNGEN, AVGÖR VAD "SÄKER" ÄR (2026-07-30)**:
  modellens NAMN är opålitligt på skärmfotograferingar. Samma kort, samma ram, fyra skanningar: "Pelipper", "Pawmot",
  "Falinks", "Palafin ex" — det sista med konfidens 0,85. Ett hallucinerat namn får full namnlikhet (1,0) mot SINA kort
  medan rätt kort får ~0 på namn, så texten vann alltid. MÄTT över 250 kort (hård försämring + 3 % marginal) för träff 1:
  RÄTT (210 st) poäng median 0,873 / min 0,570 · marginal median 0,111 / p90 0,297 — FEL (40 st) poäng median 0,758 /
  **MAX 0,922** · marginal median 0,012 / **MAX 0,066**.
  ⛔ **POÄNGEN SKILJER INTE RÄTT FRÅN FEL** (fördelningarna överlappar: en felträff kan ha 0,92, en rätt träff 0,57).
  MARGINALEN till tvåan gör det. Regeln `poäng ≥ 0,70 OCH marginal ≥ 0,10` (`ART_TRUST_*`) gav **100 % precision** — 0 av
  40 felträffar slapp igenom — och täckte 117 av 210 rätta. Tröskeln har ~1,5× marginal till sämsta observerade felträff
  och är satt på FÖRDELNINGEN, inte på det produktionsfall som väckte frågan (Falinks TG07: 0,857, marginal 0,379).
  Bonusen (1,15) ligger ÖVER en ren namnträff (max 1,0) men UNDER namn+nummer (1,4–1,5): ett hallucinerat namn utan
  nummerstöd förlorar, men namn OCH nummer som pekar på samma kort vinner — där är texten bevisad, inte gissad.
  Verifierat i tre riktningar: hallucinerat namn + säker bild → bilden vinner; hallucinerat namn + OSÄKER bild → namnet
  står kvar; namn+nummer på ett annat kort → texten vinner.
  **KORSVALIDERING — NAMNET DÄMPAS NÄR BILDEN INTE HÅLLER MED (2026-07-30)**: marginalregeln räddar bara de 56 % av
  rätta bildträffar som är BEVISAT säkra; de övriga 44 % har en äkta men smalare marginal och förlorade fortfarande mot
  ett hallucinerat namn. Håller modellens namn inte med om NÅGOT av bildens 15 bästa kort (Dice < `NAME_AGREE_MIN` 0,5)
  OCH bilden själv är stark (≥ `ART_STRONG`), skruvas namnvikten ner till `NAME_DISTRUST` (0,25). Två oberoende signaler
  som pekar isär betyder att en av dem är fel, och bilden är den mätta av de två. Namnet NOLLAS inte — namnträffar
  ligger kvar över orelaterade kort, för i ~7 % av fallen är det BILDEN som har fel.
  ⛔ **DÄMPNINGEN MÅSTE GÄLLA NUMRET OCKSÅ.** Namn och nummer kommer ur SAMMA modellsvar — är det ena påhittat är det
  andra lika misstänkt. MÄTT när bara namnet dämpades: det hallucinerade numret "041/193" matchade Paldean Tauros 41 i
  Paldea Evolved EXAKT (setet har 193 kort), fick full nummerbonus och vann över rätt kort. Ett påhittat tal träffar en
  riktig rad förr eller senare — katalogen har 20 563 kort.
  **FLERA VIDEORUTOR PER SLUTARTRYCK (`CAPTURE_FRAMES` 3)**: moiré, rörelseoskärpa och autofokus-sökning varierar PER
  RUTA, och avtrycket är gratis att räkna (ingen API-kostnad). Servern väljer den ruta som var mest AVGÖRANDE — störst
  marginal, `searchByFrames`. ⛔ Slå INTE ihop rutor med max-poäng per kort: det plockar den lyckligaste observationen
  per kort, trycker ihop fältet och förstör marginalen, som är hela vårt mått på tillförlitlighet. Bilden och närbilden
  till modellen tas från FÖRSTA rutan (den användaren såg); extra rutor skulle bara kosta uppladdning.
  **DIAGNOSTIK SPARAS FÖR ADMIN** (`ScannerJob.result`, ingen migration, inga extra rader): modellens svar, bildens
  topp-3 och det valda kortet — plus konstavtrycket (264 byte), ALDRIG bilden. Det är vad som gör det möjligt att mäta
  VERKLIG träffsäkerhet; alla siffror ovan är tak, byggda på frågor härledda ur samma filer som referenserna. Bara
  admin, av dataminimeringsskäl.
  ⛔ **BILDTRÄFFARNA MÅSTE LIGGA ÖVER NAMN-SYSKONEN i kandidatlistan** (skikt 2 mot 3): med ett hallucinerat namn är dess
  syskon en lista över FEL kort, och låg bildträffarna i "övrigt" försvann rätt kort ur listan helt.
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
- **SKANNERKOSTNADEN ÄR VERIFIERAD MOT FAKTURA (2026-08-02)**: sedan Gemini slogs på (01:14 UTC) har **177 kort
  identifierats** — **68 gratis** (bilden avgjorde, noll API-anrop), **97 vision-anrop**, 12 utan diagnostik
  (icke-admin). De 97 anropen förbrukade 362 353 in- och 5 565 ut-tokens, och Googles konsol visade **0,82 kr**.
  Alltså **~0,0085 kr per vision-anrop** och **~0,0046 kr per identifierat kort** (bildvägen späder ut notan).
  Sätt det mot Pro: 49 kr/mån, och skäligt-bruk-taket 1 000 skanningar ⇒ värsta fallet ~8,5 kr om VARENDA
  skanning krävde vision. Marginalen är alltså bekväm, och ~40-50 % avgörs gratis av bilden i praktiken.
  ⛔ `scripts/scanner-telemetry.ts` PRICES-tabell är en uppskattning för att följa kostnaden MELLAN fakturor —
  **fakturan är facit.** Den gamla gemini-raden (0,25/1,50) låg ~28 % för högt och är rättad till 0,20/0,80 mot
  det uppmätta utfallet. Stämmer de inte överens: rätta tabellen, aldrig tvärtom.
- **HAPTIK BOR I `src/lib/haptics.ts`, MED TRE STYRKOR (2026-08-02)**: `hapticTick` (långtryck löste ut, val
  gjordes), `hapticGlide` (fingret gled till ett NYTT värde) och `hapticImpact` (något blev klart — skannern
  låste ett kort). ⛔ Hitta inte på millisekunder på anropsstället: spridda `vibrate(37)` ger en app som känns
  olika på olika ställen utan att någon bestämt det. ⛔ **Haptik per VÄRDE, aldrig per pixel** — `onMouseMove` på
  prisgrafen eldar hundratals gånger i sekunden, så `price-chart.tsx` jämför mot `lastHaptic` och vibrerar bara
  när datapunkten byts. Gesterna som har haptik är de som saknar visuell kvittens: långtryck på "+" (arket hinner
  inte upp förrän efter animationen), långtryck för att kopiera namnet (ticket kommer NÄR gesten löser ut, medan
  fingret ligger kvar — kopian sker fortfarande på pointerup) och grafens skrubb (fingret täcker sin egen
  träffpunkt). ⚠️ **`navigator.vibrate` finns INTE i iOS Safari/WKWebView** — på iPhone händer ingenting, tyst och
  utan fel. **Därför finns `@capacitor/haptics` sedan 2026-08-02**: modulen försöker plugin:et FÖRST (Taptic
  Engine på iOS, bättre känsla även på Android) och faller till `navigator.vibrate`. ⛔ Plugin:et nås via
  BRYGGAN (`Capacitor.Plugins.Haptics`), aldrig via `import` — samma mönster som Keyboard-plugin:et, av samma
  skäl: koden körs också på webben där paketet inte har någon native-sida, och en statisk import hade dragit in
  modulen i webbuntet i onödan. ⚠️ **iOS är tyst tills `npx cap sync` körts och appen byggts om (Codemagic) —
  en `git push` räcker INTE.**
- **BULK-TAKET = 15, SATT PÅ MÄTNING (2026-08-02)**: bor på TRE ställen — `BULK_MAX_CARDS` i skanna/page.tsx
  (vad klienten skickar), `cells.max(N)` i `/api/scanner/identify-bulk` (vad servern accepterar) och
  `BULK_DETECTOR_MAX_CARDS` i lib/camera-controls.ts (vad zoom-rekommendationen klampas mot).
  12 → 20 → **15**. Måttet är andelen celler som BILDEN avgjorde utan att kosta ett vision-anrop, ur
  `ScannerJob`-telemetrin: **12 kort → 42/42/50 % · 15 kort → 47 % · 18 kort → 28 %** (och notan dubblas,
  $0,008 → $0,013). 15 ligger i samma band som 12; vid 18 kollapsar det. ⛔ Glider de tre talen isär blir felet
  TYST: ett för lågt Zod-tak avvisar HELA fångsten med 400 (inte bara överskottet), ett för lågt klient-tak kapar
  korten utan förklaring. `tests/unit/bulk-cap-sync.test.ts` vaktar att de är samma tal.
- **⛔ MODELLEN LÄSER ÄGARPREFIX FEL — OCH TEXTEN SLÅR DÅ BILDEN (MÄTT 2026-08-02)**: de nya seten (Ascended
  Heroes, Destined Rivals) är fulla av kort som heter "Larry's Komala", "Steven's Beldum", "Erika's Gloom",
  "Team Rocket's Murkrow". Modellen läser bara Pokémon-namnet, och det TRUNKERADE namnet matchar ett HELT ANNAT
  kort EXAKT — som då vinner över bildens träff:
  `"Komala" → Komala 185 (Unified Minds)` medan bilden sa Larry's Komala 175 · `"Beldum" → Beldum 59` mot
  Steven's Beldum 143 · `"Gloom" → Gloom 44` mot Erika's Gloom 2. **Bilden hade rätt i alla tre.** Värre: vinnaren
  delar då varken namn eller konst med rätt kort, så det föll ur alternativlistan och gick INTE att rätta.
  Lindring: `ScanCandidate.artRank` märker bildens `ART_ALWAYS_SHOWN`(3) bästa, och detaljvyn visar dem ALLTID.
  Det fabricerar ingen säkerhet — poäng och ordning är orörda, kortet går bara alltid att välja.
  ⏭️ KVAR (den egentliga fixen): låt namnmatchningen förstå ägarprefix, så "Komala" också krediterar
  "Larry's Komala". Det ändrar poängsättningen för HELA katalogen och måste mätas med
  `scripts/scanner-match-audit.ts` före ship — inte gissas.
- **NAMNSYSKON HAR GARANTERADE PLATSER I KANDIDATLISTAN (2026-08-02)**: `SIBLING_RESERVED`=4 i
  `matchCards`. Syskonen ligger i skikt 3, UNDER bildkandidaterna (skikt 2), och en bulk-cell kan ha upp till
  `ART_CANDIDATES` kort över `ART_STRONG` — då fyller skikt 2 hela taket och syskonen faller ur listan. Det är
  exakt det fall användaren måste kunna rätta: **samma konst, olika samlarnummer**. MÄTT I FÄLT: en bulk-fångst
  gav Raboot #27 där kortet var #37, omärkt som osäker och utan #37 bland alternativen. Reservationen ändrar inte
  ORDNINGEN, bara vilka som får plats. I detaljvyn visas dessutom **kort med SAMMA KONST alltid**, oavsett
  poängfönstret — förtroendebonusen (ART_TRUST 1,15) skjuter annars omtrycket långt utanför `ALT_SCORE_WINDOW`,
  vilket var precis vad som gjorde felmatchningen omöjlig att rätta. Flaggan `ScanCandidate.sameArt` sätts
  server-sida med `artPairSimilarity` mot **samma `SAME_ART_MIN` (0,9)** som omtryckssyskonens tie-break redan
  använder — kalibrerat mot verkliga fall: äkta omtryck **0,954–0,976**, olika konst **≤ 0,638**. Två tal på var
  sin sida om det gapet är samma beslut och får inte glida isär. ⛔ Beräknas BARA när bildmatchningen kördes
  (`artScores?.size`), annars hade en ren textskanning tvingat fram en lat inläsning av hela 5,4 MB-indexet.
  ⛔ **KONST, inte NAMN** (ägarbeslut 2026-08-02): namnregeln drog in varenda annan Raboot i katalogen och gjorde
  listan onödigt lång fast de flesta inte ser likadana ut. Regeln bor i `src/lib/scan-alternatives.ts` — ren och
  testad, för den avgör om en felmatchning går att RÄTTA och har felat i fält en gång. `MAX_ALTERNATIVES` 3 → 6.
  ⚠️ Server-reservationen går på NAMN medan visningen går på KONST: **var generös med vad som HÄMTAS, strikt med
  vad som VISAS.** Ett namnsyskon med annan konst är fortfarande en trolig rättelse (mätt: Falinks ur Astral
  Radiance TG matchad som Falinks ur Stellar Crown) och kostar inget att ha i listan när UI:t ändå filtrerar.
- **⛔ `Haptics.selectionChanged()` ÄR EN TYST NO-OP PÅ iOS UTAN `selectionStart()` (2026-08-02)**: Capacitor
  skapar `UISelectionFeedbackGenerator` först i `selectionStart()`, så ett ensamt `selectionChanged()` returnerar
  utan fel och utan vibration. Det var därför långtrycken kändes på iPhone men graferna inte gjorde det —
  långtrycket använder `impact()`, som inte kräver någon förberedelse. `hapticGlide` använder därför **LIGHT
  impact**, inte selection: start/ändrad/slut-livscykeln vore "rättare" men kräver att varje anropsställe
  signalerar när en gest BÖRJAR och SLUTAR, dvs mer API-yta och fler sätt att glömma ett anrop, för en
  nyansskillnad i känsla. Glide har dessutom en spärr på `GLIDE_MIN_GAP_MS` (45 ms): Taptic Engine hinner inte
  återgå tätare än så och iOS SLÄPPER de överflödiga, så utan spärren blir resultatet FÄRRE kännbara tick.
- **⛔ RECHARTS SYNTETISERAR INTE MUS-EVENTS FRÅN TOUCH (2026-08-02)**: diagrammets `onMouseMove` fyras BARA av
  mus, och biblioteket typar inga touch-props på `AreaChart`. Grafens haptik satt först där och fungerade därför
  bara på desktop — mätt i fält: långtrycken vibrerade på iPhone, graferna gjorde det inte. TOOLTIPEN däremot
  renderas av recharts för båda inmatningssätten, så haptiken bor i `ChartTooltip` och triggas när `label` byts
  (dvs per DATAPUNKT, aldrig per pixel). `onMouseMove` driver fortfarande linjens uttoning, inget mer.
  Portföljgrafen och produktsidans prishistorik delar `PriceChart` — en fix, båda ytorna.
- **BULK VID 0,5× ÄR FÄLTVERIFIERAT PÅ 12 KORT (ägaren 2026-08-02)**: tolv kort i EN fångst, alla tolv rätt
  identifierade. Farhågan i `ZOOM_PRESET_MAX_CARDS` — att pixelbudgeten (~1/12 av bilden per kort) skulle fälla
  det — besannades INTE, och det är väntat efter bildmatchningen: avtrycket läser FÄRGLAYOUT, inte det ~2 mm höga
  samlarnumret. Det är numret som behöver pixlar, och bulkvägen avgörs av bilden. 1× och 2× är fortfarande omätta
  (copyn säger "ca"). Om 12 är ett tak eller bara det högsta någon provat går inte att veta utan att höja
  `BULK_MAX_CARDS` först — detektorns eget tak är 12.
- **BOTTENARKET ÄR APPENS "VÄLJ OCH BEKRÄFTA"-FORM (ägarbeslut 2026-08-02)**: `src/components/ui/bottom-sheet.tsx`
  — mörk överlagring, rundad panel som glider upp, draghandtag, rubrikrad med valfri åtgärd, scrollande kropp,
  fast fot med huvudknappen. Katalogens filter-/sorteringsark var förlagan; snabbtillägget i samlingen (håll in
  "+") byggdes först som en popover ankrad vid knappen och gjordes om till samma ark. ⛔ **EN implementation.**
  Tangentbordslyftet är den kluriga delen och bär en dokumenterad Capacitor-fälla (native kör `Keyboard
  resize:none` → varken WKWebView eller `visualViewport` krymper, bryggan är enda pålitliga signalen) — den får
  inte kopieras. `explore-filter-bar.tsx`s `Sheet` är sedan dess ett tunt skal som bara fyller i filtrens egen copy.
  Vinsten med formbytet var att ankarmätning, portal förbi kortets `overflow-hidden`, flip över/under, klampning
  mot visualViewport, omräkning när felraden ändrar höjden och följ-ankaret-vid-scroll ALLA försvann: ett ark är
  fäst vid skärmen, inte vid ett kort.
- **⛔ KAMERANS LIVSCYKEL FÅR ALDRIG BERO PÅ ETT HOOK-OBJEKTS IDENTITET (2026-08-02)**: `useCameraControls`
  returnerade ett bart objektliteral → ny identitet varje rendering. `stopCamera` fick `[camera]` som beroende,
  och eftersom den anropas av `useEffect(() => () => stopCamera(), [stopCamera])` kördes den effekten om vid varje
  rendering — och dess CLEANUP river strömmen. `startCamera` startade om, anropade `attach()` → setState → ny
  rendering → loop. Kameran revs ner i samma andetag som den startades och gick aldrig live. Fixat i TVÅ lager:
  hooken memoiserar sitt returvärde, OCH skanner-sidan når `attach` via en REF så livscykeln inte kan bero på
  objektet alls. Memoiseringen ensam räcker INTE — identiteten byts ändå när `zoomPresets` fylls i efter första
  spåret, vilket hade rivit strömmen en gång till. Regeln generellt: en callback som en avmonterings-effekt
  beror på måste ha stabila beroenden, annars är dess cleanup en tyst rivning vid varje rendering.
- **SKANNING = OBEGRÄNSAD FÖR PRO, MED 1 000/MÅNAD SOM PUBLICERAT SKÄLIGT BRUK (ägarbeslut 2026-08-02)**:
  fyra ytor måste säga SAMMA sak och de gör det nu: prissidan ("Obegränsad kortskanning (skäligt bruk)"),
  skannerns Pro-badge (`∞`), villkoren `Terms.s6FairUse` ("upp till 1 000 skanningar per kalendermånad, nollställs
  den 1:a") och koden `PREMIUM_FAIR_USE = 1000` i `src/services/scanner/index.ts`. Gratis = 30/månad, oförändrat.
  Kvoten räknar IDENTIFIERADE KORT och nollställs på UTC-månadsskiftet (`startOfMonthUtc`), inte på
  prenumerationens årsdag. ⛔ **Taket är nu ett AVTALSVILLKOR, inte bara en skyddsspärr.** Sänks det — i koden
  eller via `SCANNER_PREMIUM_MONTHLY_LIMIT` — blir villkorstexten falsk, och ett dolt tak under det publicerade är
  ett villkor kunden aldrig fått se. Ändra konstanten och villkorstexten tillsammans, eller ingen av dem.
  Env-variabeln finns kvar för nödlägen, inte för produktbeslut.
  Sidofix samma dag: `Grading.limitPremium` sa "Tillbaka i morgon" fast graderingskvoten är MÅNADSVIS
  (`startOfMonthUtc` i `src/services/grading/index.ts`) — en Pro-kund som slog i taket fick veta att det löste sig
  i morgon, och blockerades igen dagen därpå.
- **SKANNERN HAR TRE LÄGEN, OCH DE ÄR ETT `mode`-FÄLT (2026-08-02)**: `"single" | "bulk" | "barcode"` i
  `skanna/page.tsx`. ⛔ Inte tre booleaner: två flaggor har fyra tillstånd varav ett ("båda på") är meningslöst men
  fullt möjligt, och lägena tävlar om SAMMA videoruta, slutare och poll-loop. Live-pollen/låset körs BARA i
  `single` (låset är ett enkortsbegrepp), bulk pollar inte alls, och streckkodsläget kör sin egen detektor.
  **BULK ÄR PRO**: grinden sitter i `/api/scanner/identify-bulk` (`isPro`, aldrig `planTier` — RevenueCat nollar
  planTier vid EXPIRATION och har tystat ägarens egna funktioner förr). Knappen VISAS ändå för gratisanvändare, med
  hänglås + PRO-märke → `/priser`; en funktion man inte kan se säljer ingenting. Låset sätts först när kvoten
  laddats (`quota != null && !isPremium`) — att gissa låst medan den är okänd blinkade ett Pro-lås för betalande
  kunder vid varje öppning. Ett 403 städar cellerna och skickar till prissidan i stället för att visa nio fel.
  Kvoten var redan rätt: `identifyCellsArt` bokför en scan per SÄKER cell och osäkra celler bokförs av `/identify`,
  dvs 9 identifierade kort = 9 kvot.
- **SEALED SKANNAS PÅ STRECKKOD, INTE PÅ UTSEENDE (2026-08-02)**: en ask har ingen konstbild att matcha mot, men
  den bär tillverkarens GTIN — och vi har redan hela GTIN-infrastrukturen (~73 % täckning på riktiga offers,
  `src/lib/gtin.ts`). Koden ÄR identiteten: `/api/scanner/identify-gtin` slår upp på normaliserad GTIN-14, så en
  träff är exakt och kostar noll vision-anrop. `src/services/scanner/barcode.ts` avkodar via webbläsarens
  `BarcodeDetector` och normaliserar ALLTID genom `gtin.ts` (fel checksiffra → INGEN träff, aldrig en gissning).
  ⛔ **iOS/WebKit har ingen `BarcodeDetector`** → `barcodeSupported()` är false och läget döljs HELT. Skillnaden mot
  bulk är avsiktlig: bulk är låst av OSS och går att låsa upp, streckkod är omöjlig på enheten. Detektorn skapas EN
  gång per lägesbyte (Android initierar Play Services-modellen i konstruktorn), och en `seen`-mängd hindrar att
  samma ask läses om 2,5 ggr/s medan den ligger kvar framför linsen. Skicket sätts till SEALED — NEAR_MINT hade
  varit ett påstående om något vi inte kan se.
- **FICKLAMPA + ZOOM: RENDERA BARA DET ENHETEN FAKTISKT KAN (2026-08-02)**: `src/lib/camera-controls.ts` (ren
  logik, testbar) + `src/hooks/use-camera-controls.ts` (livscykel). Torch saknas på desktop, framkameror och HELA
  iOS; zoom-kapabilitetens intervall är enhetsspecifikt och står INTE i "x" (både faktor- och procentskala
  förekommer), och **0,5× är oftast ett ANNAT OBJEKTIV** — en egen enhet i `enumerateDevices()`, inte ett
  zoom-värde. Hooken returnerar därför bara NÅBARA förval; en 0,5×-knapp som inte gör något är sämre än ingen knapp.
  ⛔ Modulen rör ALDRIG strömmens livscykel: kräver ett förval en annan kamera svarar den `needs-stream-restart`
  med enhetens id och skanner-sidan öppnar om strömmen själv (`withDeviceId` släpper `facingMode` — exakt
  deviceId + facingMode kan motsäga varandra och ge OverconstrainedError). ⚠️ Korttalen per zoomnivå
  (`ZOOM_PRESET_MAX_CARDS`: 0,5× = 12, 1× = 6, 2× = 1) är HÄRLEDDA UR GEOMETRIN, inte mätta — copyn säger därför
  "ca". De är ett tak för vad som FÅR PLATS, inte ett löfte om vad som går att LÄSA.
- **SKANNERNS ALTERNATIVLISTA GALLRAS FÖR VISNING, ALDRIG FÖR MATCHNING (2026-08-02)**: `MAX_ALTERNATIVES`=3 och
  `ALT_SCORE_WINDOW`=0,2 mot TRÄFFENS poäng (inte listans topp — frågan är "kan skannern ha tagit fel på DET HÄR
  kortet?"). Listan var oavkortad, och eftersom 92 % av katalogen delar namn med minst ett annat kort radade en
  vanlig skanning upp tio kort och sköt ner prisutvecklingen under vikningen. Ett kort långt under träffen delade
  oftast bara ett namn-token och är ingen förväxlingsrisk — att visa det får användaren att tvivla på en träff som
  var rätt. Kandidaterna räknas fram precis som förut och `onChoose` kan fortfarande välja vilken som helst.
  Under alternativen ligger `ScanPriceHistory`: hämtar `/api/products/{slug}/detail` (samma CDN-cachade endpoint
  som produkt-overlayn) NÄR DETALJVYN ÖPPNAS, aldrig vid skanningen — en bulk-fångst hade annars dragit nio
  detaljhämtningar ingen tittar på. Grafen ritas bara med ≥2 punkter.
- **PRODUKT-OVERLAYNS z-index ÄR INTE EN KONSTANT (2026-08-02)**: overlayn ligger på z-40 (över sidans header,
  UNDER bottenflikarna som målas senare i DOM). Skannern är `fixed inset-0 z-[60]` → "Visa produkt" därifrån
  öppnade overlayn UNDER kameravyn: den monterades och hämtade sitt data, men användaren såg ingenting hända.
  Buggen var aldrig länken, den var målningsordningen. En helskärmsvärd anmäler sig med `registerFullscreenHost()`
  (`src/lib/product-overlay-open.ts`, RÄKNARE inte boolean) och BARA då lyfts overlayn till z-[70]. ⛔ Höj den
  aldrig permanent — då försvinner bottenflikarna bakom den i vanlig bläddring, vilket är hela skälet till z-40.
- **SAMLINGEN LAGRAR POSTER (LOTS), VISAR SNITT (ägarbeslut 2026-08-02)**: köper man samma kort två gånger till
  OLIKA pris blir det TVÅ `CollectionItem`-rader, var och en med sitt pris och datum; gränssnittet slår ihop dem
  till EN rad med totalantal och snittpris (hopfällbar, lotsen syns när man fäller ut). `addCollectionItem`
  stackar därför bara när priset är IDENTISKT (`null` matchar `null`) — förut stackade den alltid och skrev bara
  `quantity`, så ett andra köp till annat pris fick sitt inköpspris **tyst kastat**. Ren, testad logik i
  `src/lib/collection-lots.ts` (`groupLots`, `canStackOnto`, `lotKey`).
  **VARFÖR INTE ETT SNITT I DATABASEN** — tre skäl, i fallande tyngd:
  (1) **Försäljningen kräver poster.** `Sale` ögonblicksbildar `purchasePriceOre`; säljer man ETT av tre exemplar
  köpta till olika pris finns inget "det" inköpspris att dra av under ett blandat snitt. En jämförbar app har
  exakt det felet och användarna klagar på det i recensionerna.
  (2) **Delvis data går inte att uttrycka.** Alla befintliga poster saknar pris med flit; "3 ex okänt + 1 ex à
  400" ryms inte i ett `purchasePrice`-fält utan att ljuga om de tre eller kasta de 400. `groupLots` returnerar
  därför `costedQuantity` vid sidan av `quantity`, och UI:t säger "snitt 400 kr · 1 av 4".
  (3) **Marknadskoll (2026-08-02, ~13 appar)**: varje app som BEVISLIGEN tänkt på frågan lagrar poster med datum
  per köp. De som staplar har aldrig dokumenterat vad ett andra köp gör — i hela kategorin finns inte ett enda
  omnämnande av "average cost", FIFO eller LIFO. ⛔ Ett snitt hade alltså inte varit "som alla andra"; det är en
  fråga ingen i kategorin besvarat högt.
  ⚠️ Skatt: om kort räknas som personliga tillgångar gör 50 000 kr-fribeloppet + 25 %-schablonen att ett
  snittanskaffningsvärde saknar skattemässig betydelse. Marknadsför det som en PRESTANDA-funktion, aldrig som
  hjälp med deklarationen.
- **INKÖPSPRIS + VINST/FÖRLUST (2026-08-02)**: `CollectionItem.purchasePrice` (öre) fanns redan — ingen migration.
  Ägarbeslut: priset är PER OBJEKT, och befintliga poster lämnas TOMMA (ingen backfill från `estimatedValue` — en
  påhittad anskaffningskostnad gör hela siffran till en lögn). ⛔ **Vinsten var fel**: `profit = totalValue −
  totalCost` drog de fåtal prissatta objektens kostnad från ALLA objekts marknadsvärde, så ett objekt utan
  kostnadsbas bidrog med hela sitt värde som "vinst". Nu `profit = costedValue − totalCost` över objekt som har
  BÅDE inköpspris och känt värde, och `profitExcludedCount` visas i UI:t så talet är ärligt. Har inget objekt en
  bas visas "–", aldrig "0 kr" (en nolla läser som "du går jämnt ut"). EN penningparser för hela appen:
  `src/lib/purchase-price.ts` (`parseKronorToOre`, tar både "," och ".", taket är int4).
- **Samlingsvärde**: live via `computeCollectionValue`/`valueCollectionItems` (`src/services/collection.ts`) → `getCardValues`/`getProductValues` (`src/services/products.ts`) = produktens lägsta pris (singel = CM-trend, sealed = butik) × live-kurs. Faller tillbaka på lagrat `estimatedValue` (ögonblicksbild vid tillägg) när live saknas. Skannade kandidater visar samma värde via `estimateCardValue`
- **AI-gradering = GEMINI PÅ BÅDA NIVÅERNA (ägarbeslut 2026-08-05)**: adaptermönster i `src/services/grading/`
  (`GradingAdapter` + mock + Claude + Gemini). Plan→modell är nu PER LEVERANTÖR: FREE = `GRADING_MODEL_FREE_GEMINI`
  (`gemini-3.1-flash-lite`, $0,25/$1,50 per MTok, max `GRADING_FREE_MONTHLY_LIMIT`=3/mån), PREMIUM =
  `GRADING_MODEL_PREMIUM_GEMINI` (`gemini-3.6-flash`, $1,50/$7,50, max `GRADING_PREMIUM_MONTHLY_LIMIT`=15/mån).
  ⛔ **3.6 och INTE 3.5**: samma inpris, 20 % billigare utpris, nyare — 3.5 är strikt dominerad (samma fälla sitter
  kvar i `SCANNER_MODEL_PRECISE`). ⛔ **Aldrig `gemini-2.5-*`**: spärrad för NYA API-nycklar, stängs 2026-10-16.
  ⛔ **Egna variabelnamn per leverantör med flit** (`_GEMINI`-suffix, efter `DEALS_VERIFY_MODEL_GEMINI`): ett DELAT
  `GRADING_MODEL_*` hade tyst skickat ett Claude-modellnamn till Google vid ett byte = 404 på VARJE gradering, en
  funktion som är död för alla utom loggläsaren.
  **Prompt/schema/tolkning bor i `grading/contract.ts`**, aldrig i en adapter — annars jämför ett leverantörsbyte
  PROMPTER i stället för MODELLER (samma skäl som skannerns och fynd-verifierarens kontrakt). `GRADE_REQUIRED`
  HÄRLEDS ur fältspecen så de inte kan glida isär. Strukturerat svar via tvingat verktyg (`report_grade`).
  ⛔ **`maxOutputTokens` är taket för TÄNKANDE + SVAR på Gemini 3** och tänkandet går inte att stänga av — Claudes
  1024 rakt över trunkerar tyst verktygsanropet. 2048 + `thinkingLevel: "minimal"`.
  ⛔ **GIF avvisas explicit**: delade `parseDataUrl` accepterar gif för Claudes skull, Google gör det inte.
  Byte sker med `GRADING_PROVIDER` på RAILWAY (ingen deploy); `GRADING_PROVIDER=claude` är rollback.
  ⏭️ KVAR: bilderna skalas INTE ner (två foton à upp till 5 MB) — största kostnadsspaken, medvetet lämnad utanför
  leverantörsbytet så kostnadsdeltat går att tillskriva. Det är en UPPSKATTNING, aldrig en officiell PSA/BGS-grad.
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
- **SIDANS LODRÄTA HÖJD: SKALET MÅSTE DRA AV ALLT SOM LIGGER UTANFÖR SKALET (2026-08-05)**: `/mer` och
  `/community` gick att svepa fast allt syntes. Tre poster adderar dokumenthöjd UTANFÖR sidskalet, och
  missas EN går sidan att scrolla precis så mycket: (1) `BottomTabs` klarerings-spacer (`h-16`) är ett
  SYSKON till skalet i rot-layouten, (2) `body { padding-top: env(safe-area-inset-top) }` i globals.css
  (~44–59 px på telefon med urklipp), (3) `100vh` är den STORA viewporten på mobilwebb — använd `100dvh`.
  Därav `min-h-[calc(100dvh_-_4rem_-_env(safe-area-inset-top))] lg:min-h-screen` i `app-shell.tsx` och
  `(marketing)/layout.tsx`. ⚠️ **Post 1 och 2 är NOLL på desktop** (spacern är `lg:hidden`, `env()` = 0) —
  uppmätt spill i datorwebbläsaren var 0 px medan telefonen scrollade. **Verifiera på telefon.**
  ⛔ `overscroll-behavior: none` MÅSTE stå på `html`: egenskapen propagerar till viewporten bara från
  ROT-elementet (till skillnad från `overflow`, som propagerar från body). Den låg på `body` med en
  kommentar som påstod att studsen var av — uppmätt värde på html var `auto`. På iOS känns rubber-band
  exakt som scroll och maskerar felsökningen.
  ⛔ **`LockScroll` är BORTTAGEN — återinför den inte.** Den satte `overflow:hidden` för att dölja den
  extra höjden: en gardin för en mätbar layoutbugg. Den gömde Adminpanel/Logga ut bakom e-postbannern,
  och två sidor som båda låser återställer varandras sparade `overflow` (därav "scrollar först efter en
  tur via /community"). Med rätt höjd sköter webbläsaren det: får innehållet plats scrollar det inte.
  ⛔ Tailwind arbiträra värden kräver UNDERSTRECK för mellanslag — `calc(100dvh-4rem)` är ogiltig CSS och
  tappas TYST. Verifiera i den kompilerade CSS:en, inte i källan.
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
```

## Demo-konton (lokal seed)
- admin@pokefinds.se (SUPERADMIN) — lösenord från `SEED_ADMIN_PASSWORD`
- demo@pokefinds.se (USER) — lösenord från `SEED_DEMO_PASSWORD`
- Lösenorden står INTE i koden (repot är publikt). Utelämnas variablerna slumpar
  seeden fram dem och SKRIVER UT dem när den är klar. E2E:s inloggningstest läser
  samma `SEED_DEMO_PASSWORD` och hoppas över om den saknas.
- OBS: dessa lösenord är ROTERADE på prod (repot publikt) — gäller bara lokal seed.

## Regler
- All copy på svenska, premium men lekfull ton
- Inga hårdkodade hemligheter
- Priser i öre (int), aldrig float
- Mörkt tema som standard
- GDPR: dataminimering, export, radering måste alltid fungera
- Inga fabricerade priser/data — bara verifierade källor
