---
paths:
  - "scripts/discord-restock-run.ts"
  - "scripts/export-restock-routes.ts"
  - "scripts/lib/restock-routes.ts"
  - "src/lib/discord-restock-filter.ts"
  - "src/lib/restock-feed-events.ts"
  - "src/lib/restock-poll-interval.ts"
  - "src/lib/stock-flap.ts"
  - ".github/workflows/discord-restock.yml"
---
# Discord restock-lane

## ⛔ KATALOGEN GRINDAR INTE LÄNGRE (2026-08-16) — ombygget som löste ägarens felrapport
Symtomet: **mejl och push kom fram om påfyllningar Discord teg om, i de flesta butiker.**
Roten var att lanen grindade på RUTTABELLEN — saknades butikens URL där postades ingenting.
Ruttabellen bär bara URL:er med en `Offer` eller en bunden `StoreListing` hos en bevakad butik;
allt annat butikerna säljer var osynligt, och bortfallet gick inte att skilja från en sleeve.
**Domen tas nu på ANNONSEN** (`src/lib/discord-restock-filter.ts`), rutten är ENRIKNING
(snyggare titel, rätt kanal, länk till vår produktsida).
- **VAKTKEDJAN ÄR SAMMA FUNKTIONER SOM AUTO-IMPORTEN, ALDRIG KOPIOR**: språk → denylist →
  tillbehör (`isAccessoryListing` + `classifyForm` accessory/event) → merch → singel → annan
  franchise → butiksbundle → känd form (`guessListingCategory` ≠ OTHER) → positiv Pokémon-evidens.
  Kopieras reglerna driver lanarna isär tyst, exakt som flapp-dämpningen en gång gjorde.
- ⛔ **EN KÄND RUTT ÖVERTRUMFAR VAKTERNA — annars vore ombygget en REGRESSION.** Fram till nu
  postades VARJE routad URL utan någon vakt alls; hade en ordlista kunnat rösta ner den hade
  ändringen tagit BORT larm samtidigt som den lade till dem. Katalogen har redan avgjort att en
  routad URL är en riktig sealed Pokémon-produkt. MÄTT 2026-08-16: "Starter Deck 100 Japansk" och
  "Phantsmal Flames Booster Pack" (butikens stavfel) faller båda på `no-pokemon-signal` fast de är
  riktiga varor — en ordlista täcker aldrig butikernas formuleringar.
  ⛔ **TVÅ UNDANTAG SOM ALDRIG ÖVERTRUMFAS**, för de är POLICY och inte gissningar: `language`
  (kanalerna är EN + JP, ägarkrav) och `denylist` (ägarens "Ta bort" måste gälla i kanalerna också).
  `stats.rescuedByRoute` loggas — **ett stigande tal betyder att en vakt är för bred för butikernas
  formuleringar**, och är signalen att mäta om den innan den ändras.
- ⛔ **`isUnspecifiedCharacterListing` står MED FLIT INTE i kedjan.** Den finns bara för att hindra
  DUBBLETTER när en produkt SKAPAS; en karaktärslös "Premium Checklane Blister" är en fullt riktig
  påfyllning att larma om. Asymmetrin är omvänd här: ett falskt JA kostar ett inlägg, ett falskt NEJ
  kostar precis det ägaren klagade på.
- ⛔ **KATEGORIGRINDEN (OTHER) STÅR KVAR.** Svansen som blir kvar i OTHER är mest merch ordlistorna
  inte känner igen (tote bags, Squishmallows, kakburkar, badbomber). MÄTT i drift 2026-08-16:
  Pocketmonsters levererade 83 "flippar" i ETT tick — badbyxor, plånböcker, plysch, kepsar. Utan
  vakterna hade den katalogfriheten fyllt kanalerna med exakt det.
- **MÄTT FÖRE OCH EFTER** (`scripts/audit-discord-lane-coverage.ts`, alla 42 butikers levande feedar):
  5 295 annonser i lager → 1 428 passerar vakterna → **64 av dem saknade rutt och kunde alltså
  ALDRIG postas förut**. Resten fälls av vakterna: 1 199 tillbehör, 869 singlar, 528 okänd form,
  488 blockerat språk, 465 annan franchise, 174 merch.
  ⚠️ **`RestockEvent` kan inte mäta bortfallet** — en restock på en URL utan offer skriver ingen
  RestockEvent alls, så en jämförelse mot DB-lanens facit visar 0 missar per konstruktion. Mät på
  FEEDEN, inte på händelsetabellen. (`scripts/audit-discord-vs-db-alerts.ts` gör jämförelsen och bär
  samma varning.)
