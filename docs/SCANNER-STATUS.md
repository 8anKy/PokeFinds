# Kortskannern — nuläge, mätvärden och nästa steg

Skrivet 2026-07-30 efter ett långt pass. Syftet är att INTE göra om det som redan
är gjort och mätt. Arkitekturen står i `docs/SCANNER.md`; de durabla besluten i
`CLAUDE.md`. Den här filen är lägesbilden: vad som är bevisat, vad som är
motbevisat, och vad som återstår.

## Så identifieras ett kort i dag

Två oberoende signaler vägs samman i `matchCards` (`src/services/scanner/index.ts`):

1. **KONSTAVTRYCK** — `Card.artFingerprint`, 264 byte (8×11 celler × RGB, int8),
   `src/lib/art-fingerprint.ts`. Identifierar kortet på UTSEENDE, läser ingen text.
   Klienten räknar avtrycket i canvas och skickar **264 byte upp** per variant;
   servern söker linjärt mot hela katalogen i processminnet
   (`src/services/scanner/art-index.ts`).
2. **TEXT** — Claude vision (Haiku 4.5) läser kortnamn och samlarnummer ur två
   bilder: hela kortet, och en närbild på nederkanten där numret trycks.

**Bilden föreslår, numret avgör.** Numret är exakt bevis (och det enda som skiljer
tryckningar med identisk konst); bilden är en gradering. Vikterna och alla
tröskelvärden är satta på MÄTNING — se `CLAUDE.md` för varje enskilt tal.

## Vad som är BEVISAT (gör inte om det här)

| Fråga | Svar | Var det mättes |
|---|---|---|
| Kan ett billigt fingeravtryck skilja 20 431 lika kort? | Ja — topp-15 96 % vid hård försämring | `scripts/art-audit/eval.ts` |
| Hjälper ett FINARE rutnät? | **Nej, sämre.** 24×33 ger 98,3 % mot 8×11:s 99,7 % | samma |
| Behövs ett neuralt nät (CLIP/DINOv2)? | **Nej.** Deras styrka är fin detalj, och fin detalj överlever inte en dålig bild | följer av ovan |
| Hjälper det att VIKTA konstfönstret tyngre? | **Nej, sämre** — flat 87,5 % mot 84,5–86,0 % | `scripts/art-audit/weight-audit.ts` |
| Hur känsligt är avtrycket för marginal runt kortet? | Brutalt: topp-15 96 % (0 %) → 15 % (6 %) | `eval.ts` med `PROFILE=padded` |
| Räddar ett inset-svep felaktig inramning? | **Ja** — topp-15 93 % oavsett marginal | `scripts/art-audit/inset-sweep.ts` |
| Går det att lita på en bildträff utifrån POÄNGEN? | **Nej** — felträffar når 0,92, rätta ner till 0,57 | `scripts/art-audit/margin-audit.ts` |
| … utifrån MARGINALEN till tvåan? | **Ja** — felträffar max 0,066, regeln ≥ 0,10 gav 100 % precision | samma |
| Fungerar katalogslagningen när numret är rätt? | Ja — topp-1 100 % (uniformt), 99,8 % (namntvillingar) | `scripts/scanner-match-audit.ts` |

⚠️ **Alla siffror ovan är TAK.** Frågorna härleds ur samma filer som referenserna,
så de kan inte visa vad en riktig fångst gör. Den enda källan till verkliga tal är
telemetrin nedan.

## Vad de RIKTIGA skanningarna visar (26 st, admin-telemetri)

`node scripts/with-prod-db.mjs npx tsx scripts/scanner-telemetry.ts`

- **Helbildskort fungerar**: 4/4 rätt (Trainer Gallery), och alla tre "SÄKER"-
  träffar var TG-kort. Marginal upp till 0,377.
- **Klassiskt ramade kort fungerar INTE på skärmfoto**: 0/6. Bilden svarar med rätt
  FÄRGFAMILJ men kan inte peka ut kortet — en Gyarados gav Starmie, Buizel,
  Shellos, Feraligatr, Huntail, Feebas, Palkia, Politoed, Marshtomp, Milotic. Alla
  blå vattenkort, alla inom 0,05 av varandra.
- **Modellen HITTAR PÅ samlarnummer.** 16 av 26 nummer var syntaktiskt giltiga och
  praktiskt taget inget korrekt: TG-kortens verkliga nummer (TG01/TG30, TG04/TG30,
  TG07/TG30, TG08/TG30) rapporterades som "43/102", "37/102", "40/202", "89/136",
  och "41/108" kom tillbaka för BÅDE en Crawdaunt och en Rayquaza.
- Bildens topp-poäng: median 0,737. Marginal: median 0,028. Bara 3/26 säkra.

**Varför skärmfoto är ett hårdare fall än ett fysiskt kort:** produktbilden på
skärmen är ~300 px bred, så samlarnumret är ~3 px högt. Det finns inte i källan —
ingen modell och ingen upplösning kan läsa det. Klassiska kort saknar då sin enda
särskiljare, medan helbildskort klarar sig på konsten. Utfallet ovan UNDERSKATTAR
alltså hur bra skannern är på riktiga kort, och det är otestat.

## Vad som gjordes i dag (kronologiskt, med commit)

| Commit | Vad |
|---|---|
| `4298bcb` | Kandidaturvalet var ett SLUMPURVAL (`take: 50` utan `orderBy`) + `parseInt` dödade bokstavsnummer (TG10, 130a). Topp-1 86,5 % → 100 % |
| `7348c3f` | `getUserMedia` begärde ingen upplösning → 640×480, samlarnumret ~5 px. Nu 3840×2160 + admin-diagnostikrad |
| `14f4a52` | Modellen läste HP:t (110) som samlarnummer → egen närbild på kortets nederkant |
| `73fc200` | Konstavtrycket infört (migration + backfill av 20 431 kort, 5,1 MB index) |
| `e7609cd` | Syskon först i "välj ett annat" + tryckningar (Unlimited/Shadowless/1st Edition) blev valbara |
| `534fb0d` | Avtrycket räknades på det MARGINALFÖRSEDDA utsnittet → topp-15 96 % → 15 %. Fix + inset-svep |
| `dcd16a9` | Bildträffar över namn-syskon; diagnostiken visar VILKA kort bilden valde |
| `6cc5f9f` | En SÄKER bildträff (poäng + marginal) slår modellens namn |
| `cd673bd` | Korsvalidering text↔bild, tre videorutor per tryck, admin-telemetri |
| `16882e1` | Modellen skrev verktygsanropets XML i nummerfältet → sanering. Namndämpning grindad på marginal, inte poäng |
| `e9b3e11` | Oavgjort mellan olika kort = ingen träff … |
| `8c7529c` | … vilket var FEL avvägning: de flesta kort blev "ingen träff". Nu en MÄRKT gissning (`?`) i stället |

