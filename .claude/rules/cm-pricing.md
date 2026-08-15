---
paths:
  - "src/jobs/cardmarket-refresh*"
  - "src/jobs/hot-card-refresh*"
  - "src/lib/offer-source*"
  - "src/lib/exchange-rate*"
  - "scripts/rapidapi-*"
  - "scripts/frozen-cm-report*"
  - "scripts/recover-cm-idproduct*"
  - "scripts/cm-range-audit*"
  - "scripts/repair-single-prices*"
  - "scripts/revert-guide-median-prices*"
  - "scripts/purge-zero-prices*"
  - "scripts/verify-cm-single-links*"
  - "scripts/resolve-cm-urls*"
---

# Cardmarket-prispolicy för singlar (flyttad verbatim från CLAUDE.md 2026-08-12)

Innehållet nedan är flyttat oförändrat. Ändra reglerna HÄR — CLAUDE.md pekar hit.

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

## Leverantörsläget (survey 2026-08-02)
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

## Singel-länkar = CardTrader-verifierade idProduct
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
