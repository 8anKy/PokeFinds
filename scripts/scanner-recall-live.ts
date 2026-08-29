/**
 * KONST-RECALL I PRODUKTION — samma fråga som scanner-art-recall.ts, men med
 * RIKTIGA användares domar som facit i stället för ägarens etikettfil.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-recall-live.ts
 *   DAGAR=7 node scripts/with-prod-db.mjs npx tsx scripts/scanner-recall-live.ts
 *
 * Frågan: skulle en BILD-FÖRST-skanner (inget vision-anrop, användaren väljer
 * ur en kort lista) hitta kortet? Underlaget skrivs sedan 2026-08-15 av
 * `recordScanUsage` (`result.recall`) + `/api/scanner/feedback`
 * (`result.userChosen`) — för ALLA användare, inte bara admin.
 *
 * ⛔ **DET FINNS INGET "ETT TAL". RAPPORTEN SKRIVER TRE STRATA, ALDRIG EN SUMMA.**
 *    Skanningarna kommer ur tre helt olika urval och bara ETT av dem svarar på
 *    frågan ovan:
 *      1. VISION-BEHÖVDES — `artConfidentFrom` sa NEJ, vi betalade för vision.
 *         Det ENDA stratum som mäter om bilden ensam räcker.
 *      2. ART-AVGJORD  — `skipVision`, bilden avgjorde. **Grindad på svaret:**
 *         `ART_TRUST_BONUS` gjorde bildens etta till svaret, så topp-1 är 100 %
 *         PER KONSTRUKTION. Kontrollhink.
 *      3. RUTNÄTS-BULK — `identifyCellsArt`, bokförs bara när bilden redan var
 *         säker. Samma grind som (2), egen väg in. Kontrollhink.
 *    Slås de ihop stiger topp-1 mot 100 % utan att skannern blivit bättre.
 *    ⚠️ Exakt det hände: talet **70,9 %** (08-17, "mätt på riktiga användare")
 *    var en BLANDNING — de art-avgjorda raderna saknade `recall.src` och
 *    summerades tyst in i enkelskanningarna. Se GRINDEN sist i utskriften.
 *
 * ⛔ **KORRIGERING OCH BEKRÄFTELSE FÅR ALDRIG SLÅS IHOP TILL ETT TAL.**
 *    En BEKRÄFTELSE (användaren tog vårt förslag) är svag och partisk till vår
 *    fördel — den finns bara när vi redan hade rätt på plats 1. En KORRIGERING
 *    (användaren valde ett annat KORT) är starkt facit OCH anrikad med de svåra
 *    fallen. Ett medelvärde av de två mäter blandningen, inte skannern.
 *
 * ⛔ **"BEKRÄFTAD" HAR TVÅ STYRKOR OCH DEN SVAGA DOMINERAR.** Ett tryck på
 *    "Lägg till alla" bekräftar upp till 15 kort på några millisekunder — det
 *    betyder "invände inte", inte "granskade". Mätt i den här rapporten
 *    2026-08-29: **579 av 694 domar (83,4 %)** över ALLA strata kom ur addAll.
 *    Redovisas därför på egen rad (`via:"bulk"`), aldrig hopslagen med ett aktivt
 *    val i listan (`via:"pick"`).
 *    ⛔ **DOKTRINEN GÄLLER ALLA STRATA, INTE BARA VISION.** Delningen 1b/1c fanns
 *    en revision innan art- och bulk-hinkarna fick samma behandling — och det var
 *    just DE hinkarna som bar filens starkaste påstående (trust-precision). Varje
 *    hink skriver nu ut sin DOMSTYRKA-sammansättning före sina tal.
 *    ⚠️ `userChosen.via = "bulk"` (addAll-KNAPPEN) och `recall.src = "bulk"`
 *    (RUTNÄTS-fångsten) är två OLIKA axlar med samma ord. En enkelskanning kan
 *    bekräftas via addAll, och en rutnätscell kan väljas aktivt.
 *
 * ⛔ **VARIANTBYTE ÄR INTE EN KORRIGERING AV KORTET.** Byter användaren
 *    tryckning behålls `cardId` medan `productId` ändras. Recall mäter KORT, så
 *    domen förblir "confirmed" — men det är en äkta rättelse av PRODUKTEN och
 *    räknas på egen rad. (Före v2 fanns fältet inte alls, så siffran är en
 *    UNDERSKATTNING på äldre rader — där loggades bytet som en ren bekräftelse.)
 *
 * ⛔ **`art` ÄR MÅTTET, `shown` ÄR KONTROLLEN.** `art` = bildsökningens egen
 *    topplista (vad en bild-först-skanner hade visat). `shown` = listan
 *    användaren faktiskt fick, där texten redan vägts in. Ligger kortet i
 *    `shown` men inte i `art` betyder det att vision bar träffen — precis den
 *    andel som INTE blir gratis.
 *
 * ⚠️ **ÖVERLEVNADSBIAS — LÄS TALEN MED DEN I HANDEN.** En användare som inte
 *    hittar sitt kort i listan ger upp eller söker manuellt. Med v2 fångas det
 *    som `kind:"rejected"`/`"searched"` (negativt facit, egen rad nedan); på
 *    äldre rader skrevs ingen `userChosen` alls och raden är osynlig, vilket
 *    lyfter recall. Talen är alltså TAK, om än ärligare än facitfilens
 *    (ägarens egna omsorgsfulla fångster).
 *
 * Läser bara. Inga API-anrop.
 */
import { Prisma, PrismaClient } from "@prisma/client";
/**
 * ⛔ **TRÖSKLARNA IMPORTERAS, DE SKRIVS ALDRIG AV.** Konstanterna är exporterade
 * ur produktionen just för att ett mätskript ska döma med PRODUKTIONENS värden
 * (`scanner-scoreboard.ts` och `scanner-skip-audit.ts` importerar samma tre;
 * `scanner-art-recall.ts` importerar hela `artConfidentFrom`). En lokal kopia
 * driver isär TYST — och den här filen hade redan hunnit göra det: avsnitt 5
 * påstod "poäng ≥ 0,70" på två ställen, ett värde som slutade gälla 2026-07-30
 * när poängen blev BLANDAD (0,25·färg + 0,25·dctb + 0,5·grad) och tröskeln
 * sänktes till 0,55. Percentilerna lästes alltså mot en tröskel som inte fanns.
 */
import {
  ART_AGREE_MARGIN,
  ART_TRUST_MARGIN,
  ART_TRUST_SCORE,
} from "../src/services/scanner/index";

const prisma = new PrismaClient();
const DAYS = Number(process.env.DAGAR ?? "30");

/** Rangdjup som redovisas. 15 = `ART_CANDIDATES`, dvs hela bildens topplista. */
const KS = [1, 3, 5, 15] as const;

/**
 * MINSTA UNDERLAG FÖR ATT GRINDEN ENS SKA GÅ ATT SVARA PÅ.
 *
 * ⛔ Talet är ARITMETIK, inte en mätning: grinden är ≥ 95 %, dvs den tål 5 %
 * missar. Under n=20 kan hinken inte ens REPRESENTERA en enda miss utan att
 * falla under gränsen (1/20 = exakt 5,0 %), så varje utfall är antingen 100 %
 * eller underkänt — en grind som bara kan svara "ja" är ingen grind. 20 är
 * alltså GOLVET för att frågan ska vara ställd, inte ett tillräckligt underlag:
 * vid n=20 ligger svaret en enda rad från att kantra.
 */
const MIN_GRIND_N = 20;

interface Recall {
  v?: number;
  art?: string[];
  shown?: string[];
  /**
   * Vilken väg skrev raden.
   *   "bulk" = rutnätsfångst (`identifyCellsArt`)  — grindad på svaret.
   *   "art"  = `skipVision`, bilden avgjorde ensam — grindad på svaret.
   *   saknas = vanlig vision-skanning.
   * ⛔ Alla rader före 2026-08-29 saknar "art" (fältet fanns inte) — se
   * `retroaktivtArtAvgjord()` för hur de återfås, och för vad den gissningen
   * kostar i precision.
   */
  src?: "bulk" | "art";
  /** Bildens topp-1-poäng. Två floats, ingen kortidentitet. Saknas på v1. */
  top?: number | null;
  /** topp1 − topp2. Det är MARGINALEN, inte poängen, som trust-grinden går på. */
  margin?: number | null;
}

