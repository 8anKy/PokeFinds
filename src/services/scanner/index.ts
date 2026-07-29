/**
 * Kortskanner: orkestrerar OCR-adapter → kortmatchning → ScannerJob.
 *
 * Bildlagring (MVP): vi sparar INTE base64-datan i databasen — fältet
 * imageUrl sätts till "inline-upload". I produktion laddas bilden upp till
 * S3-kompatibel objektlagring och URL:en sparas här (se docs/SCANNER.md).
 */
import type { PlanTier, Prisma, ScannerJob } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { FINGERPRINT_BYTES } from "@/lib/art-fingerprint";
import { cardNumberSortKey } from "@/lib/card-number-order";
import { scoreSimilarity } from "@/scrapers/matching";
import { searchByFingerprint } from "@/services/scanner/art-index";
import { getCardValues } from "@/services/products";
import { ClaudeVisionOcrAdapter } from "@/services/scanner/claude-vision";
import { MockOcrAdapter } from "@/services/scanner/ocr-mock";
import type { OcrAdapter, OcrResult, ScanCandidate } from "@/services/scanner/types";

/** Markör för bilder som laddats upp inline (MVP, ingen objektlagring). */
const INLINE_UPLOAD = "inline-upload";

/** Max antal kandidater som returneras. */
const MAX_CANDIDATES = 5;

/** Månadsgräns för sparade skanningar per plan (skyddar mot AI-missbruk + kostnad).
 *  Per-scan vision-anrop är enda rörliga kostnaden; månadstak (inte dygnstak) är det
 *  som faktiskt binder kostnaden mot Pro-priset ($4,99/mån). Haiku ≈ $0,0025/scan. */
function scannerLimitForTier(planTier: PlanTier): number {
  const env =
    planTier === "PREMIUM"
      ? process.env.SCANNER_PREMIUM_MONTHLY_LIMIT ?? "100"
      : process.env.SCANNER_FREE_MONTHLY_LIMIT ?? "30";
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : planTier === "PREMIUM" ? 100 : 30;
}

