---
paths:
  - "src/services/alerts.ts"
  - "src/services/notifications.ts"
  - "src/lib/watched-sets.ts"
  - "src/jobs/sealed-set-label.ts"
  - "src/app/api/push/**"
---
# Larm och set-bevakning

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
