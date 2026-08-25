---
paths:
  - "src/lib/matching.ts"
  - "src/lib/same-product.ts"
  - "src/lib/listing-*.ts"
  - "src/lib/gtin.ts"
  - "src/lib/import-denylist.ts"
  - "src/lib/product-category.ts"
  - "src/scrapers/runner.ts"
  - "src/scrapers/listing-category.ts"
  - "src/scrapers/gtin-source.ts"
  - "src/jobs/dedupe-stubs.ts"
  - "scripts/diagnose-listing-match.ts"
  - "scripts/measure-guard-changes.ts"
  - "scripts/backfill-gtin.ts"
---
# Matchning, auto-import och kategorivakter

- **⛔ ADJEKTIVET KRÄVER SITT SUBSTANTIV — "PROTECTIVE CASE" ÄR PLAST, "PROTECTIVE ORB" ÄR ETT KORT
  (2026-08-16)**: `PROTECTOR_SIGNS` kände `protector(s)` men inte adjektivet, så Hobbykorts fem
  "Pokémon **Protective** Case – Booster Box / Elite Trainer Box / Mini Tin Display" passerade HELA
  vaktkedjan — formordet "Booster Box" gav dem till och med en giltig kategori. De kunde alltså både
  bli katalogprodukter och postas som restock-larm i Discord.
  ⛔ **Bart `\bprotective\b` är FÖRBJUDET.** Delta-mätning mot prod (`scripts/measure-protective-guard.ts`):
  "Protective Goggles · 151 164/165" och "Protective Orb · Unseen Forces 90/115" är riktiga
  trainer-KORT — 4 katalograder och 9 offers — och vakten sitter också i `productsConflict`, där en
  falsk träff blockerar en korrekt butikslänk TYST. Regeln kräver därför substantivet
  (`case|sleeve|box|cover|holder|film|fodral|hylsa`). Utfall: **0 katalogträffar, 0 bundna
  huvudboksrader, 6 träffar — alla Hobbykorts skyddsplast.** Samma familj som bart "accessory", bart
  "display" och bart "figure". Vaktat av `tests/unit/protective-case-guard.test.ts`.

- **⛔ ETT SEALED-FORMORD KAN VETA MERCH-VAKTEN — MÄRKET ÄR DÅ ENDA UTVÄGEN (2026-08-16)**: 28 Re-Ment-
  dioramor låg i katalogen som COLLECTION_BOX med Speltrollet-länkar, dvs de kunde larma restock i
  Discords Pokémon-kanaler. Ingen ordbaserad merch-regel hade kunnat stoppa dem: varenda Re-Ment-titel
  heter "… **Figure Collection** …", och den frasen står i `SEALED_FORM_WORD` eftersom Pokémons EGEN
  "Shining Legends Figure Collection" är en riktig SKU med boosters i (mätt 2026-08-15: 8 katalog-
  produkter, 24 butikslänkar). Sealed-ordet vetade alltså merch-vakten, tyst, för varje ny produkt.
  `NON_TCG_BRAND` (`matching.ts`) prövas därför **FÖRE** `SEALED_FORM_WORD` — märket säger VEM som
  tillverkat varan, inte vad förpackningen kallas. ⛔ Vänds ordningen om är vakten verkningslös igen och
  felet syns inte; produkterna importeras bara vidare som vanliga sealed-varor. Vaktat av
  `tests/unit/merch-brand-guard.test.ts`, som också kräver att Pokémons egna Figure-/Pin-/Poster
  Collection-SKU:er ÖVERLEVER.
  ⚠️ **Lägg bara till märken som ALDRIG gör TCG-varor.** Ett märke som gör både (Pokémon Center) hör
  inte hemma där — då fälls riktiga SKU:er tyst.
  ⛔ **MÄT DELTAT AV REGELN, INTE HELA VAKTEN.** `isMerchandiseListing` fäller redan i dag singlar som
  "Rare Candy" och "Puzzle of Time" via `MERCHANDISE_SIGNS` — men de når aldrig merch-vakten, eftersom
  `isSingleCardListing` fäller dem först i `ensureListingProduct`. En mätning av HELA funktionen mot
  HELA katalogen visar därför ett tjugotal "falsklarm" som varken är nya eller verkliga, och man
  förkastar en korrekt regel. Delta-mätningen var ren: 28/28 på båda facit (katalogens sealed 1 960
  rader, huvudbokens accepterade annonser 459), noll som inte var Re-Ment.
  ⛔ **MERCH RADERAS, RIKTIGA SKU:er GÖMS.** Ägarbeslut 2026-08-16: merch ska inte finnas i katalogen
  alls och ska aldrig kunna komma tillbaka ⇒ radering + denylist (och nu även märkesvakten, som är det
  som gör "aldrig" sant — en denylist täcker bara de URL:er som RÅKAR finnas i dag, och en 28:e
  Re-Ment-produkt fanns redan utanför ägarens lista). Se `catalog-curation.md` för gömningsvägen.

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
- **Auto-import av sealed butiks-SKU:er = LIVE (2026-07-05)**: restock-skanningen skapar/länkar nu automatiskt en katalogprodukt
  för varje sealed butiks-URL utan Offer (`ensureListingProduct()`, dedup via `matchProduct`≥0.85 annars ny produkt). Nya sealed-
  produkter dyker alltså upp i appen utan manuell körning. **DUBBLETT-SKYDD (2026-07-07)**: (1) cross-produkt-URL-vakt — en
  butiks-URL som redan ägs av en produkt återanvänds, aldrig ny stub; (2) `cleanListingTitle()` (matching.ts) rensar butiksjunk
  ("MAX 1 per kund", "förhandsbokning", "(kopia)") innan matchning/namnsättning; (3) veckovis LLM-dedup (`src/jobs/dedupe-stubs.ts`,
  Haiku ~2 titlar/anrop, körs i store-health.yml) merge:ar stubbar som är samma SKU med annan butiksfrasering. Länk-revision =
  `scripts/audit-links.ts` (också veckovis, röd körning vid säkra fel).
- **DÖDA LÄNKAR AUTO-RENSAS EFTER "TVÅ RÖDA VECKOR" (ägarbeslut 2026-08-25)**: en butik som avlistar en vara tar bort
  produktsidan och släpper den ur feeden, men INGENTING städade Offer-raden — den rapporterades som död varje måndag och
  backloggen växte till 161 rader (varav ~149 äkta 404). `audit-links.ts --prune` raderar en rad först när **TVÅ oberoende,
  MÄTTA signaler** pekar åt samma håll: (1) raden har fallit ur butikens feed, `lastSeenAt` > 7 dygn, OCH (2) sidan svarar
  verifierat 404/410 vid en FÄRSK hämtning i samma körning. Ingen av dem tolkas — frånvaro ur feeden KOLLAS (samma doktrin som
  `scraping-restock.md`). Det ger två veckors fördröjning utan ny tabell, migration eller en enda extra DB-skrivning per körning.
  Regeln bor i `src/lib/link-audit-policy.ts` med tester; rensningen loggar VARJE rad plus de produkter som blir helt utan
  butikslänk. ⛔ **EN AVVISAD LÄNK (401/403/407/451) RENSAS ALDRIG** — se `isStoreRefusal`; det var precis den förväxlingen som
  la nio friska Leksaksaffären-länkar först i rensningskön. ⛔ **INGEN DENYLIST**: en 404-URL som lämnat feeden kan inte
  återskapas av auto-importen, och kommer varan tillbaka SKA länken återskapas.
