# Foilio — Pokémon TCG-marknadsplattform för Sverige

## Vad är detta?
En komplett SaaS-webbplattform för svenska Pokémon TCG-samlare: prisbevakning, restock-alerts,
marknadsdata, samlingsvärde, kortskanning och community. Helt eget varumärke ("Foilio"),
egen design, egen copy (svenska). Nämn ALDRIG inspirations-/konkurrentsidor i kod, copy eller docs.

> Historik: detaljerade dagboksanteckningar per session ligger i git-historiken (commits + tidigare
> versioner av denna fil). Den här filen håller bara NULÄGE, durabla beslut och vad som är kvar.

## Nuläge
- **LIVE i produktion** på https://foilio.se — **Railway** (projekt `divine-reflection/PokeFinds`) + Neon serverless
  Postgres (Frankfurt). Deploy = `git push origin main` (Railway auto-bygger via Dockerfile, node:22-slim). INGEN `vercel --prod`
  längre — vi har lämnat Vercel. Railway BLOCKAR SMTP-portar → mejl skickas via Resend HTTP API (se `src/lib/mailer.ts`).
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
- **Katalog komplett**: ~173 set, ~20k singlar + ~1558 sealed-produkter (0 saknade set/kort mot pokemontcg.io).
- **Priser**: singlar = Cardmarket engelska NM-"From" (RapidAPI) × live-kurs; sealed = CM `lowest`. Graf/historik = CM trend.
- **Auto-uppdatering** via GitHub Actions (repot är publikt → obegränsade Actions-minuter):
  `cardmarket-refresh` (dagl 13:00 UTC) + `hot-card-refresh` (21:00), `tradera-sweep` (dagl 04:00), `scrape-all` (dagl 02:00),
  `restock-watch` (var 10:e min via extern pinger). ⛔ Manatörsk-snabbfilen (2-min) TOGS BORT 2026-08-09 (ägarbeslut) —
  Manatörsk täcks av 10-min-lanen som alla andra butiker. ✅ HELT AVSLUTAT 2026-08-11: workflow-filen var redan borta,
  cron-job.org-jobbet skrevs om till Discord-pingaren (finns alltså inte längre), och tombstonen i
  `/api/cron/dispatch` är borttagen. Kvarvarande "Manatörsk" i koden är BUTIKEN, som fortfarande skrapas som alla andra.
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
  AI-gradering (`/gradera`, Gemini vision), live kort-skanner (`/skanna`, capture-baserad, Gemini vision), community, admin, PWA.

## Öppna ärenden / Nästa steg
- **DISCORD-KOPPLINGEN ÄR PÅSLAGEN**: `DISCORD_ENABLED=true` i BÅDE Railway och GitHub (avläst 2026-08-14;
  GitHub-variabeln stämplad 2026-08-07). Rollsynken är alltså live — länkning, webhookar och den nattliga
  avstämningen kör skarpt. Ägarbeslut tagna: roller tas bort men ingen kickas, och Pro-rollen följer hela
  `isPro()` (inkl. admin + referral-bonus). Se "DISCORD-ROLLEN" under Tekniska beslut.
  ⛔ **INTEGRITETSPOLICYN ÄR FORTFARANDE INTE JURISTGRANSKAD** — den var villkoret för påslaget och är nu
  försenad MEDAN behandlingen pågår, inte före den. `../PokeFinds-private/docs/PRIVACY-DISCORD-DRAFT.md`
  listar utöver Discord TRE leverantörer som behandlar personuppgifter i produktion UTAN att stå i policyn
  (Stripe sedan 08-07, Google/Gemini sedan 08-05, Tradera). Det är den enda kvarvarande punkten.
