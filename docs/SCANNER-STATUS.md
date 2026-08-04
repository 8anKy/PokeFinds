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

⛔ Den syntetiska tvillingen ströks som enhetstest med flit: den fick fyra olika
svar medan de riktiga fotona var stabila, och att tuna en syntetik tills den
matchar verkligheten är precis det fältrunda 2 gjorde fel. Enhetstestet täcker
det som går att påstå deterministiskt (storleksfiltret); resten mäts med
`bulk-debug.ts` mot riktiga fångster.

⚠️ Fältrunda 3 förutsåg sin egen efterföljare: "ett stort LJUST föremål som når
BILDKANTEN kan invertera masken". Ägaren fotade nästa runda med t-shirt i
nederkanten — och det inträffade. Se nedan.

## FÄLTRUNDA 4 (2026-08-01): MODELLBYTE — BAKGRUND = DET SOM NÅR BILDKANTEN

Ägarens tredje fångst (sex kort, t-shirt i nederkanten) gav **fyra kort + ett
tygveck som "kort"**. Tröskelsvepet visade att **INGEN tröskel i hela stegen
30–170 gav alla sex korten** — vid t=50 saknades nedre mitten, vid t=60–80 nedre
vänster, och tröjvecket följde med på alla. Felet satt alltså i MODELLEN, inte
i talet, och tuning hade inte kunnat rädda det.

**Varför den gamla modellen föll**: den skattade en bords-FÄRG ur kantringen och
mätte färgavstånd mot den. Ett stort ljust föremål som når kanten drar fältet mot
ljust → korten närmast tröjan sjunker under tröskeln, och vecket blir självt en
region. MÄTT i en syntetisk tvilling: bordet hamnade 60 RGB-enheter från sin EGEN
bakgrundsskattning.

⛔ **En MSER-lik stabilitetsregel PRÖVADES och MOTBEVISADES.** Hypotesen var att
kort har skarpa kanter och behåller sin area över ett brett tröskelband medan
tygveck växer/krymper. MÄTT över stegen: kortens areakvot var **1,62 och 1,69**
(de växer ihop med grannar vid låg tröskel) medan tröjvecket låg på **1,43** —
korten var alltså MINDRE stabila än den falska regionen. Bygg inte om den.

**Modellen är nu**: översvämning inifrån BILDKANTEN med LOKAL färgtolerans —
"bordet är det sammanhängande som når kanten" i stället för "bordet har den här
färgen". En ljusramp är slät → fyllningen går rakt igenom (det som krävde
segmentknep förut). En kortkant är skarp → fyllningen stannar. Tröjan når kanten
→ den blir bakgrund, precis som bordet. Nedströms är allt oförändrat: erosion,
komponenter, formvillkor, storlekssamstämmighet.

**MÄTT på alla tre riktiga fångsterna: 18 av 18 kort, NOLL falska** (var 6 + 6 +
4 kort och 1 falsk). Toleransen är okänslig — 12, 16, 22 och 30 ger alla sex
korten i alla tre bilderna, så talet är inte finjusterat mot fotona.

⛔ **TOLERANSEN ÄR EN KEDJA, INTE ETT AVSTÅND.** `REGION_FLOOD_TOL` = 12 sattes
inte av de riktiga fotona utan av lågkontrast-testet: ett kort 37,7 RGB-enheter
från bordet får sin kant UTJÄMNAD av nedskalningen till två steg om ~19, och vid
tolerans 22 vandrade fyllningen rakt igenom och åt upp HELA kortet. Det är det
nya felläget: den gamla modellen degraderade gradvis, den här tappar ett helt
kort på en enda mjuk kant. `diag.backgroundFrac` skiljer fallen åt — nära 100 %
= läckage, låg andel = ådringen stoppade fyllningen.
⛔ Ett kort som NUDDAR bildkanten fylls som bakgrund och tappas (med flit: ett
kort i kanten är ändå beskuret).
⚠️ **Kort som ligger PÅ en matta/musmatta är omätt**: mattan är då förgrund och
korten sitter ihop med den till en enda blob som förkastas av areataket. Samma
begränsning fanns i den gamla modellen. Fixen om det visar sig i fält: kör om
fyllningen INUTI en förkastad jätteblob med dess egen kant som utgångspunkt.
Bygg inte förrän ett foto visar det.

## FÄLTRUNDA 5 (2026-08-01): 5 av 6 — UPPLÖSNING, INTE MORFOLOGI

Första fångsten på den nya modellen: **fem regioner, alla korrekta, noll falska**
(tröjan och tangentbordet borta som avsett). Det saknade kortet var inte missat
utan **hopslaget**: en region 110×78 med formen 1,41 täckte topp-mitten OCH
topp-höger, medan de fyra andra var rena kort (form 0,70–0,84).

⛔ **Formen kan INTE avslöja det**: två stående kort sida vid sida ger 1,41 och
ett LIGGANDE kort ger 88/63 = 1,40. Samma tal.

**Mätt i masken** (ASCII-karta över springan): korten ligger ~4,5 px isär i
480 px-fångsten → **1–2 maskpixlar** vid maskbredd 240, och boxmedelvärdet
blandar springan med kortens ljusa kanter. Springans MÖRKASTE nedskalade värde
blev `134,126,103` mot bordets ~40 — den ser alltså ut som FÖRGRUND, oavsett
tolerans. (Tolerans 16 råkar separera dem, men ger falska regioner på tre av de
andra fångsterna: 12 ger 6/6/6/6/5 och noll falska, 16 ger 30/30 kort men fyra
falska. Noll falska väger tyngre — en falsk cell kostar ett vision-anrop, kvot
och kan ge ett felaktigt kort.)

