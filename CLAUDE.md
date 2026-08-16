# Foilio — Pokémon TCG-marknadsplattform för Sverige

SaaS för svenska Pokémon TCG-samlare: prisbevakning, restock-alerts, marknadsdata, samlingsvärde,
kortskanning, community. Eget varumärke ("Foilio"), egen design, svensk copy. Nämn ALDRIG
inspirations-/konkurrentsidor i kod, copy eller docs.

> **Filen håller NULÄGE, durabla TVÄRGÅENDE beslut och vad som är kvar.** Delsystemsregler bor i
> `.claude/rules/` (laddas automatiskt via `paths:`). Sessionsdagbok = git-historiken.
> Incidentnarrativ (varför, hur det upptäcktes) = minnesfilerna.

## Nuläge
- **LIVE** på https://foilio.se — **Railway** (`divine-reflection/PokeFinds`) + Neon serverless Postgres
  (Frankfurt). Deploy = `git push origin main` (Dockerfile, node:22-slim). Ingen Vercel. Railway blockar
  SMTP-portar → mejl via Resend HTTP API (`src/lib/mailer.ts`).
- **Apex är kanonisk sedan 2026-08-14** (var `www`). DNS hos Cloudflare: `foilio.se` grå (DNS-only,
  CNAME-flattening → Railway, eget cert), `www` orange och existerar BARA för Redirect Rule → 301 till apex.
  ⛔ Registrera aldrig `www` som custom domain på Railway igen — då servar den appen parallellt.
  ⛔ **En 301 är gratis bara för webbläsare.** Stripes webhook-leverans, `curl` utan `-L` och de flesta
  API-klienter följer den INTE. Varje MASKINELL URL måste peka direkt på apex: `NEXTAUTH_URL`,
  `NEXT_PUBLIC_APP_URL`, Stripe-webhooken, OAuth-redirects (Discord/Tradera), `/api/revalidate`-defaults i
  workflows. Missas en är felet TYST — webhooken "levereras" aldrig, cachen invalideras aldrig.
  ⛔ Sessionscookien är host-only (`sessionCookieOptions`) → **byte av värdnamn loggar ut alla igen.**
  ⚠️ Cachade gamla NS-poster (~2 h TTL) får sajten att se död ut för enstaka användare — mät med
  `Resolve-DnsName foilio.se -Type NS -Server <resolver>` innan något felsöks i appen.
- **Katalog komplett**: ~173 set, ~20k singlar + ~2100 sealed (0 saknade mot pokemontcg.io). ~868 singlar
  + ~24 sealed saknar genuint CM-marknadsdata → ärlig "–"/döljs tills data finns.
- **Priser**: singlar = Cardmarket engelska NM-"From" (RapidAPI) × live-kurs; sealed = CM `lowest`;
  graf/historik = CM trend.
- **Funktioner live**: watchlist/prisbevakning, restock-alerts (42 butiker), samlingsvärde, AI-gradering
  (`/gradera`), live kort-skanner (`/skanna`), community, admin, PWA.
- **Katalogflödet är hands-off**: nya set + singlar (`import-new-sets.yml`, sön 03:30 UTC), sealed
  CM-pris/trend + set-etiketter (`runCardmarketRefresh`), auto-import av butiks-SKU:er (restock-skanningen).
  Inget manuellt steg återstår — bevaka bara RapidAPI-kvoten vid stora släpp.
- ⛔ **Prishistorik byggs FRAMÅT** — ingen legitim källa ger äkta retroaktiv daglig historik (CM-grafen får
  ej skrapas, RapidAPI ger bara 7d/30d-snitt). Öppna aldrig backfill-frågan igen.