interface UserChosen {
  /**
   * ⛔ **TRE TILLSTÅND, INTE TVÅ — OCH SKILLNADEN ÄR DATERINGEN AV RADEN.**
   * `/api/scanner/feedback` skriver `cardId: cardId ?? null`, dvs nyckeln finns
   * ALLTID på en rad skriven av dagens rutt (kommentaren där: "nyckeln ska finnas
   * så rapporten kan skilja 'ingen träff att avvisa' från en äldre rad").
   *   sträng    → ett valt kort, går att ranka.
   *   null      → dagens rutt, negativ dom UTAN kort. Rang 0 är då SANT.
   *   saknas    → äldre rad. Rang 0 vore en GISSNING, inte en avläsning.
   * Att typa fältet `string | undefined` raderade mitten och gjorde de två sista
   * omöjliga att skilja åt — en positiv dom utan rankbart kort blev en tyst miss.
   * Se `positivUtanKort` / `positivMedNullKort` nedan.
   */
  cardId?: string | null;
  /**
   * corrected = annat KORT (starkt facit) · confirmed = tog vårt förslag
   * rejected  = raderade skanningen · searched = gick till manuell sökning
   * De två sista är NEGATIVT facit och fanns inte alls före v2.
   */
  kind?: "corrected" | "confirmed" | "rejected" | "searched";
  /** "pick" = aktivt val · "bulk" = Lägg till alla · "auto" = ingen handling. */
  via?: "pick" | "bulk" | "auto";
  productId?: string;
  /** 1-baserad plats i den VISADE listan. 0/utelämnad = inte ur listan. */
  rank?: number;
  /** Samma cardId, annan productId — rättelse av tryckningen, inte av kortet. */
  variantChanged?: boolean;
  at?: string;
}

/* ------------------------------------------------------------------ *
 * SKURDETEKTION — retroaktiv addAll-identifiering
 * ------------------------------------------------------------------ */

/**
 * ⛔ TRÖSKELN ÄR SATT PÅ FÖRDELNINGEN, INTE PÅ EN MAGKÄNSLA — OCH KÄNSLIGHETEN
 * ÄR MÄTT, INTE PÅSTÅDD.
 *
 * addAll skriver i SKUR. Domglappen hos samma användare (egen körning
 * 2026-08-29, 30 dygn, **n=670 glapp**): p10 **0,125 s** · p25 0,135 · median
 * **0,160 s** · p75 0,184 · p90 **48,8 s**. Fördelningen är alltså bimodal med
 * ~2,5 tiopotenser mellan topparna, och 5 s ligger i gapet mellan dem.
 *
 * ⛔ **PÅSTÅENDET "VILKEN GRÄNS SOM HELST I BANDET 1–30 s GER NÄSTAN SAMMA SVAR"
 * VAR OMÄTT NÄR DET SKREVS, OCH DET BÄR HELA DELNINGEN 1b/1c.** Nu svept över
 * samma domar (`skurSvep`, noll DB-arbete; rapporten skriver ut tabellen vid
 * varje körning). Mätt 2026-08-29, 694 domar:
 *
 *      fönster   addAll-andel (alla strata)   vision-bekräftelser pick/bulk
 *       1 s       577/694 = **83,1 %**         52 / 452
 *       5 s       579/694 = **83,4 %**         50 / 454
 *      30 s       580/694 = **83,6 %**         49 / 455
 *
 * Spridningen över HELA bandet är **0,5 procentenheter** och 1b/1c rör sig med
 * **3 rader av 504**. Påståendet håller alltså i det här datat — men det är en
 * AVLÄSNING som ska göras om när `via` börjar finnas på riktiga rader, inte en
 * egenskap hos metoden.
 *
 * ⛔ **DEN KAN INTE SKILJA addAll FRÅN EN SNABB MÄNNISKA.** Någon som trycker
 * igenom fem kort på fem sekunder ser exakt likadan ut. Gissningen är en NEDRE
 * gräns för addAll-andelen, aldrig ett precisionsmått — och den används BARA
 * när `via` saknas. Finns `via` vinner den alltid, utan undantag.
 * ⚠️ I fönstret ovan saknas `via` på VARJE rad (DOMKLASSNING: via-fält 0), så
 * delningen är i praktiken helt och hållet den här gissningen.
 */
const BURST_WINDOW_MS = 5_000;
const BURST_MIN_NEIGHBOURS = 4;

/**
 * Ren funktion: sorterade tidsstämplar (ms) för EN användare in, en flagga per
 * dom ut. "I skur" = minst `BURST_MIN_NEIGHBOURS` ANDRA domar inom ±fönstret.
 * ⛔ Fönstret är dubbelsidigt — den första domen i en addAll-skur har alla sina
 * grannar efter sig, den sista alla före. Ett enkelsidigt fönster hade tappat
 * skurens ändar och underskattat addAll-andelen systematiskt.
 */
export function markBursts(
  sortedTimesMs: number[],
  windowMs = BURST_WINDOW_MS,
  minNeighbours = BURST_MIN_NEIGHBOURS
): boolean[] {
  const out: boolean[] = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < sortedTimesMs.length; i++) {
    const t = sortedTimesMs[i];
    while (lo < sortedTimesMs.length && sortedTimesMs[lo] < t - windowMs) lo++;
    while (hi < sortedTimesMs.length && sortedTimesMs[hi] <= t + windowMs) hi++;
    // [lo, hi) är fönstret INKLUSIVE domen själv → dra av 1.
    out.push(hi - lo - 1 >= minNeighbours);
  }
  return out;
}

interface SvepUtfall {
  windowMs: number;
  addAllI: number;
  addAllAv: number;
  visionPick: number;
  visionBulk: number;
}

/**
 * KÄNSLIGHETSSVEP: samma domar, annat skurfönster.
 *
 * ⛔ **PÅSTÅENDET "VILKEN GRÄNS SOM HELST GER SAMMA SVAR" MÅSTE MÄTAS, INTE GISSAS.**
 * Skurgissningen är inte marginell — den klassar i praktiken HELA vision-delningen
 * (mätt nedan: `via` saknas på varje rad i fönstret, så 1b/1c avgörs på tidsstämpel).
 * Datat ligger redan i minnet och `markBursts` tar fönstret som parameter, så
 * kostnaden för att svara är noll DB-arbete.
 */
function skurSvep(rows: Row[], perUser: Map<string, Row[]>, windowMs: number): SvepUtfall {
  const flagga = new Map<Row, boolean>();
  for (const list of perUser.values()) {
    const flags = markBursts(
      list.map((x) => x.atMs ?? 0),
      windowMs
    );
    list.forEach((row, i) => flagga.set(row, flags[i]));
  }
  const ut: SvepUtfall = { windowMs, addAllI: 0, addAllAv: 0, visionPick: 0, visionBulk: 0 };
  for (const row of rows) {
    const via = row.chosen.via;
    const iSkur = flagga.get(row);
    const styrka: Domstyrka | undefined =
      via === "pick" || via === "bulk" || via === "auto"
        ? via
        : iSkur === undefined
          ? undefined
          : iSkur
            ? "bulk"
            : "pick";
    if (styrka === undefined) continue;
    ut.addAllAv++;
    if (styrka === "bulk") ut.addAllI++;
    if (row.stratum === "vision" && row.chosen.kind === "confirmed") {
      if (styrka === "bulk") ut.visionBulk++;
      else if (styrka === "pick") ut.visionPick++;
    }
  }
  return ut;
}

/* ------------------------------------------------------------------ *
 * STRATIFIERING
 * ------------------------------------------------------------------ */

type Stratum = "vision" | "art" | "bulk";
/** Hur stratumet bestämdes — en gissning får aldrig se ut som en avläsning. */
type StratumKalla = "src" | "retroaktiv";

