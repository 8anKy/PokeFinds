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
import {
  type ArtMatch,
  searchByFingerprints,
  searchByFrames,
} from "@/services/scanner/art-index";
import { getCardValues, getProductValues } from "@/services/products";
import { ClaudeVisionOcrAdapter } from "@/services/scanner/claude-vision";
import { MockOcrAdapter } from "@/services/scanner/ocr-mock";
import type { OcrAdapter, OcrResult, ScanCandidate } from "@/services/scanner/types";

/** Markör för bilder som laddats upp inline (MVP, ingen objektlagring). */
const INLINE_UPLOAD = "inline-upload";

/** Max antal kandidater som returneras.
 *  Höjt från 5 (2026-07-29): listan bär nu både TRYCKNINGAR (ett Base-kort ger
 *  tre rader) och namn-syskon (nio Falinks i katalogen). Med 5 platser trängdes
 *  just de alternativ användaren behöver ut av orelaterade kort. */
const MAX_CANDIDATES = 12;

/** Hur många namn-syskon som hämtas in utöver de poängsatta kandidaterna. */
const SIBLING_LIMIT = 12;

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
export async function recordScanUsage(
  userId: string,
  /**
   * DIAGNOSTIK, bara för admin. Gör det möjligt att mäta VERKLIG träffsäkerhet:
   * varje siffra vi har kommer från frågor härledda ur samma filer som
   * referenserna, dvs ett tak, aldrig en riktig fångst.
   *
   * Lagrar konstavtrycket (264 byte base64), INTE bilden — replaybart offline
   * utan att någon kortbild sparas. Skrivs i den `result`-kolumn som redan finns,
   * så ingen migration och inga extra rader: Neon-kostnaden är oförändrad.
   *
   * BARA ADMIN med flit (dataminimering, GDPR): vanliga användares rader ser
   * exakt ut som förut. Urvalet blir ägarens egna skanningar, vilket är precis
   * det underlag mätningen behöver.
   */
  diagnostics?: Prisma.JsonObject
): Promise<void> {
  await prisma.scannerJob.create({
    data: {
      userId,
      imageUrl: INLINE_UPLOAD,
      status: "COMPLETED",
      ...(diagnostics ? { result: diagnostics } : {}),
    },
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
          ? process.env.SCANNER_MODEL_PRECISE ?? "claude-sonnet-5"
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
 * Minsta avstånd till nästa KORT för att träffen ska få kallas en träff.
 *
 * Jämförelsen hoppar över andra TRYCKNINGAR av samma kort: de ligger med flit
 * 0,001 från varandra (Base Unlimited/Shadowless/1st Edition) och är ett val av
 * tryckning, inte en osäkerhet om vilket kort det är.
 *
 * 0,05 flaggar bara nära-exakta oavgjorda lägen. Ett äkta övertag är mycket
 * större: en nummerträff ger +0,4–0,5 och en säker bildträff +1,15.
 */
const MATCH_MARGIN_MIN = 0.05;

/** Tak på antal videorutor per skanning. Varje ruta är ett inset-svep (4 sökningar
 *  à ~8 ms), så taket är det som binder serverns CPU: 4 rutor ≈ 130 ms. */
const MAX_FRAMES = 4;

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

/**
 * Bildlikhet över detta räknas som en RIKTIG signal, inte som en gissning.
 *
 * Behövs för att modellens NAMN kan vara hallucinerat och ändå få full poäng.
 * Mätt på samma kort fyra gånger (samma monitor, samma ram) svarade Haiku
 * "Pelipper", "Pawmot", "Falinks" och "Palafin ex" — det sista med konfidens
 * 0,85. Ett påhittat namn ger namnlikhet 1,0 mot SINA kort, medan rätt kort får
 * ~0 på namn och bara `art × ART_WEIGHT`. Utan ett eget skikt för bildträffarna
 * fyllde det hallucinerade namnets syskon hela listan och rätt kort föll ur helt.
 */
const ART_STRONG = 0.75;

/**
 * NÄR FÅR BILDEN ÖVERRÖSTA MODELLENS NAMN?
 *
 * MÄTT över 250 kort (hård försämring + 3 % marginal, hela katalogen som
 * referens), fördelningen för träff 1:
 *
 *              RÄTT (210 st)                    FEL (40 st)
 *   poäng      median 0,873 · min 0,570         median 0,758 · MAX 0,922
 *   marginal   median 0,111 · p90 0,297         median 0,012 · MAX 0,066
 *
 * ⛔ POÄNGEN SKILJER INTE RÄTT FRÅN FEL — en felträff kan ha 0,92 och en rätt
 * träff 0,57; fördelningarna överlappar. MARGINALEN till tvåan gör det: ingen
 * felträff kom över 0,066, medan rätt träff ligger på 0,111 i median. Regeln
 * "poäng ≥ 0,70 OCH marginal ≥ 0,10" gav 100 % precision (0 av 40 felträffar
 * slapp igenom) och täckte 117 av 210 rätta. Tröskeln är satt med ~1,5× marginal
 * till sämsta observerade felträff, inte på det enskilda produktionsfall som
 * väckte frågan (Falinks TG07: 0,857 med marginal 0,379).
 *
 * Bonusen ligger ÖVER en ren namnträff (max 1,0) men UNDER namn+nummer
 * (1,4–1,5). Följden är precis den avsedda: ett hallucinerat namn utan
 * nummerstöd förlorar mot en säker bildträff, medan namn OCH nummer som pekar på
 * samma kort fortfarande vinner — där är texten bevisad, inte gissad.
 */
const ART_TRUST_SCORE = 0.7;
const ART_TRUST_MARGIN = 0.1;
const ART_TRUST_BONUS = 1.15;

/**
 * KORSVALIDERING: håller modellens namn med om vad bilden ser?
 *
 * Marginalregeln ovan räddar bara de fall där bildträffen är BEVISAT säker — mätt
 * 56 % av de rätta träffarna. Resterande 44 % har en äkta men smalare marginal och
 * kan fortfarande förlora mot ett hallucinerat namn, eftersom ett påhittat namn
 * får full namnlikhet (1,0) mot sina kort.
 *
 * Två OBEROENDE signaler som pekar isär betyder att en av dem är fel. Bilden är
 * mätt (topp-15 93 %); namnet var 2 av 5 på skärmfotograferingar. Håller namnet
 * inte med om NÅGOT av bildens 15 bästa kort är namnet den troliga lögnaren, och
 * dess vikt skruvas ner.
 *
 * KONSERVATIVT I BÅDA LEDEN: invändningen gäller bara när bildträffen klarar
 * förtroendekravet (`ART_TRUST_*` — BÅDE poäng och marginal), inte när den bara
 * har hög poäng. Och namnet NOLLAS inte, det dämpas: kort som matchar namnet
 * ligger kvar över orelaterade, så om det är BILDEN som har fel (~7 % av fallen
 * ligger rätt kort utanför topp-15) finns namnträffarna kvar i listan.
 *
 * "Palafin ex" mot "Falinks" ger Dice-likhet 0,27 — långt under tröskeln.
 *
 * ⛔ DÄMPNINGEN MÅSTE GÄLLA NUMRET OCKSÅ. Namn och nummer kommer ur SAMMA
 * modellsvar — är det ena påhittat är det andra lika misstänkt. Mätt när bara
 * namnet dämpades: det hallucinerade numret "041/193" matchade Paldean Tauros 41
 * i Paldea Evolved EXAKT (setet har 193 kort), fick full nummerbonus (0,5) och
 * vann med 0,568 mot rätt korts 0,313. Ett påhittat tal träffar en riktig rad
 * förr eller senare — katalogen har 20 563 kort.
 */
const NAME_AGREE_MIN = 0.5;
const NAME_DISTRUST = 0.25;

/**
 * RAMGENERATION → årsintervall. Modellen klassar kortets ram-DESIGN (gul ram,
 * EX-layout, SWSH-layout …) — en grov visuell signal som överlever suddiga
 * skärmfoton där samlarnumret (~3 px) inte gör det.
 *
 * VARFÖR (mätt fall 2026-07-30): en Gyarados ur Deoxys (2005) skannades fyra
 * gånger. Namnet lästes rätt, numret var oläsligt, bildens toppträffar var brus
 * — och då stod alla 28 kort som heter exakt "Gyarados" på samma poäng.
 * Tie-breaken "nyast set först" valde 151/Paldea Evolved varje gång, och
 * 2005-kortet låg på plats 22 av 28 i åldersordning: det fick inte ens plats i
 * kandidatlistans 12 platser. Rätt kort var alltså OMÖJLIGT att välja.
 *
 * Intervallen matchas med ±1 års marginal — set blöder över årsskiften.
 */
const ERA_YEARS: Record<string, [number, number]> = {
  wotc: [1999, 2003],
  ex: [2003, 2007],
  dp: [2007, 2011],
  bwxy: [2011, 2016],
  sm: [2017, 2019],
  swsh: [2020, 2022],
  sv: [2023, 2099],
};

/**
 * Era-bonusen är MEDVETET UNDER `MATCH_MARGIN_MIN` (0,05): den får ordna
 * annars-oavgjorda namnsyskon (vinnaren OCH kandidatlistan sorteras på poäng),
 * men ALDRIG få en gissning att se säker ut — träffen förblir märkt "?" — och
 * aldrig utmana ett läst nummer (0,25–0,5) eller en säker bildträff (1,15).
 * Eran kommer ur samma modellsvar som namnet och dämpas därför med samma
 * misstro (nameWeight) när bilden motsäger texten.
 */
const ERA_WEIGHT = 0.04;

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
  artScores?: Map<string, number>,
  /**
   * Kortet vars bildträff är SÄKER (poäng + marginal över tröskeln, se
   * ART_TRUST_*). Det får en bonus som slår en ren namnträff, så ett hallucinerat
   * kortnamn inte kan överrösta en bevisat säker bildidentifiering.
   */
  artConfidentCardId?: string | null
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

  // KORSVALIDERING av namnet mot bilden. Se NAME_AGREE_MIN.
  //
  // ⛔ VILLKORET ÄR `artConfidentCardId`, INTE bildens poäng. Första versionen
  // dämpade namnet så snart bildens topp-poäng nådde ART_STRONG — men poängen är
  // mätt att INTE indikera tillförlitlighet (felträffar når 0,92). Följden i
  // produktion: modellen läste "Rayquaza" HELT RÄTT, bilden hade fel med poäng
  // 0,792 och marginal 0,011, namnet dämpades ändå — och Dratini 52 vann med
  // 0,271. Ett korrekt namn kastades bort på en bildträff som enligt vår egen
  // mätning inte gick att lita på. Bara en bildträff som klarar BÅDE poäng och
  // marginal får ifrågasätta namnet.
  let nameWeight = 1;
  if (query && artConfidentCardId && artScores?.size) {
    let bestNameAgreement = 0;
    for (const id of artScores.keys()) {
      const card = byId.get(id);
      if (card) {
        const agree = scoreSimilarity(query, card.name);
        if (agree > bestNameAgreement) bestNameAgreement = agree;
      }
    }
    if (bestNameAgreement < NAME_AGREE_MIN) nameWeight = NAME_DISTRUST;
  }

  const eraRange = ocr.guessedEra ? ERA_YEARS[ocr.guessedEra] : undefined;

  const scored = [...byId.values()].map((card) => {
    // Namnlikheten är 0 när modellen inte läste något namn — då bär bilden och
    // numret hela bedömningen, vilket är precis avsikten.
    let score = query ? scoreSimilarity(query, card.name) * nameWeight : 0;
    // Ramgenerationen: liten tie-breaker mellan namnsyskon. Se ERA_WEIGHT.
    if (eraRange && card.set.releaseDate) {
      const year = card.set.releaseDate.getUTCFullYear();
      if (year >= eraRange[0] - 1 && year <= eraRange[1] + 1) {
        score += ERA_WEIGHT * nameWeight;
      }
    }
    // Bildlikhet: en gradering, inte ett bevis. Se ART_WEIGHT.
    const art = artScores?.get(card.id);
    if (art !== undefined && art > 0) score += art * ART_WEIGHT;
    // …men en SÄKER bildträff (hög poäng OCH stor marginal till tvåan) ÄR ett
    // bevis: 100 % precision över 250 mätta fall. Då ska den slå ett kortnamn
    // modellen kan ha hittat på.
    if (artConfidentCardId && card.id === artConfidentCardId) score += ART_TRUST_BONUS;
    // Numret är identiteten när namnet delas — och det gör det i 92 % av fallen.
    // Nyckeln jämförs som STRÄNG mot samma normalisering som databasen använder,
    // så "TG10", "SWSH034" och "130a" räknas, inte bara rena tal.
    // Nummerbonusen dämpas med SAMMA vikt som namnet: samma modellsvar, samma
    // misstro. Se NAME_DISTRUST.
    if (guessedNum && card.numberSortKey === guessedNum.sortKey) {
      if (guessedNum.total == null) {
        score += 0.4 * nameWeight; // nummer matchar, total oläst
      } else if (card.set.totalCards === 0 || card.set.totalCards === guessedNum.total) {
        score += 0.5 * nameWeight; // nummer + total matchar → starkast
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
      productId: null,
      variantLabel: null,
      slug: null,
      estimatedValue: null,
    };
    return { candidate, released: card.set.releaseDate?.getTime() ?? 0 };
  });

  const ranked = scored
    .filter((c) => c.candidate.score > 0)
    .sort(
      (a, b) =>
        b.candidate.score - a.candidate.score ||
        // Lika poäng (namntvillingar utan läsbart nummer): nyast set först. Ett
        // svagt men ÄRLIGT antagande — man skannar oftast det man nyss öppnat —
        // och framför allt stabilt, till skillnad från DB-ordningen det var förut.
        b.released - a.released ||
        a.candidate.cardId.localeCompare(b.candidate.cardId)
    );
  if (ranked.length === 0) return [];

  // VINNAREN avgörs av poängen ENSAM, före all syskonsortering nedan. Annars
  // skulle "lyft syskon" kunna byta ut själva träffen, och då rankar man om
  // svaret i stället för alternativen.
  const winner = ranked[0].candidate;
  const winnerName = winner.name.toLowerCase();

  // SYSKON FÖRST I "VÄLJ ETT ANNAT" (2026-07-29). Bildmatchningen kan per
  // definition inte skilja tryckningar med identisk konst, och 92 % av korten
  // delar namn med ett annat kort — så när träffen är fel är det RÄTT KORT som
  // nästan alltid är ett syskon: en annan tryckning av samma kort, eller samma
  // Pokémon i ett annat set. Mätt fall: en Falinks ur Astral Radiance Trainer
  // Gallery (TG07) matchades som Falinks #88 ur Stellar Crown, medan katalogens
  // åtta andra Falinks trängdes ut av en Pawmot. Listan sorteras därför i skikt,
  // inte på poäng: rätt kort ska ligga ett tryck bort, inte sjunka under brus
  // som råkar poängsätta högre.
  const sameNameCards = await prisma.card.findMany({
    where: {
      name: { equals: winner.name, mode: "insensitive" },
      id: { notIn: ranked.slice(0, MAX_CANDIDATES).map((r) => r.candidate.cardId) },
    },
    select: {
      id: true,
      name: true,
      number: true,
      rarity: true,
      imageUrl: true,
      set: { select: { name: true, releaseDate: true } },
    },
    orderBy: { id: "asc" },
    take: SIBLING_LIMIT,
  });

  const merged = [
    ...ranked.slice(0, MAX_CANDIDATES),
    ...sameNameCards.map((card) => ({
      candidate: {
        cardId: card.id,
        name: card.name,
        setName: card.set.name,
        number: card.number,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        // Poäng 0 = "kom hit som syskon, inte för att den matchade". Skikt-
        // sorteringen nedan bär ordningen, så en påhittad poäng skulle bara
        // se ut som bevis den inte har.
        score: 0,
        productId: null,
        variantLabel: null,
        slug: null,
        estimatedValue: null,
      } satisfies ScanCandidate as ScanCandidate,
      released: card.set.releaseDate?.getTime() ?? 0,
    })),
  ];

  // TRYCKNINGARNA som egna kandidater. Ett Base-kort är ETT Card med TRE
  // produkter, så utan detta kan skannern inte ens erbjuda valet — den tar
  // billigaste produkten och en 1st Edition hamnar tyst i samlingen som
  // Unlimited.
  const withPrintings = await expandPrintings(merged.map((m) => m.candidate));

  // Skikt: vinnaren, sedan andra TRYCKNINGAR av samma kort, sedan samma NAMN i
  // andra set, sist övrigt. Inom varje skikt gäller poäng och sedan setets ålder.
  // ⛔ BILDTRÄFFARNA MÅSTE LIGGA ÖVER NAMN-SYSKONEN. Namnet kan vara påhittat
  // (se ART_STRONG), och då är dess syskon en lista över fel kort medan
  // bildträffarna pekar på rätt. Låg bildträffarna i "övrigt" fyllde det
  // hallucinerade namnets syskon hela listan och rätt kort syntes inte alls.
  const tierOf = (c: ScanCandidate): number => {
    if (c.cardId === winner.cardId && c.productId === winner.productId) return 0;
    if (c.cardId === winner.cardId) return 1;
    if ((artScores?.get(c.cardId) ?? 0) >= ART_STRONG) return 2;
    if (c.name.toLowerCase() === winnerName) return 3;
    return 4;
  };
  const releasedOf = new Map(merged.map((m) => [m.candidate.cardId, m.released]));

  const top = withPrintings
    .sort(
      (a, b) =>
        tierOf(a) - tierOf(b) ||
        b.score - a.score ||
        (releasedOf.get(b.cardId) ?? 0) - (releasedOf.get(a.cardId) ?? 0) ||
        (a.variantLabel ?? "").localeCompare(b.variantLabel ?? "") ||
        a.cardId.localeCompare(b.cardId)
    )
    .slice(0, MAX_CANDIDATES);

  // Värde + djuplänk. Kandidater som pekar på en SPECIFIK tryckning värderas på
  // sin egen produkt — annars hade alla tre Base-tryckningarna visat samma pris
  // (den billigaste), vilket är hela felet valet finns för att rätta.
  const productIds = top.flatMap((c) => (c.productId ? [c.productId] : []));
  const cardOnlyIds = top.filter((c) => !c.productId).map((c) => c.cardId);
  const [productValues, cardValues, fallbackProducts] = await Promise.all([
    getProductValues(productIds),
    getCardValues(cardOnlyIds),
    cardOnlyIds.length
      ? prisma.product.findMany({
          where: { cardId: { in: cardOnlyIds } },
          select: { cardId: true, slug: true },
        })
      : Promise.resolve([]),
  ]);
  const slugByCard = new Map(
    fallbackProducts.flatMap((p) => (p.cardId ? [[p.cardId, p.slug] as const] : []))
  );
  for (const c of top) {
    if (c.productId) {
      c.estimatedValue = productValues.get(c.productId) ?? null;
    } else {
      c.estimatedValue = cardValues.get(c.cardId) ?? null;
      c.slug = slugByCard.get(c.cardId) ?? null;
    }
  }

  return top;
}

/**
 * Delar upp kandidater som har flera TRYCKNINGAR i en kandidat per tryckning.
 *
 * Kort utan variantmärkta produkter lämnas orörda (en kandidat, som förut). För
 * de 157 kort som HAR dem blir det en rad per tryckning, med produktens egen
 * slug och etikett — det är den enda vägen för användaren att säga "min är
 * 1st Edition", eftersom ingen bild och ingen text på kortet skiljer dem åt i
 * katalogen.
 */
async function expandPrintings(candidates: ScanCandidate[]): Promise<ScanCandidate[]> {
  const cardIds = candidates.map((c) => c.cardId);
  if (cardIds.length === 0) return candidates;
  const variants = await prisma.product.findMany({
    where: { cardId: { in: cardIds }, variantLabel: { not: null } },
    select: { id: true, cardId: true, slug: true, variantLabel: true },
    orderBy: { id: "asc" },
  });
  if (variants.length === 0) return candidates;

  const byCard = new Map<string, typeof variants>();
  for (const v of variants) {
    if (!v.cardId) continue;
    const list = byCard.get(v.cardId);
    if (list) list.push(v);
    else byCard.set(v.cardId, [v]);
  }

  return candidates.flatMap((c) => {
    const printings = byCard.get(c.cardId);
    if (!printings || printings.length === 0) return [c];
    return printings.map((p) => ({
      ...c,
      productId: p.id,
      variantLabel: p.variantLabel,
      slug: p.slug,
      // Unlimited är standardvalet: den vanligaste tryckningen och den
      // billigaste, alltså det minst överraskande svaret när ingenting i bilden
      // säger vilken det är. Samma konvention som Tradera-matchningen
      // ("en annons som inte SÄGER 1st edition/shadowless är Unlimited").
      score: /unlimited/i.test(p.variantLabel ?? "") ? c.score : Math.max(0, c.score - 0.001),
    }));
  });
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
  /** Modellens ramgenerations-klassning ("wotc" … "sv"), null när osäker. */
  guessedEra: string | null;
  confidence: number;
  candidates: ScanCandidate[];
  /** Bildmatchningens bästa likhet 0..1, eller null när inget avtryck skickades. */
  artTop: number | null;
  /**
   * Träffen går INTE att motivera — flera olika kort ligger praktiskt taget lika.
   *
   * MÄTT fall: användaren skannade en Gyarados. Modellen läste namnet HELT RÄTT,
   * men numret blev skräp och bilden var oanvändbar (klassiskt ramat kort), så
   * ALLA nio Gyarados i katalogen fick exakt 1,000 och koden valde en av dem på
   * ett tiebreak (nyast set). Tre skanningar, tre självsäkra FEL svar — när det
   * ärliga svaret var "det är en Gyarados, men jag vet inte vilken".
   *
   * Samma marginalprincip som gäller bildträffar gäller alltså slutrankningen:
   * utan avstånd till nästa KORT finns ingen träff att påstå. Klienten visar då
   * kandidatlistan i stället för ett svar.
   */
  ambiguous: boolean;
  /**
   * Bildmatchningens tre bästa kort som text, för admin-diagnostiken.
   *
   * Utan detta går det INTE att skilja "bilden hittade rätt kort men namnet
   * överröstade det" från "bilden hittade också fel" — och de två har helt olika
   * åtgärder (vikta om mot namnet, respektive felsöka avtrycket). Att gissa
   * mellan dem är precis den blinda justering som kostade oss flera varv.
   */
  artTopLabel: string | null;
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

/** Avkodar inset-svepet och slänger tysta felaktigheter. Tom lista = ingen bildsignal. */
function decodeFingerprints(list: string[] | undefined): Int8Array[] {
  if (!list?.length) return [];
  // Taket speglar API-schemat: en klient ska inte kunna beställa hundra sökningar.
  return list.slice(0, 8).flatMap((b64) => {
    const fp = decodeFingerprint(b64);
    return fp ? [fp] : [];
  });
}

/** Rutor × inset-svep. Taken binder serverns CPU per skanning. */
function decodeFrames(frames: string[][] | undefined): Int8Array[][] {
  if (!frames?.length) return [];
  return frames
    .slice(0, MAX_FRAMES)
    .map((f) => decodeFingerprints(f))
    .filter((f) => f.length > 0);
}

/**
 * Live-identifiering: kör OCR-/vision-adaptern + matchar mot katalogen UTAN att
 * skapa ett ScannerJob (billigt nog att polla med nedskalade videorutor).
 * Returnerar bästa katalogträffar + aktuellt marknadsvärde. Sätt `precise` för
 * den starkare vision-modellen (bekräftelse/uppladdning).
 */
export async function identifyCard(
  imageDataUrl: string,
  opts: {
    precise?: boolean;
    detailDataUrl?: string;
    /** Inset-svepet från klienten (base64). Se FINGERPRINT_INSETS. */
    fingerprints?: string[];
    /** Flera videorutor, var och en ett inset-svep. Föredras framför `fingerprints`. */
    fingerprintFrames?: string[][];
  } = {}
): Promise<IdentifyResult> {
  const adapter = getOcrAdapter(opts.precise);
  // Bildsökningen och vision-anropet är oberoende → kör dem parallellt. Sökningen
  // är några millisekunder CPU mot ett index i minnet; vision-anropet är ett
  // nätverksanrop på hundratals ms. Serialiserade hade bilden lagt sig ovanpå
  // svarstiden i onödan.
  // Flera rutor när klienten skickar dem; annars den enkla listan (bakåtkompatibelt
  // med en cachad klient som ännu inte skickar rutor).
  const frames = decodeFrames(opts.fingerprintFrames);
  const single = frames.length === 0 ? decodeFingerprints(opts.fingerprints) : [];
  const [ocr, artMatches] = await Promise.all([
    adapter.extractCardInfo(imageDataUrl, opts.detailDataUrl),
    frames.length
      ? searchByFrames(frames, ART_CANDIDATES)
      : single.length
        ? searchByFingerprints(single, ART_CANDIDATES)
        : Promise.resolve([]),
  ]);

  const artScores = new Map(artMatches.map((m) => [m.cardId, m.score]));
  // MARGINALEN till tvåan är det som avgör om bildträffen går att lita på —
  // poängen ensam skiljer inte rätt från fel (se ART_TRUST_*). Finns ingen tvåa
  // är marginalen odefinierad och träffen får inte räknas som säker.
  const artConfidentCardId =
    artMatches.length >= 2 &&
    artMatches[0].score >= ART_TRUST_SCORE &&
    artMatches[0].score - artMatches[1].score >= ART_TRUST_MARGIN
      ? artMatches[0].cardId
      : null;

  // Bilden ensam räcker som signal — texten kan vara helt oläslig.
  const [candidates, artTopLabel] = await Promise.all([
    matchCards(ocr, artScores, artConfidentCardId),
    describeArtMatches(artMatches.slice(0, 3)),
  ]);

  return {
    provider: adapter.name,
    guessedName: ocr.guessedName ?? null,
    guessedNumber: ocr.guessedNumber ?? null,
    guessedEra: ocr.guessedEra ?? null,
    confidence: ocr.confidence,
    candidates,
    ambiguous: isAmbiguous(candidates),
    artTop: artMatches.length > 0 ? artMatches[0].score : null,
    artTopLabel,
  };
}

/**
 * Ligger flera OLIKA kort praktiskt taget lika? Se MATCH_MARGIN_MIN.
 *
 * Andra tryckningar av samma kort räknas INTE som konkurrenter — de ligger med
 * flit tätt ihop och representerar ett val av tryckning, inte tvivel om kortet.
 */
export function isAmbiguous(candidates: ScanCandidate[]): boolean {
  const top = candidates[0];
  if (!top) return false;
  const rival = candidates.find((c) => c.cardId !== top.cardId);
  if (!rival) return false; // bara tryckningar av ett och samma kort
  return top.score - rival.score < MATCH_MARGIN_MIN;
}

/** Bildträffarna som kort text. Uppslag på primärnyckel — tre rader. */
async function describeArtMatches(matches: ArtMatch[]): Promise<string | null> {
  if (matches.length === 0) return null;
  const cards = await prisma.card.findMany({
    where: { id: { in: matches.map((m) => m.cardId) } },
    select: { id: true, name: true, number: true },
  });
  const byId = new Map(cards.map((c) => [c.id, c]));
  return matches
    .map((m) => {
      const c = byId.get(m.cardId);
      return `${c ? `${c.name} ${c.number}` : m.cardId} ${m.score.toFixed(3)}`;
    })
    .join(" | ");
}