## Auto-uppdatering (GitHub Actions; publikt repo → obegränsade minuter)
`cardmarket-refresh` 13:00 UTC + `hot-card-refresh` 21:00, `tradera-sweep` 04:00, `scrape-all` 02:00,
`restock-watch` var 10:e min (extern pinger), `discord-restock` (loop-i-jobbet, egen takt per butik,
pingas var 2:a min).
DB-skrivningar kör med `mapPool`-samtidighet så de hinner klart före timeout.
- ⛔ **Nattkedjan får ALDRIG bli längre än tre led**: scrape-all → tradera-sweep → cardtrader-refresh är
  länkade med `workflow_run` för att dela ETT Neon-fönster. GitHub fyrar max tre nivåer från roten; led 4
  fyrar ALDRIG, tyst. **Nya nattjobb läggs som STEG i ett befintligt led.** `workflows:` matchar
  `name:`-FÄLTET — byter du namn på ett uppströmsjobb slutar de efterföljande köra tyst. ⛔ Ingen
  `conclusion`-grind (byter en synlig röd körning mot tre osynligt uteblivna). Vaktat av
  `tests/unit/cron-chain-sync.test.ts`.
- **restock-watch** = `runRestockScan()` i `src/scrapers/runner.ts`: butikskatalogerna hämtas PARALLELLT
  (fas 1 = ren HTTP → Neon sover), offers läses EN gång och lagerstatus diffas i minnet. Källistan ligger i
  diskcache (TTL 24 h) → **en ändrad restockWatch-flagga slår igenom först inom ett dygn.**

## Öppna ärenden / Nästa steg
- ⛔ **Integritetspolicyn är inte juristgranskad** — enda kvarvarande punkten i legalpaketet.
  `DISCORD_ENABLED=true` kör skarpt trots att granskningen var villkoret. Utöver Discord behandlar Stripe,
  Google/Gemini och Tradera personuppgifter i prod UTAN att stå i policyn
  (`../PokeFinds-private/docs/PRIVACY-DISCORD-DRAFT.md`). ⛔ Discord/Tradera får ALDRIG in i
  `Privacy.s7Items` — den listan påstår biträdesavtal, och båda är självständigt personuppgiftsansvariga.
  Övrig legalstatus: `../PokeFinds-private/docs/TERMS-GAP.md`.
- **Kvar i legalpaketet**: F2 (datalicenser, egen utredning) + community-klausulen (publiceras med
  community). ⛔ ODR-hänvisningen är borttagen med flit (EU-plattformen nedlagd 2025-07-20) — aldrig åter.
- **Restock Wave 3**: maxgaming, sweetnerds, Spel & Sånt, playoteket, arcadedreams — fragila HTML/SPA,
  byggs en i taget MED verifiering. Se [[project-pending-store-adapters]]; butiker som kräver ägarbeslut
  (EUR/DKK, Carsmästaren) står i `.claude/rules/scraping-restock.md`.
- **Stripe (webbens Pro)**: kod klar och testad. Kvar = provköp end-to-end + rotera APNs-nyckeln.
- **Mobilapp via Capacitor** (`android/` finns): iOS-bygge kräver Mac/cloud-build (ägaren på Windows).
- **Sealed CM-trendrad** i pristabellen kan vara fel pga felmappad `idProduct` (headline-lägsta är ändå
  rätt — butik vinner); kräver bättre sealed→idProduct-mappning.
- **Deal-verifieraren** kan gå på Gemini (`DEALS_VERIFY_PROVIDER=gemini`) men står på **claude** med flit:
  Geminis omdöme på just den bedömningen är OMÄTT och falska positiva blir fejkade "fynd" i en betalfunktion.
  ~$1–2/mån är inget skäl i sig. Byt först efter mätning av samma annonspar under båda leverantörerna
  (delad prompt/schema i `src/services/deal-verify/contract.ts` just därför).
- **Leverantörsfrågor** (utredda, ingen åtgärd): prisbasen vilar på en ANONYM leverantör (TCGGO — inget
  bolagsnamn, ingen jurisdiktion, inga villkor); pokemontcg.io ägs numera av Scrydex; TCGdex (gratis, MIT)
  kan ge tryckningstaxonomi + fixa 132 döda bild-URL:er.