/**
 * RETROAKTIV ART-DETEKTION för rader före `recall.src = "art"`.
 *
 * `recordScanUsage` bokför `costModel: null` när INGET vision-anrop gjordes, och
 * på en rad som ändå bär `recall` finns bara en väg dit: `skipVision`, dvs
 * bilden avgjorde. Nyckeln skrivs alltid ut (aldrig bortplockad), så
 * `"costModel" in result` skiljer "gratis" från "omätt".
 *
 * ⚠️ **FELLÄGET**: ett vision-anrop som föll ifrån utan `model`/`usage` bokförs
 * också som `null` och hamnar då i ART-hinken i stället för i VISION-hinken. Det
 * drar art-hinkens topp-1 NEDÅT (raden är ju inte grindad på svaret), så felet
 * yttrar sig som falska "fallna trust-regler" — inte som uppblåst recall. Det är
 * rätt håll att fela åt, men läs korrigeringarna i avsnitt 2a med det i handen.
 * ⛔ Gissningen används BARA när `recall.src` saknas. Från 2026-08-29 skriver
 * skannern fältet, och då ska den här funktionen sluta träffa något alls.
 */
function retroaktivtArtAvgjord(result: Record<string, unknown>): boolean {
  return "costModel" in result && result.costModel === null;
}

interface Row {
  userId: string;
  stratum: Stratum;
  kalla: StratumKalla;
  chosen: UserChosen;
  atMs?: number;
  /** Rang i BILDENS lista (1-baserad); 0 = utanför. */
  artRank: number;
  /** Rang i den VISADE listan (1-baserad); 0 = utanför. */
  shownRank: number;
  /** Längden på `recall.shown` — nämnaren i rang-vakten nedan. */
  shownLen: number;
  /** Sätts av skurpasset; undefined = ingen tidsstämpel att gissa på. */
  iSkur?: boolean;
}

/**
 * DOMSTYRKA — hur mycket en dom är värd som facit.
 *   "pick"  = aktivt val i listan · "bulk" = ett tryck på Lägg till alla
 *   "auto"  = ingen mänsklig handling alls · "okand" = går inte att placera
 */
type Domstyrka = "pick" | "bulk" | "auto" | "okand";
/** Avläst `via`-fält, retroaktiv skurgissning, eller ingetdera. */
type StyrkaKalla = "via" | "skur" | "ingen";

/**
 * ⛔ **DOMSTYRKAN GÄLLER ALLA STRATA, INTE BARA VISION.** Vision-hinken delades i
 * 1b/1c med argumentet "en bekräftelse har två styrkor och den svaga dominerar" —
 * men art- och bulk-bekräftelserna gick rakt in i sina hinkar utan att någon tittade
 * på `via`/skur. Filens starkaste påstående (trust-precision) vilade alltså på det
 * SVAGASTE facit:et. Styrkan räknas därför fram EN gång per rad, här, och redovisas
 * i varje hink (se `report()`).
 * ⛔ AVLÄST `via` VINNER ALLTID över skurgissningen — utan undantag.
 */
function domstyrkaFor(row: Row): { styrka: Domstyrka; kalla: StyrkaKalla } {
  const via = row.chosen.via;
  if (via === "pick" || via === "bulk" || via === "auto") return { styrka: via, kalla: "via" };
  if (row.iSkur !== undefined) return { styrka: row.iSkur ? "bulk" : "pick", kalla: "skur" };
  return { styrka: "okand", kalla: "ingen" };
}

/* ------------------------------------------------------------------ *
 * HINKAR
 * ------------------------------------------------------------------ */

interface Bucket {
  n: number;
  artRanks: number[];
  shownRanks: number[];
  variantChanged: number;
  /** `userChosen.rank` fanns men pekade inte på samma plats som `shown`. */
  rankOenighet: number;
  /** Hinkens SAMMANSÄTTNING i domstyrka — redovisas för varje hink, inte bara vision. */
  styrka: Record<Domstyrka, number>;
}

function emptyBucket(): Bucket {
  return {
    n: 0,
    artRanks: [],
    shownRanks: [],
    variantChanged: 0,
    rankOenighet: 0,
    styrka: { pick: 0, bulk: 0, auto: 0, okand: 0 },
  };
}

function push(b: Bucket, row: Row): void {
  b.n++;
  b.artRanks.push(row.artRank);
  b.shownRanks.push(row.shownRank);
  if (row.chosen.variantChanged) b.variantChanged++;
  b.styrka[domstyrkaFor(row).styrka]++;
  const r = row.chosen.rank;
  // SANITETSKONTROLL: klientens rang mot serverns `shown`. Går de isär var
  // listan användaren såg inte den vi bokförde, och då mäter rapporten fel lista.
  if (typeof r === "number" && r > 0 && row.shownRank > 0 && r !== row.shownRank) {
    b.rankOenighet++;
  }
}

function merge(...bs: Bucket[]): Bucket {
  const out = emptyBucket();
  for (const b of bs) {
    out.n += b.n;
    out.artRanks.push(...b.artRanks);
    out.shownRanks.push(...b.shownRanks);
    out.variantChanged += b.variantChanged;
    out.rankOenighet += b.rankOenighet;
    for (const k of ["pick", "bulk", "auto", "okand"] as const) out.styrka[k] += b.styrka[k];
  }
  return out;
}

/**
 * ÖVRE 95 %-GRÄNS FÖR EN FELFREKVENS NÄR NOLL FEL SETTS ("rule of three": 3/n).
 *
 * ⛔ **ETT TAL UTAN n ÄR INGEN PRECISION.** 0 av 46 är förenligt med ~6,5 % sanna
 * fel, 0 av 142 med ~2,1 %. En fil som själv uppfann `MIN_GRIND_N` med argumentet
 * "en grind som bara kan svara ja är ingen grind" får inte skriva ut "100,0 %" utan
 * sin egen övre gräns på samma rad.
 */
function nollFelTak(n: number): string {
  return n > 0 ? `≤ ${((3 / n) * 100).toFixed(1)} % (95 %, rule of three)` : "odefinierat";
}

/** Svenskt decimaltecken — trösklarna står i löpande text bredvid "0,028" och "0,70". */
function sv(n: number, d = 2): string {
  return n.toFixed(d).replace(".", ",");
}

/** "aktivt val 3 (6,5 %) · Lägg till alla 43 (93,5 %) · auto 0 · okänd 0" */
function styrkeRad(b: Bucket): string {
  const p = (v: number) => `${((v / b.n) * 100).toFixed(1)} %`;
  return (
    `aktivt val ${b.styrka.pick} (${p(b.styrka.pick)}) ·` +
    ` Lägg till alla ${b.styrka.bulk} (${p(b.styrka.bulk)}) ·` +
    ` auto ${b.styrka.auto} · okänd ${b.styrka.okand}`
  );
}

function atOrBetter(ranks: number[], k: number): number {
  return ranks.filter((r) => r > 0 && r <= k).length;
}

/** Andel av hinken där BILDEN hade kortet inom topp-k. NaN på tom hink. */
function artRecall(b: Bucket, k: number): number {
  return b.n === 0 ? NaN : atOrBetter(b.artRanks, k) / b.n;
}