⛔ **STARKARE EROSION PRÖVAD OCH MOTBEVISAD**: både 2 pass och STRIKT erosion
(kräv alla 4 grannar i stället för 3) gav oförändrat 5 av 6. Skälet är att
bryggan inte är en tunn brygga utan en UTSMETAD kant — det finns ingen smal
midja att erodera bort. Regeln ">= 3 av 4 grannar" tar dessutom aldrig bort en
3 px bred brygga alls: dess inre pixlar har 4 grannar.

⛔ **HÖGRE MASKUPPLÖSNING GICK INTE ATT MÄTA** — och försöket var vilseledande:
maskbredd 480 mot de sparade felsökningsbilderna gav SÄMRE utfall (7 regioner,
falska) därför att bilderna själva redan är nedskalade till 480 av klienten. Att
höja masken förstorar då bara bruset i stället för att återfå detalj som redan
är kastad. **Informationen finns i videorutan (~1080 px) men slängs innan något
sparas.**

Åtgärd nu: `BULK_DETECT_MAX` 480 → **960**, så nästa fångst BÄR springan.
Detekteringen är oförändrad (masken är fortfarande 240, bara bättre
medelvärdesbildad) — det här är ett mätbarhetsfix, inte en detektorändring.
Nästa runda kan `REGION_MASK_MAX` = 480 testas mot riktig data och shippas om
den vinner. **Tills dess: lägg några millimeter mellan korten.**

## FÄLTRUNDA 6 (2026-08-01): detekteringen är löst — MODELLEN var felet

Alla sex korten hittades, men **fyra av sex identifierades fel**. Diagnostiken
(fem vision-anrop, ett art-säkert) visar att felet INTE satt i bilden:

| kort (facit) | modellen sa | valdes | bilden sa |
|---|---|---|---|
| Mudbray | "Moobury" 40/102 | Machoke 40 | Mudbray 107 · 0,766 |
| TR's Nidorino | "Nidorina" | Nidorina 56 | Nidorino 118 · 0,818 |
| Crustle | "Crustle" | Crustle 12 ✔ | Crustle 12 · 0,676 |
| Camerupt | "Cyndaquil" | Cyndaquil 23 | Camerupt 28 · 0,676 |
| Probopass | "Groudon" 35/95 | Groudon 29 | Probopass 98 · 0,722 |

**Bilden hade rätt i 6 av 6 celler, modellens namn i 1 av 5.** Orsaken är att
en bulk-cell ger Haiku ett kort på ~240 px (mot ~1568 px när ett kort fyller
rutan) — den läser HP rätt men hittar på NAMNET. Tre buggar lät det vinna:

1. **Korsvalideringen av namnet kunde inte ens fira.** Den var grindad på
   `artConfidentCardId`, dvs bara när bilden är BEVISAD — men är bilden bevisad
   hoppas vision över helt. Namnet var alltså antingen irrelevant eller
   oemotsagt, aldrig VÄGT. Nu räcker det att bilden har en ÅSIKT
   (`ART_OPINION_*`: poäng ≥ 0,6 och marginal ≥ 0,04) för att få ifrågasätta ett
   namn den inte känner igen. Marginalgolvet skiljer det från Rayquaza-fallet
   som motiverade det strikta villkoret (marginal 0,011 = ingen åsikt).
2. **Nummerbonusen glömde dämpningen i EN av tre grenar.** Grenen "numret
   stämmer men totalen skiljer" la till 0,25 UTAN `nameWeight`, och blev därmed
   den enda vägen för ett misstrott modellsvar att vinna ändå: "Groudon 35/95"
   på en Probopass gav Rhydon 35 poängen 0,346 mot bildens 0,217. Samma
   modellsvar, samma misstro, alla grenar.
3. **Misstron var utmätt.** Ett hallucinerat men EXAKT kortnamn gav
   1,05 × 0,25 = 0,263 och slog bildens bästa kandidat (0,722 × 0,3 = 0,217) —
   dvs `NAME_DISTRUST` kunde aldrig ändra ett utfall. 0,25 → **0,20**. MÄTT:
   utfallet är IDENTISKT hela vägen ner till 0,10 (en hylla, ingen knivsegg).
4. **Rätt kort föll ur listan.** Skiktregeln lyfter bildkandidater över
   namn-syskonen först vid `ART_STRONG` = 0,75; Probopass låg på 0,722 och
   hamnade i "övrigt", utträngd av tolv Groudon-syskon — användaren kunde inte
   ens VÄLJA rätt kort. När namnet är misstrott räcker det nu att kortet är en
   bildkandidat alls.

**MÄTT på facitsetet** (`scripts/scanner-choice-replay.ts`, nu 52 märkta
skanningar — ägarens fem bulk-celler tillagda): **46/52 → 48/52, noll nya fel.**
Bulk-cellerna gick från 1/5 till 3/5 rätt.

⚠️ **KVAR (2 av 5)**: "Nidorina" på Team Rocket's Nidorino landar på
namnlikhet exakt 0,50 = `NAME_AGREE_MIN`, så misstron firar inte (modellen
namngav ett ANNAT verkligt kort vars namn matchar bättre än det rätta kortets).
"Cyndaquil" på Camerupt är en praktiskt taget jämn poäng (0,239 mot 0,238)
mellan två BILDkandidater. Båda kräver fler facitmärkta fall innan man rör
trösklarna — att tuna dem på ett fall vardera är precis det fältrunda 2 gjorde
fel.

## FÄLTRUNDA 7 (2026-08-02): hopslagningen LÖST — maskupplösningen var gränsen

Mätbarhetsfixen från runda 5 (`BULK_DETECT_MAX` 960) betalade sig direkt: två
fångster som BÄR springan mellan korten fanns nu att mäta på.