- **Launch-readiness + kostnad vid skala**: `docs/LAUNCH-CHECKLIST.md` (Section 0 = hetspunkter vid
  samtidig trafik; öppet: offers-refetch per produktvisning, `force-dynamic` på `/api/*`, ingen rate
  limiting, collection-värde live-compute). Övrigt: `docs/TODO.md`.

## Kostnadsdoktrin (styr VARJE designbeslut)
- **NEONS NOTA ÄR VAKEN TID — RÄKNA VÄCKNINGAR, ALDRIG RADER.** Compute ≈95 % av notan, egress gratis vid
  vår volym, och **varje väckning köper minst 300 s debiterad tid** (autosuspend ligger redan i golvet —
  90/120/150/180/240 s ger alla `412`). Därav nattkedjan, och **personaliserade svar cachas 60 s**
  (`PERSONAL_TTL_SECONDS`, `services/products.ts`) i stället för att gå förbi cachen — med EGEN cache-nyckel
  ("…Personal"), aldrig delad med den utloggade.
  ⛔ `loadPersonalIdsRaw` returnerar ARRAYER, inte Set: `unstable_cache` JSON-serialiserar och ett `Set` blir
  `{}` — `.has()` kastar, men bara vid cache-TRÄFF, bara i produktion, bara för inloggade.
- **EN LÄSNING PER JOBB, ALDRIG PER VARV**: uppslag i loopar med tusentals varv (denylist, källista) hämtas
  en gång per körning och hålls synkrona. Ett DB-uppslag per varv i restock-lanen räckte för att hålla
  computen vaken dygnet runt.
- **CRAWLER-UA-LISTAN ÄR FÄRSKVARA — nya bot-namn dyker upp oanmält.** Symptomet är "Neon vaken dygnet runt
  utan att jobben kör" → **kolla UA-fördelningen FÖRST** (Railways httpLogs), blockera i `blocked-bots.ts`
  + robots.ts. ⛔ Googlebot (inkl. mobil-UA:n med Chrome-prefix) får ALDRIG in i blocklistan — testet vaktar.
  Railway-minnet är följdsymptom, inte läcka (heap capad till 512 MB, `MALLOC_ARENA_MAX=2` i Dockerfile).
- **INGA INFRAKOSTNADER FÖRDELAS PER ANVÄNDARE** — den som är först på morgonen "orsakar" hela väckningen.
  Larm redovisas som ANTAL, aldrig kronor.
- **Kostnadsbriefing FÖRE funktioner**: kostar något pengar/app/tjänst — lägg fram siffran och invänta OK.

## Caching/ISR (kvot-kritiskt)
Publika läs-sidor är ISR-cachade (`revalidate=3600`), INTE `force-dynamic`: startsidan, `/marknad`, `/sets`,
`/sets/[id]`, `/produkter/[slug]`. ⛔ **Sätt aldrig tillbaka `force-dynamic`** — det var orsaken till hög
Active CPU + Neon-CU. Förutsättning: ingen server-`auth()`/`cookies()` i den delade chrome:n — rot-layouten,
marketing-layouten och `SiteHeader` får INTE kalla `auth()` (då blir HELA appen dynamisk). Session läses
klient-sida i `header-auth-actions.tsx`, `bottom-tabs.tsx` (self-gate + klarerings-spacer) och
`live-product-pricing.tsx`. `/produkter` är dynamisk med flit (searchParams).
⚠️ Offer-tabellens lagerstatus kan släpa ≤1 h (LivePricingProvider hämtar ALDRIG själv; `refresh` är bara
adminens knapp). Att stänga glappet är ett KOSTNADSBESLUT (en fetch per produktvisning) — fråga ägaren.
Prishistorik: servern hämtar HELA serien en gång (`MAX_DAYS`), `product-price-card.tsx` filtrerar perioden i
klienten (ingen URL-param → ISR-bar, ingen extra hämtning per periodbyte).

