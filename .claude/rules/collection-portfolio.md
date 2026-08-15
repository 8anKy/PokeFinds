---
paths:
  - "src/lib/collection-lots.ts"
  - "src/lib/purchase-price.ts"
  - "src/services/collection.ts"
  - "src/app/samling/**"
---
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
- **Samlingsvärde**: live via `computeCollectionValue`/`valueCollectionItems` (`src/services/collection.ts`) → `getCardValues`/`getProductValues` (`src/services/products.ts`) = produktens lägsta pris (singel = CM-trend, sealed = butik) × live-kurs. Faller tillbaka på lagrat `estimatedValue` (ögonblicksbild vid tillägg) när live saknas. Skannade kandidater visar samma värde via `estimateCardValue`