- **RUTTABELLEN BÄR NU OCKSÅ TAXONOMI**: `setNames` (den positiva Pokémon-vakten), `sets`
  (namn/serie/språk → kanalval för URL:er utan rutt) och `deniedUrls` (ägarens "Ta bort" måste gälla
  i kanalerna också). ⛔ Setnamnen byggs dessutom ur ruttabellens EGNA `setName`-värden, så en ÄLDRE
  cachad fil ger en användbar lista — annars hade en deploy stått med försvagad Pokémon-vakt tills
  nästa nattliga export, dvs fällt riktiga påfyllningar som "no-pokemon-signal" i upp till ett dygn.
- **RESERVLÄNK NÄR PRODUKTSIDAN SAKNAS (2026-08-16, ägaren såg det i kanalen)**: ett katalogfritt
  inlägg har ingen produktsida att peka på, så embedden stod helt utan väg tillbaka till oss. Setet
  vet vi ändå (det är så inlägget hamnade i rätt kanal) ⇒ **`/sets/<CardSet.id>`**, fältnamn
  **"Hos oss"**, inte "Prishistorik" — det senare lovar en prisgraf som bara finns på produktsidan.
  ⛔ **SETSIDAN, INTE KATALOGFILTRET `/produkter?set=<id>` — OCH SKÄLET ÄR KOSTNAD.** `/produkter`
  är `force-dynamic` med flit (searchParams), så varje klick från en PUBLIK kanal hade blivit en
  serverrendering med DB-frågor, dvs en Neon-väckning som debiteras minst 300 s. En länk vi postar
  dussintals gånger per dygn i en öppen kanal är en trafikkälla vi inte styr. `/sets/[id]` är
  ISR-cachad (`revalidate = 3600` + `generateStaticParams`) och serveras ur cachen.
  ⚠️ Setsidan saknar dessutom katalogfiltrets pris- och `hiddenAt`-krav (`buildProductWhere` kräver
  `lowestPriceOre != null`), så den kan inte stå tom för ett FÄRSKT set — vilket är precis det läge
  där rutten oftast saknas. Verifierat mot prod: 200 med 215 resp. 198 produkter.
  ⛔ **FRITEXTSÖK (`?q=`) DUGER INTE SOM RESERV.** Katalogfiltret kräver att ALLA ord i frågan finns
  i produktens `normalizedTitle` (`buildProductWhere`, AND över orden), och butikstiteln bär prefix
  ("Pokémon Mega Evolution: …"), språktaggar ("(ENG)") och ibland stavfel ("Phantsmal") — en sådan
  sökning landar på NOLL träffar. Dessutom är `/produkter?q=` blockerad i robots.txt, dvs medvetet
  inte en delbar URL-rymd.
  ⚠️ `sets[].id` tillkom i ruttabellen samtidigt; en ÄLDRE cachad fil ger kanalval men ingen
  setlänk (testat), aldrig ett uteblivet inlägg.
- ⛔ **ETT SET SOM HETER SAMMA SAK SOM SIN SERIE är den MINST specifika tolkningen** (`matchKnownSet`):
  "Mega Evolution" är både ett set (seriens basutgåva) och en serie, och butikerna skriver ut serien
  före setet ("Mega Evolution - Chaos Rising Booster"). Längsta-namn-matchning ensam hade lagt varan
  i basutgåvans kanal.

## ⛔ "HOS OSS"-SETLÄNKEN ÄR INTE EN BUGG — MÄTT 2026-08-17 (öppna inte frågan igen utan nya siffror)
Ägaren rapporterade att inlägg ibland länkar till HELA SETET ("Hos oss") i stället för till varan
("Prishistorik → Se på Foilio"). **Mätt två vägar samma dag:**
- **Faktiskt postade larm, senaste dygnet** (40 unika URL:er ur 40 lyckade körningars loggar):
  **39 av 40 hade produktlänk.** Den enda utan var Rogerz "Pokémon TCG: Pitch Black Checklane
  Blister" — en KARAKTÄRSLÖS blistertitel, medan katalogen (som CM) har en SKU per karaktär.
- **Hela lagerläget hos alla 42 butiker** (`scripts/audit-discord-product-links.ts`): 1 546 postbara,
  **95,7 % produktlänk via rutt**, 3,2 % bara setlänk, 0,3 % ingen länk alls.