## Tvärgående invarianter
- **Priser lagras i öre** (integer) + `currency`-fält. Visa via `formatPrice()` (`src/lib/format.ts`).
  Aldrig float.
- ⛔ **0 KR ÄR INGET PRIS**: `priceOreFromEur()` (`src/lib/exchange-rate.ts`) är enda vägen EUR→öre och
  returnerar `null` när resultatet inte är positivt. Nollor uppstår på TVÅ vägar: källan (RapidAPI publicerar
  `"30d_average": 0` för kort utan engelska annonser) och AVRUNDNINGEN (äkta belopp < ~0,005 € blir 0 öre —
  ingen `pos()`-vakt uppströms ser det, där VAR talet positivt). Konvertera aldrig med bar
  `Math.round(eur * rates.eurToOre)`. "–" läses som "vi vet inte", "0 kr" som "gratis".
- **Växelkurs** live via `getRatesOre()` (Frankfurter, dygnscache, fallback 1150/1050 öre); anropa i början
  av en ingest-körning, synkrona pris-funktioner läser `getCachedRatesOre()`. ⛔ I en webbrequest MÅSTE du
  använda `getRatesOre()` — den synkrona ger FALLBACK-kursen i en process som inte redan hämtat kursen.
  Hårdkoda aldrig 11.50. `EUR_SEK` pinnar kursen.
- **Dygnsnyckel = UTC, aldrig lokal midnatt**: `PriceSnapshot.date` är `@db.Date`; använd
  `utcToday()`/`utcDaysAgo()` (`src/lib/utils.ts`). `d.setHours(0,0,0,0)` ger LOKAL midnatt och på svensk tid
  skriver en manuell jobbkörning då tyst på GÅRDAGENS rad (osynligt i drift — Actions kör UTC). Samma för
  `startOfMonthUtc()`: kvotfönstret måste ha samma gräns i kvoten och i kostnadsvyn.
- **Offers = endast direkta länkar** — visa aldrig sök-/bläddringslänkar. `isDirectOfferUrl()` vaktar både UI
  och prisstatistik. Butiksfilter kräver IN_STOCK + direkt länk. Direkt länk UTAN pris visas ändå ("–").
- **CM-länkar = exakt slug med `?language=1`** (+ `&minCondition=2` på singlar via `withNearMint()`,
  idempotent). ⛔ Visa aldrig en bar `prices.pokemontcg.io/cardmarket/{id}`-redirect (302:n strippar
  language=1) — lös via `resolve-cm-urls.ts`; `runner.ts` bevarar lösta slug-länkar framför inkommande
  redirects. Sealed: INGET minCondition (inget skick).
- ⛔ **Aldrig `orderBy=number` i `fetchTcgCardsForSet`** — pokemontcg.io:s string-sort tappar kort mellan
  sidor. Set kan ha >250 kort (totalCount); paginera stabilt utan orderBy.
- **`Card.numberSortKey` är en GENERERAD kolumn** (`GENERATED ALWAYS ... STORED`) — Postgres äger den, för en
  kolumn varje import måste minnas att fylla i är en vakt som failar öppet.
- **Scrapers**: adapter-mönster i `src/scrapers/`; respektera robots.txt, rate limits, tydlig user-agent;
  ingen captcha/login-bypass; rådata i `PriceObservation.rawData`. ⛔ Läs HELA robots.txt — Playotekets ser ut
  som standard-PrestaShop i toppen och avslutar med ett andra `User-agent: *` + `Disallow: /` (lurade två
  granskningar). `mapPool` (`src/lib/concurrency.ts`) i batch-jobb; runner-loopen är sekventiell med flit
  (billigast-vinner + restock-dedup).