- **DISCORD RESTOCK-LARM BYGGT 2026-08-11, INERT TILLS VARIABLERNA SÄTTS**: egen lane
  (`.github/workflows/discord-restock.yml` + `scripts/discord-restock-run.ts`) som postar
  restocks var 2:a minut, kanal per SERIE. Kvar för ägaren: (1) skapa kanalerna i Discord,
  (2) sätt repo-VARIABLERNA `DISCORD_RESTOCK_ENABLED=true` och `DISCORD_RESTOCK_CHANNELS`
  (`{"default":"<id>","sets":{"Prismatic Evolutions":"<id>"},"series":{"Mega Evolution":"<id>",…}}`
  — variabler, INTE secrets: kanal-id:n är inga hemligheter, till skillnad från webhook-URL:er som
  är rena bärartokens), (3) ge boten
  **Send Messages + Embed Links** i kanalerna, (4) lägg upp en cron-job.org-pingare var 2:a minut
  mot `…/workflows/discord-restock.yml/dispatches` (GitHubs egen `schedule:` är best effort och
  kördes i praktiken var 1,5–3,5 h — samma lärdom som restock-watch).
  ✅ **ALLT OVAN ÄR GJORT 2026-08-11 och bevisat i drift**: 7/7 kanaler kvitterade testinlägget
  (`--test`), och 19:54 UTC hittade en körning som ingen människa startade 1 lagerflipp och
  postade 1 larm.
  ⛔ **INCIDENT 2026-08-12: boten förlorade Send Messages i ALLA sju kanaler** (403 code 50013,
  `--test` 0/7 mot gårdagens 7/7) — något ändrades i serverns rättigheter efter 20:00 UTC 08-11.
  Detektionen fungerade hela tiden; körningarna var ändå GRÖNA och lanen stod tyst i 14 h.
  **Nekade utskick sätter nu `process.exitCode = 1`** (röd körning, samma regel som testläget).
  Fixen på Discord-sidan är ägarens: botens roll behöver View Channel + Send Messages +
  Embed Links i varje kanal/kategori; verifiera med workflow_dispatch `test=true` → 7/7 OK. ⛔ **PINGAREN ÄR DET GAMLA MANATÖRSK-JOBBET, OMSKRIVET** (cron-job.org id
  8000102, numera "Foilio Discord restock") — PAT:en låg redan i dess Authorization-header, så
  ingen behövde hantera token. Manatörsk-jobbet finns därmed INTE LÄNGRE, dvs tombstone-punkten
  under Auto-uppdatering är avklarad. Schemat är `*/2 * * * *` (2 minuter finns även som
  preset hos cron-job.org — det var 3-minuters som saknades och tvingade fram ett custom-uttryck).
  ⛔ **OMBYGGD TILL LOOP-I-JOBBET 2026-08-13** (ersätter "en körning per dispatch var 2:a minut",
  vars 2-min-golv sattes av ~25 s Actions-omkostnad PER SVEP): jobbet loopar nu SJÄLVT — ett tick
  var 60:e sekund i ~5 min (`DISCORD_RESTOCK_LOOP_SECONDS`/`TICK_SECONDS`), omkostnaden betalas per
  JOBB. Snittlatens ≈ tick/2 + feed-hämtning ≈ **~45–60 s** (var ~2,1 min). Feed-hämtningen kortades
  samtidigt: Shopify-JSON-pacingen 1200→300 ms (CDN-serverad — mätt: DL-sida 0,15–0,27 s; den gamla
  "42 s-butiken" var Speltrollets 28 kollektioner à 1,2 s paus, inte DL:s sidantal) och de tunga
  butikerna läser numera `/products.json` (se täckningsfixarna nedan). `RESTOCK_SCAN_CONCURRENCY`
  är env-styrbar (workflow kör 16 — wall-clock per tick = långsammaste ENSKILDA butik).
  ⛔ **ARTIGHETEN ÄR PER PLATTFORM** (`isFastTier` i scripts/discord-restock-run.ts): Shopify-butiker
  (CDN) + Webhallen sveps varje tick; butiker på EGNA servrar (Quickbutik/Woo/custom) varannan —
  exakt samma takt som gamla 2-min-lanen gav dem. Klassning via `instanceof ShopifyAdapter`, så nya
  butiker hamnar rätt automatiskt. Pingern (cron-job.org, var 2:a min) står kvar orörd: pending-
  dispatcher byts ut medan ett jobb kör (någon "avbruten" i historiken per jobb — kosmetiskt; ägaren
  KAN sätta pingern till var 5:e min för renare historik, samma latens). Nästa spak därefter är en
  långkörande process (kostar Railway-minne → ägarbeslut, se kostnadsavsnittet i sessionens rapport).
  ⛔ **OKÄND URL GLÖMS INTE LÄNGRE**: en IN_STOCK-flipp vars URL saknas i ruttabellen läggs i
  `pending` (state-filen, TTL 12 h) och postas när rutten dykt upp och varan fortfarande är i lager
  — Samlarhobbys Paradox Rift-booster 08-12 (offer född 18:02 via auto-import, ruttabell från 12:57)
  sågs av lanen FÖRE DB-lanen men gick förlorad för alltid. Dessutom exporterar 10-min-lanen numera
  om ruttabellen SÅ FORT den skapat nya offers (`offersCreated` i scan-resultatet + cache-save i
  restock-watch.yml — Neon är redan vaken i exakt de körningarna) ⇒ ny SKU postbar inom minuter, inte
  ≤24 h. Loggarna namnger nu både postade nycklar och hoppade okända URL:er (räknare utan namn gick
  inte att felsöka — hela 08-13-utredningen krävde korsreferens mot DB-lanens loggar).
  ⛔ **…MEN `pending` TAPPADES VID INLÄSNINGEN (buggat 08-13 → 08-15).** `readState` byggde sitt
  returobjekt fält för fält och `pending` fanns inte med, så väntlistan skrevs till state-filen och
  KASTADES vid nästa jobbstart. Mekanismen överlevde alltså bara mellan tick INOM ett jobb (~5–9 min),
  medan rutten för en ny SKU typiskt dyker upp senare — dvs den kunde nästan aldrig rädda det den
  byggdes för. **Den rena domen (`deriveRestockPosts`) hade tester på andra chansen; serialiseringen
  runt den hade inga.** Tolkningen bor nu i `parseDiscordRestockState` (lib, testad utan filsystem).
  Läxa: en testad ren funktion kan vara helt verkningslös om I/O:t runt den inte testas.
  ⛔ **LATENSPASS 2026-08-15 — "tick var 60:e sekund" var en ÖNSKAN, inte en takt.** Loopen startar
  nästa tick först när det förra är klart, så tickintervallet kan aldrig bli kortare än feed-svepet.
  Tre fynd, alla MÄTTA (svepet loggar numera väggklocka + de fem långsammaste butikerna varje körning —
  `[restock-scan] Feed-svep: … Långsammast: …`; utan den raden gick det inte att se vem som satte takten):
  (1) **Webhallen ensam tog 52,3 s av svepets 54,4 s.** Dess live-koll slår upp varje icke-i-lager-
  produkt (~48 st) sekventiellt med 800 ms paus. En butik som står för 0,4 restocks/dygn av 12,2 satte
  alltså golvet för alla 42. Adaptern ROTERAR nu markören mellan hämtningar, så lanen kan sätta
  `WEBHALLEN_LIVE_POLL_MAX=16` och ändå täcka allt var tredje tick (~3 min — långt under de ~50 min
  sökindexet släpar, vilket var hela skälet till live-kollen). ⛔ Defaulten är oförändrad (80 = alla):
  ett engångsjobb kör EN hämtning per process och har inget nästa tick att rotera till.
  (2) **Samtidigheten 16 gjorde svepet till tre vågor.** Den är nu 48 (fler än butikerna) ⇒ wall-clock =
  långsammaste ENSKILDA butik. Det ökar INTE lasten mot någon butik: `politeFetch` fördröjer per VÄRD
  (`lastRequestPerHost`), och samtidigheten gäller mellan olika värdar.
  (3) **Glappet mellan jobb** (~25–40 s blind boot-tid) var ~10 % av tiden med 5-minutersjobb.
  Loopbudgeten är nu 540 s (~6 %), `timeout-minutes` 15.
  ⛔ **RUTTABELLEN BYGGS NUMERA UR OFFERS **OCH** HUVUDBOKEN.** En URL utan offer kan ändå vara en känd
  produkt: `Offer` är unik på (produkt, butik, skick, språk), så när en butik säljer samma vara under
  TVÅ URL:er får bara den ena en offer — den andra kan per konstruktion aldrig få en (Rogerz listar
  varje begagnad vara under båda danska momsordningarna; 87 av deras huvudboksrader är bundna men
  offer-lösa). De blev "okänd URL" i lanen och postades ALDRIG. `StoreListing.productId` är samma dom,
  redan betald och nerskriven — offers vinner fortfarande, de är granskade av länkrevisionen.
  ⚠️ Kontrollerat och EJ begränsande: Actions-cachen (1,18 GB av 10 GB, state-filerna ~0 MB) och
  GitHubs API-tak (720 dispatches/dygn mot 5 000/h).
  ⛔ **INGET NYTT SAMTYCKE BEHÖVS**: inlägget är produktdata, inga personuppgifter, så det är
  INTE blockerat av juristgranskningen som gällde `DISCORD_ENABLED`. Egen spak med flit.
  ⛔ **"GRATIS" ÄR ETT VILLKOR, INTE EN BIEFFEKT.** `shouldProcess` returnerar ALLTID false →
  `runRestockScan` stannar efter fas 1 (ren HTTP) och når aldrig `ensureDbAwake()`; dessutom
  sätter workflowet en AVSIKTLIGT oåtkomlig `DATABASE_URL` så en framtida DB-fråga dör synligt i
  stället för att tyst kosta pengar. Neon debiteras per VAKEN TID (minst 300 s per väckning) —
  det var precis därför 2-min-snabbfilen togs bort 08-09. Källista + ruttabell (butiks-URL →
  produkt/set/serie) kommer från `scripts/export-restock-routes.ts`, som körs i **scrape-all** där
  Neon ändå är vaken. Saknas filen HOPPAR lanen över; den slår aldrig upp den själv.
  ⛔ **EGEN CACHE-NYCKEL** (`.discord-restock-cache`, prefix `discord-restock-state-`). Delad
  katalog med restock-watch hade gett lanarna varandras lagerläge → både missade och dubblerade
  larm, båda tysta.
  ⛔ **FLAPP-DÄMPNINGEN ÄR SAMMA DOM, INTE EN KOPIA**: `evaluateStockFlap` bor nu i
  `src/lib/stock-flap.ts` (DB-fri) och re-exporteras ur `services/alerts.ts`. Historiken ligger i
  Actions-cachen i stället för i RestockEvent. Kopiera aldrig reglerna — DL står för 46 av 171
  restocks och togglar heta varor dussintals gånger per dygn.
  ⛔ **COOLDOWN STÄMPLAS EFTER KVITTENS** (`markPosted`), aldrig vid beslutet: annars tystar ett
  nekat utskick produkten i två timmar, dvs precis när larmet inte kom fram.
  ⛔ **OKÄND URL POSTAS INTE.** Saknas URL:en i ruttabellen kan den vara sleeves/singel/figur —
  DB-vägens vakter (`ensureListingProduct`) finns inte här. Nya SKU:er syns i Discord först efter
  nästa nattliga export (≤24 h); mejl/app larmar direkt som förut.
  **MÄTT före bygget** (14 dygn, `scripts/discord-channel-shape.ts`): 171 restocks = 12,2/dygn
  (27,4 lagerövergångar/dygn åt båda håll — den gamla "75,2 flippar/dygn" i historiken mättes i en
  hetare period), 40 distinkta set varav 15 delar på ~1 inlägg/dygn ⇒ en kanal per set = ett
  trettiotal döda kanaler. Per serie: Mega Evolution 7,0/dygn · Scarlet & Violet 3,6 · resten <0,4.
  7 % saknar set ⇒ catch-all obligatorisk. Utan matchande kanal OCH utan catch-all postas inget.
  **ROUTING = SET → SERIE → CATCH-ALL** (`resolveChannelId`). Setnivån tillkom 08-11 för att
  enstaka set bär egen kanal medan svansen inte gör det: Prismatic Evolutions ensamt = 91
  butiks-URL:er, men 15 av 40 set delar på ~1 inlägg/dygn. ⛔ Ordningen är hela poängen — låg
  serien först hade en setkanal aldrig kunnat ta emot något, eftersom varje set har en serie.
  ⚠️ **ÄGARBESLUT: kanalerna är ÖPPNA för alla.** Restock-larm är annars Pro-only, så den fria
  kanalen ger bort en betalfunktion — och eftersom den är snabbare får den betalande kunden sitt
  mejl EFTER det fria inlägget. Medvetet valt 08-11. Vill man vända på det finns Pro-rollen redan
  (kanalbehörighet på `Pro`), men den kräver att rollsynken är påslagen, dvs juristgranskningen.
  ⚠️ **BUTIKSURVALET**: sedan 2026-08-12 är repo-variabeln `DISCORD_RESTOCK_STORES=all`
  (ÄGARBESLUT — ägaren fick MaxGaming-restocks från en konkurrentbot men inte från oss, och
  valde sedan alla 34). Kod-defaulten är fortfarande de åtta mest aktiva (82 % av restockarna);
  artighetsräkningen (~24 500 feed-hämtningar/dygn vid alla 34) står kvar ovan som beslutsunderlag.
  MÄTT efter påslaget: 34 butiker hämtas+diffas på ~76 s, fortfarande inom 2-minuterstakten.
  ⛔ **EN NY KÄLLA SEEDAS TYST PER KÄLLA** (`seededSources` i `deriveRestockPosts`): när
  MaxGaming lades till såg diffen alla dess ~41 lagerförda varor som "ny-i-lager" och postade
  11 av dem som restocks — de var bara befintligt sortiment. En källa utan nycklar i förra
  lagerläget behandlas nu som roterande exakt den körningen; nästa körning diffas den som
  vanligt. Vaktat av test (alla 25 nya källor seedade tyst 12:52 UTC när "all" slogs på).
  ⛔ **SPRÅKET STYR KANALVALET** (2026-08-12): JP-set bär med flit samma latinska serienamn
  som EN-serierna ("Ninja Spinner (M4)" har serien "Mega Evolution") → fyra japanska boxar
  postades i EN-seriekanalen. Ruttabellen bär nu `language` + katalogens `imageUrl`
  (embed-miniatyr-reserv — feedarna bär sällan bild), och icke-EN går ALDRIG via set-/serie-
  kanalerna: språkkanal (`"languages":{"JP":"<id>"}` i `DISCORD_RESTOCK_CHANNELS`, valfri)
  eller catch-all. Saknat språk i en äldre cachad ruttabell tolkas som EN. Var 2:a minut mot ALLA 34 vore ~24 500 feed-hämtningar/dygn mot
  10-min-lanens ~4 900 — att bli blockerad av en butik skadar hela produkten, inte bara Discord.
  Med åtta butiker: ~5 800/dygn (var 1:a minut hade blivit ~11 500, dvs en full katalogkrypning av
  varje butik var 60:e sekund dygnet runt — för ~30 s lägre snittlatens på 12,2 restocks/dygn).
  `DISCORD_RESTOCK_STORES=all` öppnar upp.
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
  ⚠️ **Arcade Dreams robots.txt har ÄNDRATS på riktigt** (hela filen läst) — blanket-Disallow
  borta; butiken är åter möjlig att bygga.
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
  ⚠️ **`DISCORD_ENABLED` ÄR PÅ (avläst 2026-08-14) — spaken finns kvar som nödstopp.** Utkast + de tre ANDRA
  odeklarerade leverantörerna (Stripe, Google/Gemini, Tradera) ligger i `../PokeFinds-private/docs/
  PRIVACY-DISCORD-DRAFT.md`. ⛔ Discord får INTE bara läggas i `Privacy.s7Items`: den listan påstår att varje
  post är ett personuppgiftsbiträde bundet av biträdesavtal, och Discord är självständigt personuppgifts-
  ansvarig som aldrig tecknar ett sådant. Samma sak gäller Tradera.
  ⛔ **MIGRATIONEN MÅSTE LIGGA FÖRE KODEN**: `/installningar`, GDPR-exporten och kontoraderingen `select`:ar
  Discord-kolumnerna, så koden mot en omigrerad databas ger 500 för ALLA användare, inte bara Discord-användare.
  Dockerfilens `migrate deploy || true` är avsiktligt icke-blockerande och kan alltså tiga ihjäl felet — kör
  `node scripts/with-prod-db.mjs npx prisma migrate deploy` MANUELLT före push vid schemaändringar.