## Beslut 2026-07-30 (ägarens): Haiku behålls, test sker på skärmfoton

Kostnadsbriefing gavs (Sonnet 5 $0,0069/scan, +högupplöst närbild ~$0,011, mot
Haikus $0,0029) — ägaren valde att BEHÅLLA Haiku 4.5 och testa vidare på
skärmfoton. Följder:

- **Modellbytet är nu en ren env-ändring** (`SCANNER_MODEL=claude-sonnet-5` i
  Railway): vision-anropet sätter `thinking: disabled` för icke-Haiku-modeller,
  så `max_tokens: 256`-fällan (adaptivt tänkande äter taket på Sonnet 5) är
  desarmerad. Ingen Railway-var är satt i dag → koddefaulten (Haiku) gäller.
- **Diagnostiken sparar nu ALLA rutors avtryck** (inte bara ruta 1), så
  `scripts/scanner-replay.ts` kan återge exakt det `searchByFrames`-beslut
  produktionen tog. Replayen är vägen att mäta viktändringar mot RIKTIGA
  fångster i stället för syntetiska — kör den före/efter varje justering.
- På skärmfoton av klassiskt ramade kort är 90 % strukturellt onåbart (numret
  är ~3 px — finns inte i källan). Helbildskort + kort där bilden särskiljer
  fungerar; syskonval inom samma namn avgörs av bildmarginaler på ~0,01–0,08.

## Mätt testrunda 2026-07-30 (skärmfoton, Haiku): 9/10 rätt

Ägaren skannade 10 kort mot facit. Pitch Black-korten (moderna) satt alla —
tre bildträffar var SÄKRA och överröstade två hallucinerade namn ("Miraidon ex"
→ Morpeko ex 117 med 0,937/0,476). Den enda missen var **Gyarados · Deoxys
8/107 (2005)**: namnet lästes rätt, numret oläsligt (ärligt), bildens toppar
var brus — och då stod alla **28 kort som heter exakt "Gyarados"** på samma
poäng. Tie-breaken "nyast set först" valde 151/Paldea varje gång, och
2005-kortet (plats 22 av 28 i åldersordning) fick inte ens plats i
kandidatlistans 12 rader: **rätt kort gick inte att välja alls**.

**Fix: ramgenerationen som tie-breaker (`era` i report_card).** Ramdesignen
(gul WotC-ram, EX-layout, SWSH-layout …) är läsbar även när numret inte är
det. Modellen klassar eran (wotc/ex/dp/bwxy/sm/swsh/sv/okand); kort vars set
ligger i eran (±1 år) får `ERA_WEIGHT` = **0,04** — medvetet UNDER
`MATCH_MARGIN_MIN` (0,05) så att en era-vinst aldrig ser säker ut (märks
fortfarande "?"), och långt under nummer (0,25–0,5) och säker bildträff
(1,15). Effekten är att rätt EPOK vinner oavgjorda lägen och att rätt-era-
syskonen sorteras överst i "välj ett annat". Eran dämpas med samma nameWeight
som namn/nummer (samma modellsvar, samma misstro). Era-klassningens verkliga
träffsäkerhet är ÄNNU OMÄTT — telemetrin loggar `era:` per skanning.

