---
paths:
  - "src/services/grading/**"
  - "src/app/gradera/**"
---
# AI-gradering

- **AI-gradering = GEMINI PÅ BÅDA NIVÅERNA (ägarbeslut 2026-08-05)**: adaptermönster i `src/services/grading/`
  (`GradingAdapter` + mock + Claude + Gemini). Plan→modell är nu PER LEVERANTÖR: FREE = `GRADING_MODEL_FREE_GEMINI`
  (`gemini-3.1-flash-lite`, $0,25/$1,50 per MTok, max `GRADING_FREE_MONTHLY_LIMIT`=3/mån), PREMIUM =
  `GRADING_MODEL_PREMIUM_GEMINI` (`gemini-3.6-flash`, $1,50/$7,50, max `GRADING_PREMIUM_MONTHLY_LIMIT`=15/mån).
  ⛔ **3.6 och INTE 3.5**: samma inpris, 20 % billigare utpris, nyare — 3.5 är strikt dominerad (samma fälla sitter
  kvar i `SCANNER_MODEL_PRECISE`). ⛔ **Aldrig `gemini-2.5-*`**: spärrad för NYA API-nycklar, stängs 2026-10-16.
  ⛔ **Egna variabelnamn per leverantör med flit** (`_GEMINI`-suffix, efter `DEALS_VERIFY_MODEL_GEMINI`): ett DELAT
  `GRADING_MODEL_*` hade tyst skickat ett Claude-modellnamn till Google vid ett byte = 404 på VARJE gradering, en
  funktion som är död för alla utom loggläsaren.
  **Prompt/schema/tolkning bor i `grading/contract.ts`**, aldrig i en adapter — annars jämför ett leverantörsbyte
  PROMPTER i stället för MODELLER (samma skäl som skannerns och fynd-verifierarens kontrakt). `GRADE_REQUIRED`
  HÄRLEDS ur fältspecen så de inte kan glida isär. Strukturerat svar via tvingat verktyg (`report_grade`).
  ⛔ **`maxOutputTokens` är taket för TÄNKANDE + SVAR på Gemini 3** och tänkandet går inte att stänga av — Claudes
  1024 rakt över trunkerar tyst verktygsanropet. 4096 (sedan skadelistan 2026-10-04) + `thinkingLevel: "minimal"`.
  ⛔ **GIF avvisas explicit**: delade `parseDataUrl` accepterar gif för Claudes skull, Google gör det inte.
  Byte sker med `GRADING_PROVIDER` på RAILWAY (ingen deploy); `GRADING_PROVIDER=claude` är rollback.
  Fotona förbereds på telefonen sedan 2026-10-04 (`lib/grading-photo.ts`): orienteringen bakas in och längsta sidan
  kapas till 2400 px — över vad modellerna själva skalar till, så kostnad/bedömning är oförändrade. Det är en
  UPPSKATTNING, aldrig en officiell PSA/BGS-grad.
- **GRADERINGSFOTONA SPARAS SEDAN 2026-10-04 (ägarbeslut, ersätter "sparas aldrig")**: fram + bak läggs i den privata
  bucketen (`grading/<user>/<job>_<side>.<ext>`, `services/grading/photos.ts`, bästa försök parallellt med
  katalogkopplingen) och nycklarna i `result.photoKeys`; visas BARA för ägaren via `/api/grading/jobs/[id]/photo`
  (egen origin — en signerad bucket-URL hade smutsat ned canvasen för slabben/utskärningen). Raderas med kontot
  (`deleteUserImages`-prefixet). Policyn (Privacy.s2Items) säger exakt det — ⛔ aldrig AI-träning utan nytt samtycke.
  Äldre jobb har inga foton ⇒ historiken visar listan + katalogbilden som förut.
- **GRADERINGSHISTORIKEN VISAR KATALOGBILDEN, OCH BARA NÄR NUMRET STYRKT KORTET (2026-08-05)**: före 2026-10-04 sparades
  användarens foton ALDRIG (`frontImageUrl = INLINE_UPLOAD`, dataminimering), så katalogbilden var den enda bild som fanns.
  Kopplingen görs EN gång vid graderingen (`resolveGradedCard`, `services/grading/card-link.ts`) och lagras i
  `result` (cardId/cardImageUrl/cardSlug/cardLabel — ingen migration), aldrig per historikvisning.
  ⚠️ `result.cardName` är INTE ett bart kortnamn. Mätt i prod: `"Camerupt 028/217 · Scarlet & Violet: Obsidian
  Flames"`, `"Camerupt 028/217 · Ascending Heroes"`, `"Raboot 037/217 · ASC (Scarlet & Violet Promo / Astral
  set)"` — namn + nummer + en SETGISSNING som ofta är fel (28/217 är Ascended Heroes) och ibland öppet hedgad.
  Därför återanvänds skannerns MÄTTA `matchCards` rakt av; den ignorerar redan setnamn som inte stämmer, och
  `cardLabel` visar katalogens skrivning i stället för modellens gissning.
  ⛔ **UTAN NUMMER — INGEN BILD.** 92 % av korten delar namn med minst ett annat; på strängarna ovan fick
  namn+nummer 1,53 och fyra olika Camerupt fick 1,03 var. Träffen måste bära precis det numret OCH vara ensam om
  det. Fel bild bredvid en gradering är ett påstående om en tryckning vi inte känner — värre än ingen bild.
