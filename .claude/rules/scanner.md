---
paths:
  - "src/services/scanner/**"
  - "src/app/**/skanna/**"
  - "src/lib/art-fingerprint*"
  - "src/lib/camera-controls*"
  - "src/hooks/use-camera-controls*"
  - "src/lib/scan-alternatives*"
  - "scripts/art-audit/**"
  - "scripts/scanner-*"
  - "scripts/build-art-fingerprints*"
---

# Skannern — bildmatchning, kandidater, kamera, lägen, kvot (flyttad verbatim från CLAUDE.md 2026-08-12)

Innehållet nedan är flyttat oförändrat. Ändra reglerna HÄR — CLAUDE.md pekar hit.

- **SKANNERN IDENTIFIERAR PÅ UTSEENDE, INTE PÅ TEXT (2026-07-29)**: samlarnumret trycks ~2 mm högt. På en fysisk
  kortbild går det att läsa; i en skärmfotografering eller ett suddigt foto FINNS informationen inte i bilden, och då
  kan ingen modell och ingen upplösning laga det — mätt i produktion svarade Haiku med kortets HP ("110", tryckt stort
  uppe till höger) och sedan med ett påhittat "172/167". `Card.artFingerprint` (264 byte = 8×11 celler × RGB, int8,
  `src/lib/art-fingerprint.ts`) matchar kortets FÄRGLAYOUT mot hela katalogen i stället.
  **MÄTT** (`scripts/art-audit/`, hela katalogen som referens = 20 431 bilder, 300 frågor försämrade som
  skärmfotograferingar): topp-15 **99,7 % mild / 96,0 % hård** försämring, topp-1 93,3 % / 86,0 %.
  ⛔ **FINARE RUTNÄT ÄR SÄMRE** — 24×33 (2 376 dim) ger 98,3 % mot 8×11:s 99,7 %, för självlikheten efter försämring
  faller 0,918 → 0,764: fin detalj överlever inte en dålig bild och bidrar med brus. Det är också skälet att INGET
  neuralt nät valdes (CLIP/DINOv2): deras styrka är finkorniga särdrag, och vi har MÄTT att finkorniga särdrag inte
  hjälper här. Höj inte rutnätet utan att köra om revisionen.
  **KOSTNADSFORMEN (ägarkrav: ingen stor Neon/Railway-träff)**: klienten räknar avtrycket i canvas och skickar **264
  byte UPP** — den laddar aldrig ner indexet (5,4 MB per besökare hade varit Railway-egress). Sökningen är en linjär
  genomgång i processminnet (`src/services/scanner/art-index.ts`), indexet hålls som **int8 (5,4 MB), inte float32
  (21,6 MB)** eftersom minne är ~92 % av Railway-notan, och det laddas **LATT vid första skanningen** — aldrig på
  toppnivå eller på timer, så Neons scale-to-zero bevaras. En delad in-flight-promise hindrar att två samtidiga
  skanningar läser 5,4 MB var vid kallstart. Per skanning går Neon-arbetet NER: bilden ger kort-id, så vi hämtar ~15
  rader på PRIMÄRNYCKEL i stället för ännu en genomsökning. Ingen pgvector — ett ANN-index sparar CPU vi inte saknar
  och kostar minne vi betalar för.
  ⛔ **EN ENDA implementation av avtrycket.** Servern läser 3 kanaler (sharp `.raw()`), klienten 4 (`getImageData`), och
  BÅDA anropar `fingerprintFromRgb`. All aritmetik inklusive nedskalningen (rent boxmedelvärde) ligger där: ett
  mellansteg med `resize()` hade smugit in bibliotekets omsamplingsfilter i nyckeln, och sharps lanczos är inte
  canvasens utjämning. Testet `art-fingerprint.test.ts` jämför 3- och 4-kanalsvägarna byte för byte — samma sorts vakt
  som `Card.numberSortKey` mot `cardNumberSortKey()`.
  **EN SÄKER BILDTRÄFF SLÅR MODELLENS NAMN — OCH MARGINALEN, INTE POÄNGEN, AVGÖR VAD "SÄKER" ÄR (2026-07-30)**:
  modellens NAMN är opålitligt på skärmfotograferingar. Samma kort, samma ram, fyra skanningar: "Pelipper", "Pawmot",
  "Falinks", "Palafin ex" — det sista med konfidens 0,85. Ett hallucinerat namn får full namnlikhet (1,0) mot SINA kort
  medan rätt kort får ~0 på namn, så texten vann alltid. MÄTT över 250 kort (hård försämring + 3 % marginal) för träff 1:
  RÄTT (210 st) poäng median 0,873 / min 0,570 · marginal median 0,111 / p90 0,297 — FEL (40 st) poäng median 0,758 /
  **MAX 0,922** · marginal median 0,012 / **MAX 0,066**.
  ⛔ **POÄNGEN SKILJER INTE RÄTT FRÅN FEL** (fördelningarna överlappar: en felträff kan ha 0,92, en rätt träff 0,57).
  MARGINALEN till tvåan gör det. Regeln `poäng ≥ 0,70 OCH marginal ≥ 0,10` (`ART_TRUST_*`) gav **100 % precision** — 0 av
  40 felträffar slapp igenom — och täckte 117 av 210 rätta. Tröskeln har ~1,5× marginal till sämsta observerade felträff
  och är satt på FÖRDELNINGEN, inte på det produktionsfall som väckte frågan (Falinks TG07: 0,857, marginal 0,379).
  Bonusen (1,15) ligger ÖVER en ren namnträff (max 1,0) men UNDER namn+nummer (1,4–1,5): ett hallucinerat namn utan
  nummerstöd förlorar, men namn OCH nummer som pekar på samma kort vinner — där är texten bevisad, inte gissad.
  Verifierat i tre riktningar: hallucinerat namn + säker bild → bilden vinner; hallucinerat namn + OSÄKER bild → namnet
  står kvar; namn+nummer på ett annat kort → texten vinner.
  **KORSVALIDERING — NAMNET DÄMPAS NÄR BILDEN INTE HÅLLER MED (2026-07-30)**: marginalregeln räddar bara de 56 % av
  rätta bildträffar som är BEVISAT säkra; de övriga 44 % har en äkta men smalare marginal och förlorade fortfarande mot
  ett hallucinerat namn. Håller modellens namn inte med om NÅGOT av bildens 15 bästa kort (Dice < `NAME_AGREE_MIN` 0,5)
  OCH bilden själv är stark (≥ `ART_STRONG`), skruvas namnvikten ner till `NAME_DISTRUST` (0,25). Två oberoende signaler
  som pekar isär betyder att en av dem är fel, och bilden är den mätta av de två. Namnet NOLLAS inte — namnträffar
  ligger kvar över orelaterade kort, för i ~7 % av fallen är det BILDEN som har fel.
  ⛔ **DÄMPNINGEN MÅSTE GÄLLA NUMRET OCKSÅ.** Namn och nummer kommer ur SAMMA modellsvar — är det ena påhittat är det
  andra lika misstänkt. MÄTT när bara namnet dämpades: det hallucinerade numret "041/193" matchade Paldean Tauros 41 i
  Paldea Evolved EXAKT (setet har 193 kort), fick full nummerbonus och vann över rätt kort. Ett påhittat tal träffar en
  riktig rad förr eller senare — katalogen har 20 563 kort.
  **FLERA VIDEORUTOR PER SLUTARTRYCK (`CAPTURE_FRAMES` 3)**: moiré, rörelseoskärpa och autofokus-sökning varierar PER
  RUTA, och avtrycket är gratis att räkna (ingen API-kostnad). Servern väljer den ruta som var mest AVGÖRANDE — störst
  marginal, `searchByFrames`. ⛔ Slå INTE ihop rutor med max-poäng per kort: det plockar den lyckligaste observationen
  per kort, trycker ihop fältet och förstör marginalen, som är hela vårt mått på tillförlitlighet. Bilden och närbilden
  till modellen tas från FÖRSTA rutan (den användaren såg); extra rutor skulle bara kosta uppladdning.
  **DIAGNOSTIK SPARAS FÖR ADMIN** (`ScannerJob.result`, ingen migration, inga extra rader): modellens svar, bildens
  topp-3 och det valda kortet — plus konstavtrycket (264 byte), ALDRIG bilden. Det är vad som gör det möjligt att mäta
  VERKLIG träffsäkerhet; alla siffror ovan är tak, byggda på frågor härledda ur samma filer som referenserna. Bara
  admin, av dataminimeringsskäl.
  ⛔ **BILDTRÄFFARNA MÅSTE LIGGA ÖVER NAMN-SYSKONEN i kandidatlistan** (skikt 2 mot 3): med ett hallucinerat namn är dess
  syskon en lista över FEL kort, och låg bildträffarna i "övrigt" försvann rätt kort ur listan helt.
  **BILDEN FÖRESLÅR, NUMRET AVGÖR**: `ART_WEIGHT` (0,3) är medvetet LÄGRE än nummerbonusen (0,4–0,5). Ett läst
  samlarnummer är ett exakt bevis, bildlikhet en gradering — väger bilden tyngre börjar den välja fel TRYCKNING (Base
  Unlimited/Shadowless/1st Edition har identisk konst och skiljs BARA av numret). Kandidaterna läggs dessutom TILL
  text-matchningen, de ersätter den aldrig: bildmatchningens verkliga träffsäkerhet är omätt (alla siffror kommer från
  frågor härledda ur samma filer som referenserna, dvs ett tak), så värsta fallet ska vara att bilden inte hjälper.
  ⛔ **AVTRYCKET ÄR EN VAKT SOM FAILAR TYST.** `numberSortKey` räknas av Postgres (GENERATED) just för att ingen import
  ska kunna glömma den; ett avtryck kräver bildavkodning och kan inte genereras i databasen. Det byggs av
  `scripts/build-art-fingerprints.ts`, som körs i `import-new-sets.yml` EFTER set-importen. Tas det steget bort blir
  nya kort osynliga för bildmatchningen utan att något felar. Ändras rutnätet krävs `FORCE=1` för hela katalogen —
  avtryck med fel längd hoppas över (aldrig jämförda), så följden är tysta bortfall, inte fel träffar.
  ⛔ **MARGINALEN RUNT KORTET ÄR DEN ENSKILT STÖRSTA FELKÄLLAN (fix 2026-07-30)**: avtrycket räknades först på det
  MARGINALFÖRSEDDA utsnittet (`CROP_PAD` 6 %), medan indexet är byggt på katalogbilder som är EXAKT kortet. Vid ett
  8×11-rutnät smittar ytterringen **34 av 88 celler**. MÄTT på Falinks TG07 (hård försämring): utan marginal plats 1
  och likhet 0,989 — med 6 % marginal UTANFÖR topp-15, bästa träff 0,547. Över hela katalogen föll topp-15 från 96 %
  till **15 %**. Revisionen rapporterade ändå 96 %, för dess simulerade felbeskärning skär IN i kortet i stället för
  att lägga bakgrund runt om; profilen `padded` + `PAD=`-övrestyrningen finns nu så samma miss inte kan upprepas.
  Avtrycket räknas därför på ramen UTAN marginal (`fx/fy/fw/fh` i `captureFrame`) — bilden till modellen behåller
  marginalen, så ett snett kort inte tappar numret.
  **OCH DET RÄCKER INTE ATT TA BORT DEN FASTA MARGINALEN**: känsligheten är brutal (topp-15 mot marginal: 0 % → 96 %,
  1 % → 94 %, 2 % → 84 %, 4 % → 49 %, 6 % → 15 %) och en handhållen fångst sitter inte inom 1–2 %. Klienten skickar
  därför ett **INSET-SVEP** (`FINGERPRINT_INSETS` = 0 / 3 / 6 / 9 %): samma fångst beskuren fyra gånger, och servern
  tar varje korts BÄSTA likhet (`searchByFingerprints`). MÄTT: topp-15 blir **93 % oavsett marginal** (mot 87/51/18 %
  vid 2/4/6 % med ett enda avtryck). ⛔ Slå ihop varianterna med MAX, aldrig medelvärde — bara EN beskärning är den
  rätta, så ett medelvärde drar ner rätt kort med brus från de felbeskurna. Kostnaden är ~1 kB upp och fyra sökningar
  à ~10 ms; `getImageData` körs EN gång och insetet appliceras i `fingerprintFromRgb` (delad kod, samma aritmetik som
  indexet).
  **132 kort har döda bild-URL:er** uppströms (mcd17/mcd18 + en promo, 404 på både hires och liten variant) → de får
  inget avtryck och matchas som förut på namn/nummer.