| mask | 22:20-fångsten (hopslagen) | 21:30-fångsten |
|---|---|---|
| 240 (dåvarande) | 5 — **två kort hopslagna** | 7 (6 kort + skräp) |
| 360 | 8 — två kort saknas + skräp | 6 ✔ |
| **480** | **7 — paret SPLITTAT, 6 kort + 1 skräp** | **6 ✔** |
| 640 | 6 ✔ | 6 ✔ |

`REGION_MASK_MAX` 240 → **480**. Alla sex korten skiljs vid varje mask ≥ 480;
det som varierar ovanför är EN ensam skräpregion.
⛔ **640 valdes INTE fast det gav snyggast siffra** (6 och 6): 560 → 7, 640 → 6,
800 → 7, 960 → 8 på samma foto. Skräpregionen kommer och går, dvs brus — att
välja 640 vore att överanpassa mot två foton. 480 är gränsen där själva
problemet (springan under en maskpixel) faktiskt löses, och den billigaste:
masken går från 32k till ~130k pixlar, och flödesfyllningen är O(n) på telefonen.
⛔ Den äldsta fångsten (tagen före `BULK_DETECT_MAX` = 960) är fortfarande
hopslagen vid ALLA masker — informationen är kastad i själva bilden. Det är
också beviset för att runda 5:s offline-försök ("högre mask gav sämre") mätte
brus, inte modellen.

## FÄLTRUNDA 8 (2026-08-02): marginalen mättes mot ett SYSKON

Åtta kort. Modellen hittade på "Noctowl 088/102" på en Team Rocket's Murkrow —
och vann, trots att bilden hade kvällens STARKASTE träff: Murkrow 126 på 0,892
och Murkrow 127 på 0,884.

Orsaken: `artOpinion`-marginalen mättes mot NÄSTA RAD, och nästa rad var samma
Pokémon i en annan tryckning. Marginalen blev 0,008 och lästes som "bilden har
ingen åsikt" — varpå namnet inte dämpades alls. Bilden var i själva verket helt
säker på VILKEN Pokémon det var; den kunde bara inte välja tryckning.
Marginalen mäts nu mot bästa kandidat med ett ANNAT KORTNAMN (0,892 → 0,703 =
0,189). ⛔ För att välja TRYCKNING är den lilla marginalen fortfarande rätt
signal (`ART_TRUST_*` orört) — det är bara frågan "ska modellens NAMN tros"
som den var fel svar på.

Utfall: cellen ger nu Team Rocket's Murkrow i stället för Noctowl. **KVAR**:
126 (Ascended Heroes) och 127 (Destined Rivals) hamnar på IDENTISK slutpoäng
och avgörs av tie-breaken "nyast set först" — som väljer 126, medan ägarens
kort var 127. De två tryckningarna är visuellt oskiljbara (0,9 % isär) och
numret som hade avgjort läste modellen fel. Två facitfall pekar nu åt samma
håll (ey0wdb + 6jj9m2, samma kortpar) — men n=2 på ETT kortpar räcker inte för
att vända en global heuristik.

MÄTT: 53 facitmärkta skanningar, 48/53 — oförändrat mot före ändringen
(Murkrow-cellen räknas fortfarande som fel eftersom tryckningen blir fel), noll
regressioner.

## FÄLTRUNDA 9 (2026-08-02): formsamstämmighet + VINKELN ÄR EN HUVUDFAKTOR

Åtta kort, alla åtta hittade — plus två skräpregioner: ett tygveck på knäet
(form 2,50) och datorskärmens filträdspanel (form 0,56). Skärmpanelen NÅR
bildkanten men fyllningen stannar vid panelens skarpa kant, så en ö blir kvar
inuti bakgrunden. Korten låg mellan 0,98 och 1,33.

**FORMSAMSTÄMMIGHET** (samma princip som storleksfiltret): korten är fysiskt
lika formade och ses från EN vinkel, så bbox-formerna måste klustra. MÄTT över
fem riktiga fångster ligger äkta kort inom **0,83–1,14 av fotots MEDIANform**;
skräpet låg på 0,48 och 2,13. Spannet är satt till 0,65–1,55 (~1,3x marginal).
Utfall på ägarens fångst: 10 regioner → **exakt de 8 korten**.
Bonus: en hopslagen kortPAR-region landar på 1,78–1,93 av medianen och
förkastas nu — samma linje som redan gäller kort kant-i-kant (hellre färre
funna kort än en blandfångst som identifieras självsäkert till FEL kort).

⚠️ **VINKELN ÄR EN HUVUDFAKTOR FÖR BILDMATCHNINGEN — mätt, inte gissat.**
Samma Murkrow gav bildpoäng **0,892** kl. 22:30 och **ingen träff alls** (topp
var Arceus V 0,546) kl. 22:46. Skillnaden är hur platt kortet sågs:

| fångst | kortens bbox-form | bildens topp-poäng |
|---|---|---|
| 21:30, 22:20 | 0,73–0,87 (nära platt) | 0,64–0,82 |
| 22:30 | 0,84–1,04 | upp till 0,89 |
| 22:46 | **0,98–1,33** (brant vinkel) | **0,53–0,67** |

Ett platt kort är 0,716. Form ≈ 1,0–1,33 betyder kraftig perspektivförkortning,
och då matchar avtrycket inte katalogens raka bild. Kvad-rätningen ska
kompensera men uppenbarligen inte tillräckligt på små, snedsedda regioner.
**Praktisk följd: fotografera RAKT UPPIFRÅN.** Öppet: mät varför
`detectCardQuad` inte räddar de här cellerna (regionerna är bara ~86x72 px).

**BEKRÄFTAT SAMMA KVÄLL (22:57, rakt uppifrån, sex kort): 6 av 6 RÄTT.**
Kortens bbox-former låg på **0,74–0,81** (platt kort = 0,716) och bildens
topp-poäng på 0,736–0,867 — precis det sambandet tabellen ovan förutsade.
Två följder utöver träffsäkerheten:
- **Bara 3 av 6 celler behövde vision alls.** De andra tre klarade trust-regeln
  på bilden → $0 och instant. Rak vinkel halverar alltså kostnaden.