## Plattform & stack
- **DB**: PROD = Neon serverless Postgres (Frankfurt), `NEON_DATABASE_URL` i `.env`. DEV = lokal PostgreSQL 18
  (tjänst `postgresql-x64-18`, db `pokefinds`, user `postgres`, lösen `pokefinds-local`) — Docker behövs INTE.
  `DB_POOL` sätter `connection_limit` för batch-jobb.
- **Prod-DB från CLI — ANVÄND ALLTID `node scripts/with-prod-db.mjs <cmd>`** (t.ex.
  `node scripts/with-prod-db.mjs npx tsx scripts/x.ts`). ⛔ Gräv aldrig fram hemligheten i skalet
  (`DATABASE_URL="$(grep NEON_DATABASE_URL .env …)"`) — det materialiserar lösenordet i kommandoraden →
  terminalhistorik, loggar, agent-transkript. Wrappern skickar värdet som miljövariabel till barnprocessen.
  `.claude/settings.json` nekar dessutom läsning av `.env`, men det riktiga skyddet är att ingen BEHÖVER
  hemligheten.
- ⛔ **MIGRATIONEN MÅSTE LIGGA FÖRE KODEN** — ny kod som `select`:ar nya kolumner mot en omigrerad databas ger
  500 för ALLA, och Dockerfilens `migrate deploy || true` är avsiktligt icke-blockerande och kan tiga ihjäl
  felet. Kör `node scripts/with-prod-db.mjs npx prisma migrate deploy` MANUELLT före push vid schemaändring.
  ⚠️ Timeout på advisory-låset (pooler-URL via PgBouncer): kör om med
  `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1` när ingen deploy pågår — våra migrationer är idempotenta.
- **Auth**: NextAuth v4, Credentials provider + JWT-sessioner. RBAC via `role` på User
  (USER/MODERATOR/ADMIN/SUPERADMIN).
- **VILKEN LEVERANTÖR GÖR VAD**: `*_PROVIDER`-variablerna styr BARA de två BILD-funktionerna. **Gemini** =
  allt användaren ser (`OCR_PROVIDER=gemini` skannern, `GRADING_PROVIDER=gemini` graderingen). **Claude** =
  hela bakgrundspipelinen, utan provider-variabel: `judgeSameProduct` (Haiku) i auto-importens gränsfall,
  veckans stub-dedup, JP→CM-mappningen, fynd-/Tradera-verifieringen.
  ⛔ **`ANTHROPIC_API_KEY` är därför inte valfri även om båda bild-funktionerna står på Gemini** — utan den
  returnerar domaren null, omöjligt att skilja från "olika produkter", och HELA gränsfallsbandet blir
  dubbletter. Tyst, i drift. ⛔ Aldrig `gemini-2.5-*` (spärrad för nya nycklar). ⚠️ `SCANNER_MODEL_PRECISE`
  defaultar fortfarande till `gemini-3.5-flash`, strikt dominerad av `gemini-3.6-flash` (samma inpris, 20 %
  billigare ut) — graderingen bytte, skannern glömdes.
- **Skanning**: `src/services/scanner/` — OCR-adapterinterface med mock + `ClaudeVisionOcrAdapter` +
  `GeminiVisionOcrAdapter`. `OCR_PROVIDER=claude` är rollback.
- **PWA/app**: `public/manifest.json` + `public/sw.js` (registreras i prod av `pwa-register.tsx`). Native =
  Capacitor-wrapper runt samma Next-app. ⚠️ Native-ändringar (plugins, orientering, usage strings) kräver
  `npx cap sync` + nytt bygge — `git push` räcker INTE.
- **Övrigt**: Redis valfri (in-memory fallback i `src/lib/queue.ts`); recharts lazy via `PriceChartLazy`;
  e-post via nodemailer-API (console/JSON i dev via `EMAIL_MODE=console`, Resend HTTP API i prod); Zod på
  alla API-gränser.