- **JAPANSKA SET-regelverket FLYTTAT till `.claude/rules/jp-sets.md`** (laddas automatiskt vid arbete i JP-set-filerna). Kärnan: JP-set kommer från CM:s expansioner (`CardSet.cmExpansionId`), varje namnbaserat setuppslag MÅSTE filtrera på `language`, logotyper matchas aldrig på namn.
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
- **EN LLM-DOM SKRIVS NER, ANNARS BETALAS DEN VAR 10:e MINUT I EVIGHET (2026-08-14)**: `ensureListingProduct`
  frågade "har URL:en en Offer?" för att avgöra om annonsen var ny. För en URL som ALDRIG kan få en egen offer
  är svaret alltid nej: butiken har redan en offer på produkten via en ANNAN variant-URL, och `Offer` är unik på
  (produkt, butik, skick, språk) → `upsertListingOffer` skriver ingenting. Alltså matchades, dömdes (Haiku) och
  bands samma annons om och om igen. **MÄTT: 5 listningar × 144 körningar = 720 anrop/dygn ≈ $18/mån ≈ 90 % av
  hela Anthropic-notan**, för domar vi redan hade. Rogerz listar varje begagnad vara under BÅDA danska
  momsordningarna på SAMMA sida — den ena varianten fick offern, den andra kunde per konstruktion aldrig få en.
  Domen bor nu i `StoreListing.productId` + `productMatchTitle` (migration 20260814210000).
  ⛔ **MEMOT LÄSES EFTER språk- och denylist-vakterna** — en URL admin nekat får aldrig återuppstå ur cachen.
  ⛔ **DET KORTSLUTER INTE `upsertListingOffer`**: memot sparar det DYRA (butikens produktsida via HTTP +
  LLM-domen), aldrig garantin att en offer skapas när den GÅR att skapa. En misslyckad skrivning ska kunna
  göras om nästa körning.
  ⛔ **BARA POSITIVA DOMAR MEMORERAS.** `judgeSameProduct` returnerar null när domaren är OTILLGÄNGLIG, inte
  när produkterna är olika — cachas det låser vi in ett icke-svar (samma familj som "0 kr är inget pris").
  ⛔ **INVALIDERINGEN ÄR RÅTITELN**, samma regel som `DedupeVerdict.titleA/B`: byter butiken titel gäller inte
  domen längre. Rå titel med flit — den finns FÖRE `fetchListingFacts`, så en memo-träff slipper HTTP-uppslaget
  också. ⛔ **FK:n är `onDelete: SetNull`** — en mergad/raderad produkt nollar memot i DATABASEN, så nästa
  körning dömer om och binder till målet; utan den hade memot pekat på ett dött id och FK-felet slagit i
  offer-skrivningen i stället, tyst, i en bakgrundsloop. Vaktat av `tests/unit/listing-product-memo.test.ts`.
  ⏭️ KVAR (samma körning, EJ åtgärdat): feed-först-grenen kollade **6 243 URL:er** mot bara ~2 100
  huvudboksrader utan offer — gapet antyder att URL:er ÅTERSKAPAS i stället för att matchas. Mät innan något
  byggs på siffran.
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
- **⛔ `OTHER` VAR EN OAVSIKTLIG BROMS — 436 RIKTIGA SKU:er FASTNADE I DEN (2026-08-15)**: ägaren såg
  att butikerna hade "för få produkter" i katalogen. Roten var kategoriseringen, inte adaptrarna:
  `guessCategory` fanns i **TIO nästan identiska kopior** (en per adapter, redan isärdrivna — tre
  testade `/tin\b/` och `/etb/i` UTAN inledande ordgräns, så tyska "Karmesin" blev TIN) och kände bara
  sju formord. Allt annat blev `OTHER`, och `OTHER` står i `HIDDEN_CATEGORIES` ⇒ produkten är osynlig i
  katalogen, tyst i restock-larmen (`hidden`-grinden) OCH oskapbar (feed-först grindar på
  `SEALED_FEED_CATEGORIES`, som saknar OTHER).
  MÄTT mot alla 42 bevakade butikers levande feedar: **479 annonser passerade HELA vaktkedjan utan att
  ha en offer — 436 av dem (91 %) stoppades enbart av kategorigrinden.** Det var hela produktlinjer:
  Battle Decks, League Battle Decks, World Championship Decks, Build & Battle Box/Stadium/Kit, Starter
  Sets/Decks, Theme Decks, Trainer's Toolkit, Battle Academy, Premium Deck Set, samt kvalificerade
  Collections (Figure/Poster/Pin/Sticker/Special) och promo-paket.
  Kopiorna är nu EN definition: `src/scrapers/listing-category.ts` (`guessListingCategory`).
  ⛔ **Tradera-adapterns egen `guessCategory(title, fallback)` rörs INTE** — den är en marknadsplats med
  GRADED_CARD/SINGLE_CARD-grenar och en fallback-kategori, och sitter i skenor/sålt-svepet.
  ⛔ **ORDNINGEN ÄR BETYDELSEBÄRANDE**: den kvalificerade collection-regeln måste stå EFTER blister/tin.
  MÄTT: låg den före bytte sex av Aquitaz "Tech Sticker Collection **Blister**" kategori — kvalificeringen
  beskriver vad som ligger I paketet, inte formen.
  ⛔ **VAKTERNA MÅSTE HÄRDAS FÖRST — `OTHER` VAR DET ENDA SOM HÖLL SKRÄPET UTE.** Innan gaten vidgades
  passerade gosedjur, figurer, godis, myntset, nyckelringar, kortställ, spelarguider, bulk-lotter och
  **hela Pokétalks singelsortiment** varenda vakt; de syntes bara inte, eftersom klassificeraren råkade
  svara OTHER. Det var en slump, inte en vakt. Härdat samma dag (`tests/unit/listing-guards-2026-08-15.test.ts`):
  `#`-prefixade samlarnummer (`#SV59/SV94`, `#SWSH262` — `#` saknades i avgränsarklassen), japansk
  promo-notation (`120/SV-P`, med veto för "promo **pack**"), bulk-/graderade lotter, engelska
  `figure`/`figures`, blindboxar, godis, myntset, spelarguider, markörer, svenskt sammansatt "Samlar**pärm**"
  (ordgränsen före "pärm" borttagen) och "card display" (kortställ). Kinesiska setkoder utanför CSV-grenen
  (`CBB1C`) fälls nu av `CN_SET_CODE`.
  ⛔ **VARJE VAKTÄNDRING MÄTS MOT TVÅ FACIT** (`scripts/measure-guard-changes.ts`): katalogens sealed-produkter
  och de feedannonser som REDAN har en offer. Utfall: **0 katalogträffar**, och de enda nya feedträffarna var
  tre äkta singlar — varav "Mega Charizard X ex - #MEP023" är en felaktig länk ägaren redan flaggat.
  Mätningen fällde tre av mina egna regler: bart `accessory` (Prismatic Evolutions **Accessory Pouch**
  Special Collection är en riktig SKU med sju butikslänkar), `figure` utan kvalificering (**Figure
  Collection** = 8 katalogprodukter, 24 länkar) och bart `display` som sealed-ord (vetade merch-vakten
  för varje "Card **Display** Gift Box").
  ⛔ **POKÉMON-EVIDENSEN LÄSES NU ÄVEN PÅ RÅTITELN.** `hasPokemonTitleSignal` kördes bara på den TVÄTTADE
  titeln, och `cleanListingTitle` tar med flit bort "Pokémon TCG:"-prefixet — så för varje SKU vars enda
  Pokémon-ord satt i prefixet raderade tvätten precis det bevis vakten frågade efter
  ("Pokemon TCG: 2025 World Championship Deck - Pult Bomb" avvisades). Tvätten svarar på vad produkten ska
  HETA, vakten på om det är Pokémon — två frågor.
  ✅ **UTFALL (tyst seedning 2026-08-15, `scripts/run-category-widening-import.ts`, två omgångar)**:
  **+320 katalogprodukter (31 237 → 31 557), 658 nya offers, 0 larm**. Fördelning: 307 COLLECTION_BOX +
  8 BOOSTER_PACK + 5 TIN; 286 EN + 34 JP, **noll CN/KR**. Varenda titel faller i en känd produktlinje
  (79 Battle Deck, 48 Build & Battle, 40 Starter Set, 29 Figure Collection, 23 League Battle Deck,
  World Championship(s) Deck, Special Box …) — ingen merch, inga singlar.
  ⚠️ **DEN KVARVARANDE OTHER-SVANSEN (~420) ÄR MEST MERCH** och ska stanna där: tote bags,
  Squishmallows, statyer, kakburkar, badbomber, Monopol. De passerar merch-vakten (orden saknas i
  MERCHANDISE_SIGNS) och hålls ute ENBART av kategorigrinden — samma slump som förut, fast åt rätt håll.
  ⛔ **Öppna alltså ALDRIG `OTHER` för feed-först.** Den vidgade klassificeraren namnger former; grinden
  ska fortsätta neka allt den inte känner igen.
  ⛔ **`RESTOCK_SEED_SILENT=1` ÄR INTE VALFRITT VID EN VIDGNING.** Butikerna HAR huvudboks-historik, så
  utan spaken mejlas varje nyupptäckt URL som "Ny produkt i lager" till alla set-bevakare — samma fälla
  som när Samlarhobbys täckning gick 379 → 975. Kör seedningen FÖRE push; varje 10-minuterskörning som
  hinner emellan gör larmsvallet i stället.
  ⚠️ **FACETTSIFFRAN ÄR "I LAGER NU", INTE "I KATALOGEN"** (`services/explore-facets.ts` räknar IN_STOCK +
  prissatt + direkt länk, samma villkor som butiksfiltret). "NordicTCG 3" betydde 40 offers varav 3 i
  lager — inte tre produkter. Mät alltid med `scripts/audit-store-catalog-coverage.ts` innan en
  facettsiffra tolkas som ett täckningshål.
  ⛔ **KOLLEKTIONSFILTRET ÄR INTE PROBLEMET (mätt 2026-08-15, `scripts/probe-shopify-coverage.ts`)**:
  för alla 18 kollektionsbaserade Shopify-butiker jämfördes kollektionsvägen mot `/products.json`.
  Det som ligger UTANFÖR kollektionerna är tillbehör, singlar, graderat, merch och tv-spel — Goblinens
  234 är Vault X-pärmar och Dragon Shield-sleeves, Cardlevels 972 är singlar, AuroraDex 413 är graderade
  kort. **Slå alltså INTE på `wholeCatalog` för dem**; det hade dragit in tusentals främmande produkter
  i varje svep för noll vinst. Spelkortsbutikens feed på 3 varor är också korrekt — deras sitemap har
  exakt tre Pokémon-produkter.
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
- **TRADERA-SKENAN: RÄDDNINGSSIDOR MOT SYSKONSKUGGA (2026-08-12)**: Fas 0 i `tradera-sweep.ts` läste bara
  SIDA 1 (50 träffar, PriceAscending) av produktens namn-sökning. För ett dyrt kort med ett billigt namnsyskon
  fylls sida 1 helt av syskonet — MÄTT på Mega Darkrai ex 120/084: sökningen träffar 68 annonser men sida 1 är
  bara 15–37 kr-exemplar av 048/084, `pickRailCandidates` avvisar korrekt alla 50 ⇒ produkten stod utan både
  skena och offer fast annonserna fanns (guldkortets låg på sida 2). Nu läses nästa sida när en sida ger NOLL
  kandidater, upp till `TRADERA_HOT_MAX_PAGES` (4) ur en delad extra-budget (`TRADERA_HOT_EXTRA_PAGES` 1500,
  håller Fas 0 under metodkvoten 10k/dygn). Första sidan MED kandidater räcker — sorteringen är PriceAscending,
  så billigare träffar finns inte längre fram.
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
  uppströmsjobb slutar de efterföljande köra TYST. ⛔ **KEDJAN FÅR ALDRIG BLI LÄNGRE ÄN TRE LED**: GitHub fyrar
  `workflow_run` max tre nivåer från roten, och länk 4 fyrar ALDRIG — tyst (tradera-sold-sweep låg så i två
  månader med noll körningar, upptäckt 2026-08-12). Nya nattjobb läggs som STEG i ett befintligt led.
  `tests/unit/cron-chain-sync.test.ts` vaktar kedjan.
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
  `/sets`, `/sets/[id]`, `/produkter/[slug]`. Data ändras ~1×/dygn så cache är för det mesta osynlig. ⚠️ RÄTTAT 2026-08-11: raden här
  påstod att "offers uppdateras klient-sida via polling" — det är FALSKT sedan klient-hämtningen togs bort av kostnadsskäl
  (LivePricingProvider hämtar ALDRIG själv; `refresh` är bara adminens knapp). Offer-tabellens lagerstatus kan alltså släpa ≤1h efter
  DB:n — bara synligt för admin, som ser den färska restock-historiken bredvid. Vill man stänga glappet är det ett KOSTNADSBESLUT
  (en fetch per produktvisning; `/api/products/[slug]/offers` är CDN-cachad 60 s så origin-lasten är avgränsad — men fråga ägaren).
  **Sätt ALDRIG tillbaka `force-dynamic` på dessa** utan skäl — det var orsaken till hög Vercel Active CPU + Neon-CU.
  Förutsättning: ingen server-`auth()`/`cookies()` i den delade chrome:n. Session läses därför KLIENT-sida i `header-auth-actions.tsx`,
  `bottom-tabs.tsx` (self-gate + egen klarerings-spacer) och `live-product-pricing.tsx` (admin-knapp). Rot-layouten + marketing-layouten
  + `SiteHeader` får INTE kalla `auth()` (då blir HELA appen dynamisk igen). `/produkter` är dynamisk med flit (läser searchParams).
  Produktsidans prishistorik: servern hämtar HELA serien en gång (`MAX_DAYS`), `product-price-card.tsx` filtrerar perioden i klienten
  (ingen URL-param → ISR-bar, ingen extra hämtning per periodbyte).