- **SKANNERN: NUMRET ÄR IDENTITETEN, OCH KANDIDATURVALET VAR ETT SLUMPURVAL (2026-07-29)**: "skannern gissar fel kort"
  lästes som ett modellproblem (Haiku), men modellen var bara halva kedjan. `matchCards` hämtade kandidater med ett `OR`
  över namn-tokens och `take: 50` UTAN `orderBy` — Postgres returnerar då de 50 rader planen råkar ge. MÄTT mot prod:
  18 938 av 20 563 kort (92 %) delar namn med minst ett annat kort, "charizard" ger 111 kandidatrader och "pikachu" 178
  → rätt kort låg utanför urvalet ungefär varannan gång, och VILKA 50 varierade mellan körningar. Dessutom jämfördes
  numret som `parseInt(card.number, 10)`, vilket ger `NaN` för VARJE bokstavsnumrerat kort ("TG10", "GG08", "SWSH034",
  "SV075") och tappar suffixet på "130a" — alltså exakt de tryckningar någon bryr sig om att skanna (Trainer Gallery,
  Shiny Vault, promos); vanliga commons skannar man inte. Numret jämförs nu som STRÄNG mot `Card.numberSortKey`
  (indexerad GENERATED-kolumn) via `parseGuessedNumber().sortKey`, och kandidater hämtas ur TRE unionade källor:
  nummer+namn, bara nummer (räddar felstavat namn), bara namn (räddar oläst nummer). Namn-tokens matchas AND-först med
  OR som reserv — "Iron Valiant ex" som OR drog in varenda Iron Hands i katalogen. Bokstavsnummer UTAN siffror hanteras
  också ("H", "ONE"): 31 kort är Unowns eget alfabet, och "O/115" lästes förut som kort 115 (totalen).
  **FACIT** = `scripts/scanner-match-audit.ts` (matar matchCards med kortets EGET namn+nummer, dvs en felfri simulerad
  OCR; läser bara, n=400/profil): topp-1 86,5 % → **100 %** (uniformt urval) och 91,0 % → **99,8 %** (kort vars namn
  delas av ≥5 andra). Utan läsbart nummer: 21 % / 8,5 % topp-1 — strukturellt otillgängligt, det finns ingen annan
  särskiljare när 92 % delar namn. ⛔ Följden: HELA skannerns träffsäkerhet hänger nu på att modellen läser
  SAMLARNUMRET rätt. En modelluppgradering ska mätas mot det, inte mot "känns bättre".
