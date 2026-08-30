---
paths:
  - "src/lib/jp-set-name*"
  - "src/jobs/jp-set-label*"
  - "src/jobs/cardmarket-refresh*"
  - "scripts/fetch-jp-set-logos*"
  - "scripts/label-jp-sets*"
  - "scripts/set-from-cm-episode*"
  - "scripts/import-sealed-from-cardmarket*"
  - "public/set-logos/jp/**"
---

# Japanska set — regler och gotchas (flyttade verbatim från CLAUDE.md 2026-08-12)

- ✅ **JAPANSKA SINGLAR SEDAN 2026-08-29** (`src/jobs/jp-singles-refresh.ts`, körs i
  `runCardmarketRefresh` efter JP-sealed; manuellt `scripts/run-jp-singles.ts`). Källa: RapidAPI:s
  **globala** `/pokemon-jp/cards` (278 sidor, ~280 anrop/dygn). ⛔ Per-set-endpointen
  `/pokemon-jp/episodes/{id}/cards` är TOM för 62 av 71 set — använd den aldrig. Mätt 2026-08-29:
  5 553 kort, 40 set kompletta, 7 partiella, **24 set utan kort hos leverantören** (nästan hela
  2021–2022: VSTAR Universe, VMAX Climax, Eevee Heroes …) — de kommer av sig själva när listan växer.
  Identitet `Card.tcgExternalId = "tcggo-jp:<id>"`; nya set `CardSet.externalId = "tcggo-jp:<episode>"`;
  befintliga JP-set matchas på KOD (`codeFromJpSetName`), sedan namn (33 + 5 av 46 vid importen).
  Namn = engelska + " (JP)" (ägarbeslut) — skannern föredrar då EN vid lika läsning och listar JP som
  val (`sameNameCards` söker båda formerna). ⛔ `cardmarket_id` är **0 %** ⇒ ingen produktsida:
  offern bär `cardmarketJpSearchUrl` (CM-sök, `language=7`), det ENDA sök-URL som får bära ett pris
  (undantag i `isDirectOfferUrl` + `DIRECT_URL_SQL`; knappen säger "Sök på Cardmarket"). Ägaren
  valde bort leverantörens `tcggo.com/external/cm/<id>`-redirect (tredjepart, Cloudflare-grindad).
  Länken uppgraderas automatiskt till `cardmarketJapaneseProductUrl` den dag `cardmarket_id` kommer.
  ⛔ EN-refreshen, hot-card och täckningsvakten filtrerar nu `language: "EN"` — JP-kort har också ett
  `tcgExternalId` och hade annars fått EN-offers. `totalCards`/`totalCardsFull` på JP-set fylls nu
  från leverantören (printed / total). Vaktat av `tests/unit/jp-singles.test.ts`.
