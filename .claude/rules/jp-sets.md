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
