---
paths:
  - "src/lib/print-variant*"
  - "src/lib/marketplace-urls*"
  - "src/jobs/cardmarket-refresh*"
  - "src/jobs/hot-card-refresh*"
  - "scripts/split-base-printings*"
  - "scripts/fix-cm-firsted-links*"
  - "scripts/print-variant-audit*"
  - "scripts/repair-single-prices*"
  - "scripts/repair-marketplace-offers*"
---

# Base/WOTC-tryckningar — Unlimited/Shadowless/1st Edition (flyttad verbatim från CLAUDE.md 2026-08-12)

Innehållet nedan är flyttat oförändrat. Ändra reglerna HÄR — CLAUDE.md pekar hit.

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
