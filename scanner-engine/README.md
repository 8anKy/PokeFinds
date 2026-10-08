# Skannermotor

Identifierar ett Pokémonkort ur ett foto med bildgeometri — SIFT-nyckelpunkter, ett faiss-index
över hela katalogen och RANSAC-verifiering — plus (sedan 2026-10-08) en egen inlärd bildvektor som tar
över när geometrin inte räcker. Inga externa AI-anrop, ingen kostnad per skanning.

## Inlärd bildvektor (2026-10-08)

Finjusterad SigLIP2-base (`scripts/scanner-proto/train_embed.py`, tränad på en RTX 2070 på ~25 min,
ENBART katalogens referensbilder med syntetiska mobilfoto-förvanskningar), exporterad som ONNX
(`export_embed.py`: int8 utom MLP:ns fc2 + poolningshuvudet — full int8 gav cos 0,4–0,6 mot fp32).
Data i bucketen `scanner-engine/emb/<EMB_VERSION>/` (model.onnx 201 MB, gallery.npy fp16, ids.json);
`bootstrap.ensure_emb` hämtar, `add_cards` ger nya kort en vektor, start fyller i saknade i bakgrunden.

Mätt offline (`scripts/scanner-proto/hybrid_eval.py`, topp-1):

| Test | Motorn (SIFT) | Bildvektorn ensam | Motorn + vektor |
|---|---|---|---|
| Ägarens app-foton (99) | 100 % | 99,0 % | 100 % |
| Ägarens JP-batch (255) | 93,3 % | 89,0 % | 94,1 % |
| Tradera-säljarfoton (600) | 90,5 % | 84,5 % | 91,3 % |
| Tradera suddiga/mörka (600) | 66,5 % | 76,5 % | **78,7 %** |

Regeln: vektorns topp-5 läggs först i steg A; har motorns etta < `EMB_FALLBACK_INLIERS` (15) och ingen
regionkontroll bytte ⇒ vektorns etta. Vektorn väljer ALDRIG språk (EN/JP-tvillingar har samma konst).

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