- **SKANNERBILDEN BESKÄRS TILL KORTRAMEN (2026-07-29)**: `captureFrame` skickade hela videorutan trots att overlayen ber
  användaren lägga kortet i en ram som täcker ~1/3 av ytan — två tredjedelar av de vision-tokens vi betalade för var
  skrivbord och hand, och kortet fick ~0,4 MP av bildbudgeten. Utsnittet MÄTS nu med `getBoundingClientRect()` på både
  video- och ram-elementet och räknas om genom `object-cover`-matten till källpixlar (+6 % marginal). ⛔ Räkna ALDRIG på
  overlayens `w-[68%]`/`mb-[14vh]` i stället — hårdkodade tal börjar tyst beskära fel dagen någon rör ramen, och ett fel
  utsnitt kapar numret, vilket är värre än ingen beskärning alls. Kortet får ~2,7× fler pixlar till SAMMA token-kostnad
  (utsnittet skalas till samma längsta sida, `CAPTURE_MAX`). ⛔ Haiku 4.5 tar emot max 1568 px längsta sida (~1,15 MP)
  och skalar ner allt däröver SERVER-SIDE — att höja `CAPTURE_MAX` ger alltså ingenting på Haiku. Vägen till fler pixlar
  på numret är beskärning eller en modell med högupplöst vision (Sonnet 5 / Opus 5: 2576 px, ~4784 bildtokens).
