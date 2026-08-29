/**
 * SKANNER-TELEMETRI — läser admin-diagnostiken ur `ScannerJob.result`.
 *
 * Finns för att alla träffsäkerhetssiffror vi räknat fram offline är TAK: frågorna
 * härleds ur samma filer som referenserna, så de kan inte visa vad en riktig
 * fångst gör. Det här är den enda källan till verkliga tal.
 *
 * Skrivs bara för admin (dataminimering) — se `recordScanUsage`. Lagrar
 * konstavtrycket (264 byte), aldrig bilden.
 *
 * ⛔ **RUBRIKERNA ÄR STRATIFIERADE SEDAN 2026-08-29 — SLÅ ALDRIG IHOP DEM.**
 *    Raderna kommer från TVÅ populationer: art-avgjorda (`provider: "bild"`,
 *    kördes med TOM OCR, grindade på svaret) och vision-körda. Ett OCR-mått över
 *    båda mäter grinden, inte skannern — MÄTT: "namn tomt" var 42,5 % ihopslaget
 *    mot 3,4 % i vision-stratumet, dvs 12× fel. Samma fälla som recall-mätningens
 *    `src: "bulk"`, i just den fil som ska vara sanningskällan.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-telemetry.ts
 *   TAKE=40 …    # fler skanningar
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { costMicroUsd } from "@/lib/ai-pricing";
import { classifyCostRow } from "@/services/admin/user-costs";
// ⛔ PRODUKTIONENS TRUST-DOM, ALDRIG EN LOKAL KOPIA. Konstanterna är exporterade
// just för mätskript; en egen tröskel här driver isär tyst — vilket den hade
// gjort: raden hette "bildträff SÄKER" men mätte 0,70 när drift kör 0,55.
import { ART_TRUST_MARGIN, ART_TRUST_SCORE, artConfidentFrom } from "@/services/scanner/index";

const TAKE = Number(process.env.TAKE ?? "30");

interface Diag {
  v?: number;
  provider?: string;
  usage?: { inputTokens: number; outputTokens: number } | null;
  /**
   * Modell-id:t som faktiskt anropades ("gemini-3.1-flash-lite"), skrivet av
   * `recordScanUsage` för ALLA användare. `null` = inget API-anrop gjordes
   * (bilden/streckkoden avgjorde) ⇒ äkta noll kronor. Nyckeln SAKNAS helt på
   * rader före 2026-08-14 ⇒ OMÄTT.
   *
   * ⛔ **PRISSÄTT PÅ DEN HÄR, ALDRIG PÅ `provider`.** Leverantörsnamnet räcker
   *    inte: samma adapter kör modeller som skiljer en faktor tre.
   */
  costModel?: string | null;
  /**
   * Kostnadsavtryckets tokental — skrivs för ALLA användare bredvid `costModel`
   * och är det adminvyn prissätter. `usage` ovan är diagnostikens admin-kopia.
   */
  costUsage?: { inputTokens: number; outputTokens: number } | null;
  guessedName?: string | null;
  guessedNumber?: string | null;
  guessedEra?: string | null;
  guessedHp?: number | null;
  confidence?: number;
  artTop?: number | null;
  artTopLabel?: string | null;
  chosen?: { name: string; number: string; setName: string; score: number } | null;
}

