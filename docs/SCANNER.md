# Kortskanner — arkitektur & konfiguration

Kortskannern låter användare ladda upp en bild på ett Pokémon-kort, få det
identifierat och lägga till det i sin samling.

## Arkitektur

```
Klient (/skanna)
  └─ POST /api/scanner/upload   (auth + rate limit 10/10 min, Zod, max ~4 MB)
       └─ runScannerJob()        src/services/scanner/index.ts
            ├─ ScannerJob skapas (RUNNING)
            ├─ getOcrAdapter().extractCardInfo(dataUrl) → OcrResult
            ├─ matchCards(): kandidater via namn (contains, skiftlägesokänslig)
            │   + Dice-bigram-likhet (scoreSimilarity, src/scrapers/matching.ts)
            │   + bonus för matchande setnummer → topp 5 kandidater
            └─ Resultat + konfidens sparas (COMPLETED), fel → FAILED
  └─ POST /api/scanner/confirm  → CollectionItem skapas (estimatedValue från
                                   senaste PriceSnapshot.avgPrice om sådan finns)
  └─ GET  /api/scanner/jobs     → senaste skanningar
```

## Koppla in en riktig OCR-/vision-leverantör

1. Implementera `OcrAdapter` (`src/services/scanner/types.ts`):

   ```ts
   export class GoogleVisionAdapter implements OcrAdapter {
     readonly name = "google-vision";
     async extractCardInfo(imageDataUrl: string, detailDataUrl?: string): Promise<OcrResult> {
       // Anropa leverantörens API med en EGEN nyckel-variabel
       // (t.ex. process.env.MIN_LEVERANTOR_API_KEY) och lämna de råa
       // verktygsfälten till buildOcrResult() i vision-contract.ts.
     }
   }
   ```

2. Registrera adaptern i `getOcrAdapter()` (`src/services/scanner/index.ts`):

   ```ts
   case "min-leverantor":
     return new MinLeverantorAdapter(process.env.SCANNER_MODEL ?? "…");
   ```

3. Sätt miljövariabler:

   ```env
   OCR_PROVIDER=min-leverantor
   MIN_LEVERANTOR_API_KEY=...
   ```

⛔ **Det finns INGEN generisk `OCR_API_KEY`.** Varje adapter läser sin EGEN
nyckel — `ANTHROPIC_API_KEY` för `claude`, `GEMINI_API_KEY` för `gemini` — så
att två leverantörer kan vara konfigurerade samtidigt och bytet är EN variabel
(`OCR_PROVIDER`) utan att någon nyckel behöver klistras om. En tom
`OCR_API_KEY` i miljön är ett arv från ett gammalt exempel här och läses inte
av någon kod; den kan tas bort.

### Leverantörer

| `OCR_PROVIDER` | Nyckel | Standardmodell (`SCANNER_MODEL`) | Kostnad/anrop |
|---|---|---|---|
| `claude` | `ANTHROPIC_API_KEY` | `claude-haiku-4-5` | **$0,0037** (mätt) |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.1-flash-lite` | **$0,00144** (beräknad) |
| `mock` | — | — | 0 |

`gemini` finns för att KOSTNADEN skiljer kraftigt, men träffsäkerheten (läser
modellen samlarnumret?) är det som avgör — och den går bara att mäta i fält.

⛔ **Facitsetet kan INTE utvärdera ett leverantörsbyte.** Vi sparar aldrig
skanningsbilderna (dataminimering), bara avtrycken och modellens text — så
`scanner-choice-replay.ts` replayar det GAMLA modellsvaret oavsett vilken
adapter som är aktiv. Ett byte måste mätas med NYA fältskanningar:
`scanner-telemetry.ts` före och efter, och byt bara EN sak i taget.

⛔ **Prompt, fältspec och svarstolkning bor i `vision-contract.ts`** och delas av
adaptrarna. Bygger en adapter sin egen prompt jämför en A/B-körning prompter i
stället för modeller.

**Gemini debiterar per bildRUTA (258 tokens), och rutstorleken räknas på bildens
KORTSIDA.** Vår nummerremsa (~1280×393) blir därför 10 rutor (2580 tokens) medan
hela kortet (~916×1280) blir 6 (1548) — remsan kostar mer än kortet. Totalt
~4850 in-tokens mot Claudes uppmätta 2955 för SAMMA bilder. En omformad närbild
(kortsidan ≥ ~2/3 av långsidan) sänker notan mer än ett modellbyte, men ändra
inte bilderna och modellen samtidigt.

Gratisnivå finns för Gemini-modellerna (hårt rate-limitad) — 429 rapporteras
uttryckligen som kvot/rate limit så det inte läses som en modellmiss.

⛔ **2.5-serien går INTE att använda med en NY API-nyckel.** Google spärrar den
för nyskapade nycklar ("not available for new users") och hänvisar till 3.x.
Mätt i fält 2026-08-02: tre celler i rad föll på det med
`gemini-2.5-flash-lite`. Kostnad per anrop mot vår egen last (~4850 in-tokens,
152 ut) för de modeller som FAKTISKT går att välja:

| modell | in/ut $ per 1M | per anrop | mot Haiku ($0,0037) |
|---|---|---|---|
| `gemini-3.1-flash-lite` | 0,25 / 1,50 | **$0,00144** | 2,6x billigare |
| `gemini-3.5-flash-lite` | 0,30 / 2,50 | $0,00184 | 2,0x billigare |
| `gemini-3.6-flash` | 1,50 / 7,50 | $0,0084 | 2,3x DYRARE |
| `gemini-3.5-flash` | 1,50 / 9,00 | $0,0087 | 2,4x DYRARE |

⛔ Kontrollera ALLTID att modellen går att nå med en färsk nyckel innan den
sätts som default — prislistan visar modeller som API:t inte lämnar ut.

`OCR_PROVIDER=mock` (standard) använder `MockOcrAdapter`
(`src/services/scanner/ocr-mock.ts`) — en utvecklingsmock som slumpar fram
ett befintligt kort ur databasen. Okända värden ger felet
"OCR-leverantör ej konfigurerad — se docs/SCANNER.md".

## Bildlagring

MVP persisterar **inte** den uppladdade bilden — `ScannerJob.imageUrl` sätts
till `"inline-upload"` och resultatet noterar `"uploaded-inline"`, eftersom
base64-data inte hör hemma i databasen.

**Produktion:** ladda upp bilden till S3-kompatibel objektlagring (AWS S3,
Cloudflare R2, MinIO) före analysen och spara objekt-URL:en i
`ScannerJob.imageUrl`. Det möjliggör återanalys, felsökning och miniatyrer
i skanningshistoriken.
