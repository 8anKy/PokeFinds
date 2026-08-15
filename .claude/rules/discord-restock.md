---
paths:
  - "scripts/discord-restock-run.ts"
  - "scripts/export-restock-routes.ts"
  - "src/lib/stock-flap.ts"
  - ".github/workflows/discord-restock.yml"
---
# Discord restock-lane

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
