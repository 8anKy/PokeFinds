# Skannermotor utan AI

Identifierar ett Pokémonkort ur ett foto med ren bildgeometri — SIFT-nyckelpunkter, ett faiss-index
över hela katalogen och RANSAC-verifiering. Ingen modell, ingen AI, ingen kostnad per skanning.

## Mätt (2026-09-30, offline)

| Test | Motorn | Dagens skanner (bild + Gemini) |
|---|---|---|
| Ägarens 99 app-foton (hylsa, toploader, naket) | **99/99** | 92/99 |
| 600 Tradera-säljarfoton | **91,7 %** | — |
| Tid per skanning (en tråd) | **~0,39 s** median, 0,46–0,51 s p90 | 1–2 s |

Tradera-missarna (stickprov): ~1/4 fel etikett (baksida, flera kort, annonsen visar ett annat kort),
~1/3 identiska omtryck där bara setsymbolen skiljer och den är oläsbar i ett litet säljarfoto.

Indexvarianter (app 99 / Tradera 600): 300 punkter/kort med PQ m=32 (422 MB), m=16 (255 MB) och
**m=8 (171 MB)** ger samma resultat; 150 punkter/kort faller till ~81 % / 86 %. ⛔ Snåla aldrig på
antalet punkter per kort — komprimera hårdare i stället.

## Drift

- **Tjänst**: egen Railway-tjänst ur `scanner-engine/` (Dockerfile). Env: `ENGINE_SECRET`,
  `DATA_DIR=/data` (volym), `PORT`.
- **Data** (`DATA_DIR`, ~3,2 GB): `nn/` (index 171 MB, laddas i RAM), `refkp/` (2,8 GB, läses per
  kandidat med `pread` + `POSIX_FADV_DONTNEED` så kärnans sidcache inte räknas som minne),
  `cards-meta.json`. Byggs av `scripts/scanner-proto/` (build_nn.py, build_refkp.py,
  package_engine_data.py) ur referensbilderna (scanner-refs-download.ts).
- **Webben** (`src/lib/scanner-engine-shadow.ts`): sätt `SCANNER_ENGINE_URL` (Railways privata nät,
  t.ex. `http://scanner-engine.railway.internal:8080`) + `SCANNER_ENGINE_SECRET` ⇒ varje inloggad
  skanning skickas också till motorn och svaret bokförs som `ScannerJob.result.shadow`. Påverkar inget
  i svaret.

## Kostnad (uppskattad)

RAM ~0,35–0,45 GB (index + bibliotek) ≈ $3,5–4,5/mån · volym ~3,5 GB ≈ $0,5/mån · CPU försumbar vid
några hundra skanningar/dygn. **≈ 40–50 kr/mån** mot Geminis ~20–25 kr/mån i dag — dyrare vid dagens
volym, men platt: Gemini-notan växer med varje skanning, motorns gör det inte.

## Kvar innan den kan ersätta Gemini

1. Skapa tjänsten + volymen och ladda upp datan (ägarbeslut — kostar pengar).
2. Skuggläge 1–2 veckor: jämför `result.shadow.best` mot `userChosen`.
3. Veckovis påfyllning: nya kort ⇒ `index.add()` (ingen omträning) + nya refkp-rader.
4. Klientflödet: motorns topp-lista som kandidater, samma-konst-tvillingar alltid ett tryck bort.