- **Team Rocket's Murkrow 127** — kortet som två gånger tidigare blev Noctowl
  respektive fel Murkrow — träffades nu av BÅDA signalerna: modellen läste
  "Team Rocket's Murkrow 127/182" korrekt OCH bilden hade 127 överst (0,867)
  före 126 (0,865). Tryckningsvalet löstes alltså av numret, precis som
  arkitekturen säger att det ska ("bilden föreslår, numret avgör").

## FÄLTRUNDA 10 (2026-08-02): byxvecket, och KAMERAN ÄR INTE FLASKHALSEN

Tre fångster med fem kort. Kameran loggas nu: **2160x3840 (äkta 4K)** — med fem
kort blir varje kort ~500x680 px i källan, alltså INGEN pixelsvält. Frågan
"kan vi förbättra pixlarna" är därmed besvarad för 5–9 kort: nej, det är inte
där felet sitter.

Ett byxveck kom med som kort. Två fel bakom det:

1. **Referensen var mitten av ALLT, inte av korten.** Storleksfiltret tog undre
   medianen av alla formvaliderade blobbar och antog att skräpet är STÖRRE än
   ett kort. MÄTT här var det tvärtom: fem kort (area 4408–5312) och fem
   SMÅskräp (391–2178) gav undre median **2178 — ett skräpvärde** — och bandet
   runt det släppte in vecket. Referensen är nu **kortKLUSTRET**: varje kandidat
   röstar på hur många andra som ligger i dess storleksband, och den största
   gruppens median vinner (korten fick 5 röster, skräpklustren 2–3).
2. **Fyllnadsgraden användes inte.** Den är den starkaste skiljelinjen mot tyg
   och skuggor och den enda med FYSISK grund: ett kort är en STYV rektangel och
   fyller sin bbox. MÄTT över de tre fångsterna: **korten 0,86–0,98, skräp med
   meningsfull area 0,37–0,66.** Storleks- och formbanden skilde samma skräp med
   ~5 % marginal; fyllnadsgraden gör det med ~20 %.
   ⛔ **Absolut tröskel går inte**: ett kort vridet 15° har fyllnadsgrad 0,65 rent
   geometriskt — samma som skräpet. Därför RELATIVT klustrets median (0,85), som
   storlek och form: ligger alla kort vridna följer medianen med.

Utfall: 6/5/5 → **5/5/5**, och alla tidigare fångster oförändrade (den enda som
inte ger kortantalet är den med två kort kant i kant, som förkastas med flit).

## FÄLTRUNDA 11 (2026-08-02): MÖNSTRAT UNDERLAG ÄR STRUKTURELLT OMÖJLIGT

Fem kort på två olika mönstrade underlag (rutig handduk på ett geometriskt
mönstrat överkast): **noll kort identifierade** i båda. Detta är inte en bugg
att tröskla bort — det är modellens gräns.

**Varför**: bakgrunden definieras som "det sammanhängande som når bildkanten"
med LOKAL färgtolerans. Ett mönstrat underlag har STÖRRE inbördes kontrast än
gränsen kort↔underlag: fyllningen stoppas av mönstret, underlaget blir självt
förgrund, och korten hamnar INUTI den massan — osynliga.
⛔ **Toleransen kan inte rädda det** (svept): vid 12 tar bakgrunden bara 42–50 %
av bilden (normalt 66–78 %); höjs den tillräckligt för att korsa mönstret
(30–40) läcker den samtidigt genom KORTEN → 92–100 % bakgrund, noll regioner.
Det finns inget fönster däremellan, för ett vitt kort mot en vit ruta i mönstret
är en mindre färgskillnad än mönstrets egna rutor.

**Detekteras nu i stället för att gissa.** Signaturen är entydig — största
FÖRKASTADE blobben som andel av bilden:

| fångster | största förkastade blob |
|---|---|
| fungerande (8 st) | **3,3–11,2 %** |
| mönstrat underlag (4 st) | **17,4–54,7 %** |

`REGION_BUSY_MAX_BLOB` = 14 % (~25 % marginal åt båda håll). Slår den till
skickas INGA celler vidare (varje "region" är en bit av underlaget — det hade
kostat vision-anrop och kvot på rena gissningar) och användaren får en EGEN
text: "Underlaget går inte att skilja från korten — lägg dem på en enfärgad yta
som når bildens kanter." ⛔ Bara FÖRKASTADE blobbar räknas: ett enda kort fotat
nära är också en stor blob, men den godkänns och ska inte larma.

**Samma signatur väntas för kort på en MATTA/pärmsida som inte når bildkanten**
(underlaget blir en ö som korten sitter fast i). Skillnaden är att DEN gången
finns en riktig fix — kör om fyllningen INUTI den förkastade jätteblobben med
dess egen kant som utgångspunkt. Det hjälper INTE mot mönster (fyllningen
stoppas av samma mönster igen), så bygg det först när en fångst visar en ENFÄRGAD
ö. Vill man stödja mönstrade underlag på riktigt krävs en annan detektor:
kant-/rektangelsökning (Hough) i stället för bakgrundssegmentering.

### Mönstrat underlag: FYRA angreppssätt provade och MOTBEVISADE (2026-08-02)

Ägaren bedömde mönstrade underlag som viktigt. Signalen FINNS — kortens konturer
syns som slutna rektanglar i kantbilden vid analysupplösning 300 — men fyra
billiga vägar dit är nu uteslutna. Bygg dem inte igen:

1. **Befintliga `detectCardQuad` på hela rutan.** Hittade NOLL kvadrater på alla
   fyra mönstrade fångster (och på en fungerande fångst en enda kvadrat runt
   HELA kortblocket). Den är byggd för ETT kort som fyller rutan och behåller
   bara 8 linjetoppar per riktning — fem kort ger tio lodräta kortkanter plus
   allt mönstret bidrar med.
2. **Slutna ytor i kantbilden** (fyll det som kanterna omsluter). NOLL kort:
   kortets INRE är bildens mest detaljrika yta (konst + text), så det faller
   sönder i småbitar, medan slät handduk bildar rena komponenter. Metoden hittar
   FLATA ytor — och kort är det minst flata som finns i bilden.
3. **Kanttäthet** (kort = tätt av detalj, underlag = glesare). Svept över
   fönster 7–13 och tröskel 0,12–0,40: bästa utfallet gav 5 regioner på
   handduksfångsten, men ingen av dem var ett kort.
4. **Täta kantblobbar** (morfologisk slutning så kortet blir en fylld klump).
   Kortens kanttäthet smälter ihop med handdukens våffeltextur → korten hamnar i
   en enda förkastad jätteblobb. Noll kort vid dilation 2, 3 och 4.

5. **FLERKVADRATSSÖKNING — BYGGD OCH MOTBEVISAD (2026-08-02).** Full
   implementation: ~40 linjetoppar per riktning, kandidatrektanglar ur alla
   linjepar, hårda villkor (kortproportion 0,45–1,55, area 0,4–25 %, kantstöd
   ≥ 50 % på ALLA FYRA sidor, inre kanttäthet ≥ 0,08), girigt icke-överlappande
   urval, storlekskluster. **Noll kort på de mönstrade fångsterna** i två
   varianter: (a) ren stödpoäng valde kortens INRE ramar (konstfönster,
   textrutor) — de har krispigare tryckta kanter och tätare innehåll än
   kortets ytterkant mot underlaget; (b) med areavikt + inneslutningsspärr
   ("ytterst vinner", samma regel som `pickPair`) hamnade valen i stället på
   handduken och överkastet. Kostnad ~600 ms per fångst.
   **Grundorsaken**: kortets kant mot handduken är LÅGKONTRAST medan mönstrets
   linjer är HÖGKONTRAST. Varje GLOBAL kanttröskel lyfter därför fram mönstret
   och trycker ner kortkanten — samma asymmetri som fäller bakgrundsfyllningen,
   bara i kantdomänen. Koden är ÅTERSTÄLLD (inget dött spekulativt i repot).

6. **LOKALT NORMALISERAD KANTSTYRKA — PROVAD 2026-08-02. FÖRSTA SIGNALEN, men
   klarar inte kravet.** Gradienten delas med ett lokalt medel (fönster 21 px i
   analysskala 300), så kortkanten bedöms mot SIN omgivning i stället för mot
   bildens starkaste mönsterlinjer. **Kortkonturerna framträder då tydligt** —
   mätbart bättre än den globala tröskeln, där de var nedtryckta. Hela kedjan
   (normaliserad kantbild → riktningsseparerade kant­pixlar → lod-/vågräta
   linjetoppar → kandidatrektanglar → kantstöd ≥ 0,55 på alla fyra sidor →
   girigt urval) gav på den mönstrade blankettfångsten **2 av 5 kort rätt**
   (Probopass och Murkrow), plus en ruta som svalde hela översta raden och två
   på överkastet. **Alla fem tidigare försök gav NOLL kort** — det här är alltså
   första gången något alls hittas på ett mönstrat underlag.
   ⛔ **Men kravet var 5 av 5 på alla fyra fångster, och 2 av 5 är fail.**
   Svagheten är linjesökningen, inte normaliseringen: kolumn-/radprofiler är
   GLOBALA, så ett korts vänsterkant konkurrerar med allt annat i samma kolumn —
   därför blev tre kort på rad EN rektangel. Nästa steg vore riktig
   riktningsgrindad Hough per delområde i stället för globala profiler.
   Koden är INTE inlagd (provet låg i .spike/).

7. **LOKALA KANTSEGMENT i stället för globala profiler — PROVAD 2026-08-02,
   SÄMRE ÄN 6.** Rättade det som var fel i försök 6: i stället för kolumn-/rad-
   profiler (globala, så ett korts vänsterkant konkurrerar med allt i samma
   kolumn) söktes SEGMENT — sammanhängande körningar av riktningsseparerade
   kantpixlar, lokala per konstruktion, med hålöverbryggning och sammanslagning
   av tjocka kanter. Fyra segment som möts i hörn = kandidatrektangel.
   Utfall: **0 av 5 kort på BÅDA de mönstrade fångsterna**, vid varje testad
   kombination av täckningskrav (0,30–0,55) och proportionsband (1,10–1,60).
   Kontrollen på ENFÄRGAT underlag gav 4–5 rektanglar, så maskineriet fungerar —
   det är på mönster det inte går. Segmenten FINNS (34–41 lodräta, 57–76 vågräta
   per fångst), men fyra av dem bildar aldrig en kortformad rektangel: mönstrets
   egna linjer bryter kortkanten i korta bitar och fyller mellanrummen med
   segment som råkar ligga på fel ställe. Koden är inte inlagd.

**Sammanfattning efter sju försök**: bästa resultatet är fortfarande försök 6:s
**2 av 5** (lokalt normaliserad kantstyrka + globala profiler). Ingen väg har
klarat kravet 5 av 5. ⛔ Sluta leta efter en klassisk bildbehandlingsvariant —
sex av sju försök gav NOLL, och det sjunde 2 av 5. Det som återstår är en
LÄRD detektor (liten objektdetektor tränad på kortfoton), vilket är ett annat
slags projekt: träningsdata, modellhosting, latens och beroenden — och
`CLAUDE.md` avvisar redan tunga bildberoenden (OpenCV.js = 8 MB WASM per
besökare). Väg det mot att `bulkBusySurface` nu ger ett tydligt besked och att
ett enfärgat underlag (papper, bok, bordsskiva) alltid finns till hands.

