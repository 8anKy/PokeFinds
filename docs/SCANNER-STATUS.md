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
5. **Kostnadsläge**: ~$0,0029/scan (Haiku + närbild). Indexet ligger i 5,1 MB
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