⛔ **SVANSEN ÄR VAROR VI MED FLIT INTE HAR I KATALOGEN**: av de 49 setlänkarna är nästan alla CASE /
DISPLAY / PACKSTACK ("Booster Box Case", "Sealed Case (6 Boxes)", "Booster Bundle Display",
"4x … (1x Packstack)", "Tin (4 Pack)") — `classifyForm` returnerar `multipack`/`case` och matcharen
avvisar dem per konstruktion. De HAR ingen produktsida, och att peka dem på enkelboxen vore fel pris
och fel vara.
⛔ **EN TITELMATCHNING MOT KATALOGEN ÄR PRÖVAD OCH FÖRKASTAD.** `matchListingToProduct` (Traderas
riktade matchare) körd blint mot setets sealed-produkter gav 13 träffar av 49 — och de flesta var
MYNTKAST: "Journey Together Premium Checklane" → "…Rhyperior Premium Checklane" (0,74), "Perfect
Order 3-Pack Blister" → "…Makuhita 1-Pack Blister" (0,71), "Pitch Black 3-Pack Blister" →
"…Slowpoke 1-Pack Blister". Funktionen saknar med flit `blisterCharacterMismatch`/`packVsBoxMismatch`
(den förutsätter att produkten redan är känd via namnsökning) — de vakterna sitter i `matchProducts`
egen loop. Med dem tillagda återstår ~1 räddad av 49, till priset av ett produktindex i
ruttabellsfilen, matchnings-CPU i en lane som kör dygnet runt, och risken för en FELAKTIG
produktlänk i en publik kanal. **Bygg det inte utan att först mäta att svansen ser annorlunda ut.**
⚠️ **DET SOM DÄREMOT KAN DEGRADERA TYST ÄR RUTTABELLENS ÅLDER.** Filen restaureras ur Actions-cachen
på PREFIX och träffas varje körning, så den evictas aldrig — den bara åldras om scrape-all slutar
skriva den, och då får fler och fler inlägg setlänk medan körningarna förblir gröna. `ageH > 30 h`
loggar numera en varning.

## ⛔ FRÅNVARO HAR ETT MINNE (2026-08-16)
`mergeStateMap` GLÖMMER en URL som försvinner ur en levererande feed. Det gav två fel åt var sitt håll:
- **ROTERANDE BUTIKER TAPPADE ÄKTA PÅFYLLNINGAR.** Shinycards och Swepoke levererar en roterande
  delmängd, så en URL som setts slutsåld, roterat ut och kommit tillbaka I LAGER dök upp som
  `ABSENT → IN_STOCK` — och rotationsregeln kastar den, med rätta. DB-lanen larmade ändå, eftersom
  `Offer.stockStatus` LIGGER KVAR. Nu minns `absent` statusen över frånvaron: ett IHÅGKOMMET
  slutsålt → i lager ÄR en påfyllning oavsett rotation. Rotationen kan inte fabricera den — ett
  `OUT_OF_STOCK` måste faktiskt ha OBSERVERATS.
- **FEED-HICKOR BLEV FALSKA PÅFYLLNINGAR.** En delvis levererad feed tappade sina URL:er ur minnet
  och fick dem tillbaka som nyheter. Var de borta kortare än blinkfönstret (`minAwayMinutes`, samma
  tal som DB-vägen) lämnade varan aldrig hyllan. Utan regeln stämplas dessutom cooldown på hundratals
  URL:er, vilket kan TYSTA en äkta påfyllning i två timmar.
- ⛔ **En URL som var IN_STOCK, försvann och kommer tillbaka I LAGER efter blinkfönstret postas
  fortfarande** — för Speltrollet-liknande butiker är frånvaro ur kollektionen det ENDA
  slutsåld-beskedet. Ta inte bort den grenen "för att statusen inte ändrades".
- `pending`-mekanismen (andra chansen för okända URL:er) är BORTTAGEN: den fanns bara för att rutten
  var en grind, och är det inte längre. Äldre state-filers `pending` ignoreras.

## ⛔ PREORDER VAR ETT SVART HÅL (2026-08-16)
`actionableChanges` krävde att BÅDA statusarna var IN_STOCK/OUT_OF_STOCK, medan DB-vägens `isRestock`
med flit räknar **PREORDER → IN_STOCK** som en restock (tillagt 2026-07-25 sedan ägaren felsökt exakt
det symtomet — släppet är det mest värdefulla larmet av alla). Följden: den övergången kunde varken
väcka databasen eller synas i Discord-diffen, så ett släpp larmade bara om NÅGON ANNAN produkt råkade
flippa i samma körning. Villkoret är nu ordagrant `isRealStockTransition` — enbart UNKNOWN utesluts —
och `OUT_OF_STOCK → PREORDER` får ett eget besked (`RestockPost.preorder`, embed-texten fanns redan
men sattes aldrig). Kostnad: bara Webhallen-adaptern skriver PREORDER och statusen står still i
veckor (mätt 1 övergång på 14 dygn).

