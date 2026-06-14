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
     async extractCardInfo(imageDataUrl: string): Promise<OcrResult> {
       // Anropa leverantörens API med process.env.OCR_API_KEY
       // och mappa svaret till { rawText, guessedName, guessedNumber, confidence }.
     }
   }
   ```

2. Registrera adaptern i `getOcrAdapter()` (`src/services/scanner/index.ts`):

   ```ts
   case "google-vision":
     return new GoogleVisionAdapter();
   ```

3. Sätt miljövariabler:

   ```env
   OCR_PROVIDER=google-vision
   OCR_API_KEY=...
   ```

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