/**
 * ⛔ **DEN HÄR FILEN HADE EN EGEN PRISLISTA. DET VAR BUGGEN (rättat 2026-08-29).**
 *
 * Tabellen var nycklad på LEVERANTÖR (`gemini: 0,20/0,80`) medan adminpanelen
 * prissätter på MODELL via `src/lib/ai-pricing.ts` (`gemini-3.1-flash-lite`:
 * 0,25/1,50). Samma anrop kostade alltså olika mycket beroende på vem som
 * frågade — MÄTT mot hela ScannerJob-historiken 2026-08-29 (1 130 anrop,
 * 4 206 534 in / 63 663 ut): **$1,147 mot $0,892, dvs 28,6 % isär.**
 *
 * Prislistan bor numera på ETT ställe och kalibreringen mot Googles konsol
 * 2026-08-02 ligger DÄR, med uträkning, residual och datum. Rör den där, aldrig
 * här. ⛔ Lägg inte tillbaka en leverantörsnycklad tabell: samma adapter kör
 * modeller som skiljer en faktor tre (Haiku $1/$5 mot Sonnet $3/$15).
 *
 * ⛔ **TRE UTFALL, ALDRIG TVÅ** — samma definition som kostnadsvyn
 * (`classifyCostRow`): KOSTNADSFÖRD / GRATIS (`costModel: null`, bilden
 * avgjorde) / OMÄTT (avtrycket saknas, eller modellen har inget pris). Den
 * gamla koden hade bara två och föll dessutom tillbaka på CLAUDE-priset för
 * varje okänd leverantör — en okänd rad fick alltså ett trovärdigt men påhittat
 * belopp i stället för att redovisas som okänd.
 */
/**
 * Tokentalen för PRISSÄTTNING. `costUsage` är kostnadsavtrycket (skrivs för ALLA
 * användare, det adminvyn faktiskt prissätter); `usage` är admin-diagnostikens
 * kopia. VERIFIERAT mot prod 2026-08-29: av 629 v=1-rader bär 46 båda nycklarna
 * och de är OENSE i 0 av dem, 278 bär bara `usage` (före 2026-08-14) och 0 bär
 * bara `costUsage`. Vi läser därför avtrycket först — då räknar skriptet på exakt
 * samma tal som `/admin/anvandare` — och faller tillbaka på diagnostiken.
 */
function tokensFor(d: Diag): { inputTokens: number; outputTokens: number } | null {
  return d.costUsage ?? d.usage ?? null;
}

function usdForRow(d: Diag): number | null {
  const micro = costMicroUsd(d.costModel, tokensFor(d));
  return micro == null ? null : micro / 1e6;
}

/**
 * KOSTNADSFÖRD / GRATIS / OMÄTT för en telemetrirad.
 *
 * ⛔ **`provider: "bild"` ÄR ETT BEVIS OM KOSTNADEN, INTE BARA EN ETIKETT**
 *    (rättat 2026-08-29). Fältet sätts av `skipVision` och av bulk-vägen: båda
 *    betyder att `artConfidentFrom` sa ja och att INGET vision-anrop gjordes.
 *    Kostnaden ÄR alltså noll, oavsett om raden hann få ett `costModel` (fältet
 *    kom 2026-08-14). Utan den här grenen bokfördes gamla bild-rader som OMÄTTA:
 *    MÄTT vid `TAKE=200` blev rubriken "46 prissatta · 33 gratis · 121 OMÄTTA"
 *    när sanningen är **46 / 81 / 73** — 48 bevisligen gratis rader låg i den
 *    okända hinken och rubriken överdrev det okända med **66 %**.
 *    Per-modell-loopen visste det redan ("gratis, inget anrop gjordes"); det var
 *    bara summeringen som inte gjorde det. ⛔ Doktrinen är TRE UTFALL och de
 *    blandas aldrig — en okänd hink som växer är signalen att avtrycket läcker,
 *    och den signalen dränks om säkra nollor hamnar i den.
 */
function outcomeFor(d: Diag): "priced" | "free" | "unmeasured" {
  if (isArtDecided(d)) return classifyCostRow(true, null, null);
  // `jsonb_exists`-motsvarigheten på ett redan parsat objekt: nyckeln SAKNAS
  // (rad före 2026-08-14) är inte samma sak som att den är null (gratis).
  const hasCost = Object.prototype.hasOwnProperty.call(d, "costModel");
  const micro = costMicroUsd(d.costModel, tokensFor(d));
  return classifyCostRow(hasCost, d.costModel ?? null, micro);
}

