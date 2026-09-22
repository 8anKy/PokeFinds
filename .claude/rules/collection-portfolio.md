---
paths:
  - "src/lib/collection-lots.ts"
  - "src/lib/purchase-price.ts"
  - "src/services/collection.ts"
  - "src/app/samling/**"
  - "src/lib/set-denominator.ts"
  - "src/services/set-portfolio.ts"
  - "src/services/set-completion.ts"
  - "src/app/[locale]/(app)/samling/**"
  - "src/lib/portfolio-limit.ts"
  - "src/lib/portfolios-client.ts"
  - "src/services/portfolios.ts"
  - "src/app/api/portfolios/**"
  - "src/components/features/portfolio-*.tsx"
---
# Pärmar: EN samling, flera etiketter (2026-09-21)

- **EN PÄRM ÄR EN ETIKETT PÅ POSTEN, INTE EN EGEN SAMLING.** `Portfolio` (namn, `isPublic`, `isDefault`) +
  `CollectionItem.portfolioId`. Totalvärde på "Alla", set-komplettering, utmärkelser och veckobrevet räknar
  fortfarande över ALLA poster per `userId` — en privat pärm är fortfarande ens kort. Pärmen styr (1) vad
  `/samling` visar när den väljs (`?parm=<id>`: värde, graf, vinst, topplista och rutnät följer valet, set-fliken
  aldrig) och (2) om posterna syns på den publika profilen (`PortfolioPane` visar bara offentliga pärmar, en
  sektion per pärm; `ask-item` kräver att POSTENS pärm är offentlig).
- ⛔ **STANDARDPÄRMEN ÄR `portfolioId = NULL` PÅ POSTEN.** Raden med `isDefault` finns (kan döpas om och
  publiceras, aldrig raderas) men dess poster bär null. Därför fick inga skrivvägar (CSV-import, skanner-confirm,
  publikt API, seed) ändras och ingen backfill göras. `portfolioItemWhere()` / `portfolioIdForWrite()` i
  `lib/portfolio-limit.ts` är de ENDA översättningarna pärm ↔ where/skrivvärde. Radera en pärm ⇒ FK `SetNull` ⇒
  posterna faller tillbaka i standardpärmen, aldrig bort. `addCollectionItem` stackar bara inom SAMMA pärm.
- ⛔ **`User.isPublicCollection` ÄR EN SPEGEL** = "minst en pärm är offentlig", skriven av `syncUserPublicFlag`
  i `services/portfolios.ts`. Profilsidans `canSee`, adminens chip, GDPR-exporten och `PATCH /api/users/me`
  (native-klienter: slår om ALLA pärmar) läser den. Skriv den aldrig direkt.
- **TAK 1 GRATIS / 5 PRO (ägarbeslut 2026-09-21, inte 2/5)**: den andra pärmen är gratiskontots första
  organiserings-ögonblick = paywallen (403 + kod `PORTFOLIO_LIMIT` ⇒ `openPaywallOrNavigate`, källa
  `portfolio-limit`). En Pro som fallit till Free behåller sina pärmar och kan lägga kort i dem — bara NYA nekas.
  Talen står i `Pricing.specRows` på båda språken; `tests/unit/portfolio-limit.test.ts` vaktar. "+"-chipen visas
  ALLTID (även för gratis) — paywallen ska förklara, inte en saknad knapp.
- **VÄLJAREN**: `PortfolioChips` (samma chip-form som skick-chipsen) i skannerns granskningsvy ("Lägger till i"),
  snabbtilläggsarket (bara när kontot har > 1 pärm) och desktopformuläret (select). Senast valda pärm minns per
  enhet (`foilio:portfolio:last`); `lib/portfolios-client.ts` cachar listan 5 min och invalideras vid varje
  skrivning. Mobilens väljläge har "Flytta" (PATCH `portfolioId` per POST, null = standard).

# Samlingen: poster, inköpspris och värde

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
- ⛔ **SAMLINGSVÄRDE = CARDMARKET FÖRST, lägsta direkta offer bara som RESERV (ägarbeslut 2026-09-22).**
  Domen bor i `src/lib/market-value.ts` (`productMarketValue` + `pickCardValue`, rena + testade) och används av
  `getCardValues`/`getProductValues` (`src/services/products.ts`), som i sin tur driver
  `computeCollectionValue`/`valueCollectionItems` (`src/services/collection.ts`) OCH skannerns `estimateCardValue`.
  Faller tillbaka på lagrat `estimatedValue` när live saknas. ⛔ **Det här är INTE produktsidans rubrikpris och
  får aldrig bli det**: rubriken svarar "vad kostar den billigast just nu" (där ÄR en Tradera-annons svaret),
  värdet svarar "vad är min samling värd". **VARFÖR**: värdet togs förut av `computeLowestPrice` över ALLA
  källor — mätt mot prod 2026-09-22 värderades 397 singlar av CardTrader och 243 av Tradera, och på 380
  produkter fanns en CM-offer som inte var lägst (Brock's Rhydon · Gym Heroes: 67 kr Tradera mot CM 327 kr;
  30th Celebration ETB: 799 kr Goblinen mot CM 1 500 kr). Utfallet avgjordes av vilken marknadsplats som råkade
  vara billigast. Det förklarade också takten ägaren såg: värdet räknas live per request ur `Offer`, så varje
  butiksskrapning och Tradera-svep flyttade det — nu rör det sig med prisjobben (cardmarket-refresh 13:00,
  hot-card-refresh 21:00, jp-singles-refresh). ⛔ **CM-produkterna jämförs BARA med varandra** (`pickCardValue`)
  — "lägst av alla efter värdering" hade smugit tillbaka samma fel en nivå upp, via en syskonprodukt.
  ⛔ Reserven tas aldrig bort (nya set/JP utan CM-länk saknar CM-offer helt). Effekt vid påslaget: 505 av 3 002
  poster (16,8 %) bytte värde, totalvärdet över alla användare +12,3 %, 85 av 119 användare påverkade.