- ✅ **DIREKTA CM-LÄNKAR UR GRATISKATALOGEN (2026-08-30)** — `scripts/link-jp-singles-to-cardmarket.ts`.
  `products_singles_6.json` bär `idExpansion`; inom en expansion är namnet det engelska kortnamnet och
  kort med SAMMA namn (vanlig/SAR/SIR) ligger i **id-ordning = nummerordning** (verifierat på riktiga
  CM-sidor: 719445→#003 V1, 719637→#184 V2). Regel: namngrupp + LIKA versionsantal + k:te id ↔ k:te
  nummer; ⛔ gissa aldrig vid olika antal. Utfall: **5 272 av 5 553** har `Card.cardmarketId` + riktig
  produktsida via `cardmarketJapaneseSingleUrl` (= `…&language=7&minCondition=2`, NM-filtret som EN).
  Kvar med söklänk (281): Mega Series Promos (~100, CM-expansionen hittades inte — kandidaten börjar
  på Bulbasaur, vår på Chikorita), VMAX Special Set (4; CM har 8 versioner), 118 med fler CM-versioner
  än vi har (S-erans holo-varianter), 59 med annat CM-namn (energier). Tre expansioner sattes för hand
  efter browserkontroll: Legendary Pulse=3384 ("Legendary Heartbeat"), Matchless Fighter=3751, SVP=5212.
  ⛔ Vårt `cardmarketId` VINNER över leverantörens (`cmIdDisagreements` loggas); luckor fylls av API:t.
- ✅ **Set-städning + titlar (2026-08-30)**: `scripts/sync-jp-sets-from-api.ts` — leverantörens
  `/pokemon-jp/episodes` HAR setlogotyper (19 hämtade till `public/set-logos/jp/`), koder in i namnen
  (Sword (S1W), Shield (S1H), VMAX Rising (S1a), Eevee Heroes (S6a), Blue Sky Stream (S7R), Fusion Arts
  (S8), S5L→S5I, 30th Celebration M6→M6A), serie ur kodprefix, 12 tomma skal-set (ID/TH, gem packs,
  McDonald's) raderade. ~20 SM-era-set (bara sealed) har fortfarande produktfoto — kräver manuell
  logotypgranskning (`fetch-jp-set-logos.ts`). **Produkttitlar utan setkod** ("Dusclops (JP) · Night
  Wanderer 19/64", `scripts/retitle-jp-singles.ts`) — koden bor på setet, inte i titeln.
  Katalogen visar bara prissatta singlar: 3 984 av 5 553 JP-singlar syns i bläddringen, resten
  nås via set/skanner/URL tills CM får en japansk annons. JP-kort har konstavtryck (skannern).

- ✅ **MASTER BALL / POKÉ BALL PÅ JP-SINGLAR (2026-08-30)**: leverantören (TCGGO) har INGA
  bollvarianter — en rad per nummer, ingen rarity/flagga. Källan är CardTrader, som har egna
  JP-expansioner med japanska annonser ("Pokémon Card 151 - Master Ball Reverse Holo", "White Flare |
  sv11W - Poké Ball Reverse Holo" …). `matchJpBallExpansions` (`lib/cardtrader.ts`): kodformen
  `<namn> | <kod>` vinner; bart namn bara när CT-prefixet saknar `|` OCH inget EN-set heter så
  (⛔ annars hade "Black Bolt (SV11B)" tagit den ENGELSKA expansionen). Annonser filtreras med
  `isBuyableNmListing(l, "jp")`, offern skrivs `language: "JP"`. Utfall: **526 produkter** (151: 135 MB
  + 152 PB, Terastal Festival: 100 + 139); Black Bolt/White Flare JP matchar men har 0 kort hos
  leverantören ännu. ⛔ "Ball & Rocket" (MEGA Dream ex) tas inte — två mönster i en etikett. ⛔ Alla
  `products`-uppslag per JP-kort MÅSTE filtrera `variantLabel: null` (jp-singles-refresh, link-jp) —
  `take: 1` kunde annars ta bollprodukten och skriva över dess titel. Vaktat i `cardtrader.test.ts`.

Innehållet nedan är flyttat oförändrat. Ändra reglerna HÄR — CLAUDE.md pekar hit.

- **JAPANSKA SET KOMMER FRÅN CARDMARKETS EXPANSIONER (2026-08-07)**: katalogens set kommer från
  pokemontcg.io, som BARA har engelska set — alla 100 japanska produkter hade därför `setId = null` och
  japanska set gick inte att filtrera på. ⛔ **TCGGO stänger inte hålet**: episodlistan är 175 västerländska
  expansioner och `?language=japanese` ignoreras TYST (identiskt svar) — mätt 2026-08-07. Källan är i stället
  CM:s publika sealed-katalog (`products_nonsingles_6.json`), som JP-prisrefreshen redan laddar ner varje dag:
  varje produkt bär `idExpansion`, och CM namnger dem i LATINSK skrift ("Black Bolt JP Booster Box"). Setnamnet
  härleds ur det (`deriveJpSetName`, `src/lib/jp-set-name.ts`) och identiteten är `CardSet.cmExpansionId` —
  ingen titelmatchning i något led. 49 set, 96 av 100 produkter etiketterade. Jobbet (`jp-set-label.ts`) körs
  sist i `runJapaneseSealedRefresh` där katalogen redan ligger i minnet ⇒ noll extra hämtningar, ny japansk
  förhandsbox syns inom ett dygn. ⛔ **Namnet får ALDRIG komma från TCGdex**: deras japanska namn är japansk
  skrift OCH mätbart fel på minst ett set (`SV4a` bär Raging Surfs namn men Shiny Treasures datum). TCGdex ger
  bara SLÄPPDATUMET, och bara när koden är styrkt: butikstitelns egen setkod ("- sv6", "(s6K)") räknas som
  bevis (tillverkarens identifierare, samma logik som GTIN), medan tabellförslaget `JP_CODE_BY_NAME` måste
  klara datumfönstret -6..+71 dygn mot CM:s `dateAdded` (kalibrerat på de 39 set vars kod stod i titeln).
  25th Anniversary föll utanför (118 d) och står därför utan datum, sist i listan.
  ⛔ **VARJE NAMNBASERAT SETUPPSLAG MÅSTE FILTRERA PÅ `language`.** JP och EN delar latinska setnamn
  ("Black Bolt", "White Flare", "151"), och `import-tcg-data.ts` adopterar befintliga set PÅ NAMN när
  pokemontcg.io publicerar dem. Utan grinden hade den engelska importen svalt det japanska setet och tagit
  med sig dess produkter. Grindade: import-tcg-data (adoption), sealed-set-label, cardmarket-refresh
  (`setsByName`), import-sealed-from-cardmarket, set-from-cm-episode.
  ⛔ **`totalCards` är 0 på japanska set.** TCGdex vet att SV11B har 174 kort, men vi har inga japanska
  singlar — setsidan skriver ut talet rakt av och hade lovat kort som inte finns hos oss.
  **SERIE + BILD (2026-08-07)**: JP-fliken grupperas på SERIE precis som den engelska — serien kommer från
  TCGdex:s `serie.id` på den STYRKTA koden och skrivs med den latinska eran (`JP_SERIES_BY_TCGDEX_ID`:
  SV → "Scarlet & Violet" osv), samma skrivning som de engelska seten, så rubrikerna läser likadant i båda
  flikarna. Utfall: Mega Evolution 7 · Scarlet & Violet 25 · Sword & Shield 13 · Sun & Moon 3 · **Other 1**
  (25th Anniversary, vars kod aldrig styrktes). ⛔ Ingen era gissas: utan styrkt kod blir det "Other", som
  sorteras sist av sig själv (releaseDate nulls last).
  **SETLOGOTYPERNA ÄR HÄMTADE EN GÅNG OCH LIGGER I REPOT (2026-08-07)**: `public/set-logos/jp/{KOD}.png`,
  49 filer, 2,9 MB. INGEN leverantör publicerar japanska setlogotyper — TCGdex har 0 av 177
  (`assets.tcgdex.net/.../logo.png` = 404), TCGGO:s japanska endpoint svarar med tom lista, CardTrader har
  expansionerna men ingen bild, och den OFFICIELLA japanska sajten har bara 21 av våra 49 set, med bespoke
  hashade filnamn per sida (`hero-img-01-y25ri.png`) som inte går att härleda. Filerna hämtades därför en
  gång med `scripts/fetch-jp-set-logos.ts` och bor hos oss: ingen annans CDN belastas per sidvisning, och
  bilderna kan inte försvinna under oss. ⚠️ Artwork tillhör The Pokémon Company (samma sak som kortbilderna
  och de engelska setlogotyperna vi redan visar). Nya set får produktbilden tills någon kör skriptet igen.
  ⛔ **MATCHA ALDRIG LOGOTYP MOT SET PÅ NAMN.** Samma japanska set översätts olika av olika källor: ムニキスゼロ
  är "Nihil Zero" hos Cardmarket (vår skrivning) och "Munikis Zero" hos logotypkällan, 摩天パーフェクト är
  "Towering Perfection" respektive "Perfect Skyscraper", SM10b är "Sky Legend" respektive "Sky Legends" —
  7 av 49 föll på det. ⛔ Och KODEN duger inte heller ensam: källan märker "Future Flash" som SV4K, vilket är
  Ancient Roars kod, och "Lost Abyss" som S12, vilket är Paradigm Trigger. Automatiken kräver därför att
  BÅDA är ense (39 av 49); resten är granskade för hand genom att LÄSA den japanska ordbilden i logotypen och
  jämföra med TCGdex japanska namn (tabellen `VERIFIED` i skriptet, med det verifierade namnet per rad).
  Granskningen fångade en riktig förväxling: SV4K/SV4M var omkastade i källan, så utan den hade ett set fått
  fel logotyp och det andra ingen alls.
  **FALLBACK**: `pickJpSetImage` (BOOSTER_PACK före BOOSTER_BOX, CM-render före butiksfoto) används bara när
  ingen logotypfil finns — en japansk boosterpåse bär ändå setets logotyp på omslaget.
  ⛔ Filnamnet härleds av `jpSetLogoFileKey` — EN definition delad av skriptet och jobbet, annars slutar
  filerna hittas tyst den dag den ena sidan ändrar sin namngivning.
  **SJÄLVLÄKNING**: `refreshJpSetMetadata` fyller bara TOMMA fält och kör i varje jobbkörning — ett set skapas
  i samma andetag som sin första produkt och kan sakna bild då. ⛔ "Serien saknas" är formulerat som en MÄNGD
  (`series notIn [kända eror, "Other"]`), inte som en jämförelse mot den gamla platshållaren "Japanska set" —
  annars hade en legacy-sträng behövt leva i koden för alltid. Och utfallet skrivs även när det blir "Other",
  annars frågas TCGdex om samma set vid varje körning i evighet.
  **UI**: flikarna Engelska/Japanska i set-arket (visas bara när japanska set finns), desktopens `<select>`
  har en `optgroup` "Japanska" (platt där, precis som EN-listan i samma kontroll). `/sets`-galleriet är
  ENGELSKT tills vidare (JP-set har inga kortrader). Backfill/granskning = `scripts/label-jp-sets.ts`
  (torrkörning default, `--apply`).
  ⛔ **LLM-DOMAREN AVVISADE VARJE KORREKT JP-PAR (rättat 2026-08-07)**: `judgeSameProduct`s systemprompt
  säger — riktigt i allmänhet — att "japansk ≠ engelsk utgåva är ALLTID olika produkter". Men Cardmarket
  skriver ALDRIG ut språket i namnet på en japansk expansion, medan våra butikstitlar alltid gör det
  ("(Japansk)"). Domaren läste den saknade markören i B som en konkret motsägelse och svarade same=false på
  VARJE par: "VMAX Climax Booster" (sim 1,00!), "Storm Emeralda Booster Box" (0,91), "Jet Black Spirit
  Booster Box" (0,82). Följden: INGEN ny japansk SKU kunde någonsin auto-mappas — fyra produkter satt utan
  pris och utan set, och Storm Emeralda-setet fanns inte alls. Ledtråden säger nu uttryckligen att frånvaron
  av språkmarkör i B inte är ett bevis. ⛔ Men den fick inte göra domaren slapp: mätt på 9 kontrollfall
  (4 rätta par + 5 fällor) blev det först 7/9 — "Booster Box CASE" (en låda MED FLERA lådor) godkändes som
  "Booster Box". Den regeln ligger nu i SYSTEMprompten (gäller alla anropare) och kontrollen står på 8/9.
  Kvarvarande miss: internationella "151" mot japanska. Skyddet mot DEN är strukturellt och sitter ovanför
  domaren — `ownedBy` filtrerar bort varje idProduct som redan ägs, och vår engelska katalog är komplett,
  så CM:s internationella produkter når aldrig fram som JP-kandidater. **Domaren är andra linjen.**
  **KODEN KAN KOMMA FRÅN CARDTRADER (2026-08-07)**: ett japanskt set finns hos CM långt före TCGdex — Storm
  Emeralda låg i CM:s katalog 2026-07-02 medan TCGdex fortfarande slutade på M5, och butikstitlarna bar
  ingen kod. Setet skapades därför utan kod, era och datum. `cardTraderCode()` slår upp koden i CardTraders
  expansionslista (M6 ✓) och skriver in den i namnet, så TCGdex-uppslaget kan lyckas SENARE:
  `refreshJpSetMetadata` plockar upp varje datumlöst set igen, och "Other" uppgraderas till rätt era när
  TCGdex hunnit ikapp. ⛔ **Filtrera på `game_id === 5`** — listan spänner över alla spel CardTrader säljer,
  och "25th Anniversary" matchade en YU-GI-OH!-expansion (torrkörningen visade "25th Anniversary (25THYUG)").
  ⛔ Kräv ETT entydigt namn: CT listar både "Black Bolt | sv11B" (japanska) och "Black Bolt" (`blk`,
  internationella).
  **TVÅ TABELLER MED OLIKA BEVISKRAV** (`jp-set-name.ts`): `JP_CODE_BY_NAME` är FÖRSLAG som måste klara
  datumfönstret, medan `JP_CODE_VERIFIED` är koder kontrollerade mot setets EGEN ordbild (logotypen läst mot
  TCGdex japanska namn) och används utan datumprövning. 25th Anniversary hörde hemma i den senare: tre
  källor sa S8a (TCGdex-namnet 25thアニバーサリーコレクション, logotypens ordbild, logotypkällans `[S8A]`) men
  datumfönstret förkastade den för att CM la in produkterna 118 dygn före släppet. ⛔ Lägg aldrig en
  okontrollerad rad i `JP_CODE_VERIFIED` — "verkar rimligt" hör hemma bland förslagen.
  ⚠️ Läge 2026-08-07: 100 av 100 JP-produkter har set, 50 set, alla med logotyp. Serier: Scarlet & Violet 25,
  Sword & Shield 14, Mega Evolution 7, Sun & Moon 3, Other 1. Enda datumlösa: **Storm Emeralda (M6)** —
  TCGdex slutar på M5, så eran och datumet fylls i av sig själva när de publicerar M6.