- **Växelkurs**: live via `src/lib/exchange-rate.ts` (`getRatesOre()` → Frankfurter, dygnscache, fallback 1150/1050 öre). Anropa i början av en ingest-körning; synkrona pris-funktioner läser `getCachedRatesOre()`. `EUR_SEK`-env pinnar kursen. Hårdkoda ALDRIG 11.50 igen — använd modulen
- **Singelpris-policyn, frusna CM-kurvor och rubrik-källregeln FLYTTADE till `.claude/rules/cm-pricing.md`** (laddas vid arbete i cardmarket-refresh/hot-card-refresh/RapidAPI-skripten). Kärnan: singlar = CM engelska NM-"From" RAKT AV (ägarbeslut); guiden är INTE CM:s From — bygg aldrig en per-kort-vakt på den; 0 kr är inget pris.
- **Base-tryckningarna (Unlimited/Shadowless/1st Edition) — hela regelverket FLYTTAT till `.claude/rules/base-printings.md`** (laddas vid arbete med print-variant/CM-länkar/refresh-jobben). Kärnan: tryckningen är identitet, inte en prisnivå; Pikachu 58 delas inte; de nio andra WOTC-seten går INTE att dela; `variantLabel` är obligatoriskt i matcharvakterna.
- **Skanner-djupdykningarna FLYTTADE till `.claude/rules/scanner.md`** (laddas vid arbete i skanner-/kamerafilerna): bildavtryck & marginalregeln, numret är identiteten, beskärning, kostnad, bulk-taket, ägarprefix-fällan, namnsyskon, kamera-livscykeln, tre lägen, streckkod, ficklampa/zoom, alternativlistan, skäligt bruk-taket (1 000/mån = AVTALSVILLKOR). LÄS `docs/SCANNER-STATUS.md` före ändringar.
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
- **VILKEN LEVERANTÖR GÖR VAD (avläst i Railway/GitHub 2026-08-14)**: de två `*_PROVIDER`-variablerna styr
  BARA de två BILD-funktionerna. **Gemini** = allt användaren ser: kortskannern (`OCR_PROVIDER=gemini`) och
  AI-graderingen (`GRADING_PROVIDER=gemini`). **Claude** = hela bakgrundspipelinen, och den har INGEN
  provider-variabel: `judgeSameProduct` (Haiku, `src/lib/same-product.ts`) i auto-importens gränsfall
  (`runner.ts`, var 10:e min via restock-watch + scrape-all), veckans stub-dedup och JP→CM-mappningen, plus
  fynd-/Tradera-verifieringen (`src/services/deal-verify/`, default `claude`, `DEALS_VERIFY_PROVIDER` är
  OSATT i repo-variablerna). ⛔ **`ANTHROPIC_API_KEY` är därför inte valfri även om båda bild-funktionerna
  står på Gemini** — utan den returnerar domaren null, vilket är omöjligt att skilja från "olika produkter",
  och HELA 0,55–0,85-bandet blir dubbletter. Tyst, i drift. ⚠️ `SCANNER_MODEL_PRECISE` defaultar till
  `gemini-3.5-flash`, som är STRIKT DOMINERAD av `gemini-3.6-flash` (samma inpris, 20 % billigare ut, nyare);
  graderingen bytte 08-05, skannern glömdes.
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
- **REGISTRERING KRÄVER MEJLAD KOD — KONTOT FÖDS VERIFIERAT (2026-08-12)**: tvåstegad registrering.
  `/api/auth/register/send-code` mejlar en 6-siffrig kod (hashad rad i `SignupVerification`, TTL 15 min,
  5 gissningar sedan låst, per-IP + per-adress-spärr, skicka-först-spara-sedan) och `/api/auth/register`
  kräver koden → `emailVerifiedAt` sätts vid skapandet. Ren dom = `src/lib/signup-code.ts` (testad utan DB).
  Inbjudningar krediteras DIREKT i register-routen (`creditInviteOnVerify`) — nya konton når aldrig
  `/api/auth/verify`. ⛔ LÄNK-FLÖDET (`verificationToken`/`/verifiera`/resend-verification) finns
  kvar ENBART för gamla konton och får inte rivas: två konton (inkl. ägarens SUPERADMIN) lever på tokens
  utan utgångstid. ⛔ `templates.ts` får INTE importera signup-code (drar in Node-crypto i edge-bundlen via
  instrumentation → scheduler → notifications) — TTL:en skickas in som parameter. E2E kan inte läsa inkorgen,
  så auth.spec verifierar att kodsteget NÅS; själva skapandet täcks av enhetstester + smoke-test.
  **UPPTAGET NAMN/ADRESS FÄLLS VID "SKICKA KOD", INTE EFTER KODEN (2026-08-12)**: send-code gör samma
  namn-/adresskollar som /register och svarar 409 med `field: "name"|"email"` så klienten fäster felet vid
  rätt fält — ägaren fick annars "namnet upptaget" först i kodsteget. Kollarna ligger FÖRE per-adress-
  spärren (3 utskick/h) så en namnrättelse aldrig bränner utskicksbudgeten; /register behåller sina kollar
  som facit (racet namn-tas-mellan-stegen skickar tillbaka till fältet, koden överlever rättelsen).
  **VerifyEmailBanner BORTTAGEN (ägarbeslut 2026-08-12)**: nya konton föds verifierade, så bannern kunde
  bara nå de två legacy-kontona — deras väg är /verifiera:s resend-formulär (endpointen lever kvar).
  **EN FELTYPAD ADRESS ÄR EN ÅTERVÄNDSGRÄND — DÄRFÖR TYPO-FÖRSLAGET (2026-08-15)**: en registrering gick
  förlorad på `@email.com` (studs i Resend, mejlet nådde ingen, personen försökte aldrig igen). Kontot
  skapas först NÄR koden anges, så det fanns varken ett konto att laga eller en fungerande adress att nå
  personen på — enda botemedlet är att fånga typon FÖRE utskicket. `suggestEmailCorrection`
  (`src/lib/email-typo.ts`, Damerau-Levenshtein mot en kort lista kända domäner) visar "Menade du …?" som
  en KNAPP under fältet. ⛔ Den blockerar aldrig mer än EN gång: visas förslaget redan när "Skicka kod"
  trycks skickas adressen som den är — en ovanlig domän måste alltid gå att registrera. ⛔ `email.com` och
  `mail.com` står MED FLIT INTE i domänlistan (riktiga domäner, men i svensk trafik är gmail-typon långt
  vanligare och ett onödigt förslag kostar inget); Microsofts regionala domäner (hotmail.fr/.co.uk,
  outlook.dk …) står DÄR just för att de annars fått ett falskt förslag. ⛔ Oavgjort mellan två kandidater
  ⇒ inget förslag — ett myntkast i gränssnittet läser som ett påstående. Lokaldelen rörs aldrig (går inte
  att gissa), så kodsteget visar numera adressen i full kontrast med "Fel adress?" BREDVID sig i stället
  för en nedtonad "Ändra uppgifter" i sidfoten.
  **STUDS-DETEKTERING (2026-08-15, andra halvan)**: `sendMail` returnerar numera Resends meddelande-id,
  send-code skickar det till KLIENTEN, och kodsteget frågar `/api/auth/register/mail-status?id=…` vid
  8/20/45 s. `last_event: bounced|failed|suppressed` ⇒ röd ruta "Mejlet kom aldrig fram" + knapp till
  fältet. Det är den enda mekanism som fångar ett fel i adressens LOKALDEL.
  ⛔ **INGEN DB, INGEN MIGRATION, INGEN WEBHOOK.** Id:t bärs av klienten (det gavs till just den
  besökaren) ⇒ pollningen är ren HTTP mot Resend och väcker aldrig Neon, som debiteras per VAKEN TID.
  En kolumn på `SignupVerification` hade kostat en läsning per kontroll; en webhook hade dessutom krävt
  signaturverifiering och en publik skrivväg. Samma doktrin som restock-lanens källcache.
  ⛔ **`delivery_delayed` ÄR INTE EN STUDS** — Resend definierar det som ett TILLFÄLLIGT fel hos
  mottagarens server. Läses det som terminalt skickas någon som strax får sin kod tillbaka till
  formuläret. ⛔ **`complained` BETYDER ATT MEJLET KOM FRAM** (spamanmälan sker efter leverans) — koden
  ligger i skräpposten, och "adressen gick inte att nå" vore fel besked. ⛔ **Allt okänt är `pending`**:
  nya Resend-händelser, 404/429 från API:t, saknad nyckel i konsolläge. Ett falskt studsbesked avbryter
  en registrering som var på väg att lyckas. Domen är en ren funktion i `src/lib/mail-status.ts`, testad
  utan nätverk. ⚠️ Utan `RESEND_API_KEY` (dev/konsolläge) finns inget id ⇒ ingen pollning alls.
  **TYPO-FÖRSLAGET SITTER PÅ ALLA FYRA E-POSTFÄLT (2026-08-15)**: registrering, inloggning, glömt
  lösenord och begär-ny-länk delar `useEmailTypoHint` + `<EmailTypoHint>`
  (`src/components/features/email-typo-hint.tsx`) och nyckeln `Auth.didYouMean`. EN implementation —
  fyra kopior hade drivit isär vid nästa domän som läggs till.
  ⛔ **STUDS-DETEKTERING GÅR INTE ATT ÅTERANVÄNDA PÅ /glomt-losenord ELLER /verifiera.** Båda svarar
  MED FLIT likadant oavsett om kontot finns ("Om kontot finns skickar vi en återställningslänk") för
  att adresser inte ska gå att kartlägga. Ett `mailId` i svaret hade avslöjat att ett mejl FAKTISKT
  skickades, dvs. att kontot existerar — kartläggningsorakel. Typo-förslaget är därför enda varningen
  där, och det är också där det behövs mest: en felstavad adress matchar inget konto, så inget mejl
  skickas över huvud taget och användaren väntar för alltid på en länk som aldrig fanns.
  ⚠️ Inloggningen bromsar inte vid submit (ett misslyckat försök är omedelbart synligt); bara
  registreringen gör det, eftersom ett utskick till fel adress är svårt att ta tillbaka.
  **VÄNTRUMMET GALLRAS NATTLIGEN (2026-08-15)**: `SignupVerification`-raden raderas annars BARA vid
  lyckad registrering, så varje avbruten/utgången/studsad registrering lämnade en e-postadress i
  tabellen för alltid. `scripts/signup-verification-report.ts` (steg i scrape-all, `--apply`) städar
  rader som gått ut för mer än `GRACE_HOURS` (24) sedan. ⛔ **RAPPORTEN SKRIVS FÖRE RADERINGEN** —
  raderna är det ENDA spåret av misslyckade registreringar (ingen analytics, ingen adminvy), så
  fördelningen loggas varje natt även när raderna försvinner. ⛔ En rad vars adress redan är ett konto
  är INGEN avhoppare: raderingen i register-routen är nycklad på adressen som faktiskt användes, så
  den som rättade en felstavning lämnar kvar väntrumsraden för den gamla. Räknas den som "gav upp"
  blir tratten fel. ⛔ Karensen finns för MÄNNISKAN, inte för koden (som lever 15 min): den som skrev
  fel adress ska hinna komma tillbaka nästa morgon. Mätt 2026-08-15 före första körningen: 6 rader
  totalt, 2 städbara — problemet var principiellt, aldrig volymmässigt.
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
  ⚠️ **`migrate deploy` kan timeouta på advisory-låset** ("Timed out trying to acquire a postgres advisory
  lock") — pooler-URL:en går via PgBouncer i transaktionsläge, så ett sessionslås från en tidigare
  migrering kan stranda på en poolad backend och aldrig släppas (sett 2026-08-12: en app-session höll
  låset). När ingen deploy pågår: kör om med `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1` — låset skyddar bara
  mot SAMTIDIGA migreringar, och våra migrationer är idempotenta (IF NOT EXISTS).
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
- **Skanning**: `src/services/scanner/` — OCR-adapter-interface med mock + `ClaudeVisionOcrAdapter` + `GeminiVisionOcrAdapter`. PROD KÖR `OCR_PROVIDER=gemini` (avläst 2026-08-14); `=claude` är rollback
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