# Set-komplettering: TRE tal om ett set, och de blandas aldrig

Invarianterna bor i `src/lib/set-denominator.ts` — läs det filhuvudet först.

- **TRYCKT SET** = `CardSet.totalCards` = pokemontcg.io `printedTotal`. Talet på kortet ("12/84").
  ⛔ **ANVÄNDS ALDRIG SOM NÄMNARE.** 107 av 176 engelska set har secret rares ovanför det tryckta talet,
  och mot 84 blev en samlare med secret rares "120 av 84". Meningen är dessutom BÄRANDE på annat håll:
  skannern jämför numret den läst mot exakt den kolumnen och `cardNumberLabel` skriver ut den på varje
  produktkort. **Byt aldrig mening på `totalCards`** — lägg till en kolumn i stället, vilket är precis
  vad `totalCardsFull` är.
- **FULLT SET** = `max(totalCardsFull, vårt kortantal)`. Kompletteringens nämnare.
  ⛔ `max()`, inte "uppströms om det finns": mätt 2026-08-20 har SEX set FLER kort hos oss än
  pokemontcg.io:s `/sets.total` (sve +8, svp +4, sm10 +4, sm11 +1, smp +1, xy7 +1) — deras `total` är
  inaktuell för växande promo-/energiset. Åt andra hållet avslöjar `totalCardsFull` när VÅR lista är
  kortare (`catalogShort`), och då får UI:t aldrig säga "du äger alla kort".
- **MASTER SET** = antalet TRYCKNINGAR vi listar (`COUNT(DISTINCT (cardId, variantLabel))` över
  `SINGLE_CARD` med `hiddenAt IS NULL`).
  ⛔ **NÄMNAREN ÄR VÅR KATALOG, ALDRIG TCGdex `printingsTotal`.** Inte för att deras data är dålig, utan
  för att en nämnare användaren inte kan NÅ är en lögn om deras samling: äger man varenda tryckning vi
  säljer ska raden säga 100 %. TCGdex-talet används bara till noten "setet har 613 tryckningar — vi
  listar 333 av dem". Därför kan en lucka hos dem aldrig ge ett felaktigt PROCENTTAL hos oss.
  ⛔ Tryckningen bärs av `Product.variantLabel`, inte av `Card`. En samlingspost utan produkt (manuellt
  tillägg, CSV-import) räknas som den ORDINARIE tryckningen — att gissa en variant vore påhitt.

**0 betyder OKÄNT och returneras som `null`.** "0 av 0" och "0 %" är påståenden. De 95 japanska seten har
noll kort hos oss och får därför ingen stapel alls, hellre än en tom.

**SAMMA UTTRYCK I SQL SOM I JS.** Veckobrevet och achievement-svepet aggregerar över alla användare i råa
frågor och importerar `SET_FULL_TOTAL_SQL` från samma fil. Skriver man om det för hand säger mejlet ett tal
och set-fliken ett annat om samma set — och mejlet är det man tror på, för det kom först.

# Numeratorn läckte i sex månader (2026-08-20)

Poster som lagts till från en produktsida eller snabbtillägget bar bara `productId`; set-kompletteringen
frågar på `card: { setId }`. Mätt i prod: **196 poster hos 12 användare** räknades inte alls — stapeln på
`/sets/[id]` visade för lågt, tyst, för precis de användare som lägger till ur katalogen.
`addCollectionItem` fyller nu i `cardId` från produkten (i TJÄNSTEN, inte i klienterna, så native-appen och
det publika API:t täcks av samma fix).
⛔ **Den fixen KRÄVER att värderingen tar `productId` FÖRE `cardId`** (`valueCollectionItems`):
`getCardValues` undantar reverse-varianter med flit, så med kortet först börjar varje reverse-post värderas
som det ordinarie kortet i samma sekund som `cardId` fylls i. Bryt inte isär de två ändringarna.

# "Hit rates" / pull rates finns inte att visa ärligt

Utrett 2026-08-20. The Pokémon Company publicerar inga odds för fysiska boosters; den enda uppmätta källan
(TCGplayers per-set-artiklar) är varken maskinläsbar eller tillåten att återanvända och täcker ~20 av 174
set; de källor som har bred täckning skriver i sina EGNA förbehåll att talen är simulerade uppskattningar.
⛔ **Räkna aldrig `1 / (antal kort med sällsyntheten)`.** Det ser ut som odds och är meningslöst: paket sätts
samman från TRYCKARK, och "boostade" set (Prismatic Evolutions, Paldean Fates) är medvetet tätare och ser
identiska ut i en kortlista. Formeln vore mest fel exakt där användarna bryr sig mest.
Vi visar i stället `SetComposition` — setets faktiska sammansättning — med en SYNLIG rad som säger varför
inga dragodds visas. `tests/unit/set-composition.test.ts` har en regressionsspärr mot att någon lägger
tillbaka en oddsberäkning.
