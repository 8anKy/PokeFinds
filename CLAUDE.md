# Foilio — Pokémon TCG-marknadsplattform för Sverige

## Vad är detta?
En komplett SaaS-webbplattform för svenska Pokémon TCG-samlare: prisbevakning, restock-alerts,
marknadsdata, samlingsvärde, kortskanning och community. Helt eget varumärke ("Foilio"),
egen design, egen copy (svenska). Nämn ALDRIG inspirations-/konkurrentsidor i kod, copy eller docs.

> **Denna fil håller NULÄGE, durabla TVÄRGÅENDE beslut och vad som är kvar.** Detaljerade
> regelverk per delsystem bor i `.claude/rules/` (laddas automatiskt när du rör filerna de gäller —
> se indexet sist i filen). Dagboksanteckningar per session ligger i git-historiken.

## Nuläge
- **LIVE i produktion** på https://foilio.se — **Railway** (projekt `divine-reflection/PokeFinds`) + Neon serverless
  Postgres (Frankfurt). Deploy = `git push origin main` (Railway auto-bygger via Dockerfile, node:22-slim). INGEN
  `vercel --prod` längre — vi har lämnat Vercel. Railway BLOCKAR SMTP-portar → mejl skickas via Resend HTTP API
  (se `src/lib/mailer.ts`).
