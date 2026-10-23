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

> ⛔ **ÄNDRAT 2026-10-12 (ägarbeslut) — läs före "golvet rakt av" nedan.**
> 1. **UTROPSVAKTEN**: en From > `FROM_ASK_MULT` (4) × det HÖGSTA av alla försäljningssnitt (feedens
>    30d/7d + guidens trend/avg/avg1/avg7/avg30) fälls och ersätts av samma uppskattning som när From
>    saknas (OUT_OF_STOCK ⇒ "Uppskattat värde"). Kräver ≥ 2 snitt; guiden kan bara göra det SVÅRARE att
>    fälla (max). Tryckningar (1st Ed/Shadowless) dömas inte. Gäller EN (`singlesHeadlineEur`) och JP
>    (`jpFromEur`). Utlöst av Vulpix (JP) 11 170 000 kr (1 000 000 €-annons, 30d 33 €); mätt: 186 av
>    19 489 EN-singlar > 4x. Rayquaza ★ 37 000 € (6x) fälls nu — det är avsiktligt.
> 2. **SEALED: GUIDENS `low` ÄR ALDRIG ENGELSK FROM** (den är lägsta på ALLA språk): Prismatic Evolutions
>    Booster Bundle stod i 39,99 € (italiensk annons) mot engelsk 85 €. (a) NAMNBRYGGAN
>    `apiRowByCatalogName`: vårt idProduct saknas i RapidAPI men en rad med EXAKT samma CM-katalognamn
>    finns under ett annat id ⇒ radens engelska `lowest`. (b) Guide-fallbacken (`englishGuideFallbackEur`)
>    och RapidAPI-rader utan `lowest` ger en UPPSKATTNING på trenden; guidens golv är bara en signal till
>    tunndata-vakten.

> ⛔ **ÄNDRAT 2026-10-15 (ägaren: "priserna skiljer sig från vårt API", "bara Cardmarket")**:
> 3. **UTROPSVAKTEN KRÄVER ATT ÄVEN DE ANDRA SPRÅKEN MOTSÄGER FROM**: snitten är alla språk/skick,
>    så vakten fällde äkta engelska premier (Gardevoir LV.X SW: From 480 € mot snitt ≤ 98 € ⇒
>    "uppskattat" 865 kr). En From som ett annat språks EGET NM-golv i feeden
>    (`lowest_near_mint_DE/FR/ES/IT`, `cmLangFroms`) bekräftar inom `FROM_LANG_CORROBORATE` (1,5x)
>    står kvar; utrop utan bekräftelse (9 001 € Mewtwo) fälls som förut. JP har inga andra språk ⇒
>    oförändrad (363 JP-uppskattningar 10-15 är tunna vintagemarknader, ägarens 10-12-regel).
> 4. **CARDTRADER PRISSÄTTER INTE KORT SOM HAR ETT CM-PRIS**: `cardtrader-reverse` skriver ingen
>    offer/grafpunkt på det ordinarie kortet, produktsidan ritar inte CT-linjen där CM har pris,
>    18 421 offers raderade (`scripts/remove-cardtrader-base-offers.ts`). Bollvarianterna prissätts
>    ur CM:s egna bollprodukter (`import-cm-only-singles.ts`, ball-reverse hoppar över dem).
>    CT kvar BARA där CM saknar NM-pris: Reverse Holo (CM har ingen egen produkt, guidens `-holo`
>    är alla språk/skick) och 1st Edition utanför Base.
> 5. **EPISODENS SET UR RÖSTER**: en omatchad feed-rad får en andra chans på setkods-tolerant nummer +
>    namn i det set episodens matchade rader pekar på (`episodeSetFromVotes`, ≥ 3 röster, ≥ 80 %).
>    SVP 166–195 hade stått stilla sedan 2026-06-13 ("SV Black Star Promos" ≠ vårt setnamn, "SVP 173" ≠ "173").

> ⛔ **ÄNDRAT 2026-10-16 (ägaren: "många kort visar uppskattat fast de har ett NM-pris", frågat och besvarat)**:
> 6. **UTROPSVAKTEN = 10x OCH ETT GLAPP > 25 €** (`FROM_ASK_MULT` 10, `FROM_ASK_MIN_GAP_EUR`). MÄTT mot
>    leverantören samma dag (1 537 uppskattade kort, ett anrop per kort): 4x fällde en ÄKTA NM-From på 446
>    synliga kort (110 EN, 336 JP) — snitten är alla skick (JP: även koreanska kopior), och en NM-premie på
>    vintage ligger ofta 4–8x över dem. Alla troll-utrop ligger långt över 10x (Jigglypuff 9 001 € = 404x,
>    Shaymin LV.X 9 999 € = 136x, Mewtwo ex 8 999 € = 32x). Ett glapp ≤ 25 € är den billigaste NM-annonsen,
>    aldrig ett utrop värt att dölja (Growlithe JP 2,99 € mot snitt 0,50 €). Resten av de uppskattade (EN 280,
>    JP 771) saknar NM-From helt hos leverantören — där ÄR uppskattningen rätt svar. CM-only-korten (398)
>    fälls av sin egen vakt (`cmOnlyGuidePrice`: guidens `low` långt under affärerna = annat skick/språk).
>    ⚠️ "Uppskattat" kan flippa mellan nätter: From är den billigaste annonsen JUST DÅ (Mew R/RGB stod i
>    4 100 € på eftermiddagen men var en uppskattning vid nattkörningen).