function report(title: string, b: Bucket, note?: string): void {
  if (b.n === 0) {
    console.log(`\n--- ${title}: inga rader ---${note ? `\n    ${note}` : ""}`);
    return;
  }
  const p = (v: number) => `${((v / b.n) * 100).toFixed(1)} %`;
  console.log(`\n--- ${title} (n=${b.n}) ---`);
  if (note) console.log(`    ${note}`);
  // ⛔ SAMMANSÄTTNINGEN FÖRE TALEN. En hink som till 90 % består av masstryck är
  // ett svagare facit än en lika stor hink av aktiva val, oavsett vilket stratum
  // den ligger i — därför står raden i VARJE hink, inte bara i vision-delningen.
  console.log(`  DOMSTYRKA I HINKEN: ${styrkeRad(b)}`);
  console.log(`  BILDEN ENSAM (art):`);
  for (const k of KS) {
    const v = atOrBetter(b.artRanks, k);
    console.log(`    topp-${String(k).padEnd(2)} : ${String(v).padStart(4)}  ${p(v)}`);
  }
  const outside = b.artRanks.filter((r) => r === 0).length;
  console.log(`    utanför : ${String(outside).padStart(4)}  ${p(outside)}`);
  console.log(`  LISTAN SOM VISADES (shown, bild+text):`);
  for (const k of [1, 3] as const) {
    const v = atOrBetter(b.shownRanks, k);
    console.log(`    topp-${String(k).padEnd(2)} : ${String(v).padStart(4)}  ${p(v)}`);
  }
  // Den enda siffra som säger vad vision FAKTISKT bidrog med: kortet fanns i
  // den visade listan men inte i bildens. Allt annat hade bilden klarat själv.
  const visionCarried = b.artRanks.filter((r, i) => r === 0 && b.shownRanks[i] > 0).length;
  console.log(`  VISION BAR TRÄFFEN (i shown, ej i art): ${visionCarried}  ${p(visionCarried)}`);
  if (b.variantChanged > 0) {
    console.log(
      `  VARIANTBYTE (samma kort, annan tryckning): ${b.variantChanged}  ${p(b.variantChanged)}` +
        `  ⛔ rättelse av PRODUKTEN, inte av kortet — ingår i talen ovan`
    );
  }
  if (b.rankOenighet > 0) {
    console.log(
      `  ⚠️ RANG-OENIGHET: ${b.rankOenighet} rader där userChosen.rank ≠ platsen i shown` +
        ` — listan användaren såg var inte den vi bokförde.`
    );
  }
}

/* ------------------------------------------------------------------ *
 * PERCENTILER (artTop / artMargin)
 * ------------------------------------------------------------------ */