/**
 * ⛔ **STRATUMGRÄNSEN — HELA REVISIONEN 2026-08-29 HANDLAR OM DEN.**
 *
 * En `bild`-rad existerar BARA för att `artConfidentFrom` sa ja. Den kördes med
 * TOM OCR, så varje OCR-mått på den är noll per konstruktion, inte per mätning:
 * "namn tomt" är sant för 81 av 81 sådana rader (mätt vid TAKE=200). Summeras de
 * med vision-raderna mäter rubriken URVALET i stället för skannern — exakt samma
 * fälla som `src: "bulk"` i recall-mätningen, och den kostade oss två mätomgångar.
 * MÄTT 2026-08-29: **203 av 629 v=1-rader (32,3 %)** är art-avgjorda, och vid
 * default `TAKE=30` är **21 av 30** det.
 */
function isArtDecided(d: Diag): boolean {
  return (d.provider ?? "") === "bild";
}

/** Poängen ur "Namn Nr 0.857 | Namn Nr 0.478 | …". */
function artScores(label: string | null | undefined): number[] {
  return (label ?? "")
    .split("|")
    .map((p) => Number(p.trim().split(/\s+/).pop()))
    .filter((n) => Number.isFinite(n));
}

/**
 * Skulle PRODUKTIONENS basregel ha litat på bildträffen? Dömt av
 * `artConfidentFrom` självt, med dess egna konstanter.
 *
 * ⚠️ **DET HÄR ÄR EN UNDRE GRÄNS, INTE PRODUKTIONENS BESLUT.** `artTopLabel` bär
 * bara topp-3 och INGA `frameTops`, så samstämmighetsgrenen (`ART_AGREE_MARGIN`,
 * marginal ≥ 0,05 när alla videorutor pekar likadant) går inte att utvärdera här.
 * MÄTT 2026-08-29 vid TAKE=200: basregeln fäller 76 av de 81 rader produktionen
 * FAKTISKT art-avgjorde — de 5 övriga kom in via just den grenen. Det verkliga
 * utfallet står i `provider`, som är beslutet, inte en rekonstruktion av det.
 * ⚠️ Poängen är dessutom avrundade till tre decimaler i etiketten, så en marginal
 * på exakt tröskeln kan falla åt fel håll.
 */
function baseRuleTrusts(d: Diag): boolean {
  const sc = artScores(d.artTopLabel);
  if (sc.length < 2) return false;
  // Syntetiska id:n: regeln dömer på poäng och marginal, aldrig på identitet.
  // Tom `frameTops` ⇒ bara basregeln, se varningen ovan.
  return artConfidentFrom(
    sc.map((score, i) => ({ cardId: `#${i}`, score })),
    []
  ) !== null;
}