- **Designtokens**: SVART yta + turkos signaturaccent (`holo.cyan` = `#2dd4bf`), allt via tokens i
  `tailwind.config.ts` — undvik hårdkodade hex/`*-blue-*`. ⛔ `surface-overlay` är en interaktiv FYLLNING,
  inte en bakgrund, och ska INTE sänkas till svart. Sidans vågräta luft = 10px på mobil (`px-2.5 sm:px-6`)
  och delas av ALLT som möter kanten. Detaljer: `.claude/rules/ui-shell.md`.

## Regelverk per delsystem (`.claude/rules/`, laddas automatiskt via `paths:`)
| Fil | Hårdaste regeln |
|---|---|
| `scraping-restock.md` | Shopifys `available` ≠ köpbar; `discontinued` är INGEN lagersignal; frånvaro ur feeden kollas, tolkas inte |
| `discord-restock.md` | Lanen är GRATIS på villkor — når aldrig DB:n; egen cache-nyckel; domen tas på ANNONSEN, men en känd rutt övertrumfar vakterna |
| `matching-import.md` | `OTHER` var det enda som höll skräpet ute — härda vakterna FÖRE en vidgning; mät mot två facit |
| `catalog-curation.md` | Herrelösa URL:er räknas över HELA gruppen; denylist FÖRE apply; identiteten måste överleva normaliseringen |
| `cm-pricing.md` | Singlar = CM engelska NM-"From" RAKT AV; guiden är INTE CM:s From |
| `base-printings.md` | Tryckningen är identitet, inte en prisnivå; `variantLabel` obligatoriskt i vakterna |
| `jp-sets.md` | JP-set kommer från CM:s expansioner; namnuppslag MÅSTE filtrera på `language` |
| `scanner.md` | Numret är identiteten; LÄS `docs/SCANNER-STATUS.md` före ändringar |
| `grading.md` | `maxOutputTokens` är taket för TÄNKANDE + SVAR på Gemini 3; prompt bor i contract.ts |
| `auth-accounts.md` | En cookie som JS skriver har inte den livslängd du anger (WebKit kapar till 7 dygn) |
| `billing-entitlements.md` | Stripe skriver ALDRIG `planTier`; glöms grenen i `proUserWhere()` får kunden Pro i UI:t men INGA larm |
| `alerts-setwatch.md` | Regeln utvärderas vid LARMTILLFÄLLET, i BÅDA vägarna |
| `marketplace-tradera.md` | Sålt är en EGEN serie, ersätter aldrig annonskurvan; ingen `fillForward` |
| `catalog-browse.md` | Ofiltrerad katalog personaliseras ALDRIG; bygg ingen inlärd rankning |
| `collection-portfolio.md` | Poster (lots), aldrig ett snitt i databasen |
| `ui-shell.md` | Porträttlås; bredd ensam ≠ desktop; min-height måste dra av spacer + safe-area |
| `admin-ops.md` | Tre utfall, aldrig två: kostnadsförd / gratis / OMÄTT |
| `legal-copy.md` | Ångerrätten är den PROPORTIONELLA modellen — villkor och checkout-samtycke är EN mekanism |

## Kommandon & lokala konton
```bash
npm install                     # --legacy-peer-deps vid peer-konflikt
```
Postgres kör redan som Windows-tjänst (`postgresql-x64-18`) — ingen Docker. Seed-konton:
admin@pokefinds.se (SUPERADMIN) och demo@pokefinds.se (USER), lösenord från
`SEED_ADMIN_PASSWORD`/`SEED_DEMO_PASSWORD` — utelämnas de slumpar seeden fram dem och skriver ut dem
(E2E:s inloggningstest läser samma variabel och hoppas över om den saknas). Prod-lösenorden är ROTERADE.

## Regler
- All copy på svenska, premium men lekfull ton; mörkt tema som standard
- Inga hårdkodade hemligheter; inga fabricerade priser/data — bara verifierade källor
- GDPR: dataminimering, export och radering måste alltid fungera