- **APEX ÄR KANONISK SEDAN 2026-08-14 (var `www`)**: DNS ligger hos **Cloudflare** (`hal`/`tori.ns.cloudflare.com`,
  flyttad från one.com). `foilio.se` är GRÅMOLNAD (DNS-only) och pekar med CNAME-flattening på Railways
  `6yygajda.up.railway.app` — Railway serverar alltså apex direkt med eget cert. `www.foilio.se` är ORANGEMOLNAD
  (proxad) och existerar BARA för att Cloudflares Redirect Rule ska 301:a den till apex; den är med flit INTE
  registrerad som custom domain på Railway. Lägg inte tillbaka den — då börjar www serva appen parallellt.
  ⛔ **VÄRDBYTET LOGGADE UT ALLA EN GÅNG.** Sessionscookien sätts utan `domain` (host-only, se `sessionCookieOptions`),
  så en cookie utfärdad för `www.foilio.se` skickas aldrig till `foilio.se`. Det var väntat och engångs — men det är
  också regeln: **byter värden igen loggas alla ut igen.**
  ⛔ **EN 301 ÄR INTE GRATIS FÖR MASKINER.** Cloudflares www→apex-svar är ett 301, och `curl` utan `-L`,
  Stripes webhook-leverans och de flesta API-klienter FÖLJER INTE redirects — de ser bara en 3xx och ger upp.
  Därför måste varje maskinell URL peka DIREKT på apex: `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, Stripes
  webhook-endpoint, OAuth-redirect-URI:er (Discord/Tradera) och workflow-defaultarna för `/api/revalidate`.
  Symptomet när en missas är TYST: webhooken "levereras" aldrig, cachen invalideras aldrig.
  ⚠️ Fördröjd DNS-utrullning är normal: en resolver som cachat de GAMLA NS-posterna (one.com) frågar fel
  auktoritet tills NS-TTL:en löper ut (~2 h) — sajten ser då död ut för just den användaren medan alla andra
  är opåverkade. Mät med `Resolve-DnsName foilio.se -Type NS -Server <resolver>` innan något felsöks i appen.
- **Katalog komplett**: ~173 set, ~20k singlar + ~2100 sealed-produkter (0 saknade set/kort mot pokemontcg.io).
- **Priser**: singlar = Cardmarket engelska NM-"From" (RapidAPI) × live-kurs; sealed = CM `lowest`. Graf/historik = CM trend.
- **Funktioner live**: watchlist/prisbevakning, restock-alerts (42 bevakade butiker), samlingsvärde (live),
  AI-gradering (`/gradera`, Gemini vision), live kort-skanner (`/skanna`, Gemini vision), community, admin, PWA.
- **Hands-off katalogflöde**: nya set + singlar (`import-new-sets.yml`, sön 03:30 UTC), sealed CM-pris/trend och
  set-etiketter (dagliga `runCardmarketRefresh`), auto-import av butiks-SKU:er (restock-skanningen). Inget manuellt
  steg återstår — bevaka bara RapidAPI-kvoten vid stora släpp. Detaljer: `.claude/rules/matching-import.md`.
- **Genuint utan CM-marknadsdata**: ~868 singlar + ~24 sealed → ärlig "–"/döljs tills data finns.
- **Prishistorik byggs FRAMÅT** — ingen legitim källa ger äkta retroaktiv daglig historik (CM-graf får ej skrapas,
  RapidAPI ger bara 7d/30d-snitt). Öppna aldrig backfill-frågan igen.

## Auto-uppdatering (GitHub Actions, repot är publikt → obegränsade minuter)
`cardmarket-refresh` (dagl 13:00 UTC) + `hot-card-refresh` (21:00), `tradera-sweep` (04:00), `scrape-all` (02:00),
`restock-watch` (var 10:e min via extern pinger), `discord-restock` (loop-i-jobbet, extern pinger var 2:a min).
Jobben kör DB-skrivningar med `mapPool`-samtidighet så de hinner klart innan timeout.
- ⛔ **NATTKEDJAN FÅR ALDRIG BLI LÄNGRE ÄN TRE LED**: scrape-all → tradera-sweep → cardtrader-refresh är länkade med
  `workflow_run` för att dela ETT Neon-fönster. GitHub fyrar `workflow_run` max tre nivåer från roten, och länk 4
  fyrar ALDRIG — tyst (tradera-sold-sweep låg så i två månader med noll körningar). **Nya nattjobb läggs som STEG i
  ett befintligt led.** ⛔ `workflows:` matchar `name:`-FÄLTET i den andra filen — byter du namn på ett uppströmsjobb
  slutar de efterföljande köra TYST. ⛔ INGEN `conclusion`-grind: en success-grind byter en synlig röd körning mot
  tre osynligt uteblivna. Vaktat av `tests/unit/cron-chain-sync.test.ts`.
- **restock-watch** = `runRestockScan()` i `src/scrapers/runner.ts`: hämtar de restock-bevakade butikernas kataloger
  PARALLELLT (fas 1 = ren HTTP → Neon sover), läser sedan offers EN gång och diffar lagerstatus i minnet. Källistan
  läses från diskcache (TTL 24h) — ett DB-uppslag per körning höll förr computen vaken dygnet runt. **En ändrad
  restockWatch-flagga slår därför igenom först inom ett dygn.** Detaljer: `.claude/rules/scraping-restock.md`.

## Öppna ärenden / Nästa steg
- ⛔ **INTEGRITETSPOLICYN ÄR INTE JURISTGRANSKAD** — enda kvarvarande punkten från legalpaketet.
  `DISCORD_ENABLED=true` är påslaget (rollsynken kör skarpt) trots att granskningen var villkoret, dvs den är
  försenad MEDAN behandlingen pågår. `../PokeFinds-private/docs/PRIVACY-DISCORD-DRAFT.md` listar utöver Discord TRE
  leverantörer som behandlar personuppgifter i produktion UTAN att stå i policyn (Stripe, Google/Gemini, Tradera).
  ⛔ Discord/Tradera får ALDRIG in i `Privacy.s7Items` — den listan påstår biträdesavtal, och båda är självständigt
  personuppgiftsansvariga. Övriga legalstatus + juristfrågor: `../PokeFinds-private/docs/TERMS-GAP.md`.
- **Kvar i legalpaketet**: F2 (datalicenser, egen utredning) och community-klausulen (publiceras när community
  lanseras). ⛔ ODR-hänvisningen är BORTTAGEN med flit (EU-plattformen nedlagd 2025-07-20) — lägg aldrig tillbaka den.
- **Restock Wave 3** (kvar): custom/JS-butiker maxgaming, sweetnerds, Spel & Sånt, playoteket, arcadedreams — fragila
  HTML/SPA, byggs en i taget MED verifiering. Se [[project-pending-store-adapters]] och
  `.claude/rules/scraping-restock.md` för butiker som kräver ägarbeslut (EUR/DKK-butiker, Carsmästaren).
- **Mobilapp via Capacitor** (`android/` finns): iOS-bygge kräver Mac/cloud-build (användaren på Windows).
- **Sealed CM-trendrad i pristabellen** kan vara fel pga felmappad `idProduct` (headline-lägsta är ändå rätt — butik
  vinner); kräver bättre sealed→idProduct-mappning.
- **Stripe (webbens Pro)**: kod klar och testad. Kvar: provköp end-to-end + rotera APNs-nyckeln.
- **Deal-verifieraren kan bytas till Gemini** med `DEALS_VERIFY_PROVIDER=gemini`. Standard är fortsatt **claude** med
  flit — Geminis omdöme på just den bedömningen är OMÄTT, och falska positiva blir fejkade "fynd" i en betalfunktion.
  Besparingen är ~$1–2/mån, alltså inget skäl i sig. Vill man byta: mät först genom att döma om samma annonspar under
  båda leverantörerna (prompt/schema delas i `src/services/deal-verify/contract.ts` just därför).
- **Leverantörsfrågor** (utredda, ingen åtgärd): prisbasen vilar på en ANONYM leverantör (TCGGO — inget bolagsnamn,
  ingen jurisdiktion, inga villkor), pokemontcg.io ägs numera av Scrydex. TCGdex (gratis, MIT) kan ge tryckningstaxonomi
  + fixa 132 döda bild-URL:er. Detaljer i minnesfilerna, inte här.
- **Launch-readiness + kostnad-vid-skala**: levande checklista i `docs/LAUNCH-CHECKLIST.md` (Section 0 =
  kostnadshetspunkter vid samtidig trafik). Öppna poster: offers-refetch per produktvisning, `force-dynamic` på alla
  `/api/*`, ingen rate limiting, collection-värde live-compute.
- Övrigt: se `docs/TODO.md`.

## Kostnadsdoktrin (styr VARJE designbeslut)
- **NEONS NOTA ÄR VAKEN TID — RÄKNA VÄCKNINGAR, ALDRIG RADER.** Compute är ~95 % av notan, egress är gratis vid vår
  volym, och **varje väckning köper minst 300 s debiterad tid** (autosuspend ligger redan på golvet — 90/120/150/180/240 s
  ger alla `412`). Följder: nattkedjan ovan; **personaliserade svar cachas 60 s** (`PERSONAL_TTL_SECONDS`,
  `services/products.ts`) i stället för att gå förbi cachen — en inloggad besökare väckte förut computen vid varje
  sidladdning för att slippa 60 sekunders inaktualitet i en SORTERINGSORDNING. Egen cache-nyckel ("…Personal"),
  aldrig delad med den utloggade.
  ⛔ `loadPersonalIdsRaw` returnerar ARRAYER, inte Set: `unstable_cache` serialiserar till JSON och ett `Set` blir `{}`
  — `.has()` hade kastat, men bara vid cache-TRÄFF, bara i produktion, bara för inloggade. Samma familj som
  Date→sträng-fällan.
- **EN LÄSNING PER JOBB, ALDRIG PER VARV**: uppslag som ligger i loopar med tusentals varv (denylist, källista) hämtas
  en gång per körning och hålls synkrona. Ett DB-uppslag per körning i restock-lanen räckte 2026-07-07 för att hålla
  computen vaken dygnet runt.
- **CRAWLER-UA-LISTAN ÄR EN FÄRSKVARA — NYA BOT-NAMN DYKER UPP OANMÄLT.** 2026-08-09 var Neon vaken 36 h i sträck:
  **Claude-SearchBot** (ny Anthropic-UA, matchades inte av ClaudeBot/Claude-Web) svepte katalogen i 5,7 req/s = 63 % av
  ALL trafik, plus **GoogleOther** 28 %. Båda 403:as nu i `blocked-bots.ts` + står i robots.ts. Räkna med att det händer
  IGEN: symptomet är "Neon vaken dygnet runt utan att jobben kör" → **kolla UA-fördelningen FÖRST** (Railways httpLogs).
  ⛔ Googlebot (inkl. mobil-UA:n med Chrome-prefix) får ALDRIG in i blocklistan — sökindexeringen är hela poängen med
  SEO-arbetet; testet vaktar. Railway-minnet var följdsymptom, inte läcka: heapen är capad till 512 MB, resten var
  glibc-malloc-arenor under crawl-last → `MALLOC_ARENA_MAX=2` i Dockerfile.
- **INGA INFRAKOSTNADER FÖRDELAS PER ANVÄNDARE** — Neon debiteras per vaken tid, så den som råkar vara först på
  morgonen "orsakar" hela väckningen. Larm redovisas som ANTAL, aldrig kronor.
- **Kostnadsbriefing FÖRE funktioner**: kostar något pengar/app/tjänst — lägg fram siffran och invänta OK.

## Caching/ISR (kvot-kritiskt)
Publika läs-sidor är ISR-cachade, INTE `force-dynamic` (`revalidate=3600`): startsidan, `/marknad`, `/sets`,
`/sets/[id]`, `/produkter/[slug]`. Data ändras ~1×/dygn så cache är för det mesta osynlig.
**Sätt ALDRIG tillbaka `force-dynamic` på dessa** — det var orsaken till hög Vercel Active CPU + Neon-CU.
Förutsättning: ingen server-`auth()`/`cookies()` i den delade chrome:n. Session läses därför KLIENT-sida i
`header-auth-actions.tsx`, `bottom-tabs.tsx` (self-gate + egen klarerings-spacer) och `live-product-pricing.tsx`.
Rot-layouten + marketing-layouten + `SiteHeader` får INTE kalla `auth()` (då blir HELA appen dynamisk igen).
`/produkter` är dynamisk med flit (läser searchParams).
⚠️ Offer-tabellens lagerstatus kan släpa ≤1h efter DB:n (LivePricingProvider hämtar ALDRIG själv; `refresh` är bara
adminens knapp). Att stänga glappet är ett KOSTNADSBESLUT (en fetch per produktvisning) — fråga ägaren.
Produktsidans prishistorik: servern hämtar HELA serien en gång (`MAX_DAYS`), `product-price-card.tsx` filtrerar
perioden i klienten (ingen URL-param → ISR-bar, ingen extra hämtning per periodbyte).

## Tvärgående invarianter
- **Priser lagras i öre** (integer) för SEK, `currency`-fält. Visa via `formatPrice()` i `src/lib/format.ts`. Aldrig float.
- **0 KR ÄR INGET PRIS**: `priceOreFromEur()` i `src/lib/exchange-rate.ts` är enda vägen från EUR till öre, och den
  returnerar `null` när resultatet inte är positivt. Två verkliga vägar till en nolla: källan säger noll (RapidAPI
  publicerar `"30d_average": 0` för kort utan engelska annonser) och AVRUNDNINGEN (ett äkta belopp < ~0,005 € blir 0 öre,
  och ingen `pos()`-vakt uppströms ser det — där VAR talet positivt). ⛔ Konvertera aldrig med en bar
  `Math.round(eur * rates.eurToOre)` igen. "–" läses som "vi vet inte", "0 kr" läses som "gratis".
- **Växelkurs**: live via `src/lib/exchange-rate.ts` (`getRatesOre()` → Frankfurter, dygnscache, fallback 1150/1050 öre).
  Anropa i början av en ingest-körning; synkrona pris-funktioner läser `getCachedRatesOre()`. `EUR_SEK`-env pinnar kursen.
  Hårdkoda ALDRIG 11.50 igen. ⛔ I en webbrequest måste du använda `getRatesOre()` — den synkrona ger FALLBACK-kursen i
  en process som inte redan hämtat kursen.
- **Dygnsnyckel = UTC, aldrig lokal midnatt**: `PriceSnapshot.date` är `@db.Date`. Använd `utcToday()`/`utcDaysAgo()` i
  `src/lib/utils.ts` — `d.setHours(0,0,0,0)` ger LOKAL midnatt, och på svensk tid skriver en manuell jobbkörning då tyst
  på GÅRDAGENS rad. Actions kör i UTC så felet syns aldrig i drift. Samma sak för `startOfMonthUtc()`: kvotfönstret måste
  vara samma gräns i kvoten och i kostnadsvyn.
- **Offers = endast direkta länkar**: visa aldrig sök-/bläddringslänkar som offers. `isDirectOfferUrl()` vaktar både UI
  och prisstatistik. Butiksfilter kräver IN_STOCK + direkt länk. Direkta länkar UTAN pris visas ändå (pris "–").
- **CM-länkar = exakt slug med `?language=1`** (+ `&minCondition=2` på singlar via `withNearMint()`, idempotent): visa
  ALDRIG en bar `prices.pokemontcg.io/cardmarket/{id}`-redirect (302:n strippar language=1). Lös den via
  `resolve-cm-urls.ts`. `isDirectOfferUrl()` döljer olösta redirects; `runner.ts` bevarar lösta slug-länkar framför
  inkommande redirects. Sealed: INGET minCondition (inget skick).
- **TCG-import paginering**: använd ALDRIG `orderBy=number` i `fetchTcgCardsForSet` — pokemontcg.io:s string-sort tappar
  kort mellan sidor. Set kan ha >250 kort (totalCount), paginera stabilt utan orderBy.
- **Kortnummer-sortering är en GENERERAD KOLUMN** (`Card.numberSortKey`, `GENERATED ALWAYS ... STORED`) — Postgres äger
  den, för en kolumn varje import måste minnas att fylla i är en vakt som failar öppet. Detaljer i
  `.claude/rules/catalog-browse.md`.
- **Scrapers**: adapter-mönster i `src/scrapers/`. Riktiga adapters MÅSTE respektera robots.txt, rate limits, tydlig
  user-agent. Ingen captcha/login-bypass. Rå data i `PriceObservation.rawData`. ⛔ Läs HELA robots.txt — Playotekets
  fil ser ut som standard-PrestaShop i toppen och avslutar med ett andra `User-agent: *` + `Disallow: /` (lurade två
  granskningar). Samtidighet via `mapPool` (`src/lib/concurrency.ts`) i batch-jobben; runner-loopen lämnas sekventiell
  med flit (billigast-vinner + restock-dedup).

## Plattform & stack
- **DB**: PROD = Neon serverless Postgres (Frankfurt), connection-string i `.env` som `NEON_DATABASE_URL`. DEV = lokal
  PostgreSQL 18 (tjänst `postgresql-x64-18`), databas `pokefinds`, user `postgres`, lösen `pokefinds-local`. Docker
  behövs INTE. `DB_POOL`-env sätter `connection_limit` för batch-jobb.
- **Prod-DB från CLI — ANVÄND ALLTID `scripts/with-prod-db.mjs`**:
  ```bash
  node scripts/with-prod-db.mjs npx tsx scripts/x.ts     # läser .env internt, skriver ut måldatabasen
  ```
  Gräv ALDRIG fram hemligheten i skalet (`DATABASE_URL="$(grep NEON_DATABASE_URL .env …)" npx tsx …`). Det mönstret
  materialiserar lösenordet i kommandoraden → terminalhistorik, loggar och agent-transkript. Wrappern skickar värdet som
  miljövariabel till barnprocessen; det passerar aldrig ett skal. `.claude/settings.json` NEKAR dessutom läsning av
  `.env` — en spärr i djupet, inte ett fullgott skydd. Det riktiga skyddet är att ingen BEHÖVER hemligheten.
  ⛔ **MIGRATIONEN MÅSTE LIGGA FÖRE KODEN.** Ny kod som `select`:ar nya kolumner mot en omigrerad databas ger 500 för
  ALLA användare. Dockerfilens `migrate deploy || true` är avsiktligt icke-blockerande och kan tiga ihjäl felet — kör
  `node scripts/with-prod-db.mjs npx prisma migrate deploy` MANUELLT före push vid schemaändringar.
  ⚠️ `migrate deploy` kan timeouta på advisory-låset (pooler-URL:en går via PgBouncer i transaktionsläge). När ingen
  deploy pågår: kör om med `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1` — låset skyddar bara mot SAMTIDIGA migreringar, och
  våra migrationer är idempotenta (IF NOT EXISTS).
- **Auth**: NextAuth v4 med Credentials provider + JWT-sessioner. RBAC via `role` på User (USER/MODERATOR/ADMIN/SUPERADMIN).
- **VILKEN LEVERANTÖR GÖR VAD**: de två `*_PROVIDER`-variablerna styr BARA de två BILD-funktionerna. **Gemini** = allt
  användaren ser: kortskannern (`OCR_PROVIDER=gemini`) och AI-graderingen (`GRADING_PROVIDER=gemini`). **Claude** = hela
  bakgrundspipelinen, utan provider-variabel: `judgeSameProduct` (Haiku) i auto-importens gränsfall, veckans stub-dedup,
  JP→CM-mappningen och fynd-/Tradera-verifieringen.
  ⛔ **`ANTHROPIC_API_KEY` är därför inte valfri även om båda bild-funktionerna står på Gemini** — utan den returnerar
  domaren null, vilket är omöjligt att skilja från "olika produkter", och HELA gränsfallsbandet blir dubbletter. Tyst, i drift.
  ⚠️ `SCANNER_MODEL_PRECISE` defaultar till `gemini-3.5-flash`, som är STRIKT DOMINERAD av `gemini-3.6-flash` (samma
  inpris, 20 % billigare ut, nyare) — graderingen bytte, skannern glömdes. ⛔ Aldrig `gemini-2.5-*` (spärrad för nya nycklar).
- **Skanning**: `src/services/scanner/` — OCR-adapter-interface med mock + `ClaudeVisionOcrAdapter` +
  `GeminiVisionOcrAdapter`. `OCR_PROVIDER=claude` är rollback.
- **PWA/app**: installerbar via `public/manifest.json` + `public/sw.js` (registreras i prod av
  `src/components/pwa-register.tsx`). Native = Capacitor-wrapper runt samma Next-app.
  ⚠️ Native-ändringar (plugins, orientering, usage strings) kräver `npx cap sync` + nytt bygge — en `git push` räcker INTE.
- **Cache/queue**: Redis valfri — koden degraderar graciöst utan Redis (in-memory fallback i `src/lib/queue.ts`).
- **Charts**: recharts (lazy-laddad via `PriceChartLazy`).
- **E-post**: nodemailer-API, console/JSON-transport i dev (`EMAIL_MODE=console`), Resend HTTP API i prod.
- **Validering**: Zod överallt på API-gränser.
- **Designtokens**: SVART yta + turkos signaturaccent (`holo.cyan` = `#2dd4bf`). Allt färgsätts via tokens i
  `tailwind.config.ts` — undvik hårdkodade hex/`*-blue-*`-klasser. ⛔ `surface-overlay` är en interaktiv FYLLNING, inte
  en bakgrund, och ska INTE sänkas till svart. Sidans vågräta luft = 10px på mobil (`px-2.5 sm:px-6`) och delas av
  ALLT som möter kanten. Detaljer + kant-till-kant-reglerna: `.claude/rules/ui-shell.md`.

## Regelverk per delsystem (`.claude/rules/`, laddas automatiskt via `paths:`)
| Fil | Gäller | Hårdaste regeln |
|---|---|---|
| `scraping-restock.md` | `src/scrapers/**`, wave-/probe-skript | Shopifys `available` ≠ köpbar; `discontinued` är INGEN lagersignal; frånvaro ur feeden kollas, tolkas inte |
| `discord-restock.md` | discord-restock-lane, `stock-flap.ts` | Lanen är GRATIS på villkor — når aldrig DB:n; egen cache-nyckel; okänd URL postas inte |
| `matching-import.md` | `matching.ts`, `runner.ts`, kategorivakter | `OTHER` var det enda som höll skräpet ute — härda vakterna FÖRE en vidgning; mät mot två facit |
| `catalog-curation.md` | ägarbeslut, mergar, denylist | Herrelösa URL:er räknas över HELA gruppen; denylist FÖRE apply; identiteten måste överleva normaliseringen |
| `cm-pricing.md` | cardmarket-/hot-card-refresh, RapidAPI | Singlar = CM engelska NM-"From" RAKT AV; guiden är INTE CM:s From |
| `base-printings.md` | print-variant, CM-länkar | Tryckningen är identitet, inte en prisnivå; `variantLabel` obligatoriskt i vakterna |
| `jp-sets.md` | JP-set-filer | JP-set kommer från CM:s expansioner; namnuppslag MÅSTE filtrera på `language` |
| `scanner.md` | skanner-/kamerafiler | Numret är identiteten; LÄS `docs/SCANNER-STATUS.md` före ändringar |
| `grading.md` | `services/grading/**` | `maxOutputTokens` är taket för TÄNKANDE + SVAR på Gemini 3; prompt bor i contract.ts |
| `auth-accounts.md` | middleware, session, registrering | En cookie som JS skriver har inte den livslängd du anger (WebKit kapar till 7 dygn) |
| `billing-entitlements.md` | Stripe, RevenueCat, Discord-roller | Stripe skriver ALDRIG `planTier`; glöms grenen i `proUserWhere()` får kunden Pro i UI:t men INGA larm |
| `alerts-setwatch.md` | `services/alerts.ts`, set-bevakning | Regeln utvärderas vid LARMTILLFÄLLET, i BÅDA vägarna |
| `marketplace-tradera.md` | Tradera-jobb/skript | Sålt är en EGEN serie, ersätter aldrig annonskurvan; ingen `fillForward` |
| `catalog-browse.md` | produkt-/setvyer, rankning | Ofiltrerad katalog personaliseras ALDRIG; bygg ingen inlärd rankning |
| `collection-portfolio.md` | samling, inköpspris | Poster (lots), aldrig ett snitt i databasen |
| `ui-shell.md` | komponenter, layout, tokens | Porträttlås; bredd ensam ≠ desktop; min-height måste dra av spacer + safe-area |
| `admin-ops.md` | adminvyer, kostnad | Tre utfall, aldrig två: kostnadsförd / gratis / OMÄTT |
| `legal-copy.md` | villkor, policyer, `/om`, checkout-copy | Ångerrätten är den PROPORTIONELLA modellen — villkor och checkout-samtycke är EN mekanism, ändra dem tillsammans |

## Kommandon
```bash
# Postgres körs redan som Windows-tjänst (postgresql-x64-18) — ingen Docker behövs
npm install                     # (--legacy-peer-deps vid peer-konflikt)
```

## Demo-konton (lokal seed)
- admin@pokefinds.se (SUPERADMIN) — lösenord från `SEED_ADMIN_PASSWORD`
- demo@pokefinds.se (USER) — lösenord från `SEED_DEMO_PASSWORD`
- Lösenorden står INTE i koden (repot är publikt). Utelämnas variablerna slumpar seeden fram dem och SKRIVER UT dem
  när den är klar. E2E:s inloggningstest läser samma `SEED_DEMO_PASSWORD` och hoppas över om den saknas.
- OBS: dessa lösenord är ROTERADE på prod (repot publikt) — gäller bara lokal seed.

## Regler
- All copy på svenska, premium men lekfull ton
- Inga hårdkodade hemligheter
- Priser i öre (int), aldrig float
- Mörkt tema som standard
- GDPR: dataminimering, export, radering måste alltid fungera
- Inga fabricerade priser/data — bara verifierade källor