function startOfMonthUtc(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export interface ScannerQuota {
  used: number;
  limit: number;
  remaining: number;
}

/** Månadens skanningskvot (misslyckade/no-match-jobb räknas inte). */
export async function getScannerQuota(
  userId: string,
  planTier: PlanTier
): Promise<ScannerQuota> {
  const limit = scannerLimitForTier(planTier);
  const used = await prisma.scannerJob.count({
    where: { userId, createdAt: { gte: startOfMonthUtc() }, status: { not: "FAILED" } },
  });
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/** Bokför en skanning mot månadskvoten. VARJE scan som nådde vision-API:t räknas
 *  (träff ELLER no-match) — annars kan no-match-scans dränera API-budgeten gratis
 *  (bara 60/min skyddar). Live-skannern (/api/scanner/identify) skapar inget jobb
 *  själv, så detta är dess kvot-liggare. Endast äkta fel (API kastar) räknas inte. */
export async function recordScanUsage(userId: string): Promise<void> {
  await prisma.scannerJob.create({
    data: { userId, imageUrl: INLINE_UPLOAD, status: "COMPLETED" },
  });
}

/** Användarens N FÖRSTA skanningar (livstid) kan köras med den dyra, träffsäkra
 *  Sonnet-modellen (wow-faktor, ~$0,01/scan mot Haikus ~$0,002). DEFAULT AV
 *  (2026-07-07, kostnadsmål ~$0,002/scan) — sätt SCANNER_INTRO_SONNET_SCANS=1
 *  för att slå på igen. */
export async function isIntroScan(userId: string): Promise<boolean> {
  const n = Number(process.env.SCANNER_INTRO_SONNET_SCANS ?? "0");
  const intro = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (intro === 0) return false;
  const prior = await prisma.scannerJob.count({
    where: { userId, status: { not: "FAILED" } },
  });
  return prior < intro;
}

/**
 * Returnerar konfigurerad OCR-adapter utifrån env-variabeln OCR_PROVIDER.
 * "mock" (standard) använder utvecklingsmocken. Nya leverantörer
 * registreras här — se docs/SCANNER.md.
 *
 * `precise` väljer en starkare (men dyrare) vision-modell. Live-loopen pollar
 * med den snabba/billiga modellen (SCANNER_MODEL, Haiku); den precisa modellen
 * (SCANNER_MODEL_PRECISE, Sonnet) körs bara EN gång per kort — vid uppladdning
 * och vid den slutliga bekräftelsen innan ett kort låses — så att träffsäkerheten
 * blir hög utan att varje videoruta kostar Sonnet-tokens.
 */
export function getOcrAdapter(precise = false): OcrAdapter {
  const provider = process.env.OCR_PROVIDER ?? "mock";
  switch (provider) {
    case "mock":
      return new MockOcrAdapter();
    case "claude":
      return new ClaudeVisionOcrAdapter(
        precise
          ? process.env.SCANNER_MODEL_PRECISE ?? "claude-sonnet-4-6"
          : process.env.SCANNER_MODEL ?? "claude-haiku-4-5"
      );
    default:
      throw new ServiceError(
        503,
        "OCR-leverantör ej konfigurerad — se docs/SCANNER.md"
      );
  }
}

/** Tolkat kortnummer ur OCR:ens läsning. */
export interface GuessedNumber {
  /** Tryckt nummer som det står på kortet: "143", "TG10", "SWSH034", "130a". */
  printed: string;
  /** Katalognyckel — SAMMA sträng som `Card.numberSortKey` (indexerad kolumn). */
  sortKey: string;
  /** Talet i numret, eller null när numret saknar siffror ("A", "ONE"). */
  num: number | null;
  /** Totalen efter snedstrecket ("/195"), när modellen läst hela strängen. */
  total: number | null;
}

/**
 * Tolkar OCR:ens gissade kortnummer.
 *
 * BOKSTÄVERNA ÄR EN DEL AV NUMRET (fix 2026-07-29). Funktionen returnerade förut
 * bara ett heltal, och matchningen jämförde det mot `parseInt(card.number, 10)`.
 * Den jämförelsen ger `NaN` för VARJE bokstavsnumrerat kort — "TG10", "GG08",
 * "SWSH034", "SV075" — och tappar suffixet på "130a". Mätt mot prod-facit med en
 * FELFRI simulerad OCR missade matchningen 13,5 % av korten, och praktiskt taget
 * varenda miss var ett sådant nummer: Trainer Gallery, Shiny Vault, Black Star
 * Promos och alternativa tryckningar. Alltså exakt de kort någon bryr sig om att
 * skanna — de vanliga commons scannar man inte.
 *
 * `sortKey` speglar den GENERADE kolumnen `Card.numberSortKey`, så numret blir en
 * INDEXERAD exakt uppslagning i stället för en efterhandsbonus. Totalen behålls
 * separat: den är svagare (secret rares trycks "199/165") och används bara för
 * att gradera hur säker nummerträffen är, aldrig för att kasta en kandidat.
 */
export function parseGuessedNumber(raw: string | null | undefined): GuessedNumber | null {
  if (!raw) return null;
  // "TG10/TG30", "143/195", "199/091" — vänstersidan är kortets identitet.
  const withTotal =
    /([A-Za-z]{0,5})\s*0*(\d{1,4})\s*([A-Za-z]?)\s*[/／]\s*[A-Za-z]{0,5}\s*0*(\d{1,4})/.exec(raw);
  if (withTotal) {
    const printed = `${withTotal[1]}${withTotal[2]}${withTotal[3]}`;
    return {
      printed,
      sortKey: cardNumberSortKey(printed),
      num: parseInt(withTotal[2], 10),
      total: parseInt(withTotal[4], 10),
    };
  }
  // "H/115" — bokstavsnumret med setets total. MÅSTE prövas före den nakna
  // regexen nedan: den hittar inga siffror till vänster om snedstrecket och
  // skulle glatt läsa TOTALEN som kortnummer ("O/115" → kort 115).
  const alphaTotal = /^\s*([A-Za-z]{1,4}|[!?])\s*[/／]\s*[A-Za-z]{0,5}\s*0*(\d{1,4})/.exec(raw);
  if (alphaTotal) {
    return {
      printed: alphaTotal[1],
      sortKey: cardNumberSortKey(alphaTotal[1]),
      num: null,
      total: parseInt(alphaTotal[2], 10),
    };
  }
  // Naket nummer utan total: "143", "SWSH034", "MEP 074", "no. 25".
  const bare = /([A-Za-z]{0,5})\s*0*(\d{1,4})\s*([A-Za-z]?)/.exec(raw);
  if (bare) {
    const printed = `${bare[1]}${bare[2]}${bare[3]}`;
    return {
      printed,
      sortKey: cardNumberSortKey(printed),
      num: parseInt(bare[2], 10),
      total: null,
    };
  }
  // NUMRET BEHÖVER INTE VARA ETT TAL. 31 kort i katalogen är numrerade med bara
  // bokstäver: Unowns eget alfabet i Unseen Forces ("A"…"Z", "!", "?") plus fyra
  // Alph Lithograph ("ONE"…"FOUR"). Där ÄR bokstaven samlarordningen. Utan det
  // här föll de tillbaka på ren namnmatchning, och "Unown H" landade på en
  // Unown ur ett helt annat set. Ett skräpvärde ger bara en nyckel som inte
  // finns i katalogen — namnkällan står kvar som skydd.
  const alpha = /^\s*([A-Za-z]{1,4}|[!?])\s*$/.exec(raw);
  if (!alpha) return null;
  return {
    printed: alpha[1],
    sortKey: cardNumberSortKey(alpha[1]),
    num: null,
    total: null,
  };
}

/** Tak per kandidatkälla. Generöst — "charizard" ger 111 rader, "pikachu" 178. */
const CANDIDATE_LIMIT = 400;

/** Hur många kort bildmatchningen får föreslå. Mätt: rätt kort ligger i topp-15
 *  i 96 % av fallen även vid hård försämring (se src/lib/art-fingerprint.ts). */
const ART_CANDIDATES = 15;

/**
 * Vikt för bildlikheten i den samlade poängen.
 *
 * MEDVETET LÄGRE ÄN NUMMERBONUSEN (0,4–0,5): ett läst samlarnummer är ett EXAKT
 * bevis, bildlikhet är en gradering. Får bilden väga tyngre än numret börjar den
 * välja fel TRYCKNING — Base Unlimited, Shadowless och 1st Edition har identisk
 * konst och skiljs bara av numret. Bilden ska föreslå kandidater; numret ska
 * avgöra vilken av dem det är.
 */
const ART_WEIGHT = 0.3;

/** Kortnamn-tokens ur OCR-texten. Tomt resultat → hela frågan som en token. */
function nameTokens(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 5);
  // Kort HETER ibland kortare än tre tecken — "N", "Bea", "Guzma & Hala".
  // Med ett hårt ≥3-filter blev tokenlistan tom och matchningen returnerade
  // INGENTING för dem, oavsett hur bra modellen läst kortet.
  if (tokens.length > 0) return tokens;
  const whole = query.toLowerCase().trim();
  return whole ? [whole] : [];
}

/**
 * Matchar ett OCR-resultat mot kortkatalogen.
 *
 * KANDIDATURVALET VAR ETT SLUMPURVAL (fix 2026-07-29). Frågan var ett `OR` över
 * namn-tokens med `take: 50` och UTAN `orderBy` — Postgres returnerar då de 50
 * rader planen råkar producera. Mätt mot prod delar 18 938 av 20 563 kort (92 %)
 * namn med minst ett annat kort, och "charizard" ger 111 kandidatrader: rätt kort
 * låg utanför urvalet ungefär varannan gång, och VILKA 50 man fick kunde variera
 * mellan körningar. Ingen modelluppgradering i världen lagar det — kortet var
 * borta innan poängsättningen började.
 *
 * Nu hämtas kandidater ur TRE källor som unionsammanfogas (dubbletter faller bort
 * på id):
 *   1. nummer + namn   exakt `numberSortKey` OCH alla namn-tokens → oftast 1–3 rader
 *   2. bara nummer     räddar kortet när modellen stavat NAMNET fel
 *   3. bara namn       räddar kortet när modellen läst NUMRET fel (eller inte alls)
 *
 * Att köra alla tre kostar inget märkbart (indexerade uppslag, tak per källa) och
 * gör matchningen robust mot att ETT av de två fälten är fel — vilket är det
 * normala felet, inte att båda är fel samtidigt.
 */
export async function matchCards(
  ocr: OcrResult,
  /**
   * Bildmatchningens förslag (kort-id → likhet 0..1), från konstavtrycket.
   *
   * ADDITIVT med flit: förslagen LÄGGS TILL kandidaterna och höjer poängen, de
   * ERSÄTTER aldrig text-matchningen. Skälet är att bildmatchningens verkliga
   * träffsäkerhet är omätt — alla siffror vi har kommer från frågor som härletts
   * ur samma filer som referenserna, dvs ett tak. Byggt så här är värsta fallet
   * att bilden inte hjälper, inte att den gör resultatet sämre.
   */
  artScores?: Map<string, number>
): Promise<ScanCandidate[]> {
  const query = ocr.guessedName?.trim() || ocr.rawText.trim();
  const tokens = query ? nameTokens(query) : [];
  const guessedNum = parseGuessedNumber(ocr.guessedNumber);
  // Utan NÅGON signal finns inget att matcha på. Bildmatchningen räcker som enda
  // signal — det är hela poängen med den: den fungerar när texten är oläslig.
  if (tokens.length === 0 && !guessedNum && !artScores?.size) return [];

  const select = {
    id: true,
    name: true,
    number: true,
    numberSortKey: true,
    rarity: true,
    imageUrl: true,
    set: { select: { name: true, totalCards: true, releaseDate: true } },
  } as const;
  const nameAll = tokens.map((t) => ({ name: { contains: t, mode: "insensitive" as const } }));
  // Deterministisk ordning: ett tak utan orderBy är samma slumpurval igen.
  const orderBy = { id: "asc" as const };

  const sources = await Promise.all([
    // 1+2: nummerkällorna. Exakt uppslag på den indexerade generade kolumnen.
    guessedNum
      ? prisma.card.findMany({
          where: { numberSortKey: guessedNum.sortKey },
          select,
          orderBy,
          take: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
    // 3: namnkällan. AND över alla tokens först (precist), OR som reserv —
    // "Iron Valiant ex" som OR drar in varenda Iron Hands/Iron Moth i katalogen.
    nameAll.length === 0
      ? Promise.resolve([])
      : prisma.card
          .findMany({ where: { AND: nameAll }, select, orderBy, take: CANDIDATE_LIMIT })
          .then((rows) =>
            rows.length > 0
              ? rows
              : prisma.card.findMany({
                  where: { OR: nameAll },
                  select,
                  orderBy,
                  take: CANDIDATE_LIMIT,
                })
          ),
    // 4: bildkällan. Uppslag på PRIMÄRNYCKEL — billigaste möjliga fråga, och
    // därför går Neon-arbetet per skanning NER när bilden bidrar: 15 rader på id
    // i stället för ytterligare en genomsökning.
    artScores?.size
      ? prisma.card.findMany({
          where: { id: { in: [...artScores.keys()] } },
          select,
          orderBy,
        })
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, (typeof sources)[0][number]>();
  for (const rows of sources) for (const r of rows) byId.set(r.id, r);
  if (byId.size === 0) return [];

  const scored = [...byId.values()].map((card) => {
    // Namnlikheten är 0 när modellen inte läste något namn — då bär bilden och
    // numret hela bedömningen, vilket är precis avsikten.
    let score = query ? scoreSimilarity(query, card.name) : 0;
    // Bildlikhet: en gradering, inte ett bevis. Se ART_WEIGHT.
    const art = artScores?.get(card.id);
    if (art !== undefined && art > 0) score += art * ART_WEIGHT;
    // Numret är identiteten när namnet delas — och det gör det i 92 % av fallen.
    // Nyckeln jämförs som STRÄNG mot samma normalisering som databasen använder,
    // så "TG10", "SWSH034" och "130a" räknas, inte bara rena tal.
    if (guessedNum && card.numberSortKey === guessedNum.sortKey) {
      if (guessedNum.total == null) {
        score += 0.4; // nummer matchar, total oläst
      } else if (card.set.totalCards === 0 || card.set.totalCards === guessedNum.total) {
        score += 0.5; // nummer + total matchar → starkast
      } else {
        // Total skiljer, men numret stämmer. Förut gav det NOLL bonus, vilket
        // straffade secret rares systematiskt: de trycks "199/165", så totalen
        // säger med flit inte samma sak som setets storlek. En nummerträff är
        // alltid bevis — bara svagare när totalen motsäger den.
        score += 0.25;
      }
    }
    // Explicit typad — `satisfies` hade smalnat slug/estimatedValue till `null`,
    // och de fylls i längre ner när topplistan är vald.
    const candidate: ScanCandidate = {
      cardId: card.id,
      name: card.name,
      setName: card.set.name,
      number: card.number,
      rarity: card.rarity,
      imageUrl: card.imageUrl,
      score: Math.round(score * 1000) / 1000,
      slug: null,
      estimatedValue: null,
    };
    return { candidate, released: card.set.releaseDate?.getTime() ?? 0 };
  });

  const top = scored
    .filter((c) => c.candidate.score > 0)
    .sort(
      (a, b) =>
        b.candidate.score - a.candidate.score ||
        // Lika poäng (namntvillingar utan läsbart nummer): nyast set först. Ett
        // svagt men ÄRLIGT antagande — man skannar oftast det man nyss öppnat —
        // och framför allt stabilt, till skillnad från DB-ordningen det var förut.
        b.released - a.released ||
        a.candidate.cardId.localeCompare(b.candidate.cardId)
    )
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.candidate);

  // Bifoga aktuellt marknadsvärde (Cardmarket-trend) + produkt-slug (djuplänk)
  // för de visade kandidaterna.
  const cardIds = top.map((c) => c.cardId);
  const [values, products] = await Promise.all([
    getCardValues(cardIds),
    prisma.product.findMany({
      where: { cardId: { in: cardIds } },
      select: { cardId: true, slug: true },
    }),
  ]);
  const slugByCard = new Map(
    products.flatMap((p) => (p.cardId ? [[p.cardId, p.slug] as const] : []))
  );
  for (const c of top) {
    c.estimatedValue = values.get(c.cardId) ?? null;
    c.slug = slugByCard.get(c.cardId) ?? null;
  }

  return top;
}

export interface ScanResult {
  job: ScannerJob;
  candidates: ScanCandidate[];
}

/**
 * Kör en komplett skanning: skapar ett ScannerJob (RUNNING), kör
 * OCR-adaptern, matchar mot katalogen och sparar resultatet (COMPLETED).
 * Vid fel markeras jobbet som FAILED och felet kastas vidare.
 */
export async function runScannerJob(
  userId: string,
  planTier: PlanTier,
  imageDataUrl: string
): Promise<ScanResult> {
  const quota = await getScannerQuota(userId, planTier);
  if (quota.remaining <= 0) {
    throw new ServiceError(
      429,
      planTier === "PREMIUM"
        ? `Du har nått dagens gräns på ${quota.limit} skanningar. Försök igen i morgon.`
        : `Du har använt dina ${quota.limit} gratis skanningar i dag. Uppgradera till Pro för fler.`
    );
  }

  const adapter = getOcrAdapter();

  const job = await prisma.scannerJob.create({
    data: {
      userId,
      // MVP: persistera inte base64-datan; produktion = S3-URL.
      imageUrl: INLINE_UPLOAD,
      status: "RUNNING",
    },
  });

  try {
    const ocr = await adapter.extractCardInfo(imageDataUrl);
    const candidates = await matchCards(ocr);

    const result: Prisma.JsonObject = {
      provider: adapter.name,
      ocr: {
        rawText: ocr.rawText,
        guessedName: ocr.guessedName ?? null,
        guessedNumber: ocr.guessedNumber ?? null,
        confidence: ocr.confidence,
      },
      imageNote: "uploaded-inline",
      candidates: candidates.map((c) => ({ ...c })),
    };

    // Varje genomförd skanning räknas (träff eller no-match) — bara äkta fel
    // (catch nedan → FAILED) är gratis.
    const updated = await prisma.scannerJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", result, confidence: ocr.confidence },
    });

    return { job: updated, candidates };
  } catch (error) {
    await prisma.scannerJob
      .update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          result: {
            error: error instanceof Error ? error.message : "Okänt fel",
          },
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

/** Hämtar användarens senaste skanningar. */
export async function listScannerJobs(userId: string, take = 10) {
  return prisma.scannerJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Uppskattar ett korts aktuella marknadsvärde (öre) via kortets produkt
 * (lägsta pris = Cardmarket-trend) — samma mått som produktsidan och samlingens
 * live-värdering. Returnerar null om data saknas.
 */
export async function estimateCardValue(cardId: string): Promise<number | null> {
  const values = await getCardValues([cardId]);
  return values.get(cardId) ?? null;
}

export interface IdentifyResult {
  /** Adaptern som användes ("mock" = simulerad, "claude" = riktig vision). */
  provider: string;
  guessedName: string | null;
  guessedNumber: string | null;
  confidence: number;
  candidates: ScanCandidate[];
  /** Bildmatchningens bästa likhet 0..1, eller null när inget avtryck skickades. */
  artTop: number | null;
}

/**
 * Base64-avtryck från klienten → Int8Array, eller null om det inte håller måtten.
 *
 * Längdkontrollen är inte formalia: ett avtryck med fel längd kommer från en annan
 * rutnätsversion, och att jämföra vektorer av olika längd "fungerar" (man får ett
 * tal) men betyder ingenting. Hellre ingen bildsignal än en påhittad.
 */
function decodeFingerprint(b64: string | undefined): Int8Array | null {
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length !== FINGERPRINT_BYTES) return null;
    return new Int8Array(buf.buffer, buf.byteOffset, buf.length);
  } catch {
    return null;
  }
}

/**
 * Live-identifiering: kör OCR-/vision-adaptern + matchar mot katalogen UTAN att
 * skapa ett ScannerJob (billigt nog att polla med nedskalade videorutor).
 * Returnerar bästa katalogträffar + aktuellt marknadsvärde. Sätt `precise` för
 * den starkare vision-modellen (bekräftelse/uppladdning).
 */
export async function identifyCard(
  imageDataUrl: string,
  opts: { precise?: boolean; detailDataUrl?: string; fingerprint?: string } = {}
): Promise<IdentifyResult> {
  const adapter = getOcrAdapter(opts.precise);
  // Bildsökningen och vision-anropet är oberoende → kör dem parallellt. Sökningen
  // är några millisekunder CPU mot ett index i minnet; vision-anropet är ett
  // nätverksanrop på hundratals ms. Serialiserade hade bilden lagt sig ovanpå
  // svarstiden i onödan.
  const fp = decodeFingerprint(opts.fingerprint);
  const [ocr, artMatches] = await Promise.all([
    adapter.extractCardInfo(imageDataUrl, opts.detailDataUrl),
    fp ? searchByFingerprint(fp, ART_CANDIDATES) : Promise.resolve([]),
  ]);

  const artScores = new Map(artMatches.map((m) => [m.cardId, m.score]));
  // Bilden ensam räcker som signal — texten kan vara helt oläslig.
  const candidates = await matchCards(ocr, artScores);

  return {
    provider: adapter.name,
    guessedName: ocr.guessedName ?? null,
    guessedNumber: ocr.guessedNumber ?? null,
    confidence: ocr.confidence,
    candidates,
    artTop: artMatches.length > 0 ? artMatches[0].score : null,
  };
}