- **CENTRERINGSMÄTAREN + "LÖNAR DET SIG?" + DELNINGSKORTET (2026-10-01, ägarbeslut)**: användaren lägger åtta
  stödlinjer på sitt eget foto (`components/features/centering-tool.tsx`, matematiken ren + testad i
  `lib/centering.ts`) — ingen AI, inget nätverk. Gränserna är PSA:s PUBLICERADE (fram 55/45 = 10, 60/40 = 9,
  65/35 = 8, 70/30 = 7; bak 75/25 = 10, annars 90/10; 10:an skärptes tyst från 60/40 under 2025) och resultatet
  är ett TAK, aldrig en grad. ⛔ **e-READER-KORT** (Expedition/Aquapolis/Skyridge, `isEReaderSet`): framsidans
  vänster- och nederkant är breddade för punktkoden ⇒ jämför ÖVRE mot HÖGRA kanten (i pixlar); baksidan mäts som
  vanligt. Mätningen går med till modellen som klartext i `buildClosingInstruction` (contract.ts) och sparas på
  jobbet (`result.centering`). "Lönar det sig?" (`services/grading/extras.ts`) = ograderat CM-först-värde mot
  sålda PSA-medianer runt graden — ⛔ aldrig en uträknad vinst (avgift/frakt overifierade), ⛔ talen är Pro
  (samma grind som produktsidan; gratis ser antal + suddade tal). Skannern → `/gradera` via sessionStorage
  (`lib/grade-prefill.ts`, läses EN gång). Slab-bilden (`renderGradeShareCard`) har Foilios EGEN etikett —
  ⛔ aldrig PSA:s utseende.
  **Uppdaterat samma kväll (ägarens fältrapport):** mätaren har nu TVÅ steg — 1) fyra hörn på kortet, bilden
  RÄTAS UPP med en homografi (`lib/perspective.ts`, testad) till exakt 63:88 med marginal; 2) linjerna på den raka
  bilden. ⛔ Rotationsreglaget är borttaget: det tog lutning men aldrig perspektiv, och ett snett foto gick inte
  att mäta. Innerlinjens gissning tar den FÖRSTA starka kanten inåt (fullbildskortens namnrad är starkare än ramen).
  Historiken är klickbar: en tidigare gradering öppnas med sparad bedömning + sparad mätning, "Lönar det sig?"
  räknas om via `/api/grading/jobs/[id]/worth` (aldrig sparat — priserna rör sig). Delningen tar mätningen ur
  `result.centering` (samma väg för färsk och historik); fotona finns aldrig kvar ⇒ katalogbilden ur historiken.
  Slabben ritas platt (pärlemoetikett, folieremsa, nedsänkt brunn) och lutas i 3D med synlig tjocklek.
- **SKADEMARKERINGAR + KAMERARULLE + SLABBILD + HJÄLP (2026-10-04, ägarönskan)**: modellen returnerar `defects`
  (obligatorisk lista, får vara TOM): sida, kategori (corners/edges/surface), allvar, kort text på användarens språk
  och en ruta i Geminis konvention (ymin, xmin, ymax, xmax 0–1000). `parseDefects` (contract.ts, testad) kastar allt
  otolkbart och sparar rutan som andelar i `result.defects`. ⛔ Rutorna gäller FOTOT modellen fick — därför bakas
  EXIF-orienteringen in i klienten innan uppladdning; utan det hamnar rutorna fel på en iPhone-bild. ⛔ Fotona sparas
  i bucketen sedan samma dag ⇒ historiken visar rutorna på de sparade fotona. Rutorna är modellens PEKANDE, inte en mätning — UI:t säger "ungefärliga".
  `maxOutputTokens` 4096 (Gemini) / `max_tokens` 2048 (Claude) för listan; merkostnad ≈ 300–600 ut-tokens per gradering.
  Uppladdningen har TVÅ inputs: kamera (`capture`) och kamerarulle (utan) — en input med `capture` stängde galleriet
  på Android. Delningsarket väljer slabbens bild: katalogbild eller "Mitt foto" (mätarens utsnitt, annars
  `autoCropCard` med skannerns hörnsökare, annars råfotot). Centreringsmätaren visar en ritad hjälp första gången
  per steg ("?" tar fram den) som täcker HELA mätaren; linjesteget har bara Hörnen + e-Reader och EN mening om
  linjen man drar (ägarens fältrapport: pilknappar/"Nästa linje"/andra hjälptext var för mycket). Efter en färsk
  gradering byts Gradera-knappen mot "Gradera ett nytt kort" (samma foton graderas inte två gånger). "Mitt foto" på
  slabben ⇒ videon snurrar med användarens EGEN baksida (`backImageUrl`), annars den generiska. Turerna stoppar
  pek/hjul/tangent-scroll medan de är öppna (`useBlockScroll`, händelser — aldrig `overflow`). "Vilket kort är det?"
  visar bara bildträffar ≥ ART_TRUST_SCORE (0,55); under golvet är träffen i praktiken alltid fel.
  Graderingsturen (`lib/grading-tour.ts`, fem info-steg, localStorage) delar ritningen med appturen
  (`components/features/spotlight.tsx`).