**ANDRA MÄTNINGEN + HP-BESLUTET (senare samma kväll)**: med de rättade
layout-ledtrådarna svarade Haiku `era:swsh` på SAMMA kort som nyss fått
`wotc` × 3 — era-klassningen är alltså MÄTT OPÅLITLIG på skärmfoton (den
studsar mellan epoker). Mekaniken behålls (skadar inte, hjälper när den
träffar) men kan inte bära beslutet. Ägaren godkände i stället **HP-kolumnen**:
`Card.hp` (migration 20260730200000) + backfill från pokemontcg.io
(`scripts/backfill-card-hp.ts`; import-tcg-data fyller framtida set).
HP är kortets STÖRSTA tal — modellen läste det spontant redan när vi bad om
samlarnumret (fix 14f4a52) — och mätt på fallet: HP 90 bär 3 av 28 Gyarados,
och "nyast först" bland de tre är EXAKT rätt kort (Deoxys #8). Vikter:
`HP_WEIGHT` 0,04 (läsning) > `ERA_WEIGHT` 0,02 / `ERA_ADJACENT_WEIGHT` 0,01
(klassning), summan klippt av `TIEBREAK_CAP` 0,045 < `MATCH_MARGIN_MIN` —
två gissningar ur samma modellsvar får aldrig tillsammans se ut som bevis.
HP saniteras hårt (30–500, jämna 10-tal) — ett felläst tal ska hellre kastas
än matcha fel kort exakt.

**FÖRSTA MÄTNINGEN AV ERA-KLASSNINGEN (samma dag, 3 skanningar)**: mekaniken
höll (tre skanningar → SAMMA svar, rätt tidsepok ±2 år; förut tre olika svar
från 2023) men Haiku klassade EX-era-Gyaradosen (2005) som `wotc` alla tre
gångerna → vinnaren blev Dragon #32 (nyast i wotc-fönstret, nov 2003) och
Deoxys #8 föll UR listan igen. ⛔ ROTORSAKEN VAR PROMPTEN: "gul ram = wotc"
är faktafel — ALLA engelska kort t.o.m. 2022 har gul ram; bara Scarlet &
Violet (2023–) är silver/grå. Ledtrådarna är omskrivna till LAYOUT (wotc =
evolutionsruta OVANFÖR konsten uppe till vänster; ex = STAGE-flik som
ÖVERLAPPAR konsten nere till vänster), och GRANNEPOKEN får halv bonus
(`ERA_ADJACENT_WEIGHT` 0,02) — en epok fel är det FÖRVÄNTADE felet, och
halva bonusen håller rätt kort kvar i kandidatlistan även då. Kvarstående
ärlig gräns: inom rätt epok avgör fortfarande "nyast set" — exakt kort på
skärmfoto kräver läsbart nummer (eller HP-kolumn i katalogen, som inte finns).

**SLUTMÄTNING GYARADOS-FALLET (21:18, 4 skanningar)**: rätt kort till slut —
men via en TREDJE väg: modellen läste "8/107" ur PRODUKTSIDANS RUBRIK som kom
med i utsnittet (konf 0,85; kortets eget nummer är ~3 px och oläsbart).
Nummer+total → +0,5 → exakt träff utan "?". Lärdomar: (1) ett läsbart nummer
VAR SOM HELST i bilden är den starkaste signalen — det generaliserar dock
inte till fysiska kort eller rena foton; (2) `era ex` var RÄTT efter
layout-ledtrådarna (n=1); (3) `hp —` — modellen avstod ärligt på den suddiga
kortbilden, så HP-mekanismen är FORTFARANDE OMÄTT i fält. Den är byggd för
exakt de fångster där ingen sidtext finns; mät via telemetrin när fler
skanningar droppat in.

## BILDMATCH 2.0 (2026-07-30, kväll): strukturavtryck löser skärmfoto-fallet

Ägarens mätning: konkurrenternas scanners (TinEye CardSearchEngine-klassen,
$500/mån) identifierar kort på skärmfoton till ~100 %, även med nederkanten
dold — alltså på ren konst. Vår färg-grid var alltså inte "taket för vad som
går" utan taket för FÄRGBASERAD matchning. I stället för att köpa tjänsten
byggdes samma komponenter själva:

1. **Kalibrerat skärmfoto-harness** (`scripts/art-audit/screen-eval.ts` +
   `screen-descriptors.ts`): degradering + moiré + färgstick + RUMSLIGT
   varierande ljus. Kalibrering = baslinjen måste reproducera produktionens
   verkliga haverier — och gör det (Gyarados·Deoxys faller till brus ~0,67
   mot verklighetens ~0,69; Charizard Base håller ~0,84 mot verkliga 0,83).
   ⛔ NYCKELINSIKT: färg-gridens per-kanal-standardisering KANCELLERAR alla
   affina ljusförändringar — det som fäller den är RUMSLIGT ljus (LCD:ns
   off-axis-avfall, vinjettering, blänk), och det var exakt det som saknades
   i alla tidigare profiler.
2. **Deskriptorracet** (205 frågor × 2 benchmarks, hela katalogen som
   distraktorer), topp-15:
   | | skärm | fysisk (harsh) |
   |---|---|---|
   | färg-grid (gamla) | 38,5 % | 93,2 % |
   | dctb (tecken-DCT, pHash-klass) | 89,8 % | 68,3 % |
   | grad (HOG-lätt 704 dim) | 94,1 % | 93,7 % |
   | **triw = 0,25·färg + 0,25·dctb + 0,5·grad** | **97,1 %** | **95,6 %** |
   Fel-marginal max 0,028 över 410 frågor → marginalregeln håller med ~3,6×
   säkerhet. ⛔ MAX-AV-EXPERTER FUNKAR INTE (85,9 % skärm): den trasiga
   experten är SJÄLVSÄKERT fel — skalor mellan experter är ojämförbara.
3. **Produktion**: `Card.structFingerprint` (959 byte: 255 DCT-tecken + 704
   gradientfack; migration 20260730230000, backfyllt 20 431 kort ur lokala
   bildcachen). Delad implementation i `src/lib/art-fingerprint.ts` (parvisa
   tester 3-kan/4-kan), klienten skickar båda avtrycken per inset ur SAMMA
   getImageData, servern blandar tre delcosinus. Äldre klienter utan
   strukturavtryck får exakt gamla färgbeteendet. `ART_TRUST_SCORE` sänkt
   0,70 → 0,55 (blandad skala); marginalen 0,10 kvar som bärande villkor.
   Indexkostnad: +~19 MB residentminne, noll per-scan-kostnad, inga tjänster.

⚠️ Siffrorna är fortfarande TAK (frågor härledda ur referensfilerna) — men
harnesset är för första gången KALIBRERAT mot verkliga haverier. Verklig
träffsäkerhet mäts som vanligt via telemetrin + replayen (nya skanningar bär
även strukturrutor, så replayen återger blandningen exakt).

**FÄLTVERIFIERAT (22:56 samma kväll): 3/3 på det förut omöjliga kortet.**
Gyarados · Deoxys 8/107 på monitor: bildens topp-3 innehåller nu Gyarados 8
(0,606 — igår enbart brus), hp läses (90), och slutvalet blir rätt kort med
rätt pris tre skanningar i rad. Två efterföljande fixar samma kväll:
(1) OUTSET-SVEPET (ram × 1,2/1,45) — kort STÖRRE än ramen gav en partiell
fångst som inga referenser kan matcha; inset-svepet beskär bara inåt. Mätt:
första skanningen (kort i ram) rätt, tre med överflöde = brus → fix 5672213.
(2) Kvarstående kända hål: modellen fabricerade "Dragonite 4/102" på en suddig
zoomad fångst → exakt träff på Fossil Dragonite (nummer+total-bonusen är
stark). numberLegible stoppar det inte alltid. OMÄTT hur ofta; era-klassningen
fortsatt opålitlig (bwxy på ett EX-kort igen) men bara tie-break. Fysiska
kort: fortfarande otestat.

## LIVE-LÅS + VILLKORAD HAIKU (2026-07-31)

Fältverifierat 9/9 (3 Gyarados + 6 blandade) → nästa steg blev konkurrenternas
"millisekundkänsla", som är ARKITEKTUR, inte modell:

1. **Live-pollen** (`/api/scanner/identify-art`): kameravyn skickar avtryck ur
   aktuell ruta ~var 600:e ms (fpOnly-läget i captureFrame hoppar över den dyra
   JPEG-kodningen). Ingen bild, ingen vision, INGEN KVOT (kvoten binder
   vision-kostnad; pollen kostar ~40 ms CPU). Chip under ramen: grönt lås när
   TRE rutor i rad pekar på samma kort och trust-regeln höll i den senaste.
   Kortmetadata cachas i processen (artMetaCache) så pollandet inte väcker Neon.
2. **Villkorad Haiku**: /identify kör bilden FÖRST (~40 ms); är träffen
   trust-säker (100 % uppmätt precision, 660 frågor) hoppas vision-anropet
   över helt (provider "bild", konf 0,95) → instant + $0. Tvetydiga fall —
   inklusive tryckningar med identisk konst (pytteliten marginal per
   konstruktion) — går fortfarande till modellen. `precise` hoppar aldrig.
   ⛔ Haiku kan INTE elimineras helt: namnet avgör fortfarande nära-oavgjorda
   lägen (mätt: bild rank 2–3 på de lyckade Gyarados-skanningarna), numret är
   enda tryckning-/exakthetssignalen på fysiska kort, HP är syskonskiljaren,
   och cardVisible är "finns ens ett kort"-grinden.
3. **Fabricerade nummer märks**: nummer-drivet val som bildens FULLA topp-15
   inte innehåller → "?" (Dragonite 4/102-fallet). Valet står kvar, men ser
   inte längre ut som bevis.
4. Kvot-UX: 429 visade sig som "Ingen träff" i remsan → nu serverns besked +
   toast; admin har i praktiken obegränsad kvot; månads-copy rättad.

## OCKLUSION (2026-07-31, natt): mätningen stoppade en felship

Ägarens fingertest: finger MELLAN kamera och skärm → fel/inget svar. Byggde
finger-ocklusion i harnesset + regional grad-poäng (bästa 4 av 6 regioner).
MÄTT: (1) simulerad ocklusion PÅ kortet (skarp fläck 12–22 % från kant)
klaras REDAN av blandningen — topp-15 97,6 % ≈ rent; (2) regional poäng
tillför INGET (96,8 %) → EJ shippad (ligger kvar i harnesset); (3) replay av
de verkliga fingerskanningarna: konsten kollapsar till brus (rätt kort borta
ur topp-5) — mekanismen är en DEFOKUSERAD jätteblob + autofokus-/exponerings-
skift som degraderar HELA rutan, inte en region. Utanför simulatorns modell.
NÄSTA: (a) be ägaren göra äpple-mot-äpple-testet (täck nederkanten PÅ
skärmen, platt/skarpt — det klarar vi enligt mätningen); (b) vill man klara
finger-framför-linsen krävs en kalibrerad defokusblob-modell först — de
verkliga avtrycken finns lagrade som facit. Exakt-namn-fixen (41a08f5) höll:
rena skanningar väljer nu Deoxys #8 konsekvent.

## AUTO-FÅNGST + ÄGARBESLUT (2026-07-31)

Fingertestet äpple-mot-äpple (täckning PÅ skärmen) klarades 2/2 — som mätt.
**Auto-fångst shippad (ff5c8f1)**: grönt lås som hållit ≥2 extra pollar
(~1,2 s) trycker av själv (vibration, samma fångstväg, EN fångst per kort —
spärren släpper när ett annat kort ses). Auto-fångster är per konstruktion
trust-säkra → Haiku hoppas över → $0 AI. **Ägarbeslut efter briefing**:
Haiku BEHÅLLS som fallback (kostar ~$0,10–0,15/mån per tung Pro-användare,
köper nummer/tryckning på fysiska kort, namnräddning, HP, cardVisible);
kvoten KVAR på 100/mån — unlimited-Pro med dolt fair-use-tak på vision-
skanningar (~1000/mån) är designad och skjuten till efter fältdata.
KVAR: fysiska kort — sista omätta domänen.

## FAS 0 + FAS 1 (2026-07-31, kväll): scoreboard med facit + quad-rätning

Djupresearchen (TinEye CardSearchEngine m.m.) landade i en fasplan; kortversion
av vad den etablerade: CardSearchEngine är deskriptor + index + närmaste granne
— samma arkitektur som vår — utan påvisbar vallgrav. Deras 99,9 %/pris/
tryckningsval överlevde INTE källgranskning (unaudited marknadsföring; deras
egen MatchEngine-sida visar 45 % på alternate-artwork-par i svårt ljus). Vår
nummerbaserade tryckningsdisambiguering är en förmåga deras publika material
inte ens demonstrerar.

**FAS 0 — `scripts/scanner-scoreboard.ts`** (facit slår takmätningar):

- `TEMPLATE=1` skriver olabellade skanningar till `scripts/scanner-labels.json`
  med LEDTRÅDAR (modellsvar, valt kort, bildens topp-5 MED kort-id) — märkning
  är minuter. **87 riktiga skanningar väntar på ägarens facit.** Svaga
  etiketter (samlings-tillägg ≤15 min efter skanning) redovisas separat; i
  dagens data fanns inga.
- Rapporterar per population (physical/screen): bild topp-1/5/15, slutval,
  svep-räddade, trust-regelns VERKLIGA precision (importerar produktionens
  exporterade `ART_TRUST_*`), tröskel-tabellen (rätt/fel × poäng/marginal) och
  TRE HINKAR per miss: VIKTNING (bilden hade facit i topp-15, valet föll fel),
  DESKRIPTOR (självsäkert fel bild), INFO/RAM (allt brus — ramfel eller
  information som inte finns i källan; utan bilden går de inte att skilja,
  ägarens `note` avgör).
- ⛔ Trösklarna härleds OM härifrån när deskriptor/beskärning ändras — aldrig
  ur takmätningar.

**FAS 1 — quad-rätning (`src/lib/card-quad.ts`, shippad)**: Sobel →
riktnings-grindad Hough → yttersta starka linjeparet → sub-bin-förfining mot
råa kantpixlar → validering (konvexitet, sidoförhållande 63:88, area) →
Heckbert-homografi + bilinjär varp till 240×335. Ren TS, 0 beroenden (OpenCV.js
= 8+ MB WASM egress — avvisat), ~10–30 ms, EN implementation för klient (4 kan)
och harness (3 kan) med parvisa tester (`tests/unit/card-quad.test.ts`).
Klienten lägger varpen som **7:e svepvariant** (≤ API-taket 8; diagnostiken
sparar nu 7): servern tar bästa varianten per kort, så misslyckad detektering
eller felvarp lämnar allt som förut — failar öppet åt rätt håll.

**MÄTT före ship** (`scripts/art-audit/rectify-eval.ts`, triw-blandningen,
hela katalogen som distraktorer, n=40/rad):

| fall | single | sweep | quad | **both (= det som shippas)** |
|---|---|---|---|---|
| pad 6 % symmetrisk | 60,0 % | 97,5 % | 85,7 % | **97,5 %** topp-15 |
| pad 6 % ASYM + ±6° | 5,0 % | 50,0 % | 86,8 % | **90,0 %** topp-15 |
| pad 10 % ASYM + ±6° | 0,0 % | 20,0 % | 86,5 % | **85,0 %** topp-15 |

Läsning: symmetrisk pad löser svepet redan (quad tillför noll, kostar noll) —
men det ASYMMETRISKA fallet (kort ur centrum + rotation, dvs en verklig
handhållen/sned fångst) kan svepet per konstruktion inte nå: **+40 till +65
procentenheter topp-15**. Detekteringsgrad 37–38/40. ⛔ Svepet BEHÅLLS tills
Fas 0-facit visar att varpen ensam räcker (4 sökningar → 1 är en senare
optimering, inte dagens).

**Kostnadsform**: +~350 B upp per ruta (7:e varianten), +1 sökning à ~10 ms
server-CPU, 0 nytt residentminne, 0 API-kostnad, Neon-vägen orörd.

**FAS 3 MÄTT SAMMA KVÄLL — NEGATIVT, DEFERRED**: `rerank-eval.ts` (100 frågor,
kalibrerad skärmbenchmark): triw topp-1 är redan 92,0 % och topp-15 98,0 % →
takhöjden för EN PERFEKT omrankning är 6,0 procentenheter. Den finkorniga
proxyn (2816-dim gradient, 4× produktionens) FÖRLORAR i stället: ren fin 85,0 %,
triw+0,5·fin 91,0 % — båda UNDER baslinjen. Samma fysik som "finare rutnät är
sämre": degraderingen förstör findetaljerna själva, så en robust kortlista
räddar dem inte — och ORB/RANSAC på ~250 px katalogbilder mot moiré-frågor
möter samma vägg. Produktionskostnaden (kandidatbilder finns inte på servern:
CDN-hämtning ~15 bilder/scan, ELLER ~58 MB int8 resident för förberäknade
findeskriptorer) är dessutom fel riktning när minne är notan. **Återöppnas
BARA om Fas 0-facit visar att DESKRIPTOR-hinken dominerar OCH idén överlever
degradering (mellanskala-struktur, inte findetalj).**

**FAS 2 MÄTT SAMMA KVÄLL — OCKSÅ NEGATIVT, EJ BYGGD**: `augment-eval.ts`
(2 augmenterade referensvarianter × hela katalogen, MAX per kort, 100 frågor):
original 92,0/98,0/98,0 % → +1 variant **85,0/90,0/94,0 %** (+25 MB resident)
→ +2 varianter 89,0/92,0/95,0 % (+50 MB). Augmenterade referenser SÄNKER
träffsäkerheten: varje extra variant ger 20k distraktorer en lott till på en
lycklig max-träff, och fältet trycks ihop — samma mekanism som fällde
max-av-experter (85,9 %). Recall-per-MB-kurvan är alltså NEGATIV; det finns
inget ägarbeslut att fatta. Återöppnas bara om Fas 0-facit visar en felklass
som bevisligen är referens-domänglappet (och då med få, hårt validerade
varianter — aldrig 8 för att 8 stod i en plan).

`quant-check.ts` mäter int8-kvantiseringens cosinus-störning —
**MÄTT (996 par): |Δcosinus| p99 7,9e-4, max 1,6e-3 — 60× under sämsta
fel-marginal (0,028), 125× under trust-marginalen. int8 kan inte ändra ett
utfall; antagandet är nu en mätning.** Fas 3 (ORB/RANSAC-omrankning av
topp-15) och Fas 4 (inlärd embedding, 25–90 MB resident ELLER 25–90 MB
klientnedladdning) är DEFERRED: byggs bara om Fas 0-facit visar att hinken
DESKRIPTOR dominerar missarna — INFO/RAM-hinken kan ingen deskriptor laga.

## FÖRSTA RIKTIGA MÄTNINGEN — FYSISKA KORT (2026-07-31, kväll, n=25)

Ägaren skannade 25 fysiska kort (Ascended Heroes/Destined Rivals-tunga) EFTER
quad-deployen och intygade facit direkt (rättade 3 fel). Första talen någonsin
som inte är ett tak:

| mått | verkligt | syntetiskt tak |
|---|---|---|
| bild topp-15 | **96,0 %** | 96–97 % |
| bild topp-5 / topp-1 | 92,0 % / 64,0 % | — |
| slutval rätt | **88,0 %** (22/25) | — |
| trust-regeln | utlöst 12/25, **precision 100 %** | 100 % |
| svep/quad-räddade | 32,0 % | — |

- **Fältet matchar taket**: topp-15 96,0 % på riktiga handhållna fångster.
- **Auto-fångst-grinden felade aldrig**: 12/12 rätt (= 12 scans utan Haiku,
  $0 AI). Marginalerna separerar BÄTTRE i fält än syntetiskt: sämsta
  fel-marginal 0,018 mot tröskeln 0,10 (5,5× säkerhet) — rätt-median 0,130.
- **Alla 3 missar = VIKTNING-hinken, samma mekanism**: samma-konst-omtryck
  över set (Raboot SC 27 ↔ AH 37, Scorbunny SC 26 ↔ AH 36) + nummer-tvilling
  (Electrike 60 Deoxys ↔ Eelektrik 60; modellen läste "Electrik / 060/111" —
  en fabricerad blandning). Identisk konst kan INGEN bilddeskriptor skilja;
  numret är enda separatorn och det var oläst/felläst i alla tre. Fixriktning:
  text/tie-break för omtryckssyskon (gratis) — INTE deskriptorer, vilket
  oberoende bekräftar att Fas 2/3/4 ska förbli deferred. DESKRIPTOR-hinken: 0.
  ⚠️ n=3 — bygg inget förrän mönstret står sig över fler skanningar.
- 7:e varianten (quad) verifierad live i diagnostiken: nya skanningar bär
  7+7+7+7 varianter/ruta (6 där detekteringen avböjde = failar öppet).

**SKÄRMSESSIONEN SAMMA KVÄLL (n=17, ägarintygad)**: populationen som var
0/6 för två dagar sedan är nu **16/17 rätt** — topp-1 94,1 %, topp-5 100 %,
topp-15 100 %, trust-regeln 12/17 utlöst med 100 % precision. Gyarados·Deoxys,
TG-korten och Base-Charizard — de förut omöjliga fallen — satt alla. Enda
missen: Regirock ex DR 101 ↔ AH 107, ÄNNU ett samma-konst-omtryck (marginal
0,007). Alla 4 missar över båda populationerna delar alltså EN mekanism.
⚠️ Ärlig brasklapp: skärmfrågorna var produktbilder — i praktiken samma
renders som referenserna, dvs ett gynnsamt fall; godtyckliga marknadsfoton
ligger sannolikt mellan populationerna. Ninetales Base 12 var 1st
EDITION-tryckningen: kortidentiteten var RÄTT (tryckning = produktnivå, väljs
i syskonlistan) — märkt korrekt med not.

De gamla 87 skanningarna ligger kvar omärkta i labels-filen (valfri bonusdata).

## OMTRYCKSSYSKON-TIE-BREAKEN (2026-07-31, sen kväll): 38/42 → 40/42

`applySameArtTiebreak` (ren dom, testad utan DB) + `artPairSimilarity`
(triw-likhet mellan två REFERENS-avtryck ur indexet, indexOf i stället för en
id-Map med flit — RAM är notan). Regeln: kandidater med samma namn vars
referensavtryck är nästan identiska (≥ `SAME_ART_MIN` 0,9 — KALIBRERAT: äkta
omtryck 0,954–0,976, olika konst ≤ 0,638) får bild-delen UTJÄMNAD till
gruppens bästa (identisk konst ⇒ skillnaden är brus), varpå äkta bevis avgör:
läst nummer (orörd, kan inte utmanas), läst TOTAL ("034/217" → 217-setet,
`TOTAL_TIEBREAK` 0,02 under osäkerhetströskeln), sist "nyast set först".

**TVÅ ROTORSAKER, inte en** (felsökt via `scanner-choice-replay.ts` som
replayar HELA matchvägen — bild + lagrat modellsvar → matchCards — över de
facitmärkta skanningarna):
1. **Dubbelrundning**: poängen rundades FÖRE utjämningen → 0,001-skillnader
   kvar = exakt bruset regeln skulle ta bort. Utjämningen räknar nu på ORUNDADE
   komponenter.
2. **⛔ HP-HÅLET**: Ascended Heroes är skapat ur CM:s episodlista innan
   pokemontcg.io har setet → korten har `hp = NULL` (backfillen saknar källa).
   Modellen läste HP HELT RÄTT från kortet (90/70/230), det matchade den GAMLA
   tvillingens katalograd (+0,04), nya setets NULL fick noll — en katalog-lucka
   som systematiskt röstade på fel syskon i ALLA tre omtrycksmissarna. Samma
   felklass som tcgid-incidenten (saknat fält failar öppet). Regel: HP får bara
   skilja syskon när ALLA i gruppen har HP i katalogen.

**Replay-verifierat mot facit (42 skanningar)**: 38/42 → **40/42**. Fixade:
Raboot, Scorbunny, Regirock ex (alla tre omtrycksmissarna). Kostnad: Murkrow
DR 127 ↔ AH 126 — prod hade RÄTT av tur (brus + HP-hålet råkade peka på gamla
setet, som var sanningen där); nyast-först väljer nu AH. Ärlig bokföring: inom
samma-konst-grupper valde bruset rätt 1/4, nyast-först 3/4 — ingen av dem är
kunskap (identisk konst + oläst nummer ÄR ett myntkast, valet förblir "?" med
båda syskonen i listan), men priorn med bäst odds vinner netto +2.
Eelektrik-missen (olika konst 0,391 — namn-blandningsfällan "Electrik") ligger
KVAR öppen: n=1, ingen regel byggs på ett fall.

## UTVIDGAD TRUST: RUTA-SAMSTÄMMIGHET (2026-07-31, natt): 24 → 28 av 42 gratis

Ägarens fråga "varför är bara auto-fångsten gratis?" hade ett halvt felaktigt
antagande (även manuella fångster hoppar Haiku när trust-regeln håller — 24/42
i fält) och en HELT RIKTIG kärna: fångsten bär redan 4 oberoende videorutor,
och att ALLA rutors topp-1 pekar på samma kort är temporalt bevis av samma
slag som live-låsets "tre pollar i rad" — men det räknades aldrig.

`artConfidentFrom` (delad dom — produktion, replay, scoreboard och skip-audit
importerar SAMMA funktion): basregeln som förut, PLUS full ruta-samstämmighet
→ marginalkravet sänks 0,10 → `ART_AGREE_MARGIN` 0,05. MÄTT mot facit
(`scanner-skip-audit.ts`): 24/42 → **28/42 hopp, fortfarande 100 % precision**.
0,05 valdes över 0,04 (29 hopp) med flit: 2,8× marginal till fältets värsta
fel-marginal (0,018), och syskonfallen (0,005–0,018) ligger KVAR under
tröskeln — samstämmighet ensam räcker aldrig (rutorna kan vara ense om fel
syskon), marginalen förblir det bärande villkoret. Verifierat: choice-replay
oförändrad 40/42 med utvidgningen aktiv.

Effekt: ~67 % av skanningarna är nu $0 och instant (var 57 %); resten är
precis de fall där Haiku faktiskt tillför (nummer/tryckning/syskonval).

## BULK-SKANNERN v1 (2026-08-01): en bild, upp till nio kort

Ägarens idé: fota en HEL pärmsida (eller kort utlagda på ett bord) och få alla
identifierade + prissatta i ett svep — en funktion konsumentappar i praktiken
saknar. **Rutnätsoverlayen är en PLACERINGSGUIDE, inte en pärmfunktion**: 3×3
celler i kortproportion fungerar för pärmficka och lösa kort lika ("ett kort
per ruta"), och detektionen slipper frilagd multi-kvadrat (= fas 2, byggs när
v1 är mätt).

**Arkitektur = maximal återanvändning.** Per cell: samma kvad-rätning,
inset-svep och färg+struktur-avtryck som enkelskanningen; alla celler i EN
förfrågan till nya `/api/scanner/identify-bulk` (art-only, `identifyCellsArt`
→ matchCards med tom OCR = exakt vision-hoppade vägen, tryckningar + priser
inkl.). Säkra celler (trust-regeln, basvillkoret — en cell är EN ruta, ingen
samstämmighetssänkning) blir träffar direkt: **$0, ingen kvot**. Osäkra celler
körs SEKVENTIELLT genom vanliga `/identify` med cellens utsnitt + nederkants-
remsa → vision, kvot (PER VISION-ANROP, ägarbeslut 2026-08-01), diagnostik och
feedback-loopen precis som enkelskanningar. Resultaten blir vanliga ScanItems
— remsan, granskningen, syskonlistan och lägg-till-alla fungerar orört.

⛔ **INGA OUTSETS i bulk** (`captureBulkCells`): utvidgas en cell blöder
GRANNKORTET in och avtrycket matchar en blandning av två kort. Kvad-rätningen
per cell (padding 4 %) tar snedlagda kanter i stället. Live-pollen/låset är
avstängda i bulk-läget (enkortsbegrepp; 9 celler × 2 poll/s vore CPU utan
mottagare).

**Kostnadsform**: ~10 kB upp per sida (9 celler × 4 avtryck), ~1 s server-CPU
mot indexet i minnet, 0 nytt residentminne, Neon = PK-uppslag. Vision bara för
osäkra celler à $0,0054.

**OMÄTT (nästa mätning)**: pärmficke-BLÄNK är den förväntade felkällan — plast
över korten är en fångstkvalitet vi aldrig mätt. Ägaren fotar pärmsidor, facit
via scoreboardet som vanligt. Känd v1-lucka: korrigeringar på art-säkra
bulk-celler ger ingen feedback-rad (inget ScannerJob-id utan vision) — bara
vision-cellerna bär auto-facit.

**v2 SAMMA DAG — FRILAGD DETEKTERING, RUTNÄTET BORTA (ägarens bordstest)**:
fasta 3×3-celler beskar fel när korten inte låg exakt i rutorna ("some right
and some not"), och ägaren ville inte ha rutnätet. `detectCardRegions`
(card-quad.ts, testad): bakgrundssegmentering — bordet skattas som median-RGB
ur bildens KANTRING, adaptiv tröskel ur kantringens egen spridning (mönstrat
bord kräver större avstånd än slät duk) — + sammanhängande komponenter +
formvalidering (area 0,4–30 %, bbox-form, fyllnadsgrad). Varje funnen region
körs sedan genom exakt samma per-kort-maskineri (kvad-rätning för precisa
hörn, inset-svep, avtryck). Ingen guide: "sprid ut korten med lite mellanrum".
⛔ Kort kant-i-kant smälter ihop till EN blob och förkastas av areataket —
hellre "inga kort hittades"-toast än en blandfångst; en pärmsida (nio kort
kant i kant) är därmed FORTFARANDE osupportad i frilagt läge. "Manuell
inmatning"-knappen i kameravyn ersattes med bulk-växlaren (ägarbeslut —
sökningen finns i katalogen).

**FÄLTRUNDA 3 (2026-08-01) — FELET LÅG I TRÖSKELN, INTE I SÄRDRAGET**: ägarens
två riktiga fångster (samma sex kort på ett skrivbord, tio sekunder isär) gav
**0 respektive 5 av 6** kort. `scripts/bulk-debug.ts` + tröskelsvepet (`SWEEP=1`)
visade att bandet där ALLA sex korten hittas är t≈40–80 i båda bilderna — medan
den live valda tröskeln låg på **178 respektive 293**. Tre oberoende fel, alla
med samma orsak: ramen bär en TREDJE klass (tangentbord upptill, fotografens
kropp nedtill) som är både STÖRRE och längre från bordsfärgen än korten.

1. **Brusgolvet mättes mot fel referens.** Varje pixel mäts mot det LOKALA
   bakgrundsfältet, men golvet räknades mot den GLOBALA medianen — så en
   kantring som innehåller tangentbord och vit tröja läste 209 som "brus"
   (×1,4 = 293). Golvet mäts nu i samma fält, och ROBUST: ringens p95 ÄR
   skräpet när skräpet ligger i ringen (ringens p50 var 9 och p95 90 i samma
   bild). Median + 3 robusta σ (MAD) ger 51 resp. 46 i stället för 127/135.
2. **Ett enda Otsu-snitt lade sig mellan BORDET och skräpet**, inte mellan
   bordet och korten (103–104, långt över bandet). Snittet körs nu i TVÅ nivåer
   — andra snittet på fördelningen under det första → 43,2 resp. 45,0, mitt i
   bandet.
3. **Formvillkoren släppte igenom kroppen**: 28 % av bilden, bbox-form 1,55,
   hög fyllnadsgrad — den passerade varenda villkor (spannen är med flit
   generösa för snedlagda kort). Nytt villkor: **storlekssamstämmighet**. Alla
   Pokémon-kort är FYSISKT lika stora, så deras areor i ETT foto måste ligga
   nära varandra; blobbar utanför 0,4–2,5× fältets UNDRE median förkastas.
   ⛔ Det är ett FÖRHÅLLANDE, inte ett tak — hårdkoda aldrig en maxarea i
   stället: två kort fotade nära fyller mer av bilden än sex på håll.

Utfall: **6 av 6 kort i BÅDA fångsterna, noll falska regioner** (var 0 resp.
5 äkta + 2 falska). Detektorn är dessutom inte längre knivseggsberoende av
tröskeln — den ger 6 regioner över hela bandet 40–80 i stället för i en punkt.

⚠️ **KÄND, OFIXAD SVAGHET — LJUST FÖREMÅL SOM RÖR BILDKANTEN**: bakgrundsfältet
blandar in kantringen även långt in i bilden (en centrumpixel hämtar ~36 % av
sin bakgrund från topp+botten). Når ett STORT, LJUST föremål fram till kanten —
en vit ärm eller tröja nederst — dras fältet mot ljust och masken kan INVERTERA:
bordet blir förgrund och korten bakgrund. MÄTT i en syntetisk tvilling: bordet
hamnade 60 RGB-enheter från sin EGEN bakgrundsskattning och detektorn fann 1 av
6 kort. Ägarens två fångster klarar sig för att bildkantens nedersta rader är
mörka byxor; flyttas tröjan ner i kanten faller det. ⛔ Detta går INTE att fixa
genom att kasta "avvikande" ringsegment: en äkta ljusramp (fönsterljus) ger
precis lika stora segmentavvikelser som skräp gör — det testet finns redan och
skulle gå sönder. Riktningen som skulle lösa det är en annan
bakgrundsmodell: översvämning inifrån bildkanten med LOKAL färgtolerans (bordet
= den sammanhängande yta som når kanten), där en skarp kant stoppar fyllningen.
Det är en omskrivning av detektorns kärna och ska INTE byggas på två foton —
nästa fältrunda bör medvetet innehålla en fångst med ljus ärm/tröja i bildkanten
så beslutet vilar på mätning.
⛔ Och den syntetiska tvillingen ströks som enhetstest med flit: den fick fyra
olika svar medan de riktiga fotona var stabila, och att tuna en syntetik tills
den matchar verkligheten är precis det fältrunda 2 gjorde fel. Enhetstestet
täcker nu det som går att påstå deterministiskt (storleksfiltret); resten mäts
med `bulk-debug.ts` mot riktiga fångster.

## Öppet — nästa steg
1. **`numberLegible` är just infört och OMÄTT.** Modellen får nu svara ja/nej på om
   varje tecken i numret var läsbart, och numret används bara när svaret är ja.
   Hypotesen är att en rak ja/nej-fråga fungerar bättre än att förvänta sig ett tomt
   fält (prompten har sagt "hellre tomt än fel" hela tiden och modellen struntade i
   det). **Mät med `scanner-telemetry.ts`**: andelen "nr oläst" bör stiga kraftigt,
   och felaktiga träffar drivna av påhittade nummer bör försvinna.
2. **Testa på FYSISKA kort.** Det är den enda ogjorda mätningen som kan flytta
   klassiska kort, eftersom numret då faktiskt finns i bilden. Ägaren hade inga kort
   2026-07-30.
3. **Om klassiska kort ska fungera på skärmfoto** krävs särdrag som överlever
   omrendering (kanter/struktur snarare än färg). ⛔ Kan INTE valideras med
   `scripts/art-audit/` — harnesset härleder frågan ur referensfilen och kan därför
   inte modellera "en annan rendering av samma kort", vilket är precis det som
   fäller färgbaserad matchning. Kräver riktiga fångster först (telemetrin samlar
   dem).
4. **132 kort saknar avtryck** — döda bild-URL:er uppströms (mcd17/mcd18 + en promo,
   404 på både hires och liten variant). De matchas som förut på namn/nummer.
5. **Kostnadsläge (MÄTT 2026-08-01, API:ts egna tokental)**: **$0,0054 per
   Haiku-anrop** (medel 4 613 in / 149 ut tokens — de gamla $0,0029 var en
   underskattning, ägaren fångade det mot konsolen), och ~79 % av skanningarna
   hoppar numera anropet helt (trust + ruta-samstämmighet) → blandat
   ~$0,001/scan, ~$0,18/mån för en Pro-användare vid kvottaket. Konsolens
   dagssumma blandar skannern med batch-jobbens Haiku (Tradera-domen) på samma
   nyckel — `scanner-telemetry.ts` visar skannerns egen, mätta kostnad.
   ⛔ Prompt-cache hjälper inte här: Haiku 4.5:s minsta cachebara prefix är
   4096 tokens, vår prompt+schema ~2000 → cachear tyst aldrig.
   Indexet ligger i 5,1 MB
   processminne, laddas latt vid första skanningen, och Neon-arbetet per skanning
   GICK NER (bilden ger kort-id → uppslag på primärnyckel). Ingen pgvector.
   Vill man höja modellen står kostnadstabellen i `CLAUDE.md`.

## Verktygen (allt är resumerbart och läser bara)

```bash
# Verklig träffsäkerhet från riktiga skanningar (admin-telemetri)
node scripts/with-prod-db.mjs npx tsx scripts/scanner-telemetry.ts

# Replaya riktiga skanningars avtryck genom searchByFrames (mät viktändringar)
node scripts/with-prod-db.mjs npx tsx scripts/scanner-replay.ts

# Katalogslagningen mot facit (simulerad felfri OCR)
node scripts/with-prod-db.mjs npx tsx scripts/scanner-match-audit.ts

# Bildmatchningens revision — se scripts/art-audit/README.md
node scripts/with-prod-db.mjs npx tsx scripts/art-audit/dump-cards.ts
npx tsx scripts/art-audit/fetch-images.ts          # ~20 500 bilder till .spike/
ONLY=grid8x11 PROFILE=harsh npx tsx scripts/art-audit/eval.ts
node scripts/with-prod-db.mjs npx tsx scripts/art-audit/margin-audit.ts

# Bygg avtryck för nya kort (körs automatiskt i import-new-sets.yml)
node scripts/with-prod-db.mjs npx tsx scripts/build-art-fingerprints.ts
```

`.spike/` är gitignorerad (bildcachen är hundratals MB och repot är publikt).