function percentil(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

function fordelning(namn: string, values: number[], tackning: string): void {
  if (values.length === 0) {
    console.log(`  ${namn}: inga värden — ${tackning}`);
    return;
  }
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => percentil(s, p).toFixed(3);
  console.log(
    `  ${namn} (n=${s.length}): p10 ${q(10)} · p25 ${q(25)} · median ${q(50)} ·` +
      ` p75 ${q(75)} · p90 ${q(90)}  [${tackning}]`
  );
}

/* ------------------------------------------------------------------ *
 * HUVUDPROGRAM
 * ------------------------------------------------------------------ */

async function main() {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const jobs = await prisma.scannerJob.findMany({
    where: {
      createdAt: { gte: since },
      status: { not: "FAILED" },
      NOT: { result: { equals: Prisma.DbNull } },
    },
    select: { id: true, userId: true, result: true },
  });

  // RADER per stratum (med OCH utan dom) — nämnaren i domtäckningen och den
  // enda giltiga vikten i det populationsviktade talet längre ner.
  const rader: Record<Stratum, number> = { vision: 0, art: 0, bulk: 0 };
  const rows: Row[] = [];
  const users = new Set<string>();
  let withRecall = 0;
  let withoutChoice = 0;
  let tomArtLista = 0;
  let retroaktivaArtRader = 0;
  let v2Rader = 0;
  const topValues: number[] = [];
  const marginValues: number[] = [];

  /**
   * KANARIEFÅGEL — HELTÄCKANDE, ÖVER ALLA STRATA OCH ALLA DOMTYPER.
   *
   * ⛔ Den gamla vakten ("DOMKLASSNING: via-fält N") räknades BARA i vision-grenens
   * bekräftelser: art-, bulk- och korrigeringsrader passerade ett `continue` innan
   * dess, så en namnglidning i de vägarna (`via: "tap"`, `kind: "picked"`,
   * `src: "grid"`) hade varit osynlig i exakt de hinkar filens starkaste påstående
   * vilar på. Kontrollerna ligger nu i inläsningen, före all stratifiering.
   * ⚠️ Noll är en AVLÄSNING och skrivs ut som en sådan — en tyst vakt är ingen vakt.
   */
  const kanarie = {
    okandKind: 0,
    okandVia: 0,
    okandSrc: 0,
    /** Positiv dom utan `cardId`-NYCKEL: äldre rad, går inte att ranka. Exkluderas. */
    positivUtanKort: 0,
    /** Positiv dom med `cardId: null` — Zod-refinementet i rutten förbjuder det. */
    positivMedNullKort: 0,
    /** `rank` pekar bortom den `shown`-lista vi bokförde. */
    rankUtomShown: 0,
    /** `rank` ≠ platsen i `shown` — över ALLA strata, även negativa domar. */
    rankOenighet: 0,
    /** Variantbyte utan `productId`: bytet har inget mål. */
    variantUtanProdukt: 0,
    /** Variantbyte + `corrected`: motsägelse — samma cardId kan inte vara ett annat kort. */
    variantPaKorrigering: 0,
    /** Variantbyte på en negativ dom: inget valdes, så inget kan ha bytt tryckning. */
    variantPaNegativ: 0,
  };
  const KANDA_KIND = ["corrected", "confirmed", "rejected", "searched"];
  const KANDA_VIA = ["pick", "bulk", "auto"];
  const KANDA_SRC = ["bulk", "art"];

  for (const job of jobs) {
    const r = job.result as Record<string, unknown> | null;
    if (!r || typeof r !== "object") continue;
    const recall = r.recall as Recall | undefined;
    if (!recall || !Array.isArray(recall.art)) continue;
    // ⛔ En TOM art-lista är inte "bilden missade" utan "bilden tillfrågades
    // aldrig" (streckkod/uppladdning). Från v2 skrivs `recall` inte alls i det
    // läget; äldre rader räknas här och exkluderas — annars sjunker recall av
    // rader som inte mäter någonting.
    if (recall.art.length === 0) {
      tomArtLista++;
      continue;
    }
    withRecall++;
    if ((recall.v ?? 1) >= 2) v2Rader++;
    if (typeof recall.top === "number") topValues.push(recall.top);
    if (typeof recall.margin === "number") marginValues.push(recall.margin);

    if (recall.src !== undefined && !KANDA_SRC.includes(recall.src)) kanarie.okandSrc++;

    let stratum: Stratum;
    let kalla: StratumKalla = "src";
    if (recall.src === "bulk") {
      stratum = "bulk";
    } else if (recall.src === "art") {
      stratum = "art";
    } else if (retroaktivtArtAvgjord(r)) {
      stratum = "art";
      kalla = "retroaktiv";
      retroaktivaArtRader++;
    } else {
      stratum = "vision";
    }
    rader[stratum]++;

    const chosen = r.userChosen as UserChosen | undefined;
    if (!chosen?.kind) {
      withoutChoice++;
      continue;
    }
    if (!KANDA_KIND.includes(chosen.kind)) kanarie.okandKind++;
    if (chosen.via !== undefined && !KANDA_VIA.includes(chosen.via)) kanarie.okandVia++;
    if (chosen.variantChanged) {
      if (!chosen.productId) kanarie.variantUtanProdukt++;
      if (chosen.kind === "corrected") kanarie.variantPaKorrigering++;
      if (chosen.kind === "rejected" || chosen.kind === "searched") kanarie.variantPaNegativ++;
    }

    const positiv = chosen.kind === "corrected" || chosen.kind === "confirmed";
    // ⛔ TRE TILLSTÅND FÖR `cardId`, OCH BARA ETT AV DEM FÅR BLI RANG 0.
    // Saknad NYCKEL på en positiv dom är en ÄLDRE rad: vi vet inte vad som valdes,
    // och att ranka den till 0 hade bokfört en okänd som en miss — samma fel som
    // `art: []`-raderna gjorde åt andra hållet. Exkluderas och räknas.
    if (positiv && !("cardId" in chosen)) {
      kanarie.positivUtanKort++;
      continue;
    }
    if (positiv && chosen.cardId === null) {
      kanarie.positivMedNullKort++;
      continue;
    }

    users.add(job.userId);
    const at = chosen.at ? Date.parse(chosen.at) : NaN;
    const shown = recall.shown ?? [];
    // Negativt facit (rejected/searched) bär inte alltid ett cardId — `null` är
    // dagens rutts sätt att säga "ingen träff att avvisa", och rang 0 är då SANT.
    const kort = typeof chosen.cardId === "string" ? chosen.cardId : null;
    const shownRank = kort ? shown.indexOf(kort) + 1 : 0;
    const rank = chosen.rank;
    if (typeof rank === "number" && rank > 0) {
      if (rank > shown.length) kanarie.rankUtomShown++;
      else if (shownRank > 0 && rank !== shownRank) kanarie.rankOenighet++;
    }
    rows.push({
      userId: job.userId,
      stratum,
      kalla,
      chosen,
      atMs: Number.isFinite(at) ? at : undefined,
      artRank: kort ? recall.art.indexOf(kort) + 1 : 0,
      shownRank,
      shownLen: shown.length,
    });
  }

  /* --- Skurpasset: en användare i taget, ALLA strata tillsammans -------
   * ⛔ Skuren är en egenskap hos TRYCKET, inte hos skanningen. Ett addAll över
   * en rutnätsfångst skriver domar för både säkra (art) och osäkra (vision)
   * celler i samma millisekund — grupperas de per stratum splittras skuren och
   * faller under tröskeln. */
  const perUser = new Map<string, Row[]>();
  for (const row of rows) {
    if (row.atMs === undefined) continue;
    const list = perUser.get(row.userId) ?? [];
    list.push(row);
    perUser.set(row.userId, list);
  }
  /** Glappet mellan två domar i följd hos SAMMA användare, i sekunder. */
  const glappSek: number[] = [];
  for (const list of perUser.values()) {
    list.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
    for (let i = 1; i < list.length; i++) {
      glappSek.push(((list[i].atMs ?? 0) - (list[i - 1].atMs ?? 0)) / 1000);
    }
    const flags = markBursts(list.map((x) => x.atMs ?? 0));
    list.forEach((row, i) => {
      row.iSkur = flags[i];
    });
  }
  const svep = [1_000, BURST_WINDOW_MS, 30_000].map((w) => skurSvep(rows, perUser, w));

  /* --- Hinkar ---------------------------------------------------------- */
  const visionCorrected = emptyBucket();
  const visionPick = emptyBucket();
  const visionAddAll = emptyBucket();
  const visionAuto = emptyBucket();
  const visionOkand = emptyBucket();
  const artCorrected = emptyBucket();
  const artConfirmed = emptyBucket();
  const bulkCorrected = emptyBucket();
  const bulkConfirmed = emptyBucket();
  /** Negativt facit per stratum — ALDRIG i recall-talen, det finns inget val. */
  const negativt: Record<Stratum, { rejected: number; searched: number; iArt: number }> = {
    vision: { rejected: 0, searched: 0, iArt: 0 },
    art: { rejected: 0, searched: 0, iArt: 0 },
    bulk: { rejected: 0, searched: 0, iArt: 0 },
  };
  /**
   * Hur domarna klassades: avläst `via` mot retroaktiv skurgissning.
   * ⛔ Räknas över ALLA domar och ALLA strata — den gamla vakten satt inuti
   * vision-grenens bekräftelser och kunde därför inte se en namnglidning i
   * art-, bulk- eller korrigeringsvägen.
   */
  const viaKalla = { via: 0, skur: 0, ingen: 0 };
  /** addAll-andel över ALLA domar (alla strata) — kontextsiffran till 1c. */
  const addAllAllaStrata = { i: 0, av: 0 };
  /** Hur många av art-domarna som vilar på den retroaktiva gissningen. */
  let artDomarRetroaktiva = 0;

  for (const row of rows) {
    const kind = row.chosen.kind;
    // addAll-andelen räknas över ALLA domar och ALLA strata: den svarar på
    // "hur mycket av vårt facit är ett uteblivet klick", vilket inte är en
    // fråga om vilket stratum raden hamnade i.
    const { styrka, kalla: styrkeKalla } = domstyrkaFor(row);
    viaKalla[styrkeKalla]++;
    if (styrka !== "okand") {
      addAllAllaStrata.av++;
      if (styrka === "bulk") addAllAllaStrata.i++;
    }
    if (row.stratum === "art" && row.kalla === "retroaktiv") artDomarRetroaktiva++;
    if (kind === "rejected" || kind === "searched") {
      const slot = negativt[row.stratum];
      if (kind === "rejected") slot.rejected++;
      else slot.searched++;
      // Låg kortet ÄNDÅ i bildens lista? Då fallerade presentationen, inte
      // recall — en UI-fråga, inte en modellfråga.
      if (row.artRank > 0 && row.artRank <= 15) slot.iArt++;
      continue;
    }
    if (kind === "corrected") {
      if (row.stratum === "vision") push(visionCorrected, row);
      else if (row.stratum === "art") push(artCorrected, row);
      else push(bulkCorrected, row);
      continue;
    }
    // kind === "confirmed"
    if (row.stratum === "art") {
      push(artConfirmed, row);
      continue;
    }
    if (row.stratum === "bulk") {
      push(bulkConfirmed, row);
      continue;
    }
    // Domstyrkan är redan framräknad ovan (samma funktion för alla strata).
    if (styrka === "bulk") push(visionAddAll, row);
    else if (styrka === "auto") push(visionAuto, row);
    else if (styrka === "pick") push(visionPick, row);
    else push(visionOkand, row);
  }

  const visionAlla = merge(visionCorrected, visionPick, visionAddAll, visionAuto, visionOkand);
  const artAlla = merge(artCorrected, artConfirmed);
  const bulkAlla = merge(bulkCorrected, bulkConfirmed);

  /* --- Översikt -------------------------------------------------------- */
  console.log(`\n=== KONST-RECALL, PRODUKTION (${DAYS} dygn) ===`);
  console.log(`Skanningar med mätdata : ${withRecall}`);
  console.log(`  utan användardom     : ${withoutChoice}  (se överlevnadsbias i filhuvudet)`);
  if (tomArtLista > 0) {
    console.log(
      `  tom art-lista (ej med): ${tomArtLista}  (bilden tillfrågades aldrig — får inte räknas som miss)`
    );
  }
  console.log(`Distinkta användare    : ${users.size}`);
  console.log(`recall-rader på v2     : ${v2Rader} av ${withRecall}`);

  console.log(`\nRADER PER STRATUM (nämnaren i domtäckningen och vikten i avsnitt 4):`);
  const domar: Record<Stratum, number> = {
    vision: visionAlla.n + negativt.vision.rejected + negativt.vision.searched,
    art: artAlla.n + negativt.art.rejected + negativt.art.searched,
    bulk: bulkAlla.n + negativt.bulk.rejected + negativt.bulk.searched,
  };
  for (const s of ["vision", "art", "bulk"] as const) {
    const tack = rader[s] > 0 ? `${((domar[s] / rader[s]) * 100).toFixed(1)} %` : "–";
    console.log(
      `  ${s.padEnd(6)}: ${String(rader[s]).padStart(5)} rader · ${String(domar[s]).padStart(4)} domar` +
        ` · domtäckning ${tack}`
    );
  }
  console.log(
    `  ⛔ TÄCKNINGEN SKILJER SIG SYSTEMATISKT MELLAN STRATA. Ett rakt medelvärde\n` +
      `     över alla domar viktar därför hinkarna efter hur ofta folk RAPPORTERAR,\n` +
      `     inte efter hur ofta de INTRÄFFAR. Se POPULATIONSVIKTAT i avsnitt 4.`
  );
  if (retroaktivaArtRader > 0) {
    console.log(
      `  ⚠️ ${retroaktivaArtRader} av ${rader.art} art-rader är RETROAKTIVT klassade` +
        ` (costModel === null),\n     inte avlästa ur recall.src — fältet skrevs först 2026-08-29.` +
        ` Ett vision-anrop som\n     föll ifrån utan model/usage hamnar i samma hink; se` +
        ` retroaktivtArtAvgjord().`
    );
  }
  console.log(
    `\nDOMKLASSNING (ALLA domar, alla strata och alla domtyper): via-fält ${viaKalla.via} ·` +
      ` skurgissning ${viaKalla.skur} · oklassad ${viaKalla.ingen}\n` +
      `  ⛔ Står "via-fält 0" här klassas HELA delningen 1b/1c på tidsstämpel — läs\n` +
      `     känslighetssvepet nedan innan något slutsatsdrivet läses ur den.`
  );
  console.log(
    `\nKANARIEFÅGEL (fältnamn och invarianter; 0 är en AVLÄSNING, inte tystnad):\n` +
      `  okänt kind ${kanarie.okandKind} · okänt via ${kanarie.okandVia} ·` +
      ` okänt src ${kanarie.okandSrc}\n` +
      `  positiv dom utan cardId-nyckel (äldre rad, EXKLUDERAD): ${kanarie.positivUtanKort}` +
      ` · med cardId:null (bryter rutans Zod): ${kanarie.positivMedNullKort}\n` +
      `  rank utom shown-listan ${kanarie.rankUtomShown} · rank ≠ plats i shown` +
      ` ${kanarie.rankOenighet}\n` +
      `  variantbyte utan productId ${kanarie.variantUtanProdukt} · på en korrigering` +
      ` ${kanarie.variantPaKorrigering} · på en negativ dom ${kanarie.variantPaNegativ}`
  );
  fordelning(
    "domglapp (s)",
    glappSek,
    `${glappSek.length} glapp mellan domar i följd hos samma användare`
  );
  console.log(
    `\nKÄNSLIGHETSSVEP FÖR SKURFÖNSTRET (samma domar, annat fönster — noll DB-arbete):`
  );
  for (const s of svep) {
    const andel = s.addAllAv > 0 ? ((s.addAllI / s.addAllAv) * 100).toFixed(1) : "–";
    console.log(
      `  ${String(s.windowMs / 1000).padStart(2)} s: addAll ${String(s.addAllI).padStart(4)}` +
        ` av ${s.addAllAv} = ${andel.padStart(5)} %` +
        `  · vision-bekräftelser: aktivt val ${String(s.visionPick).padStart(3)} ·` +
        ` Lägg till alla ${s.visionBulk}`
    );
  }
  console.log(
    `  ⛔ Går talen isär mellan 1 s och 30 s är gränsen 5 s ett ANTAGANDE, inte en\n` +
      `     avläsning — och 1b/1c är då en artefakt av den. Se BURST_WINDOW_MS.`
  );
  if (addAllAllaStrata.av > 0) {
    const andel = (addAllAllaStrata.i / addAllAllaStrata.av) * 100;
    console.log(
      `  "Lägg till alla" över ALLA strata: ${addAllAllaStrata.i} av ${addAllAllaStrata.av}` +
        ` = ${andel.toFixed(1)} %\n` +
        `  ⛔ Så stor del av vårt facit är ett UTEBLIVET klick. Läs varje` +
        ` bekräftelse-tal\n     med den andelen i handen.`
    );
  }

  if (withRecall === 0) {
    console.log(
      `\nInga rader ännu. Mätdatat skrivs från och med deployen 2026-08-15 —\n` +
        `kör om när riktiga skanningar hunnit ske.`
    );
    return;
  }

  /* --- 1. VISION-BEHÖVDES --------------------------------------------- */
  console.log(
    `\n\n########## 1. VISION-BEHÖVDES — DET ENDA RIKTIGA MÅTTET ##########\n` +
      `artConfidentFrom sa NEJ och vi betalade för ett vision-anrop. Bara här är\n` +
      `frågan "räcker bilden ensam?" obesvarad i förväg. Talen nedan är stratumets\n` +
      `egna — de gäller de SVÅRA fallen och får ALDRIG citeras som "skannerns recall".`
  );
  report(
    "1a. KORRIGERADE — starkt facit, grindens mått",
    visionCorrected,
    "Användaren valde ett ANNAT KORT. Anrikat med de svåra fallen."
  );
  report(
    "1b. BEKRÄFTADE via aktivt val — medelstarkt facit",
    visionPick,
    'via:"pick", eller retroaktivt: dom UTANFÖR skur. Användaren tog ett beslut.'
  );
  report(
    "1c. BEKRÄFTADE via Lägg till alla — SVAGAST",
    visionAddAll,
    'via:"bulk", eller retroaktivt: dom I skur. "Invände inte" är inte "granskade".'
  );
  if (visionAuto.n > 0) {
    report(
      "1d. BEKRÄFTADE automatiskt — ingen mänsklig handling alls",
      visionAuto,
      'via:"auto". ⛔ Får inte räknas som aktivt val; egen rad med flit.'
    );
  }
  if (visionOkand.n > 0) {
    report(
      "1e. BEKRÄFTADE, domstyrka OKÄND",
      visionOkand,
      "Varken via-fält eller tidsstämpel — går inte att placera. Aldrig hopslagen."
    );
  }
  report(
    "1f. HELA VISION-STRATUMET (blandning av 1a–1e)",
    visionAlla,
    "Läs 1a–1c först: blandningen styrs av hur folk råkar bekräfta, inte av skannern."
  );
  const neg = negativt.vision;
  console.log(
    `\n--- 1g. NEGATIVT FACIT (vision) ---\n` +
      `  raderade skanningen (rejected)      : ${neg.rejected}\n` +
      `  gick till manuell sökning (searched): ${neg.searched}\n` +
      `  ...varav kortet ÄNDÅ låg i bildens topp-15: ${neg.iArt}` +
      `  (då fallerade presentationen, inte recall)\n` +
      `  ⛔ Ingår ALDRIG i recall-talen ovan — det finns inget valt kort att ranka.` +
      (neg.rejected + neg.searched === 0
        ? `\n  ⚠️ NOLL rader: kanalen finns först i v2. Före den skrevs ingen userChosen\n` +
          `     alls när användaren gav upp, och de skanningarna är osynliga i HELA\n` +
          `     rapporten. Det ÄR överlevnadsbiasen — här kvantifierad till "okänd".`
        : ``)
  );

  /* --- 2. ART-AVGJORD -------------------------------------------------- */
  console.log(
    `\n\n########## 2. ART-AVGJORD — KONTROLLHINK, INTE ETT RESULTAT ##########\n` +
      `skipVision: artConfidentFrom sa JA, inget vision-anrop gjordes, och\n` +
      `ART_TRUST_BONUS gjorde bildens etta till svaret. ⛔ TOPP-1 ÄR DÄRFÖR 100 %\n` +
      `PER KONSTRUKTION — hinken är grindad på exakt det den skulle mäta. Ett högt\n` +
      `tal här betyder att grinden fungerar, inte att skannern är bra. Summeras den\n` +
      `med avsnitt 1 stiger recall mot 100 % utan att något förbättrats.\n` +
      `Det som ÄR intressant: varje KORRIGERING är en trust-regel som föll.`
  );
  report("2a. ART, korrigerade — trust-regeln hade FEL", artCorrected);
  report("2b. ART, bekräftade — trust-regeln hade rätt", artConfirmed);
  if (artAlla.n > 0) {
    const precision = (artConfirmed.n / artAlla.n) * 100;
    const utanDom = rader.art - domar.art;
    console.log(
      `\n  TRUST-PRECISION I FÄLT (art): ${artConfirmed.n}/${artAlla.n} = ${precision.toFixed(1)} %` +
        `${artCorrected.n === 0 ? ` — sann felfrekvens ${nollFelTak(artAlla.n)}` : ``}\n` +
        `  ⛔ **TALET ÄR ETT TAK, INTE EN MÄTNING.** Tre skäl, alla åt samma håll:\n` +
        `     1. ÖVERLEVNADSBIAS: ${utanDom} av ${rader.art} art-rader (${(
          (utanDom / rader.art) *
          100
        ).toFixed(1)} %) bär INGEN dom alls, och före v2\n` +
        `        lämnade ett FELAKTIGT art-avgjort svar inget spår — användaren gav upp\n` +
        `        eller sökte manuellt utan att någon rad skrevs.\n` +
        `     2. FACIT:ETS STYRKA: se DOMSTYRKA i hinken ovan. En bekräftelse ur ett\n` +
        `        masstryck är ett uteblivet klick, inte ett godkännande.\n` +
        `     3. n: 0 fel av ${artAlla.n} utesluter inte en felfrekvens under taket ovan.\n` +
        `  (offline 2026-07-30: 0 fel av 40 ⇒ ${nollFelTak(40)}.\n` +
        `   ⚠️ Den mätningen dömde med poäng ≥ 0,70 på den RENA FÄRGpoängen. Produktionen\n` +
        `   kör i dag ART_TRUST_SCORE ${sv(ART_TRUST_SCORE)} på den BLANDADE poängen plus\n` +
        `   agree-grenen (marginal ≥ ${sv(ART_AGREE_MARGIN)} när alla rutor är ense) — en\n` +
        `   BREDARE regel. Fälttalet mäter alltså inte samma grind som offline-talet.)`
    );
    if (artDomarRetroaktiva > 0) {
      console.log(
        `  ⚠️ ${artDomarRetroaktiva} av ${artAlla.n} domar i hinken vilar på den RETROAKTIVA\n` +
          `     klassningen (costModel === null), inte på ett avläst recall.src. En\n` +
          `     trasig vision-körning skulle synas här som en fallen trust-regel.`
      );
    }
    if (negativt.art.rejected + negativt.art.searched > 0) {
      console.log(
        `  negativt facit i art-stratumet: ${negativt.art.rejected} raderade,` +
          ` ${negativt.art.searched} sökte manuellt — också fallna trust-regler.`
      );
    }
  }

  /* --- 3. RUTNÄTS-BULK ------------------------------------------------- */
  if (rader.bulk > 0) {
    console.log(
      `\n\n########## 3. RUTNÄTS-BULK — KONTROLLHINK, INTE ETT RESULTAT ##########\n` +
        `identifyCellsArt bokför bara celler där bilden REDAN var säker. Samma grind\n` +
        `som avsnitt 2, annan väg in. ⚠️ Detta är recall.src="bulk" (FÅNGSTEN), inte\n` +
        `userChosen.via="bulk" (Lägg till alla-KNAPPEN) — två axlar, samma ord.`
    );
    report("3a. BULK, korrigerade — trust-regeln hade FEL", bulkCorrected);
    report("3b. BULK, bekräftade — trust-regeln hade rätt", bulkConfirmed);
    if (bulkAlla.n > 0) {
      const precision = (bulkConfirmed.n / bulkAlla.n) * 100;
      console.log(
        `\n  TRUST-PRECISION I FÄLT (bulk): ${bulkConfirmed.n}/${bulkAlla.n} =` +
          ` ${precision.toFixed(1)} %` +
          `${bulkCorrected.n === 0 ? ` — sann felfrekvens ${nollFelTak(bulkAlla.n)}` : ``}\n` +
          `  ⛔ Samma tak som i avsnitt 2, och hinken är MINDRE: en liten hink ger en\n` +
          `     HÖGRE övre gräns, inte ett säkrare svar. Domtäckningen är visserligen\n` +
          `     100 % (en bokförd cell får alltid en dom), men en cell som användaren\n` +
          `     tog bort blir \`rejected\` — en kanal som finns först i v2, så före den\n` +
          `     var ett fel i bulk-vägen lika spårlöst som i art-vägen.\n` +
          `     Läs DOMSTYRKA i hinken ovan: precisionen är bara så stark som facit:et.`
      );
    }
  }

  /* --- 4. POPULATIONSVIKTAT + TÄCKNINGSTAK ----------------------------- */
  console.log(
    `\n\n########## 4. POPULATIONSVIKTAT — DET ENDA TALET SOM FÅR KALLAS "SKANNERNS",` +
      ` OCH DET ÄR ETT TAK ##########`
  );
  const bildforstRader = rader.art + rader.vision;
  if (bildforstRader === 0 || artAlla.n === 0 || visionAlla.n === 0) {
    console.log(
      `  Går inte att räkna: ett stratum saknar rader eller domar` +
        ` (art ${rader.art} rader/${artAlla.n} domar, vision ${rader.vision}/${visionAlla.n}).`
    );
  } else {
    const andelArt = rader.art / bildforstRader;
    const andelVision = rader.vision / bildforstRader;
    console.log(
      `  Vikterna kommer ur RADERNA, inte ur domarna: art ${(andelArt * 100).toFixed(1)} % ·` +
        ` vision ${(andelVision * 100).toFixed(1)} %\n  av ${bildforstRader} enkelskanningar` +
        ` (rutnäts-bulken är en egen produkt och ingår inte).\n` +
        `  ⛔ Domarna duger INTE som vikt — domtäckningen skiljer sig systematiskt\n` +
        `     mellan strata, så ett rakt medelvärde lutar mot det stratum vars\n` +
        `     användare råkar rapportera mest.\n` +
        `  Formel: andel_art × art_recall + andel_vision × vision_recall`
    );
    for (const k of KS) {
      const a = artRecall(artAlla, k);
      const v = artRecall(visionAlla, k);
      const w = andelArt * a + andelVision * v;
      console.log(
        `    topp-${String(k).padEnd(2)} : art ${(a * 100).toFixed(1).padStart(5)} % ·` +
          ` vision ${(v * 100).toFixed(1).padStart(5)} %  ⇒  VIKTAT ${(w * 100).toFixed(1)} %`
      );
    }
    const utanDomAndel = (withoutChoice / withRecall) * 100;
    const tackArt = (domar.art / rader.art) * 100;
    const tackVision = (domar.vision / rader.vision) * 100;
    console.log(
      `  ⛔ DET HÄR — och bara det här — är svaret på "vad skulle en bild-först-\n` +
        `     skanner klara i produktion", OCH DET ÄR ETT TAK: ${withoutChoice} av ${withRecall}` +
        ` mätrader (${utanDomAndel.toFixed(1)} %)\n` +
        `     bär ingen dom alls, och poststratifieringen tar bara bort bias MELLAN\n` +
        `     strata — bortfallet INOM varje stratum är orört (domtäckning art` +
        ` ${tackArt.toFixed(1)} %,\n` +
        `     vision ${tackVision.toFixed(1)} %). Den som inte hittade sitt kort gav upp` +
        ` utan att lämna en rad.\n` +
        `     ⚠️ Kvalificeringen står på SAMMA RAD med flit: det var precis den\n` +
        `     mekanismen som gjorde 70,9 % citerbart i ett dygn. Ett tak som står i ett\n` +
        `     stycke längre ner citeras aldrig med.\n` +
        `     Vision-stratumets egna tal (avsnitt 1) är ett STRATUMTAL för de SVÅRA\n` +
        `     fallen; art-stratumets är en konstruktion. Citeras något av dem som\n` +
        `     helhetens tal är det en lögn åt var sitt håll.`
    );

    console.log(`\n  TÄCKNINGSTAK MED EN N-KORTS MENY (andel_art + andel_vision × vision_toppN):`);
    for (const k of KS) {
      const tak = andelArt + andelVision * artRecall(visionAlla, k);
      console.log(
        `    N=${String(k).padEnd(2)} : ${(tak * 100).toFixed(1).padStart(5)} %` +
          `  — andel av alla skanningar som får rätt kort framför sig utan vision-anrop`
      );
    }
    const artTop1 = artRecall(artAlla, 1);
    console.log(
      `  ⚠️ Taket räknar art-stratumet som 100 % (grindens LÖFTE). Mätt art-topp-1 är\n` +
        `     ${(artTop1 * 100).toFixed(1)} % — skillnaden mot det viktade talet ovan ÄR de fallna\n` +
        `     trust-reglerna. Går de isär: laga grinden, inte menyn.`
    );
  }

  /* --- 5. artTop / artMargin ------------------------------------------ */
  console.log(`\n\n########## 5. BILDENS POÄNG OCH MARGINAL ##########`);
  fordelning("artTop   ", topValues, `${topValues.length} av ${withRecall} rader bär fältet`);
  fordelning("artMargin", marginValues, `${marginValues.length} av ${withRecall} rader bär fältet`);
  console.log(
    `  Fördelningen är enda sättet att svara på "hur mycket kan trust-grinden\n` +
      `  vidgas" — hur många fler skanningar en sänkning skulle fånga syns bara som\n` +
      `  massa strax under trösklarna.\n` +
      `  ⛔ **GRINDEN ÄR TVÅGRENAD, OCH TALEN ÄR IMPORTERADE UR PRODUKTIONEN:**\n` +
      `     poäng ≥ ${sv(ART_TRUST_SCORE)} OCH ( marginal ≥ ${sv(ART_TRUST_MARGIN)}` +
      `  ELLER  alla videorutor ense OCH marginal ≥ ${sv(ART_AGREE_MARGIN)} ).\n` +
      `     Det EFFEKTIVA marginalgolvet för en flerrutefångst är alltså` +
      ` ${sv(ART_AGREE_MARGIN)}, inte ${sv(ART_TRUST_MARGIN)};\n` +
      `     läses percentilerna mot en engrenad regel överskattas hur mycket som\n` +
      `     återstår att vidga.\n` +
      `  ⛔ **RÄTT REFERENS FÖR RÄTT SKALA.** \`recall.top\` är den BLANDADE likheten\n` +
      `     (0,25·färg + 0,25·dctb + 0,5·grad), som ligger lägre än ren färgcosinus —\n` +
      `     det är hela skälet att score-tröskeln sänktes 0,70 → ${sv(ART_TRUST_SCORE)}` +
      ` den 2026-07-30.\n` +
      `     · BLANDAD skala (den här filens tal): rätta träffars toppar 0,56–0,95 på\n` +
      `       den kalibrerade benchmarken; FEL-marginal MAX **0,028 över 410 frågor**\n` +
      `       ⇒ ~3,6× säkerhet till ${sv(ART_TRUST_MARGIN)}.\n` +
      `     · GAMLA FÄRGmätningen (2026-07-30, n=250): poäng rätt median 0,873 / min\n` +
      `       0,570, FEL max 0,922 · marginal rätt median 0,111, FEL max 0,066 (1,5×).\n` +
      `       ⛔ Den linjalen hör INTE hemma på \`recall.top\` — annan skala, annat\n` +
      `       avtryck. Att citera 0,066 här är att blanda två mätningar till en.\n` +
      `  ⛔ MARGINALEN, INTE POÄNGEN, skiljer rätt från fel: poängfördelningarna\n` +
      `     överlappar i BÅDA mätningarna (en felträff kunde ha 0,922 där en rätt\n` +
      `     träff hade 0,570), marginalfördelningarna gör det inte.\n` +
      (topValues.length === 0
        ? `  ⚠️ FÄLTEN SAKNAS PÅ ALLA RADER HÄR — de skrivs först från 2026-08-29.\n` +
          `     Frågan går alltså inte att svara på ännu, bara att förbereda.`
        : `  ⚠️ Fälten saknas på alla rader före 2026-08-29 — läs n ovan, inte withRecall.`)
  );

  /* --- 6. GRINDEN ------------------------------------------------------ */
  const gVal = artRecall(visionCorrected, 3) * 100;
  const korrFrekvens =
    visionAlla.n > 0 ? `${((visionCorrected.n / visionAlla.n) * 100).toFixed(1)} %` : "–";
  console.log(
    `\n\n########## GRINDEN ##########\n` +
      `Bygg bild-först om VISION-STRATUMETS KORRIGERADE topp-3 håller ≥ 95 %.\n` +
      `⛔ Grinden går på hink 1a och ingenting annat: art- och bulk-hinkarna är\n` +
      `   grindade på svaret, och bekräftelser är partiska till vår fördel.\n` +
      `Nu: ${
        visionCorrected.n >= MIN_GRIND_N
          ? `${gVal.toFixed(1)} % (n=${visionCorrected.n})`
          : `OTILLRÄCKLIGT UNDERLAG — n=${visionCorrected.n}, krävs ≥ ${MIN_GRIND_N}` +
            `${visionCorrected.n > 0 ? ` (talet skulle bli ${gVal.toFixed(1)} %)` : ``}`
      }\n` +
      (visionCorrected.n < MIN_GRIND_N
        ? `⛔ **ETT HÖGT TAL PÅ EN LITEN HINK ÄR INGET GODKÄNNANDE.** Vid n under ${MIN_GRIND_N}\n` +
          `   är varje utfall antingen 100 % eller underkänt (se MIN_GRIND_N) — grinden\n` +
          `   kan inte svara nej, alltså betyder dess ja ingenting.\n` +
          `⚠️ VARFÖR ÄR HINKEN LITEN? Korrigeringsfrekvensen i vision-stratumet är\n` +
          `   ${visionCorrected.n} av ${visionAlla.n} = ${korrFrekvens}. Det mäter i första hand UPPMÄRKSAMHET:\n` +
          `   en korrigering kräver att någon tittade, och merparten av domarna kommer\n` +
          `   ur "Lägg till alla" (se DOMKLASSNING ovan), där ingen tittade. Vägen till\n` +
          `   ett utvärderingsbart underlag går via kind:"rejected"/"searched" (1g), inte\n` +
          `   via att vänta på fler korrigeringar.\n`
        : ``) +
      `\n` +
      `REFERENSER (historiska — ändra dem inte utan en ny mätning):\n` +
      `  · Facitfilen (ägarens egna fångster): topp-3 98,0 % — scripts/scanner-art-recall.ts.\n` +
      `    Reproducerades INTE i fält; dess massa på plats 2 (32,3 %) finns inte i\n` +
      `    riktiga fångster.\n` +
      `  · 2026-08-17: "70,9 % topp-3 (n=79) mätt på riktiga användare".\n` +
      `    ⛔ TALET ÄR OGILTIGT SOM STRATUMTAL. De art-avgjorda raderna saknade\n` +
      `    recall.src och summerades tyst in i enkelskanningarna — samma fälla som\n` +
      `    src:"bulk" redan varnade för, fast i mätningen i stället för i koden.\n` +
      `  · 2026-08-29, stratifierat (n=649 domar): VISION topp-1 39,8 % · topp-3\n` +
      `    58,2 % · topp-15 67,9 % · utanför 32,1 % (n=507). ART topp-1 100 % per\n` +
      `    konstruktion (n=142). POPULATIONSVIKTAT: 58,9 / 71,3 / 77,9 %.\n` +
      `    ⚠️ 70,9 % låg NÄRA det viktade 71,3 % — och lästes ändå som vision-\n` +
      `    stratumets tal, som är 58,2 %. Rätt storleksordning av fel skäl är den\n` +
      `    farligaste sortens fel: den överlever granskning.\n` +
      `    ⚠️ HÄRLEDNING AV SKILLNADEN MOT VISION-n=507 (skriv härledningen, inte\n` +
      `    slutsatsen): den mätningen räknade INTE bort rader med tom art-lista.\n` +
      `    Den här körningen exkluderar ${tomArtLista} sådana rader (se överst). Kärnans\n` +
      `    kommentar (services/scanner/index.ts) säger att 4 rader i prod bar \`art: []\`,\n` +
      `    VARAV 1 HADE EN DOM — de tre andra hade ingen och kan alltså inte flytta\n` +
      `    någon domräkning alls. Exklusionen kan därför sänka domräkningen med HÖGST\n` +
      `    ett, och att det blev just VISION-hinken (507 → ${visionAlla.n + neg.rejected + neg.searched}) följer bara om den\n` +
      `    domen låg i vision-stratumet. Det är härledningen; slutsatsen "de 4 tomma\n` +
      `    art-listorna förklarar skillnaden" är den INTE utan mellanledet.\n` +
      `    ⚠️ Fönstret rullar (DAGAR=${DAYS}) — n rör sig mellan körningar av sig självt,\n` +
      `    så en avvikelse här är i första hand kalendern, inte en bugg.\n` +
      `  · Andelen av allt facit som kommer ur ett tryck på "Lägg till alla" står i\n` +
      `    DOMKLASSNING överst i den här körningen (över ALLA strata). En\n` +
      `    "bekräftelse" är i regel ett uteblivet klick, inte ett godkännande.`
  );
}

main().finally(() => prisma.$disconnect());