**Idén som gav mest**: lokalt normaliserad kantstyrka (dela gradienten med ett
lokalt medel) så att kortkanten bedöms mot SIN omgivning i stället för mot
bildens starkaste mönsterlinjer. Det angriper den uppmätta grundorsaken direkt,
men förstärker också handdukens egen textur — utfallet är osäkert och det är
sjätte försöket. Före ytterligare arbete: väg det mot att underlagsvarningen nu
är tydlig och att en enfärgad yta alltid finns tillgänglig.

**Historik (den tidigare planen)**: en riktig FLERKVADRATSSÖKNING — behåll ~40
linjetoppar per riktning, generera kandidatrektanglar ur linjepar, poängsätt var
och en på kortproportion + kantstöd på alla fyra sidor + inre detalj, och välj
en icke-överlappande, storlekskonsistent uppsättning. Det är ~200+ rader och
riktig trimning, och mönstrets egna räta linjer ger gott om kortformade
kandidater — utfallet är genuint osäkert. Den ska köras BARA när
`busySurface` slår till, så den kan inte skada den fungerande vägen.
Pass/fail före ship: 5 av 5 kort på alla fyra mönstrade fångster.

## GEMINI MOT HAIKU — MÄTT I FÄLT 2026-08-02

Samma prompt, samma fältspec, samma svarstolkning (`vision-contract.ts`), samma
bilder. Enda skillnaden är modellen.

| | anrop | nummer läst | in/ut tokens | $/anrop |
|---|---|---|---|---|
| Haiku 4.5 | 3 | 2/3 | 2995 / 148 | $0,00373 |
| **Gemini 3.1 Flash-Lite** | 11 | **11/11** | 3728 / 58 | **$0,00102** |

**20 kort skannade, alla 20 rätt** (ägarens facit). Kostnaden är **3,7x lägre**,
inte 2,6x som beräknat — Gemini svarar med en tredjedel så många ut-tokens
(58 mot 148). In-tokens blev 3728 mot mitt estimat 4850, dvs rutindelningen
straffar vår nummerremsa mindre än beräknat.

**Det avgörande är inte kostnaden utan NUMMERLÄSNINGEN.** Hela katalogslagningen
hänger på samlarnumret (92 % av korten delar namn), och i tre av sju fall i den
sista rundan hade BILDEN fel medan numret räddade valet:

| kort | bildens topp | numret | valt |
|---|---|---|---|
| Grubbin | Grubbin 9 (0,807) | 017/217 | Grubbin **17** |
| Eelektrik | Eelektrik 31 (0,752) | 060/217 | Eelektrik **60** |
| Solrock | Solrock 75 (0,692) | 106/217 | Solrock **106** |

Det är omtryckstvillingar med nästan identisk konst och marginal 0,002–0,013 —
exakt den klass som gav FEL Murkrow två gånger med Haiku samma kväll. Med
numret läst avgörs de rätt. Murkrow 126/127 löstes också: Gemini läste
"127/182" och numret avgjorde tryckningen.

**Och vakten mot påhittade nummer bevisades i fält**: på Steven's Beldum läste
modellen "149/182" — kortet var 143. Numret matchade INGEN kandidat, gav därför
ingen bonus, och den starka bildträffen (0,796, marginal 0,088) vann ändå. Ett
hallucinerat nummer drog alltså inte iväg svaret.

⛔ **2.5-serien går inte att välja med en ny API-nyckel** (fältfel:
"not available for new users"). Se docs/SCANNER.md för vilka modeller som
faktiskt går att nå och vad de kostar mot VÅR last.

**Facitsetet växte 53 → 64** genom att de elva bekräftat RÄTTA skanningarna
lades in. ⛔ Det är med flit: setet växer annars bara av KORRIGERINGAR, dvs det
består nästan bara av fall där något gick fel, och då mäter choice-replay hur
väl en ändring fixar kända missar men inte om den RASERAR det som redan
fungerar. Aktuell status: **59/64** (bild 24/24, claude 24/29, gemini 11/11).

## FÄLTRUNDA 2026-08-02 (12 kort, bord + musmatta): TOTALEN FÅR UNDERKÄNNA NUMRET

Ägarens fångst: 12 kort utspridda över TVÅ underlag (mörkt skrivbord och
musmatta), med tangentbord i överkanten och fotografens ben i nederkanten.

**DETEKTERINGEN: 12 av 12, noll falska.** Bakgrunden tog 65 % av bilden (mot
73–79 % på ett enfärgat bord — två underlag sänker andelen utan att bryta
modellen, båda når bildkanten). Former 0,73–0,93. Både tangentbordet och
kroppen — de två klasser som fällde fältrunda 3, 4 och 10 — förkastades.
⇒ **Flera enfärgade underlag i samma bild är INGET problem.** Det otestade
fallet är fortfarande en matta som INTE når bildkanten (kort på en ö).

**IDENTIFIERINGEN: 11 av 12 rätt.** 7 celler klarade sig helt utan AI-anrop
(trust-regeln, $0); 5 gick till Gemini, som läste 5/5 nummer.

**Den enda missen var ett FABRICERAT BEVIS.** Scorbunny 36 (Ascended Heroes,
217 kort) lästes som **"026/217"**. Numret 26 finns som en riktig Scorbunny i
tre andra set (Stellar Crown 142, Mega Evolution 132, Chilling Reign 198) — alla
uteslutna av den lästa totalen — men nummerträffen gav ändå 0,25 och vann över
rätt kort. Totalen 217 pekade RÄTT hela tiden och vägde bara 0,02
(`TOTAL_TIEBREAK`, och bara inom samma-konst-grupper).