> ⛔ **ÄNDRAT 2026-10-21 (ägaren: "många varor och kort har uppskattat fast API:t har rätt pris")**:
> 7. **SEALED-TAKET = 3x TRENDEN, OCH HISTORIKEN ÖVERRÖSTAR ALDRIG EN GODKÄND FROM**. MÄTT samma dag:
>    singlarnas uppskattningar var äkta (EN 267 + JP ~960 saknar NM-From hos leverantören, 19 fällda
>    utrop à 9 001 €, 57 Prize Pack utan engelsk NM-annons, 26 bollvarianter, 396 CM-only). Felet satt
>    i SEALED: 143 av 475 uppskattade EN-sealed hade en engelsk `lowest` i RapidAPI — 115 föll på
>    1,8x-taket mot trenden (alla språk ⇒ den engelska premien fälldes), 23 på HISTORIK-VAKTEN, som
>    var en spärrhake (historiken är vår egen output: Temporal Forces Booster Bundle låst på 485 kr mot
>    From 82,99 €, en Garchomp & Giratina-tin på 110 300 kr = ett 10 000 €-utrop som en gång slank in),
>    4 på likvid-vakten fast andra språk låg på samma nivå. JP-sealed: 58 på samma 1,8x-tak i guiden.
>    Regler: (a) `sealedPremiumFromOk` — en From över trenden godkänns upp till `SEALED_FROM_ASK_MULT`
>    (3) × guidens TREND för vårt idProduct (EN + JP). ⛔ Inte guidens `avg` (spretar på vintage: Call of
>    Legends avg 1 900 € mot trend 475 €), aldrig RapidAPI:s 30d (en fel-länkad rad bär sitt eget snitt).
>    (b) Godkänd From ⇒ ingen historik-överröstning; en UPPSKATTNING får historiken bara när guidens trend
>    och snitt är oense (Skyridge). (c) Likvid-vakten fäller inte en låg From som ett annat språks golv
>    bekräftar (≤ 1,5x). (d) En From godkänd över trenden är sitt eget facit i dagvakten (annars hade
>    3x-klämman hållit gårdagens uppskattning för alltid). Utfall i torrkörning: 104 av 143 EN + ~58 JP.

> ⛔ **ÄNDRAT 2026-10-23 (ägarens plan 10-22, verifierat samma dag)**:
> 8. **REVERSE HOLO = LEVERANTÖRENS `include_variants`, CARDTRADER ÄR RESERVEN** (ersätter "CT kvar
>    för Reverse Holo" i punkt 4). Episodsidorna hämtas med `&include_variants=1` (ingen extra kvot) och
>    `variants[type=reverse_holo].prices.cardmarket.lowest_near_mint` är CM:s ENGELSKA NM-golv för reverse
>    — verifierat mot CM:s egna sidor filtrerade engelska+NM+reverse: Charizard SW 3 200,00 € (feed 200),
>    Eevee UF 55 174,90 € (feed 174,90). ⛔ Inte guidens `-holo` (alla språk/skick: 8,99 resp. 5,79 €).
>    Talet skrivs som CM-offer på reverse-produkten (`src/lib/tcggo-reverse.ts`, block "REVERSE HOLO UR
>    LEVERANTÖREN" i cardmarket-refresh), länk = samma idProduct + `isReverseHolo=Y` (filtret är INTE
>    klistrigt i sessionen, kontrollerat). CT-offern på samma produkt raderas, och `cardtrader-reverse`
>    hoppar över produkter med en levande CM-offer (≤ 3 d). Saknar leverantören värdet (mätt 10-21: null
>    på 4 av 7 vintagekort) raderas CM-offern på en HEL körning och CT tar över vid sin nästa körning.
>    Ny reverse-produkt skapas bara för Common/Uncommon/Rare/Rare Holo i set som redan har reverse holos
>    (`mayCreateReverseProduct` — en felmärkt annons får inte föda en fantomvara). Blocket ligger UTANFÖR
>    haveribrytaren: första natten byter tusentals produkter källa. 1st Edition utanför Base: CT oförändrat.

> 9. **MÖNSTER-REVERSE I SPECIALSETEN (2026-10-23)**: Ascended Heroes (EN) och MEGA Dream ex (JP) har per kort
>    ett Energy-mönster (= vår "Reverse Holo") och ETT boll-/Rocket-mönster (Poké/Quick/Love/Friend/Dusk Ball,
>    Rocket — etiketterna i `REVERSE_VARIANT_LABELS`), var och en en EGEN CM-produkt. CT:s expansion bär bara
>    familjen; mönstret står i blueprintens version (`patternExpansion`). `import-cm-only-singles.ts` skapar
>    variantprodukten på vårt kort (eller länkar en befintlig) med CM-offer ur prisguiden; nattligt `--refresh`
>    prissätter dem. ⛔ Reverse-blockets städning tar bara bort CM-länkar med `isReverseHolo=` (leverantörens
>    egna) — Energy-mönstrets egen produkt hade annars raderats varje natt. ⛔ Variantvakten i matcharen gäller
>    bara SINGLAR (`card === null` ⇒ hoppa): "Poké Ball Tin"/"Love Ball Tin" är förseglade namn.

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
  ⛔ **BRICKAN SÄGER "UPPSKATTAT", ALDRIG "SLUT" (2026-10-05)**: OUT_OF_STOCK på en CM-offer betyder
  "priset är en uppskattning", inte "slutsåld" — feeden har ofta annonser (Snorlax VMAX SSH 206:
  `lowest_near_mint: null`, `available_items: 114`). DB-värdet behåller sin betydelse (rubrik, larm,
  värdering läser det); bara VISNINGEN översätts i `shownStockStatus` (`lib/offer-source.ts`): pris ⇒
  "Uppskattat", utan pris ⇒ ingen bricka. Rubriken är "Uppskattat värde ({källa})" utan påståendet
  "ingen aktiv annons". Mätt: 267 EN + 1 605 JP singlar.
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