- **SKANNERKOSTNADEN ÄR VERIFIERAD MOT FAKTURA (2026-08-02)**: sedan Gemini slogs på (01:14 UTC) har **177 kort
  identifierats** — **68 gratis** (bilden avgjorde, noll API-anrop), **97 vision-anrop**, 12 utan diagnostik
  (icke-admin). De 97 anropen förbrukade 362 353 in- och 5 565 ut-tokens, och Googles konsol visade **0,82 kr**.
  Alltså **~0,0085 kr per vision-anrop** och **~0,0046 kr per identifierat kort** (bildvägen späder ut notan).
  Sätt det mot Pro: 49 kr/mån, och skäligt-bruk-taket 1 000 skanningar ⇒ värsta fallet ~8,5 kr om VARENDA
  skanning krävde vision. Marginalen är alltså bekväm, och ~40-50 % avgörs gratis av bilden i praktiken.
  ⛔ `scripts/scanner-telemetry.ts` PRICES-tabell är en uppskattning för att följa kostnaden MELLAN fakturor —
  **fakturan är facit.**
  ⛔ **UPPDATERAT 2026-08-29 — SKRIPTET HAR INGEN EGEN PRISLISTA LÄNGRE, OCH 0,20/0,80 VAR FEL.** Två
  tabeller (skriptets `gemini: 0,20/0,80` per LEVERANTÖR mot `ai-pricing.ts` `gemini-3.1-flash-lite:
  0,25/1,50` per MODELL) gav samma anrop två priser — 28,6 % isär mätt över hela ScannerJob-historiken.
  Skriptet läser nu `costMicroUsd` som alla andra. ⛔ Och den gamla "kalibreringen" reproducerade bara
  fakturan vid ~10,6 SEK/USD, vilket i praktiken är FALLBACK-kursen (`exchange-rate.ts`) — exakt fällan
  `.claude/rules/admin-ops.md` varnar för. ECB närmaste bankdag före fakturan (2026-07-31) var **9,5651**
  ⇒ fakturan är $0,0857, och 0,20/0,80 UNDERskattar den med 10,3 % medan listpriset ÖVERskattar med 15,4 %.
  ⛔ **Fakturan pinnar bara INPRISET** — utdelen är ~9,7 % av notan, så $0,80 och $1,50 går inte att skilja
  åt ur den. Med ut pinnat på listpris 1,50 är det fakturakonsistenta inpriset **$0,2136**, och det är
  talet i koden (residual ≈ 0). ⛔ **INTE 0,22** — det parade den övre änden av avvägningsbandet
  (0,2135 vid ut=1,50 · 0,2243 vid ut=0,80) med det HÖGRE utpriset, dvs dubbelräknade, och gav en
  konstlad residual på +2,7 %. ⚠️ **NÄMNAREN ÄR OFULLSTÄNDIG**: fakturadagen 2026-08-02 hade 247
  ScannerJob-rader varav 19 saknade diagnostik (icke-admin, inget `costModel` fanns före 08-14) — deras
  tokental är okänt men Google fakturerade dem. Det ärliga bandet är därför **~0,159–0,2136**, och
  0,2136 är den ÖVRE änden, vald enligt "hellre överskatta än underskatta". Stämmer en NY faktura inte:
  rätta tabellen, aldrig tvärtom — och dividera med den kurs `getRatesOre()` gav DEN dagen.
- **BULK-TAKET = 15, SATT PÅ MÄTNING (2026-08-02)**: bor på TRE ställen — `BULK_MAX_CARDS` i skanna/page.tsx
  (vad klienten skickar), `cells.max(N)` i `/api/scanner/identify-bulk` (vad servern accepterar) och
  `BULK_DETECTOR_MAX_CARDS` i lib/camera-controls.ts (vad zoom-rekommendationen klampas mot).
  12 → 20 → **15**. Måttet är andelen celler som BILDEN avgjorde utan att kosta ett vision-anrop, ur
  `ScannerJob`-telemetrin: **12 kort → 42/42/50 % · 15 kort → 47 % · 18 kort → 28 %** (och notan dubblas,
  $0,008 → $0,013). 15 ligger i samma band som 12; vid 18 kollapsar det. ⛔ Glider de tre talen isär blir felet
  TYST: ett för lågt Zod-tak avvisar HELA fångsten med 400 (inte bara överskottet), ett för lågt klient-tak kapar
  korten utan förklaring. `tests/unit/bulk-cap-sync.test.ts` vaktar att de är samma tal.
- **⛔ MODELLEN LÄSER ÄGARPREFIX FEL — OCH TEXTEN SLÅR DÅ BILDEN (MÄTT 2026-08-02)**: de nya seten (Ascended
  Heroes, Destined Rivals) är fulla av kort som heter "Larry's Komala", "Steven's Beldum", "Erika's Gloom",
  "Team Rocket's Murkrow". Modellen läser bara Pokémon-namnet, och det TRUNKERADE namnet matchar ett HELT ANNAT
  kort EXAKT — som då vinner över bildens träff:
  `"Komala" → Komala 185 (Unified Minds)` medan bilden sa Larry's Komala 175 · `"Beldum" → Beldum 59` mot
  Steven's Beldum 143 · `"Gloom" → Gloom 44` mot Erika's Gloom 2. **Bilden hade rätt i alla tre.** Värre: vinnaren
  delar då varken namn eller konst med rätt kort, så det föll ur alternativlistan och gick INTE att rätta.
  Lindring: `ScanCandidate.artRank` märker bildens `ART_ALWAYS_SHOWN`(3) bästa, och detaljvyn visar dem ALLTID.
  Det fabricerar ingen säkerhet — poäng och ordning är orörda, kortet går bara alltid att välja.
  ⏭️ KVAR (den egentliga fixen): låt namnmatchningen förstå ägarprefix, så "Komala" också krediterar
  "Larry's Komala". Det ändrar poängsättningen för HELA katalogen och måste mätas med
  `scripts/scanner-match-audit.ts` före ship — inte gissas.
