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
