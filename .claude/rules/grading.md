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
  1024 rakt över trunkerar tyst verktygsanropet. 2048 + `thinkingLevel: "minimal"`.
  ⛔ **GIF avvisas explicit**: delade `parseDataUrl` accepterar gif för Claudes skull, Google gör det inte.
  Byte sker med `GRADING_PROVIDER` på RAILWAY (ingen deploy); `GRADING_PROVIDER=claude` är rollback.
  ⏭️ KVAR: bilderna skalas INTE ner (två foton à upp till 5 MB) — största kostnadsspaken, medvetet lämnad utanför
  leverantörsbytet så kostnadsdeltat går att tillskriva. Det är en UPPSKATTNING, aldrig en officiell PSA/BGS-grad.
- **GRADERINGSHISTORIKEN VISAR KATALOGBILDEN, OCH BARA NÄR NUMRET STYRKT KORTET (2026-08-05)**: användarens foton
  sparas ALDRIG (`frontImageUrl = INLINE_UPLOAD`, dataminimering), så katalogbilden är den enda bild som finns.
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