⛔ **Därför fick träffen inget "?".** Osäkerhetsmåttet är en MARGINAL
(`MATCH_MARGIN_MIN`), och en nummerträff är stark med flit — ett falskt nummer
producerar alltså en stor, självsäker marginal. Marginalen kan per konstruktion
inte se igenom ett fabricerat bevis; den kan bara mäta hur långt isär
kandidaterna hamnade. Enda vägen är att inte fabricera beviset.

**REGELN** (`numberMatchBonus` + `namesConfirmingTotal`, testade utan DB):
numret och totalen kommer ur SAMMA läsning. Bekräftar katalogen totalen för en
tryckning med **samma namn**, medan numret pekar på ett set totalen utesluter,
är numret den felläsa halvan → **noll bonus** i stället för 0,25.
- ⛔ Kravet på samma NAMN är avsiktligt smalt: kandidatpoolen är upp till
  `CANDIDATE_LIMIT` rader per källa, så vilket tal som helst kolliderar förr
  eller senare med NÅGOT sets storlek.
- ⛔ Totalen får bara tala när den pekar ut ett alternativ. Cynthia's Gible
  lästes "109/111" i samma runda — inget set har 111 kort, alltså är totalen
  bara felläst och nummerträffen står kvar (0,25). En rak "totalen måste
  stämma"-grind hade fällt det kortet.
- ⛔ Secret rares rörs inte: de trycks "199/165" och setet bär den TRYCKTA
  totalen (Ascended Heroes = 217 med kort 225 i sig) → grenen "nummer + total
  matchar", aldrig kontradiktionsgrenen.

**MÄTT** (`scanner-choice-replay.ts`, facitsetet 65 → **77** sedan rundans alla
tolv lagts in — elva bekräftat rätta som regressionsvakt, en rättad):
**70/77 → 71/77, noll nya fel** (bild 31/31, claude 24/29, gemini 15/17 → 16/17).

## FÄLTRUNDA 13 (2026-08-02): 11 AV 12 TVÅ GÅNGER — FYLLNADSTRÖSKELN ÅT KORT

Ägaren fotade samma tolv kort två gånger och fick **11 båda gångerna** — olika
kort saknades (bortre radens högra respektive vänstra). Detekteringen var alltså
inte slumpmässig utan systematisk.

**Skälet gick inte att läsa ur utdatan.** En kortkant som fyllningen ätit upp
(ingen blob alls) och en blob som föll på ett filter ser IDENTISKA ut när bara
godkända regioner skrivs ut, men kräver motsatta åtgärder. `RegionDiag.rejections`
bokför nu varje förkastad blob med skäl, och svaret blev entydigt: BÅDA korten
segmenterades korrekt — storlek och form mitt i klustret — och föll på den
RELATIVA fyllnadsgraden med kvot **0,85** och **0,83**. Utklippen är otvetydiga
kort (Dragonair, Solrock).

**REGION_FILL_REL_MIN 0,85 → 0,75.** Talet sattes när äkta kort mätts till
0,92–1,01 av fältets median; det verkliga spannet är **0,83–1,01**. Svept över
alla 27 sparade fältfångster ger varje värde i **[0,71 · 0,80]** identiskt utfall
— de två fångsterna går 11 → 12, ingen annan rör sig. 0,75 är mitten.

⛔ **FYLLNADEN SKILJER INTE TYG FRÅN KORT.** De mönstrade handduksfångsterna bär
tygblobbar på 0,80 och **0,83** — samma värde som ett äkta kort. Det som skyddar
där är `REGION_BUSY_MAX_BLOB`: alla fyra handduksfångsterna larmar (förkastad
blob 17–55 % av bilden) och skickar INGA celler. Höj inte tröskeln tillbaka i tron
att den bär det ansvaret; den kostar bara riktiga kort.

**IDENTIFIERINGEN: 10/11 + 11/11.** Och totalregeln från samma dag bevisades i
fält: Scorbunny lästes "**030/217**" (nummer 30 finns som Scorbunny i Sword &
Shield, 202 kort) — totalen 217 bekräftas av Ascended Heroes, nummerträffen
underkändes, och **rätt kort vann**. I andra rundan lästes "036/197": totalen
pekar ingenstans, nummerträffen behölls, rätt kort vann. Båda grenarna verifierade
på riktig data.

**Den kvarstående missen är en ny klass: en SJÄLVKONSISTENT felläsning.**
Eelektrik 60 lästes "**048/214**" — och Eelektrik 48 finns på riktigt, i ett set
vars storlek stämmer med 214. Numret OCH totalen pekar alltså samstämmigt på fel
kort, och ingen regel som bara läser modellsvaret kan avslöja det. Bilden hade
ingen åsikt om 48 (den rankade 31 och 60).
✅ Men marginalen blev 0,037 < `MATCH_MARGIN_MIN` → träffen **märktes "?"** och
ägaren rättade den. Jämför morgonens Scorbunny, där ett falskt nummer gav en STOR
marginal och ingen flagga: efter fixen är samma scan både rätt vald OCH märkt
osäker (1,309 mot 1,289). Rätt beteende i båda leden.

**Facitsetet 77 → 99** (rundans 22 celler; varje val ligger i den kända
tolvkortsuppsättningen, högst ett per runda = korsvalidering). **92/99**
(bild 42/42, claude 24/29, gemini 26/28), noll nya fel.

## UPPSKJUTET (ägarbeslut 2026-08-02): HOPSLAGNA KORT — VARNING + DELNING