/** Ett användbart nummer är det som faktiskt kan särskilja namntvillingar. */
function numberUsable(d: Diag): boolean {
  const num = (d.guessedNumber ?? "").trim();
  return num.length > 0 && /\d/.test(num) && !/[<>{}"=]/.test(num);
}

function pct(n: number, of: number): string {
  return of === 0 ? "–" : `${n}/${of} (${((n / of) * 100).toFixed(1)} %)`;
}

function stats(xs: number[]): string {
  if (xs.length === 0) return "–";
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `min ${s[0].toFixed(3)} · median ${q(0.5).toFixed(3)} · max ${s[s.length - 1].toFixed(3)}`;
}

/** Svenskt decimaltecken. Talen står mitt i svensk löptext; "0.55" läses som ett
 *  annat tal än "0,55". Samma helper finns i scanner-recall-live.ts. */
function sv(n: number, d = 2): string {
  return n.toFixed(d).replace(".", ",").replace(/,?0+$/, "") || "0";
}

async function main() {
  // SINCE=2026-08-02 (eller full ISO-tid) begränsar till EN mätrunda.
  // Utan det blandas rundorna: en A/B mot ett äldre pass drar in dess
  // misslyckade fångster (ett mönstrat underlag gav 14 tomma namn i rad) och
  // jämförelsen mäter då UNDERLAGET i stället för modellen.
  const since = process.env.SINCE ? new Date(process.env.SINCE) : null;
  if (since && Number.isNaN(since.getTime())) {
    throw new Error(`SINCE går inte att tolka som datum: ${process.env.SINCE}`);
  }
  const jobs = await prisma.scannerJob.findMany({
    // Prisma vill ha JsonNull-sentinelen, inte `null`, för Json-kolumner.
    where: {
      NOT: { result: { equals: Prisma.DbNull } },
      // ⛔ **GRINDA I SQL, INTE I JS (2026-08-29).** `TAKE` räknar RADER, och
      // diagnostiken skrivs bara för admin — sedan 2026-08-18 finns 0 admin-rader
      // mot 2 317 utan diagnostik, så `take: 400` följt av ett JS-filter på `v`
      // hämtade 400 vanliga rader och skrev "Ingen diagnostik hittad". Verktyget
      // såg trasigt ut fast datat fanns. Filtret hör hemma i frågan.
      result: { path: ["v"], equals: 1 },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: TAKE,
    select: { createdAt: true, result: true },
  });
  const rows = jobs
    .map((j) => ({ at: j.createdAt, d: j.result as Diag }))
    .filter((r) => r.d?.v === 1);

  if (rows.length === 0) {
    console.log("Ingen diagnostik hittad — skanna som admin först.");
    return;
  }
  console.log(`${rows.length} skanningar med diagnostik\n`);

  for (const { at, d } of rows) {
    const sc = artScores(d.artTopLabel);
    const margin = sc.length >= 2 ? sc[0] - sc[1] : null;
    const trusted = baseRuleTrusts(d);
    const usable = numberUsable(d);

    console.log(
      `${at.toISOString().slice(11, 19)}  "${d.guessedName ?? ""}" / "${(d.guessedNumber ?? "").trim()}"` +
        `${d.guessedEra ? ` era:${d.guessedEra}` : ""}${d.guessedHp ? ` hp:${d.guessedHp}` : ""}` +
        `  → ${d.chosen ? `${d.chosen.name} ${d.chosen.number} (${d.chosen.setName})` : "—"}` +
        `  bild ${sc[0]?.toFixed(3) ?? "–"} marg ${margin?.toFixed(3) ?? "–"}` +
        // ART = bilden avgjorde ⇒ OCR-fälten nedan är tomma per konstruktion,
        // inte för att modellen misslyckades. Utan märket läser raden fel.
        `${isArtDecided(d) ? " [ART]" : ""}${trusted ? " SÄKER" : ""}` +
        `${usable || isArtDecided(d) ? "" : " · nr oläst"}`
    );
    // Bildens EGNA toppträffar på egen rad: skiljer "bilden valde fel kort"
    // från "bilden valde rätt men texten överröstade den" — olika åtgärder.
    if (d.artTopLabel) console.log(`          bild-topp: ${d.artTopLabel}`);
  }

  /**
   * ⛔ **RUBRIKERNA ÄR STRATIFIERADE — DE FÅR ALDRIG SLÅS IHOP IGEN.**
   *
   * MÄTT mot prod 2026-08-29 vid TAKE=200 (81 art-avgjorda, 119 vision):
   *   · "namn tomt" ihopslaget 85/200 = 42,5 %, varav 81 är art-rader där OCR
   *     aldrig anropades. I vision-stratumet är talet **4/119 = 3,4 %** — den
   *     hopslagna rubriken var alltså **12× fel**.
   *   · "nummer användbart" ihopslaget 88/200 = 44,0 %, i vision-stratumet
   *     **88/119 = 73,9 %**.
   * Ett OCR-mått på en rad utan OCR mäter grinden, inte modellen.
   */
  const art = rows.filter((r) => isArtDecided(r.d));
  const vision = rows.filter((r) => !isArtDecided(r.d));
  const topsOf = (rs: typeof rows) =>
    rs.map((r) => artScores(r.d.artTopLabel)[0]).filter((n) => Number.isFinite(n));
  const marginsOf = (rs: typeof rows) =>
    rs
      .map((r) => artScores(r.d.artTopLabel))
      .filter((sc) => sc.length >= 2)
      .map((sc) => sc[0] - sc[1]);

  console.log(`\n--- ${rows.length} skanningar · TVÅ STRATA, aldrig ett tal ---`);
  console.log(`art-avgjord (provider="bild"):  ${pct(art.length, rows.length)}  ← tom OCR, grindad på svaret`);
  console.log(`vision kördes:                  ${pct(vision.length, rows.length)}`);

  console.log(`\nOCR-mått — BARA vision-stratumet (n=${vision.length}):`);
  console.log(`  nummer användbart:      ${pct(vision.filter((r) => numberUsable(r.d)).length, vision.length)}`);
  console.log(
    `  namn tomt:              ${pct(vision.filter((r) => !(r.d.guessedName ?? "").trim()).length, vision.length)}`
  );

  console.log(`\nBildmått — per stratum (samma tal, olika population):`);
  console.log(
    // Svenskt decimaltecken: talen står mitt i svensk löptext, och "0.55" i en
    // rad som annars skriver "0,55" ser ut som ett annat tal. Samma formatterare
    // som scanner-recall-live.ts har av samma skäl.
    `  bildträff SÄKER (basregeln ${sv(ART_TRUST_SCORE)}/${sv(ART_TRUST_MARGIN)}, UNDRE gräns):` +
      `  art ${pct(art.filter((r) => baseRuleTrusts(r.d)).length, art.length)}` +
      ` · vision ${pct(vision.filter((r) => baseRuleTrusts(r.d)).length, vision.length)}`
  );
  console.log(`  topp-poäng art:    ${stats(topsOf(art))}`);
  console.log(`  topp-poäng vision: ${stats(topsOf(vision))}`);
  console.log(`  marginal art:      ${stats(marginsOf(art))}`);
  console.log(`  marginal vision:   ${stats(marginsOf(vision))}`);

  // VERKLIG vision-kostnad ur API:ts egna tokental (nya rader bär usage).
  //
  // ⛔ **PER MODELL, INTE PER LEVERANTÖR** (rättat 2026-08-29). Poängen med ett
  // modellbyte är om NUMRET läses bättre och vad det kostar — och ett byte inom
  // SAMMA leverantör (3.1 Flash-Lite → 3.6 Flash, som skiljer 6,8x i inpris) var
  // osynligt när raderna grupperades på "gemini". Rader utan `costModel` (före
  // 2026-08-14) kan inte prissättas alls och grupperas på sitt provider-namn med
  // en `?`-markör, aldrig ihop med en prissatt modell.
  const byModel = new Map<
    string,
    { n: number; num: number; cost: number; inTok: number; outTok: number; unmeasured: number }
  >();
  for (const r of rows) {
    // ⛔ Gratis-raderna faller bort via `outcomeFor`, som numera KÄNNER
    // `provider: "bild"`. Ett eget `continue` på provider här hade varit en
    // andra definition av samma sak — och det var två definitioner som gjorde
    // att summeringen och den här loopen sa olika om samma rad.
    if (outcomeFor(r.d) === "free") continue;
    const key = r.d.costModel ?? `${r.d.provider ?? "okand"}?`;
    const a = byModel.get(key) ?? { n: 0, num: 0, cost: 0, inTok: 0, outTok: 0, unmeasured: 0 };
    a.n++;
    // SAMMA definition av "läst nummer" som rubriken ovan. Loopen räknade förut
    // bara på att fältet var sanningsvärt, så "0" och "|" räknades som lästa i
    // per-modell-raden men inte i rubriken — två tal om samma sak, i samma utskrift.
    if (numberUsable(r.d)) a.num++;
    const usd = usdForRow(r.d);
    if (usd == null) {
      a.unmeasured++;
    } else {
      a.cost += usd;
      // ⛔ TOKENSUMMORNA FÖLJER SAMMA NÄMNARE SOM KOSTNADEN (rättat 2026-08-29).
      // Förut summerades tokens över ALLA rader i hinken men delades på `a.n`,
      // medan $/anrop delades på `priced` — två medelvärden i samma rad med
      // olika populationer, vilket gör dem omöjliga att multiplicera ihop.
      const t = tokensFor(r.d);
      a.inTok += t?.inputTokens ?? 0;
      a.outTok += t?.outputTokens ?? 0;
    }
    byModel.set(key, a);
  }
  if (byModel.size > 0) {
    console.log("\n--- per modell (gratis-raderna ligger i stratumtabellen ovan) ---");
    for (const [model, a] of [...byModel.entries()].sort()) {
      const priced = a.n - a.unmeasured;
      console.log(
        `${model.padEnd(24)} ${a.n} anrop · nummer läst ${a.num}/${a.n}` +
          // ⛔ "–", ALDRIG $0.00000, när inget i hinken gick att prissätta.
          // `a.cost / Math.max(1, priced)` gav 0 vid priced === 0, dvs en helt
          // OMÄTT hink redovisades som gratis — samma familj som "0 kr är inget
          // pris". Medeltalen bär sin egen n, så de aldrig läses som hinkens.
          (priced === 0
            ? ` · $–/anrop (n=0 prissatta)`
            : ` · medel ${Math.round(a.inTok / priced)} in / ${Math.round(a.outTok / priced)} ut tok` +
              ` · $${(a.cost / priced).toFixed(5)}/anrop (n=${priced})`) +
          // ⛔ Omätta redovisas bredvid beloppet, aldrig som 0 kr: annars ser
          // notan lägre ut än den är. Samma regel som adminens kostnadsvy.
          (a.unmeasured ? ` · ⚠️ ${a.unmeasured} OMÄTTA` : "")
      );
    }
  }

  // TRE UTFALL. `free` = bilden/streckkoden avgjorde (äkta noll kronor, och
  // sedan 2026-08-29 inklusive de `provider: "bild"`-rader som saknar
  // `costModel`), `unmeasured` = vi VET inte (vision-rad före 2026-08-14, eller
  // en modell utan pris i prislistan).
  const priced = rows.filter((r) => outcomeFor(r.d) === "priced");
  const free = rows.filter((r) => outcomeFor(r.d) === "free").length;
  const unmeasured = rows.filter((r) => outcomeFor(r.d) === "unmeasured").length;
  if (priced.length > 0) {
    const total = priced.reduce((a, r) => a + (usdForRow(r.d) ?? 0), 0);
    const tokIn = priced.reduce((a, r) => a + (tokensFor(r.d)?.inputTokens ?? 0), 0);
    const tokOut = priced.reduce((a, r) => a + (tokensFor(r.d)?.outputTokens ?? 0), 0);
    console.log(
      `vision-kostnad (MÄTT): ${priced.length} anrop à $${(total / priced.length).toFixed(4)} ` +
        `(medel ${Math.round(tokIn / priced.length)} in / ${Math.round(tokOut / priced.length)} ut tok) · ` +
        `summa $${total.toFixed(3)} · ${free} gratis ($0) · ${unmeasured} OMÄTTA`
    );
  } else {
    console.log(
      `vision-kostnad: 0 prissatta rader · ${free} gratis · ${unmeasured} OMÄTTA ` +
        `(saknar costModel/tokental, eller modell utan pris i src/lib/ai-pricing.ts)`
    );
  }
}

main().finally(() => prisma.$disconnect());