- **NAMNSYSKON HAR GARANTERADE PLATSER I KANDIDATLISTAN (2026-08-02)**: `SIBLING_RESERVED`=4 i
  `matchCards`. Syskonen ligger i skikt 3, UNDER bildkandidaterna (skikt 2), och en bulk-cell kan ha upp till
  `ART_CANDIDATES` kort över `ART_STRONG` — då fyller skikt 2 hela taket och syskonen faller ur listan. Det är
  exakt det fall användaren måste kunna rätta: **samma konst, olika samlarnummer**. MÄTT I FÄLT: en bulk-fångst
  gav Raboot #27 där kortet var #37, omärkt som osäker och utan #37 bland alternativen. Reservationen ändrar inte
  ORDNINGEN, bara vilka som får plats. I detaljvyn visas dessutom **kort med SAMMA KONST alltid**, oavsett
  poängfönstret — förtroendebonusen (ART_TRUST 1,15) skjuter annars omtrycket långt utanför `ALT_SCORE_WINDOW`,
  vilket var precis vad som gjorde felmatchningen omöjlig att rätta. Flaggan `ScanCandidate.sameArt` sätts
  server-sida med `artPairSimilarity` mot **samma `SAME_ART_MIN` (0,9)** som omtryckssyskonens tie-break redan
  använder — kalibrerat mot verkliga fall: äkta omtryck **0,954–0,976**, olika konst **≤ 0,638**. Två tal på var
  sin sida om det gapet är samma beslut och får inte glida isär. ⛔ Beräknas BARA när bildmatchningen kördes
  (`artScores?.size`), annars hade en ren textskanning tvingat fram en lat inläsning av hela 5,4 MB-indexet.
  ⛔ **KONST, inte NAMN** (ägarbeslut 2026-08-02): namnregeln drog in varenda annan Raboot i katalogen och gjorde
  listan onödigt lång fast de flesta inte ser likadana ut. Regeln bor i `src/lib/scan-alternatives.ts` — ren och
  testad, för den avgör om en felmatchning går att RÄTTA och har felat i fält en gång. `MAX_ALTERNATIVES` 3 → 6.
  ⚠️ Server-reservationen går på NAMN medan visningen går på KONST: **var generös med vad som HÄMTAS, strikt med
  vad som VISAS.** Ett namnsyskon med annan konst är fortfarande en trolig rättelse (mätt: Falinks ur Astral
  Radiance TG matchad som Falinks ur Stellar Crown) och kostar inget att ha i listan när UI:t ändå filtrerar.
- **BULK VID 0,5× ÄR FÄLTVERIFIERAT PÅ 12 KORT (ägaren 2026-08-02)**: tolv kort i EN fångst, alla tolv rätt
  identifierade. Farhågan i `ZOOM_PRESET_MAX_CARDS` — att pixelbudgeten (~1/12 av bilden per kort) skulle fälla
  det — besannades INTE, och det är väntat efter bildmatchningen: avtrycket läser FÄRGLAYOUT, inte det ~2 mm höga
  samlarnumret. Det är numret som behöver pixlar, och bulkvägen avgörs av bilden. 1× och 2× är fortfarande omätta
  (copyn säger "ca"). Om 12 är ett tak eller bara det högsta någon provat går inte att veta utan att höja
  `BULK_MAX_CARDS` först — detektorns eget tak är 12.
- **⛔ KAMERANS LIVSCYKEL FÅR ALDRIG BERO PÅ ETT HOOK-OBJEKTS IDENTITET (2026-08-02)**: `useCameraControls`
  returnerade ett bart objektliteral → ny identitet varje rendering. `stopCamera` fick `[camera]` som beroende,
  och eftersom den anropas av `useEffect(() => () => stopCamera(), [stopCamera])` kördes den effekten om vid varje
  rendering — och dess CLEANUP river strömmen. `startCamera` startade om, anropade `attach()` → setState → ny
  rendering → loop. Kameran revs ner i samma andetag som den startades och gick aldrig live. Fixat i TVÅ lager:
  hooken memoiserar sitt returvärde, OCH skanner-sidan når `attach` via en REF så livscykeln inte kan bero på
  objektet alls. Memoiseringen ensam räcker INTE — identiteten byts ändå när `zoomPresets` fylls i efter första
  spåret, vilket hade rivit strömmen en gång till. Regeln generellt: en callback som en avmonterings-effekt
  beror på måste ha stabila beroenden, annars är dess cleanup en tyst rivning vid varje rendering.