## ⛔ SVEPET ÄR BORTTAGET — VARJE BUTIK GÅR I SIN EGEN TAKT (2026-08-16)
Lanen var ett SVEP: alla butiker hämtades parallellt, och först när den LÅNGSAMMASTE svarat kördes
diffen och inläggen gick ut. **MÄTT i drift: svepet tog 36 s och sattes av Shinycards (35,9 s) och
Swepoke (35,0 s)** — en butik som svarade på 4 s fick alltså ~32 s ren väntan påklistrad på varje
larm, dygnet runt, för att två ANDRA butiker är långsamma. Ovanpå det låg ett tickintervall på 60 s.
Nu har varje butik en egen loop (hämta → diffa → posta → vänta ut sin takt) och väntar aldrig på
någon annan. **Uppmätt effekt för en CDN-butik: ~66 s snittlatens → ~20 s.**
- ⛔ **TAKTEN VÄLJS INTE, DEN FALLER UT UR ETT ARTIGHETSTAK** (`src/lib/restock-poll-interval.ts`).
  Den gamla indelningen var per PLATTFORM ("Shopify varje tick, egna servrar varannan"), som om alla
  feedar kostade lika mycket att hämta. De gör inte det — MÄTT i drift kostar Pokexclusives feed
  **1** förfrågan och Rogerz **44**. Scriptet mäter förfrågningarna per hämtning (räknare i
  `scrapers/http.ts`) och sätter intervallet därefter: **en förfrågan per 2 s (CDN) respektive 3,5 s
  (egen server)**, golv 25/60 s, tak 240 s.
  ⛔ **KRAVET ÄR INTE "ingen butik får mer last än förut".** En enfrågas-feed lyfts med flit från
  60 s till golvet 25 s (2,4× fler förfrågningar) — det är hela poängen, och i absoluta tal är det
  fortfarande en förfrågan var 25:e sekund. Kravet är att **ingen butik får en högre ihållande takt
  än den TYNGSTA feeden i sin klass redan fick av den gamla fasta cadencen**: CDN 44/60 s = 0,73/s
  (taket är 0,50), egen server 37/120 s = 0,31/s (taket är 0,29). Den takten tålde butikerna
  bevisligen. Vaktat av `tests/unit/restock-poll-interval.test.ts` mot de UPPMÄTTA talen.
  Utfall (drift 2026-08-16, alla 42): Dragon's Lair 3 förfrågn. 60→25 s, Speltrollet 17 → 34 s,
  Webhallen 24 → 48 s, NordicTCG 3 → 60 s (var 120), Coolcard 5 → 60 s (var 120), CardGame 26 →
  91 s (var 120). De två tyngsta blir POLITARE: Rogerz 44 → 88 s, Swepoke 37 → 130 s — priset för
  att sluta låta dem sätta takten för alla 42.
  ⛔ Sänk inte `perRequestSeconds` "för att bli snabbare". Vill man ha snabbare svar på en lätt
  butik är GOLVET rätt spak.
- ⛔ **VÄRDNAMNET MÅSTE LUCKRAS UPP.** Källans registrerade `baseUrl` är inte alltid den värd
  adaptern hämtar från — Dragon's Lair står som `www.dragonslair.se` medan feeden ligger på
  `dragonslair.se`. En uppslagning på bara baseUrl-värden gav noll förfrågningar för dem, dvs
  mätningen SÅG ut att fungera och gjorde det inte. Matcha på både baseUrl och feedens egna URL:er.
- ⛔ **STARTA INTE ALLA BUTIKER SAMTIDIGT.** `politeFetch` fördröjer per VÄRD, så 42 parallella
  hämtningar mot 42 butiker är i sig artigt — men Shopify svarar 429 när för många av deras BUTIKER
  träffas från samma IP i samma ögonblick (ett dussin backoffar när svepet startade allt på en gång;
  samma symtom som täckningsrevisionen 2026-08-13). `DISCORD_RESTOCK_STAGGER_MS` (400 ms × index)
  sprider starten, och sedan driver butikerna isär av sig själva eftersom de går i olika takt.
- **GLAPPET MELLAN JOBB ÄR MÄTT**: dispatch → runner-tilldelning → checkout → cache-restore tog
  **~112 s, varav ~95 s är GitHubs egen kö** (bara ~17 s är vårt: checkout, node, cache). Det går
  inte att optimera bort, bara amorteras — loopbudgeten är därför 1200 s (~9 % blind tid mot ~17 %
  vid 9-minutersjobb), `timeout-minutes` 25. ⛔ Glappet KOSTAR INGA LARM, bara latens: nästa jobb
  diffar mot samma state och hittar övergången.
  ⚠️ Med 20-minutersjobb ger 2-minuterspingen ~10 avbrutna körningar per jobb. Pingern får gärna
  sättas till var 5:e minut — samma latens, renare historik, självläker fortfarande inom fem minuter.
- **`--dry-run`** kör hela kedjan utan att posta och utan bot-token (egen state-fil via
  `DISCORD_RESTOCK_STATE_FILE`). Enda vägen att prova en ändring var annars att deploya den och se om
  kanalerna fylldes med fel saker — och felet i den här lanen är alltid tyst åt något håll.

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