**Läget**: kort som ligger KANT I KANT smälter till en blob och FÖRKASTAS (med
flit — en blandad cell identifieras självsäkert till fel kort). Användaren ser
bara "Hittade 10 kort" utan att få veta varför eller vilka.
MÄTT 2026-08-02 på två fångster: den förkastade blobben var 168×110 resp.
168×104 px — **~2× klustrets kortbredd, ~1× dess höjd, fyllnad 0,93–0,94**,
förkastad på `form 2,00x` resp. `2,10x klustret`. Ägaren sköt om med några mm
mellanrum och fick **12 av 12 rätt**, dvs arbetsflödet fungerar — det som
saknas är BESKEDET.

**Två steg, i den här ordningen:**
1. **VARNINGEN (bygg först)**: känn igen signaturen ovan bland de förkastade
   blobbarna och säg "två kort ligger ihop — dra isär dem". Kan inte skapa en
   falsk cell: den ändrar ingenting om vad som skickas. Samma princip som
   `bulkBusySurface` — upptäck tillståndet och berätta, gissa aldrig.
   💡 **Visa den FÖRE fångsten, inte efter.** Live-pollen (`setInterval` 600 ms
   i skanna/page.tsx) finns redan men är AVSTÄNGD i bulk. Skälet i koden är
   specifikt — enkortspollen fingeravtrycker och ANROPAR SERVERN per cell
   ("CPU utan mottagare") — och det gäller INTE en layout-hint: den är helt
   LOKAL (`detectCardRegions` på en nedskalad ruta, ingen fetch, ingen kvot,
   ~10–30 ms). ⛔ Kräv en STRECK-räknare som `liveStreak` innan hinten visas —
   rörelseoskärpa när telefonen flyttas ändrar segmenteringen och hinten
   blinkar annars.
2. **DELNINGEN (först om varningen inte räcker)**: dela blobben på mitten i
   stället för att förkasta den. ⛔ Mät signaturen mot ALLA sparade fångster
   först — den får aldrig matcha ett ENSKILT föremål. Växer snabbt förbi det
   enkla fallet (tre hopslagna, lodrät hopslagning, partiell överlappning), och
   en felaktig delning kostar två vision-anrop + ett fel kort att rätta.

⛔ Höj INTE `REGION_ASPECT_REL_MAX` för att "släppa igenom" paret — hela poängen
med den gränsen är att en blandad cell aldrig ska skickas.

## FOLIESOND (2026-08-04): INSTRUMENTERING BYGGD, MÄTNINGEN ÅTERSTÅR

Frågan från ägaren: kan skannern välja rätt VARIANT (standard / reverse holo)
själv, utan AI-kostnad? Signalen finns rimligen — men den är **OMÄTT**, så
ingenting väljer något. Det som byggdes är BARA mätapparaten.

**Varför oddsen är hyfsade:** vi vet vilket KORT det är innan foliefrågan ställs,
så problemet är inte "klassificera folie" utan "jämför mot det här kortets kända
platta katalogrendering" — och den referensen är `Card.artFingerprint`. Reverse
holo lägger folie överallt UTOM i konstfönstret; en holo rare gör tvärtom. De två
ska alltså avvika i MOTSATTA regioner mot samma referens.

**Sonden** (`src/lib/foil-probe.ts`): samma 8×11-rutnät, samma cellgränser och
samma inset-semantik som konstavtrycket — annars pekar cell 37 på olika ställen i
de två och varje jämförelse blir nonsens, tyst. Fyra tal per cell (luminans,
luminansspridning, andel utbrända pixlar, kroma) = 352 byte. Räknas ur pixlar
klienten ändå läst; ingen bild lagras.

**Tre mått**, alla per region (24 konstceller / 56 kroppsceller, rad 5 = gränsrad
och räknas till ingendera):
1. `dev` — avvikelse mot kortets EGEN referens, kropp mot konst. Starkast, för den
   är per kort och inte en blind klassificerare. Kvoten normaliserar bort
   exponeringen.
2. `temporal` — luminansens rörelse över LIVE-POLLENS rutor (600 ms isär, ~5 st).
   ⛔ Slutarens extra rutor duger inte: de ligger ~16 ms isär, kortet hinner inte
   röra sig. Spekulära reflexer rör sig, tryckfärg gör det inte.
3. `spec` — klippning, textur och kroma per region i själva fångsten.

**Var det hamnar:** `ScannerJob.result.foil`, ADMIN-ONLY, tillsammans med de RÅA
sonderna så måtten kan räknas om utan att skanna om. Påverkar inte kandidater,
poäng, pris eller kvot. Noll AI-anrop, ingen ny tjänst, ~2 kB per admin-rad.

**KVAR — steg 2, kräver ägaren:** skanna ~10 kort du äger i BÅDE standard och
reverse, standard-omgången först. Kör sedan
`SPLIT=<ISO-tid> … scripts/foil-probe-audit.ts` som visar om molnen separerar.

⛔ **Skeppa ingen foliedetektor på rimlighet.** Ett fel variantval är TYST (fel
produkt, fel pris i samlingen) och användaren slutar dubbelkolla just för att det
oftast stämmer. Kravet är detsamma som för bildmatchningen: **inget överlapp
mellan klasserna** — inte "medianerna skiljer sig". Reverse holo är dessutom
minoritetsklass, så "gissa alltid standard" ger ~90 % och är värdelöst. Separerar
inget är svaret att väljaren förblir manuell, och då har vi bara kostat mätningen.
⚠️ Känd svaghet i masken: **full art-kort har ingen "kropp"** i den meningen —
konsten går ut i kanten. Därför rapporteras regionerna var för sig, aldrig bara
kvoten.

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

# Foliesonden: separerar standard och reverse holo? (SPLIT = ISO-tid för facit)
node scripts/with-prod-db.mjs npx tsx scripts/foil-probe-audit.ts
SPLIT=2026-08-04T18:30:00Z node scripts/with-prod-db.mjs npx tsx scripts/foil-probe-audit.ts

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