- **SKANNING = OBEGRÄNSAD FÖR PRO, MED 1 000/MÅNAD SOM PUBLICERAT SKÄLIGT BRUK (ägarbeslut 2026-08-02)**:
  fyra ytor måste säga SAMMA sak och de gör det nu: prissidan ("Obegränsad kortskanning (skäligt bruk)"),
  skannerns Pro-badge (`∞`), villkoren `Terms.s6FairUse` ("upp till 1 000 skanningar per kalendermånad, nollställs
  den 1:a") och koden `PREMIUM_FAIR_USE = 1000` i `src/services/scanner/index.ts`. Gratis = 30/månad, oförändrat.
  Kvoten räknar IDENTIFIERADE KORT och nollställs på UTC-månadsskiftet (`startOfMonthUtc`), inte på
  prenumerationens årsdag. ⛔ **Taket är nu ett AVTALSVILLKOR, inte bara en skyddsspärr.** Sänks det — i koden
  eller via `SCANNER_PREMIUM_MONTHLY_LIMIT` — blir villkorstexten falsk, och ett dolt tak under det publicerade är
  ett villkor kunden aldrig fått se. Ändra konstanten och villkorstexten tillsammans, eller ingen av dem.
  Env-variabeln finns kvar för nödlägen, inte för produktbeslut.
  Sidofix samma dag: `Grading.limitPremium` sa "Tillbaka i morgon" fast graderingskvoten är MÅNADSVIS
  (`startOfMonthUtc` i `src/services/grading/index.ts`) — en Pro-kund som slog i taket fick veta att det löste sig
  i morgon, och blockerades igen dagen därpå.
- **SKANNERN HAR TRE LÄGEN, OCH DE ÄR ETT `mode`-FÄLT (2026-08-02)**: `"single" | "bulk" | "barcode"` i
  `skanna/page.tsx`. ⛔ Inte tre booleaner: två flaggor har fyra tillstånd varav ett ("båda på") är meningslöst men
  fullt möjligt, och lägena tävlar om SAMMA videoruta, slutare och poll-loop. Live-pollen/låset körs BARA i
  `single` (låset är ett enkortsbegrepp), bulk pollar inte alls, och streckkodsläget kör sin egen detektor.
  **BULK ÄR PRO**: grinden sitter i `/api/scanner/identify-bulk` (`isPro`, aldrig `planTier` — RevenueCat nollar
  planTier vid EXPIRATION och har tystat ägarens egna funktioner förr). Knappen VISAS ändå för gratisanvändare, med
  hänglås + PRO-märke → `/priser`; en funktion man inte kan se säljer ingenting. Låset sätts först när kvoten
  laddats (`quota != null && !isPremium`) — att gissa låst medan den är okänd blinkade ett Pro-lås för betalande
  kunder vid varje öppning. Ett 403 städar cellerna och skickar till prissidan i stället för att visa nio fel.
  Kvoten var redan rätt: `identifyCellsArt` bokför en scan per SÄKER cell och osäkra celler bokförs av `/identify`,
  dvs 9 identifierade kort = 9 kvot.
- **SEALED SKANNAS PÅ STRECKKOD, INTE PÅ UTSEENDE (2026-08-02)**: en ask har ingen konstbild att matcha mot, men
  den bär tillverkarens GTIN — och vi har redan hela GTIN-infrastrukturen (~73 % täckning på riktiga offers,
  `src/lib/gtin.ts`). Koden ÄR identiteten: `/api/scanner/identify-gtin` slår upp på normaliserad GTIN-14, så en
  träff är exakt och kostar noll vision-anrop. `src/services/scanner/barcode.ts` avkodar via webbläsarens
  `BarcodeDetector` och normaliserar ALLTID genom `gtin.ts` (fel checksiffra → INGEN träff, aldrig en gissning).
  ⛔ **iOS/WebKit har ingen `BarcodeDetector`** → `barcodeSupported()` är false och läget döljs HELT. Skillnaden mot
  bulk är avsiktlig: bulk är låst av OSS och går att låsa upp, streckkod är omöjlig på enheten. Detektorn skapas EN
  gång per lägesbyte (Android initierar Play Services-modellen i konstruktorn), och en `seen`-mängd hindrar att
  samma ask läses om 2,5 ggr/s medan den ligger kvar framför linsen. Skicket sätts till SEALED — NEAR_MINT hade
  varit ett påstående om något vi inte kan se.
- **FICKLAMPA + ZOOM: RENDERA BARA DET ENHETEN FAKTISKT KAN (2026-08-02)**: `src/lib/camera-controls.ts` (ren
  logik, testbar) + `src/hooks/use-camera-controls.ts` (livscykel). Torch saknas på desktop, framkameror och HELA
  iOS; zoom-kapabilitetens intervall är enhetsspecifikt och står INTE i "x" (både faktor- och procentskala
  förekommer), och **0,5× är oftast ett ANNAT OBJEKTIV** — en egen enhet i `enumerateDevices()`, inte ett
  zoom-värde. Hooken returnerar därför bara NÅBARA förval; en 0,5×-knapp som inte gör något är sämre än ingen knapp.
  ⛔ Modulen rör ALDRIG strömmens livscykel: kräver ett förval en annan kamera svarar den `needs-stream-restart`
  med enhetens id och skanner-sidan öppnar om strömmen själv (`withDeviceId` släpper `facingMode` — exakt
  deviceId + facingMode kan motsäga varandra och ge OverconstrainedError). ⚠️ Korttalen per zoomnivå
  (`ZOOM_PRESET_MAX_CARDS`: 0,5× = 12, 1× = 6, 2× = 1) är HÄRLEDDA UR GEOMETRIN, inte mätta — copyn säger därför
  "ca". De är ett tak för vad som FÅR PLATS, inte ett löfte om vad som går att LÄSA.
- **SKANNERNS ALTERNATIVLISTA GALLRAS FÖR VISNING, ALDRIG FÖR MATCHNING (2026-08-02)**: `MAX_ALTERNATIVES`=3 och
  `ALT_SCORE_WINDOW`=0,2 mot TRÄFFENS poäng (inte listans topp — frågan är "kan skannern ha tagit fel på DET HÄR
  kortet?"). Listan var oavkortad, och eftersom 92 % av katalogen delar namn med minst ett annat kort radade en
  vanlig skanning upp tio kort och sköt ner prisutvecklingen under vikningen. Ett kort långt under träffen delade
  oftast bara ett namn-token och är ingen förväxlingsrisk — att visa det får användaren att tvivla på en träff som
  var rätt. Kandidaterna räknas fram precis som förut och `onChoose` kan fortfarande välja vilken som helst.
  Under alternativen ligger `ScanPriceHistory`: hämtar `/api/products/{slug}/detail` (samma CDN-cachade endpoint
  som produkt-overlayn) NÄR DETALJVYN ÖPPNAS, aldrig vid skanningen — en bulk-fångst hade annars dragit nio
  detaljhämtningar ingen tittar på. Grafen ritas bara med ≥2 punkter.

- **RECALL-MÄTNINGEN: ETT GRINDAT URVAL ÄR INGET MÅTT (2026-08-18)**: `result.recall = { art, shown }`
  skrivs för ALLA användare av `/api/scanner/identify` OCH (sedan 08-18) av `identifyCellsArt`. Bulk-raderna
  bär `src: "bulk"`, och taggen är inte bokföring utan en VAKT: en bulk-cell bokförs bara när
  `artConfidentFrom` redan sagt ja, så **bildens topp-1 är rätt svar per konstruktion**. Summeras de med
  enkelskanningarna går recall mot 100 % utan att skannern blivit bättre — urvalet är grindat på exakt det
  som mäts. `scripts/scanner-recall-live.ts` håller hinkarna isär; saknad `src` = enkelskanning (alla rader
  före 08-18). Bulkens KORRIGERINGAR är däremot ett eget, nytt mått: trust-regelns precision i FÄLT
  (offline 2026-07-30: 100 %, n=40).
  ⛔ **SKRIV ALDRIG `recall` FRÅN EN VÄG SOM INTE KÖRT BILDSÖKNINGEN** (streckkod, uppladdning). En tom
  `art`-lista räknas som "bilden missade" i stället för "bilden tillfrågades aldrig", dvs mätningen sjunker
  av rader som inte mäter något. Nyckeln ska då saknas HELT — vaktat i `scanner-quota.test.ts`.
  ⛔ **`jobId` MÅSTE TILLBAKA TILL KLIENTEN PÅ VARJE VÄG SOM BOKFÖR EN TRÄFF.** `reportScanFeedback` är
  gated på just `jobId`, så en väg som utelämnar det kastar användarens rättelse TYST. `/identify` öppnades
  08-15, `identify-gtin` glömdes och öppnades först 08-18 — mellan de datumen var varje vanlig användares
  streckkodsrättelse förlorad.
  ⚠️ **MÄT TÄCKNING PER DYGN EFTER DEPLOYEN, aldrig över ett fönster som spänner över den** — ett fönster
  som börjar på deploydagen blandar in rader från före koden och ser ut som ett pågående hål (hände
  2026-08-17: "103 av 400 saknar mätdata" var i själva verket rader från före 13:15 UTC; dygnet efter var
  täckningen 152/152).

- **BILD-FÖRST ÄR REDAN HALVVÄGS, OCH MÄTNINGEN VAR TRASIG (2026-08-29)**: `skipVision =
  artConfidentFrom(...) !== null` (`services/scanner/index.ts`) har hoppat över vision sedan
  2026-07-31 — MÄTT **31,6 % av alla enkelskanningar** (463 av 1 466). Frågan "kan vi kortsluta
  vision?" är alltså besvarad med JA i drift; det som återstår är hur mycket grinden kan VIDGAS.
  ⛔ **DE PUBLICERADE RECALL-TALEN BLANDADE TVÅ STRATA.** De art-avgjorda raderna körs med TOM OCR,
  så alla namn-/nummerpoäng blir 0 och ART_TRUST_BONUS gör bildens etta till svaret ⇒
  `shown[0] === art[0]` **per konstruktion** — samma fälla som `src: "bulk"`, men de bar ingen tagg.
  Rätt redovisning är två tal, ALDRIG ett:
  | | art-avgjord (n=142) | vision behövdes (n=507) |
  |---|---|---|
  | topp-1 | 100 % (per konstruktion) | **39,8 %** |
  | topp-3 | 100 % | **58,2 %** |
  | topp-15 | 100 % | **67,9 %** |
  ⚠️ **MEN "58 % är det ärliga talet" ÄR OCKSÅ FEL.** Domtäckningen skiljer sig systematiskt
  (art-avgjorda 30,7 %, vision 50,5 %), så art-stratumet är UNDERrepresenterat i facit.
  Populationsviktat: 58,9 / 71,3 / 77,9 %. 39,8/58,2 är stratumtalet för de SVÅRA fallen.
  Säg alltid vilket stratum ett tal gäller. Täckningstaket för ren bild-först med en N-korts meny =
  `andel_art + andel_vision × vision_toppN` ≈ **74,6 %** vid N=5 — var fjärde skanning skulle få ett
  ark utan rätt kort. `recall.src: "art"` skrivs sedan 2026-08-29; äldre rader skiljs på `costModel === null`.
- ⛔ **FACIT VAR ETT KNAPPTRYCK (2026-08-29)**: `addAll()` skickade en `confirmed` per kort i hela
  brickan efter ETT tryck. Mätt på `userChosen.at`: **533 av 649 domar (82,1 %)** låg i skurar om ≥5
  med ≤5 s mellanrum (median-glapp 161 ms). Över ALLA strata: **83,4 % av allt facit**.
  ⛔ **RÄTTELSE AV EN FÖRSTA SLUTSATS, OCH DEN ÄR SJÄLV EN STRATUM-BLANDNING.** Det första talet var
  "26 procentenheters gap i topp-1 mellan skur och icke-skur". Det var räknat över alla strata, och de
  art-avgjorda raderna (100 % per konstruktion) ligger tätare utanför skurarna — gapet var alltså till
  största delen stratumet, inte uppmärksamheten. INOM vision-stratumet: aktivt val (n=50) topp-1
  46,0 % / topp-3 60,0 % mot masstryck (n=454) 39,4 % / 57,9 % — **6,6 respektive 2,1 procentenheter**.
  Skälet att hålla dem isär är alltså inte att recallen skiljer sig mycket, utan att en masskonfirmation
  är ett UTEBLIVET klick: den kan aldrig bli en korrigering (0 av 454 mot 2 av 50).
  `via: "pick" | "bulk" | "auto"` skrivs nu vid varje anropsställe.
  ⛔ **KORRIGERINGAR MISLABELADES**: `chooseCandidate` jämför `cardId`, men rättningsraden expanderar
  VARIANTER som delar `cardId` ⇒ ett byte ordinarie → reverse holo skrevs som "confirmed". I 378 av
  649 domar (58,2 %) hade raden ett kort men flera varianter. ⛔ Ett variantbyte får ändå INTE bli en
  `corrected`: samma `cardId` ⇒ samma artRank som en bekräftelse, dvs en TREDJE kontaminering av
  korrigeringshinken. Det bokförs som `variantChanged`, en egen signal.
  ⛔ **NEGATIVA DOMAR SKA IN**: `kind` är nu fyra värden — `corrected` / `rejected` (raderad skanning)
  / `searched` (gick till manuell sökning) / `confirmed`. De två negativa kastades tyst, och de är
  anrikade med precis de svåra fall bekräftelserna saknar (54 % av mätraderna hade ingen dom alls).
  Styrkeordningen bor i `src/lib/scan-verdict.ts` och är testad: en svagare dom får aldrig skriva över
  en starkare, annars nollar nästa masstryck en rättelse.
- **VALSTEGET (`status: "choose"`, 2026-08-29) VÄNDER BESLUTET FRÅN 07-30**: låg flera OLIKA kort
  praktiskt taget lika (`isAmbiguous`) visades förut ändå TOPPEN med ett gult "?". Det var ett val
  mellan GISSNING och INGENTING — en LISTA var aldrig på bordet. Nu: ingen förvald träff, korten
  inline i granskningsraden (aldrig bakom miniatyrbilden), och "Lägg till alla" blockeras tills valet
  är gjort. ⛔ Att hoppa över de osäkra i masstillägget hade tappat precis de kort vi var minst säkra
  på, utan att användaren märkte det. ⚠️ Hur ofta läget fyrar är ÄNNU OMÄTT — `ambiguous` styrde "?"
  i en månad utan att bokföras; den skrivs nu som `recall.amb`. Läs frekvensen innan `MATCH_MARGIN_MIN` rörs.
- **FÅNGSTKVALITET ÄR DEN ENDA FELKÄLLAN I DATAN MED EN MEKANISM (2026-08-29)**: revisionen av 163
  missar hittade ingen KATALOGorsak — gamla WotC-ramar faller ut MINST (12,6 %, bäst av alla eror),
  fullart/IR minst av alla raritetsklasser (12,5–15,4 %), 0 saknade/felaktiga avtryck
  (20 563/20 563), ingen attraktor-bugg, och det är INTE "rätt konst fel tryckning" (likheten till
  det valda kortet låg på SLUMPBASLINJE, median 0,624 mot 0,610). Det som föll ut var TAKTEN:
  **< 1,5 s mellan skanningar → 34,1 % miss mot 15,3 % vid > 60 s**, monotont och inom BÅDA de tunga
  användarna; 2 av 24 användare bar 130 av 163 missar över 6 dygn och ALLA kortkategorier.
  ⛔ **ETT STÖRRE K RÄDDAR INGENTING** — rang 6–15 rymmer 3,9 % av raderna. Informationen fanns inte
  i fångsten. `src/lib/frame-sharpness.ts` mäter normaliserad medelgradient ur SAMMA pixelläsning som
  avtrycket (ingen ny `getImageData`) och grindar **bara auto-slutaren**.
  ⛔ **ALDRIG ETT MANUELLT SLUTARTRYCK** — en kamera som vägrar fotografera är trasig, inte försiktig.
  ⚠️ `SHARP_AUTO_MIN` är OKALIBRERAD; talet bokförs som `recall.sharp` just för att kunna sättas på en
  fördelning i stället för på dagens gissning.
- ⛔ **KOSTNADEN ÄR INTE SKÄLET ATT GÅ BILD-FÖRST** (mätt 2026-08-29, fönster 14,3 dygn):
  gemini-3.1-flash-lite, 1 130 anrop, ~20–25 kr/mån. Att ta bort vision HELT sparar hela den summan;
  en bredare trust-grind ~7 kr/mån. Motiven är LATENS (40 ms mot 1–2 s), oberoende av Google i den
  användarsynliga vägen och huvudrum vid skala (~209 kr/mån först vid 1 000 skanningar/dygn).
  ⚠️ `SCANNER_MODEL_PRECISE` hade ALDRIG kört (0 rader i hela tabellen) — defaulten är flyttad
  3.5 → 3.6 (strikt dominerad), men det är en defaultändring, inte en besparing.

## Status och modellval (flyttat ur CLAUDE.md 2026-08-15)
- **SKANNERN: LÄS `docs/SCANNER-STATUS.md` FÖRE NÄSTA ÄNDRING (2026-07-30)**: lägesbilden med alla mätvärden,
  vad som är BEVISAT och vad som är MOTBEVISAT (finare rutnät = sämre, viktat konstfönster = sämre, neuralt nät =
  onödigt), plus de 26 riktiga skanningarnas utfall. Kortversion: helbildskort fungerar (4/4), klassiskt ramade kort
  fungerar INTE på skärmfoto (0/6) eftersom samlarnumret är ~3 px i en produktbild på skärm och färglayouten mättas
  inom en färgfamilj. **Modellen HITTAR PÅ nummer** — 16 av 26 var syntaktiskt giltiga och nästan inget korrekt, så
  `numberLegible` (ja/nej-fråga i verktyget) infördes 07-30 och är ÄNNU OMÄTT: mät med `scripts/scanner-telemetry.ts`.
  ⛔ Nästa riktiga mätning kräver FYSISKA kort — `scripts/art-audit/` kan inte modellera "en annan rendering av samma
  kort", vilket är precis det som fäller färgbaserad matchning.
- **Skanner-modellen: MINDRE BRÅDSKANDE efter bildmatchningen (2026-07-29)**: Haiku 4.5 behövs nu bara för att läsa
  samlarnumret när det ÄR läsbart (för att välja tryckning), inte för att identifiera kortet. Kostnad/scan om det ändå
  ska bytas: Haiku 4.5 $0,0023 (+närbild ≈ $0,0029) · Sonnet 5 @1280px $0,0069 (intro $0,0046 t.o.m. 2026-08-31) ·
  Sonnet 5 @2576px högupplöst $0,016 · Opus 5 @2576px $0,027. Per Pro-användare vid kvottaket 100 scans/mån: $0,23 /
  $0,69 / $1,63 / $2,72 mot 49 kr (~$4,60) i intäkt. Gratis (30 scans, noll intäkt): $0,07 / $0,21 / $0,49 / $0,82.
  ⛔ Byter man modell: `max_tokens` är 256 i `claude-vision.ts`, och på Sonnet 5 är adaptivt tänkande PÅ som standard
  med `max_tokens` som tak för tänkande + svar — 256 trunkerar före verktygsanropet. Höj till ~2000 eller sätt
  `thinking: { type: "disabled" }`.
