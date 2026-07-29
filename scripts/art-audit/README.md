# Bildmatchnings-revision (konstavtryck)

Mät-harnesset bakom beslutet att identifiera kort på UTSEENDE i stället för på
text. Kör om det innan någon ändrar `GRID_W`/`GRID_H` i
`src/lib/art-fingerprint.ts` — siffrorna nedan är hela motiveringen för att
avtrycket är så grovt som det är.

## Varför det finns

Samlarnumret trycks ~2 mm högt. I en skärmfotografering eller ett suddigt foto
finns informationen inte i bilden alls, så textläsning kan aldrig bli
tillförlitlig där (mätt i produktion: vision-modellen svarade med kortets HP
eller hittade på ett nummer). Konstavtrycket läser ingen text.

## Körning

```bash
node scripts/with-prod-db.mjs npx tsx scripts/art-audit/dump-cards.ts  # → .spike/cards.json
npx tsx scripts/art-audit/fetch-images.ts                              # ~20 500 bilder, resumerbar
npx tsx scripts/art-audit/eval.ts                                      # topp-1/5/15 per rutnät
ONLY=grid8x11 PROFILE=harsh npx tsx scripts/art-audit/eval.ts          # bara produktionsvarianten
npx tsx scripts/art-audit/sanity.ts                                    # är försämringen ens hård?
```

Allt landar i `.spike/` (gitignorerad — repot är publikt och cachen är
hundratals MB).

## Resultat 2026-07-29

Referensmängd = HELA katalogen (20 431 cachade bilder). Frågorna är samma bilder
försämrade som skärmfotograferingar. 300 frågor per körning.

| Rutnät | Dimensioner | Profil | Topp-1 | Topp-5 | Topp-15 |
|---|---|---|---|---|---|
| **8×11** | **264** | mild | 93,3 % | 99,0 % | 99,7 % |
| **8×11** | **264** | **harsh** | **86,0 %** | **94,3 %** | **96,0 %** |
| 16×22 | 1 056 | mild | 95,0 % | 99,0 % | 99,3 % |
| 24×33 | 2 376 | mild | 92,7 % | 98,0 % | 98,3 % |

**Finare rutnät är SÄMRE.** Självlikheten efter försämring faller från 0,918
(8×11) till 0,764 (24×33): fin detalj överlever inte en dålig bild och bidrar
därför med brus. Det är också skälet att inget neuralt nät valdes — dess styrka
är finkorniga särdrag, och vi har mätt att finkorniga särdrag inte hjälper här.

⚠️ **Siffrorna är ett TAK, inte verklig träffsäkerhet.** Frågebilden härleds ur
SAMMA fil som referensen, och `harsh` innehåller ingen moiré. Talen visar att
avtrycket kan särskilja 20 431 lika kort och tål de försämringar vi valt att
lägga på. Verklig träffsäkerhet måste mätas på riktiga fångster — därför matar
bildmatchningen kandidater ADDITIVT i `matchCards`, så värsta fallet är att den
inte hjälper, inte att den gör resultatet sämre.

Skillnaden mellan 96,0 % och 97,0 % (en tidigare variant) är INTE signifikant:
vid n=300 och p≈0,96 är standardfelet ±1,1 %.
