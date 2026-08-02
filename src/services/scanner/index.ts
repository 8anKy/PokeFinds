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
import { FINGERPRINT_BYTES, STRUCT_BYTES } from "@/lib/art-fingerprint";
import { cardNumberSortKey } from "@/lib/card-number-order";
import { scoreSimilarity } from "@/scrapers/matching";
import {
  type ArtMatch,
  type ArtQuery,
  artPairSimilarity,
  searchByFingerprints,
  searchByFramesDetailed,
} from "@/services/scanner/art-index";
import { getCardValues, getProductValues } from "@/services/products";
import { ClaudeVisionOcrAdapter } from "@/services/scanner/claude-vision";
import { GeminiVisionOcrAdapter } from "@/services/scanner/gemini-vision";
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
      ? process.env.SCANNER_PREMIUM_MONTHLY_LIMIT ?? String(PREMIUM_FAIR_USE)
      : process.env.SCANNER_FREE_MONTHLY_LIMIT ?? "30";
  const n = Number(env);
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : planTier === "PREMIUM"
      ? PREMIUM_FAIR_USE
      : 30;
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

/**
 * PRO = "obegränsat" i marknadsföringen, med ett SKÄLIGT TAK i koden.
 *
 * Taket räknar IDENTIFIERADE KORT (se getScannerQuota), och 1000 i månaden är
 * ~33 om dagen — långt bortom vad en samlare gör, men lågt nog att en skenande
 * loop eller ett kapat konto fångas. Kostnadstaket är känt: ungefär hälften av
 * korten avgörs av bilden utan API-anrop, så 1000 träffar är i värsta fall
 * ~1000 vision-anrop à $0,00102 = ~$1,02 mot Pro-intäkten 49 kr (~$4,60).
 *
 * ⛔ Taket är inte en produktgräns utan ett SKYDD. Träffas det ska det synas i
 * loggen, inte tolkas som att en kund skannar för mycket.
 */
const PREMIUM_FAIR_USE = 1000;

/** Månadens skanningskvot (misslyckade/no-match-jobb räknas inte). */
export async function getScannerQuota(
  userId: string,
  planTier: PlanTier,
  /** ADMIN/SUPERADMIN = i praktiken obegränsat: kvoten finns för att binda
   *  vision-kostnaden mot intäkten, och ägaren som testar sin egen produkt
   *  är inte den kostnaden. Vanliga användare påverkas inte. */
  role?: string
): Promise<ScannerQuota> {
  const limit =
    role === "ADMIN" || role === "SUPERADMIN" ? 100000 : scannerLimitForTier(planTier);
  // ⛔ KVOTEN RÄKNAR IDENTIFIERADE KORT — inte rader och inte vision-anrop.
  //
  // Det är VÄRDET kunden får, inte vår kostnad, som ska mätas: en skanning som
  // inte hittade något kort har inte gett något och ska vara gratis, medan en
  // träff räknas även när BILDEN avgjorde den utan att kosta oss ett API-anrop.
  // En kostnadsbaserad kvot var dessutom
  // svårförklarad för kunden: två identiska skanningar kunde kosta olika mycket
  // kvot beroende på om bildmatchningen råkade vara säker. (Samma modell som
  // jämförbara appar i kategorin använder.)
  //
  // ⛔ `matched` skrivs för ALLA användare (se recordScanUsage). Äldre rader
  // saknar fältet och räknas som träffar — de skapades bara vid genomförda
  // skanningar, så det är rätt tolkning bakåt.
  const since = startOfMonthUtc();
  const [rows, missed] = await Promise.all([
    prisma.scannerJob.count({
      where: { userId, createdAt: { gte: since }, status: { not: "FAILED" } },
    }),
    prisma.scannerJob.count({
      where: {
        userId,
        createdAt: { gte: since },
        status: { not: "FAILED" },
        result: { path: ["matched"], equals: false },
      },
    }),
  ]);
  const used = Math.max(0, rows - missed);
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
  diagnostics?: Prisma.JsonObject,
  /**
   * Identifierade skanningen ett kort? ⛔ Måste sparas för ALLA användare, inte
   * bara admin: kvoten räknar TRÄFFAR, och diagnostiken (som bär `chosen`)
   * skrivs bara för admin. Utan ett eget fält vore kvoten omätbar för en vanlig
   * kund. Fältet är ett booleskt värde — ingen kortdata, ingen bild.
   */
  matched = true
): Promise<string> {
  const job = await prisma.scannerJob.create({
    data: {
      userId,
      imageUrl: INLINE_UPLOAD,
      status: "COMPLETED",
      // `matched` slås ihop med diagnostiken så en admin-rad bär båda.
      result: { ...(diagnostics ?? {}), matched },
    },
    select: { id: true },
  });
  // Id:t går tillbaka till klienten (admin) så att ett manuellt KORRIGERAT val
  // i kandidatlistan kan rapporteras in som facit — se /api/scanner/feedback.
  return job.id;
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
    // GEMINI — andra leverantören, för kostnadsjämförelse i FÄLT. Prompt,
    // fältspec och svarstolkning delas med Claude-adaptern (vision-contract.ts),
    // så en A/B-körning mäter modellen och inget annat.
    // ⛔ Facitsetet kan INTE avgöra det här: vi sparar aldrig skanningsbilderna
    // (dataminimering), bara avtryck + modellens text. Ett modellbyte måste
    // alltså mätas med NYA fältskanningar — kör scanner-telemetry/-scoreboard
    // före och efter, och byt bara EN sak i taget.
    // ⛔ 2.5-SERIEN GÅR INTE ATT ANVÄNDA MED EN NY API-NYCKEL (mätt 2026-08-02):
    // Google spärrar 2.5 för nyskapade nycklar och hänvisar till 3.x. Vår
    // första default (gemini-2.5-flash-lite) föll därför på "not available for
    // new users" i fält — tre celler i rad. Kostnadstabellen i docs/SCANNER.md
    // är uppdaterad: 3.1 Flash-Lite är 2,6x billigare än Haiku, inte 6,7x.
    case "gemini":
      return new GeminiVisionOcrAdapter(
        precise
          ? process.env.SCANNER_MODEL_PRECISE ?? "gemini-3.5-flash"
          : process.env.SCANNER_MODEL ?? "gemini-3.1-flash-lite"
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

/**
 * Namnen som den LÄSTA totalen pekar ut i kandidatpoolen.
 *
 * NUMRET OCH TOTALEN KOMMER UR SAMMA LÄSNING ("026/217"). Bekräftar katalogen
 * totalen för en tryckning med SAMMA namn, medan numret pekar på ett set som
 * totalen utesluter, då är numret den felläsa halvan — inte bevis. Se
 * `numberMatchBonus`.
 *
 * ⛔ Kravet på SAMMA NAMN är avsiktligt smalt: kandidatpoolen är upp till
 * CANDIDATE_LIMIT rader PER källa, så vilket tal som helst kolliderar förr
 * eller senare med NÅGOT sets storlek. Bara en annan tryckning av samma kort är
 * ett trovärdigt alternativ till den kandidat numret pekade ut.
 */
export function namesConfirmingTotal(
  cards: Iterable<{ name: string; set: { totalCards: number } }>,
  guessedTotal: number | null
): Set<string> {
  const names = new Set<string>();
  if (guessedTotal == null) return names;
  for (const c of cards) {
    if (c.set.totalCards > 0 && c.set.totalCards === guessedTotal) {
      names.add(c.name.trim().toLowerCase());
    }
  }
  return names;
}

/**
 * OVÄGD nummerbonus för en kandidat vars nummernyckel matchar modellens läsning.
 * Anroparen dämpar med `nameWeight` (samma modellsvar, samma misstro).
 *
 * MÄTT i fält 2026-08-02: Scorbunny 36 (Ascended Heroes, 217 kort) lästes som
 * "026/217". Det finns en Scorbunny 26 i tre ANDRA set (Stellar Crown 142, Mega
 * Evolution 132, Chilling Reign 198) — alla uteslutna av den lästa totalen — men
 * nummerträffen gav ändå 0,25 och vann över rätt kort. Ägaren fick rätta det,
 * och eftersom en nummerträff är stark blev marginalen STOR: träffen såg SÄKER
 * ut och märktes aldrig "?". Ett fabricerat bevis är värre än inget bevis, för
 * osäkerhetsmåttet är en marginal och kan per konstruktion inte se igenom det.
 *
 * ⛔ Secret rares rörs inte: de trycks "199/165" och deras set bär den TRYCKTA
 * totalen (Ascended Heroes = 217 med kort 225 i sig), så de landar i grenen
 * "nummer + total matchar" och når aldrig kontradiktionsgrenen.
 */
export function numberMatchBonus(
  card: { name: string; set: { totalCards: number } },
  guessedTotal: number | null,
  namesWithConfirmedTotal: ReadonlySet<string>
): number {
  if (guessedTotal == null) return 0.4; // nummer matchar, total oläst
  if (card.set.totalCards === 0 || card.set.totalCards === guessedTotal) {
    return 0.5; // nummer + total matchar → starkast
  }
  // Totalen pekar ut ett ANNAT set för samma kort → numret är den felläsa halvan.
  if (namesWithConfirmedTotal.has(card.name.trim().toLowerCase())) return 0;
  // Total skiljer, men numret stämmer och totalen pekar inte ut något alternativ.
  // Förut gav det NOLL bonus, vilket straffade secret rares systematiskt: de
  // trycks "199/165", så totalen säger med flit inte samma sak som setets
  // storlek. En nummerträff är alltid bevis — bara svagare när totalen motsäger
  // den utan att peka någon annanstans.
  return 0.25;
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
/**
 * SKALJUSTERING 2026-07-30 (strukturavtrycket): den blandade poängen
 * (0,25·färg + 0,25·dctb + 0,5·grad) ligger lägre än ren färgcosinus — rätta
 * träffar mätte toppar 0,56–0,95 på den kalibrerade benchmarken. Score-tröskeln
 * sänks därför till 0,55. MARGINALEN förblir 0,10 och är fortsatt det bärande
 * villkoret: fel-marginal max var 0,028 över 410 blandade frågor (≈3,6×
 * säkerhet) och 0,066 i den gamla färgmätningen (1,5×) — regeln är säker i
 * BÅDA lägena (äldre klienter utan strukturavtryck får ren färgpoäng).
 */
// Exporterade så mätskripten (scanner-scoreboard.ts, scanner-replay.ts) dömer
// med PRODUKTIONENS värden — en lokal kopia i ett skript driver isär tyst.
export const ART_TRUST_SCORE = 0.55;
export const ART_TRUST_MARGIN = 0.1;
const ART_TRUST_BONUS = 1.15;

/**
 * UTVIDGAD TRUST MED RUTA-SAMSTÄMMIGHET (2026-07-31, mätt mot facit): en
 * fångst bär flera videorutor, och varje rutas topp-1 är en OBEROENDE
 * observation (egen moiré, egen skakning). Pekar ALLA rutor på samma kort som
 * bästa rutans topp-1 sänks marginalkravet 0,10 → 0,05 — samma slags temporala
 * bevis som live-låsets "tre pollar i rad", fast räknat server-sida ur det
 * som redan skickas.
 *
 * MÄTT (scanner-skip-audit.ts, 42 facitmärkta skanningar): basregeln hoppar
 * 24/42 med 100 % precision; + samstämmighet vid marginal ≥ 0,05 → 28/42,
 * fortfarande 100 %. 0,05 valdes över 0,04 (29 hopp) med flit: det är
 * MATCH_MARGIN_MIN (osäkerhetströskeln) och ger 2,8× marginal till den värsta
 * uppmätta fel-marginalen i fält (0,018 — omtryckssyskonen). Syskonfallen
 * ligger därmed KVAR under tröskeln och går till modellen/"?" som de ska:
 * samstämmighet ensam räcker aldrig (rutorna kan vara ense om fel syskon —
 * marginalen förblir det bärande villkoret).
 */
export const ART_AGREE_MARGIN = 0.05;

/**
 * Trust-domen — EN implementation för produktion OCH mätskript (en lokal
 * kopia i ett skript driver isär tyst, samma läxa som ART_TRUST_*).
 */
export function artConfidentFrom(
  best: ArtMatch[],
  frameTops: ArtMatch[]
): string | null {
  if (best.length < 2 || best[0].score < ART_TRUST_SCORE) return null;
  const margin = best[0].score - best[1].score;
  if (margin >= ART_TRUST_MARGIN) return best[0].cardId;
  const allAgree =
    frameTops.length >= 2 && frameTops.every((t) => t.cardId === best[0].cardId);
  if (allAgree && margin >= ART_AGREE_MARGIN) return best[0].cardId;
  return null;
}

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
/** Bilden har en ÅSIKT (inte ett bevis): tillräckligt för att dämpa ett namn
 *  som inte känns igen bland dess kandidater, men INTE för att vinna själv —
 *  det kräver fortfarande ART_TRUST_*. Marginalgolvet skiljer "bilden pekar
 *  någonstans" från "bilden singlar slant" (Rayquaza-regressionen: 0,011). */
const ART_OPINION_SCORE = 0.6;
const ART_OPINION_MARGIN = 0.04;
const NAME_AGREE_MIN = 0.5;
/** Vikten ett MISSTROTT modellsvar (namn OCH nummer) behåller.
 *  0,25 → 0,20 (2026-08-01): vid 0,25 vann ett hallucinerat men EXAKT kortnamn
 *  (1,0 + EXACT_NAME_WEIGHT = 1,05 × 0,25 = 0,263) fortfarande över bildens
 *  starkaste kandidat (0,722 × ART_WEIGHT = 0,217) — dvs misstron var utmätt så
 *  att den inte kunde ändra ett enda utfall. MÄTT på facitsetet: 46/52 → 48/52,
 *  noll nya fel, och utfallet är IDENTISKT hela vägen ner till 0,10 (en hylla,
 *  ingen knivsegg). ⛔ Nollas fortfarande aldrig: i ~7 % av fallen är det
 *  BILDEN som har fel, och då ska namnet finnas kvar. */
const NAME_DISTRUST = 0.2;

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

/** Epokernas ordning — grannskap används för halva bonusen nedan. */
const ERA_ORDER = ["wotc", "ex", "dp", "bwxy", "sm", "swsh", "sv"] as const;

/**
 * TIE-BREAK-SIGNALERNA (HP + era) är MEDVETET UNDER `MATCH_MARGIN_MIN` (0,05):
 * de får ordna annars-oavgjorda namnsyskon (vinnaren OCH kandidatlistan
 * sorteras på poäng), men ALDRIG få en gissning att se säker ut — träffen
 * förblir märkt "?" — och aldrig utmana ett läst nummer (0,25–0,5) eller en
 * säker bildträff (1,15). Båda kommer ur samma modellsvar som namnet och
 * dämpas med samma misstro (nameWeight) när bilden motsäger texten, och
 * summan klipps av TIEBREAK_CAP så två gissningar som råkar samverka inte
 * kliver över osäkerhetströskeln.
 *
 * HP VÄGER DUBBELT MOT ERAN, för det ena är en LÄSNING och det andra en
 * KLASSNING: HP är kortets största tryckta tal (mätt: modellen läste det
 * spontant när vi bad om samlarnumret), medan era-klassningen är mätt
 * OPÅLITLIG på skärmfoton — samma EX-era-Gyarados fick "wotc" tre skanningar
 * i rad och "swsh" i nästa runda. Mätt särskiljning: 28 kort heter exakt
 * "Gyarados"; HP 90 bär 3 av dem, och "nyast först" bland de tre är exakt
 * rätt kort (Deoxys #8, 2005).
 *
 * GRANNEPOKEN FÅR HALV ERA-BONUS: epokgränserna delar designdrag, så en epok
 * fel är det FÖRVÄNTADE felet — halva bonusen lägger grannepokens kort mellan
 * träffepoken och de orelaterade, så rätt kort förblir valbart i listan även
 * när klassningen är ett steg fel.
 */
const HP_WEIGHT = 0.04;
const ERA_WEIGHT = 0.02;
const ERA_ADJACENT_WEIGHT = 0.01;
const TIEBREAK_CAP = 0.045;

/**
 * EXAKT NAMN SLÅR NAMN-PLUS-SUFFIX (mätt 2026-07-31): namnlikheten räknas på
 * normaliserad text som strippar specialtecken, så "Gyarados" och "Gyarados δ"
 * får BÅDA 1,0 — och δ-tvillingen (Holon Phantoms 2006, också HP 90, också
 * EX-era) vann då på "nyast set" varje gång bilden inte såg någon av dem.
 * Läste modellen exakt "Gyarados" är det starkare bevis än ett namn med
 * suffix; jämförelsen görs på RÅ lowercase (inte normaliserad — det hade
 * strippat bort just skillnaden). Under MATCH_MARGIN_MIN: bryter oavgjort,
 * fabricerar aldrig säkerhet.
 */
const EXACT_NAME_WEIGHT = 0.03;

/**
 * OMTRYCKSSYSKON-TIE-BREAK (2026-07-31). Första facitmätningen (42 riktiga
 * skanningar) gav 4 missar — och ALLA hade samma mekanism: samma kort omtryckt
 * i ett annat set med IDENTISK konst (Raboot SC 27 ↔ AH 37, Scorbunny SC 26 ↔
 * AH 36, Regirock ex DR 101 ↔ AH 107), samlarnumret oläst, och vinnaren avgjord
 * av bildpoängens BRUS (fel-marginaler 0,007–0,018 — långt under allt som
 * betyder något). Identisk konst kan ingen bilddeskriptor skilja, så inom en
 * sådan grupp är skillnaden i bildpoäng per definition brus — och brus ska inte
 * få välja kort.
 *
 * Regeln: kandidater med SAMMA namn vars referensavtryck är nästan identiska
 * (parvis blandad likhet ≥ SAME_ART_MIN — kalibrerat mot verkliga fall: äkta
 * omtryck 0,954–0,976, olika konst ≤ 0,638) får sin bildandel UTJÄMNAD till
 * gruppens bästa. Det som återstår att skilja dem åt är då äkta bevis, i
 * fallande styrka: läst nummer (befintliga bonusen, orörd — utjämningens
 * maxflytt är ~0,015 och kan aldrig utmana 0,25–0,5), tryckt TOTAL om modellen
 * läste en ("034/217" → setet med 217 kort — mätt: rätt i Scorbunny-fallet),
 * och sist "nyast set först" (befintliga sorteringen, nu nåbar eftersom
 * poängen blir exakt lika i stället för brus-skilda).
 *
 * TOTAL-bonusen ligger UNDER MATCH_MARGIN_MIN och dämpas med nameWeight (samma
 * modellsvar, samma misstro) — den ordnar syskon, fabricerar aldrig säkerhet.
 * ⛔ Utjämningen gäller BARA inom bekräftade samma-konst-grupper: globalt hade
 * den raserat bildens hela uppgift (att föreslå rätt kort framför 20 000 andra).
 */
const SAME_ART_MIN = 0.9;
const TOTAL_TIEBREAK = 0.02;

export interface SameArtEntry {
  cardId: string;
  name: string;
  /** Bildlikhet 0..1, undefined när kortet inte låg i bildens topplista. */
  art: number | undefined;
  /** Setets tryckta total (0 = okänd). */
  totalCards: number;
  /** Orundad poäng UTAN tie-break-delen (namn + nummer + bild). */
  scoreSansTiebreak: number;
  /** Ovägd HP-bonus (0 eller HP_WEIGHT) — se hpKnown. */
  hpBonus: number;
  /** Ovägd era-bonus (0 / ERA_ADJACENT_WEIGHT / ERA_WEIGHT). */
  eraBonus: number;
  /** Har KATALOGEN ett HP för kortet? NULL = hål, inte bevis — se nedan. */
  hpKnown: boolean;
}

/**
 * Ren dom (testad utan DB): returnerar NYA poäng för kandidater i bekräftade
 * samma-konst-grupper. `pairSim` är referens-likheten (artPairSimilarity i
 * produktion, stubbas i test).
 *
 * ⛔ HP FÅR BARA SKILJA SYSKON NÄR ALLA I GRUPPEN HAR HP I KATALOGEN (mätt
 * 2026-07-31, alla tre omtrycksmissarna): Ascended Heroes är skapat ur CM:s
 * episodlista innan pokemontcg.io har setet, så dess kort har `hp = NULL` —
 * HP-backfillen har ingen källa. Modellen läste HP HELT RÄTT från det fysiska
 * kortet (90/70/230), det matchade den GAMLA tvillingens katalograd, och den
 * nya fick noll: en katalog-lucka som systematiskt röstar på fel syskon.
 * Samma klass av fel som tcgid-incidenten — ett saknat fält som failar öppet.
 */
export async function applySameArtTiebreak(
  entries: SameArtEntry[],
  pairSim: (a: string, b: string) => Promise<number | null>,
  guessedTotal: number | null,
  nameWeight: number
): Promise<Map<string, number>> {
  const adjusted = new Map<string, number>();
  const byName = new Map<string, SameArtEntry[]>();
  for (const e of entries) {
    const key = e.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), e]);
  }
  for (const group of byName.values()) {
    // Minst två medlemmar som bilden faktiskt såg — utan bildpoäng finns inget
    // brus att utjämna (och ingen grund att kalla dem samma konst i frågan).
    const seen = group.filter((e) => e.art !== undefined);
    if (seen.length < 2) continue;
    const anchor = seen.reduce((a, b) => ((b.art ?? 0) > (a.art ?? 0) ? b : a));
    const confirmed: SameArtEntry[] = [anchor];
    for (const e of seen) {
      if (e === anchor) continue;
      const sim = await pairSim(anchor.cardId, e.cardId);
      if (sim !== null && sim >= SAME_ART_MIN) confirmed.push(e);
    }
    if (confirmed.length < 2) continue;
    const maxArt = Math.max(...confirmed.map((e) => e.art ?? 0));
    const hpMayArbitrate = confirmed.every((e) => e.hpKnown);
    for (const e of confirmed) {
      const tiebreak = Math.min(
        (hpMayArbitrate ? e.hpBonus : 0) + e.eraBonus,
        TIEBREAK_CAP
      );
      let score =
        e.scoreSansTiebreak +
        tiebreak * nameWeight +
        (maxArt - (e.art ?? 0)) * ART_WEIGHT;
      if (guessedTotal != null && e.totalCards > 0 && e.totalCards === guessedTotal) {
        score += TOTAL_TIEBREAK * nameWeight;
      }
      adjusted.set(e.cardId, Math.round(score * 1000) / 1000);
    }
  }
  return adjusted;
}

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
    hp: true,
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
  // …MEN "bara en SÄKER bildträff får ifrågasätta namnet" lämnade ett hål som
  // bulk-läget föll rakt igenom (2026-08-01): en cell som INTE är säker går
  // till vision, och där väger modellens namn FULLT utan någon korsvalidering
  // alls. Namnet är alltså antingen irrelevant (säker bild ⇒ vision hoppas) or
  // oemotsagt — aldrig vägt. MÄTT på ägarens bordsfångst: bilden hade rätt i
  // 6 av 6 celler, modellens namn i 1 av 5, och de hallucinerade namnen
  // ("Moobury", "Nidorina", "Cyndaquil", "Groudon") vann varje gång.
  // Mellanläget är därför: bilden behöver inte vara BEVISAD för att få
  // ifrågasätta ett namn den inte känner igen — den behöver bara ha en ÅSIKT.
  // Rayquaza-fallet som motiverade det strikta villkoret hade marginal 0,011,
  // dvs ingen åsikt alls; bulk-cellerna låg på 0,047–0,096.
  // ⛔ MARGINALEN MÄTS MOT ETT ANNAT KORT, INTE MOT NÄSTA RAD. Bildens tvåa är
  // ofta SAMMA Pokémon i en annan tryckning/set, och då är marginalen pytteliten
  // av en anledning som inte har med osäkerhet att göra: konsten är identisk.
  // MÄTT i produktion 2026-08-01: Team Rocket's Murkrow 126 (0,892) och 127
  // (0,884) — bildens starkaste träff hela kvällen, marginal 0,008 — lästes som
  // "ingen åsikt", varpå modellens hallucinerade "Noctowl" vann oemotsagt.
  // För att välja TRYCKNING är den lilla marginalen rätt signal (se
  // ART_TRUST_*); för att avgöra om modellens NAMN ska tros är den fel fråga.
  const artOpinion = (() => {
    if (!artScores?.size) return false;
    const entries = [...artScores.entries()].sort((a, b) => b[1] - a[1]);
    const [topId, topScore] = entries[0];
    if (topScore < ART_OPINION_SCORE) return false;
    const topName = byId.get(topId)?.name.toLowerCase();
    const rival = entries.slice(1).find(([id]) => {
      const n = byId.get(id)?.name.toLowerCase();
      return n === undefined || topName === undefined || n !== topName;
    });
    return topScore - (rival?.[1] ?? 0) >= ART_OPINION_MARGIN;
  })();
  let nameWeight = 1;
  if (query && (artConfidentCardId || artOpinion) && artScores?.size) {
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

  // Se namesConfirmingTotal — totalen får underkänna en nummerträff som pekar på
  // ett set totalen utesluter, när samma kort finns i ett set totalen bekräftar.
  const namesWithConfirmedTotal = namesConfirmingTotal(byId.values(), guessedNum?.total ?? null);

  const eraIdx = ocr.guessedEra
    ? ERA_ORDER.indexOf(ocr.guessedEra as (typeof ERA_ORDER)[number])
    : -1;
  const inEra = (idx: number, year: number): boolean => {
    const range = ERA_YEARS[ERA_ORDER[idx]];
    // ±1 år: set blöder över årsskiften.
    return year >= range[0] - 1 && year <= range[1] + 1;
  };

  const scored = [...byId.values()].map((card) => {
    // Namnlikheten är 0 när modellen inte läste något namn — då bär bilden och
    // numret hela bedömningen, vilket är precis avsikten.
    let score = query ? scoreSimilarity(query, card.name) * nameWeight : 0;
    // Exakt namn (rå lowercase) — se EXACT_NAME_WEIGHT.
    if (query && query.trim().toLowerCase() === card.name.trim().toLowerCase()) {
      score += EXACT_NAME_WEIGHT * nameWeight;
    }
    // TIE-BREAK mellan namnsyskon: HP (läsning) + era (klassning), med
    // gemensamt tak under osäkerhetströskeln. Se HP_WEIGHT/TIEBREAK_CAP.
    // Delarna hålls isär för omtryckssyskon-utjämningen nedan (som kan behöva
    // räkna om taket utan HP när katalogen saknar HP för en gruppmedlem).
    let hpBonus = 0;
    let eraBonus = 0;
    if (ocr.guessedHp != null && card.hp != null && card.hp === ocr.guessedHp) {
      hpBonus = HP_WEIGHT;
    }
    if (eraIdx >= 0 && card.set.releaseDate) {
      const year = card.set.releaseDate.getUTCFullYear();
      if (inEra(eraIdx, year)) {
        eraBonus = ERA_WEIGHT;
      } else if (
        (eraIdx > 0 && inEra(eraIdx - 1, year)) ||
        (eraIdx < ERA_ORDER.length - 1 && inEra(eraIdx + 1, year))
      ) {
        eraBonus = ERA_ADJACENT_WEIGHT;
      }
    }
    const tiebreakApplied =
      hpBonus + eraBonus > 0 ? Math.min(hpBonus + eraBonus, TIEBREAK_CAP) * nameWeight : 0;
    score += tiebreakApplied;
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
    // ⛔ Bonusen MÅSTE dämpas med nameWeight i ALLA grenar (2026-08-01): en gren
    // glömde det och blev därmed den ENDA vägen för ett misstrott modellsvar att
    // vinna ändå. MÄTT i produktion: modellen hittade på "Groudon 35/95" på en
    // Probopass, namnet dämpades korrekt till 0,25 — och Rhydon 35 vann på den
    // odämpade nummerbonusen (0,346 mot bildens 0,217). Samma modellsvar, samma
    // misstro. Därför ligger grenvalet i numberMatchBonus och vikten HÄR.
    if (guessedNum && card.numberSortKey === guessedNum.sortKey) {
      score += numberMatchBonus(card, guessedNum.total, namesWithConfirmedTotal) * nameWeight;
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
    return {
      candidate,
      released: card.set.releaseDate?.getTime() ?? 0,
      totalCards: card.set.totalCards ?? 0,
      // ORUNDADE komponenter till syskon-utjämningen: utjämningen ska ge EXAKT
      // lika poäng inom en grupp (så "nyast set" får avgöra), och dubbelrundning
      // (runda → justera → runda) lämnar 0,001-skillnader som är exakt det brus
      // regeln finns för att ta bort.
      rawSansTiebreak: score - tiebreakApplied,
      hpBonus,
      eraBonus,
      hpKnown: card.hp != null,
    };
  });

  // OMTRYCKSSYSKON: utjämna bildbruset inom bekräftade samma-konst-grupper så
  // att äkta bevis (nummer, total, nyast set) får avgöra. Se applySameArtTiebreak.
  if (artScores?.size) {
    const adjusted = await applySameArtTiebreak(
      scored.map((s) => ({
        cardId: s.candidate.cardId,
        name: s.candidate.name,
        art: artScores.get(s.candidate.cardId),
        totalCards: s.totalCards,
        scoreSansTiebreak: s.rawSansTiebreak,
        hpBonus: s.hpBonus,
        eraBonus: s.eraBonus,
        hpKnown: s.hpKnown,
      })),
      artPairSimilarity,
      guessedNum?.total ?? null,
      nameWeight
    );
    for (const s of scored) {
      const ns = adjusted.get(s.candidate.cardId);
      if (ns !== undefined) s.candidate.score = ns;
    }
  }

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
    // ⛔ Och när namnet är MISSTROTT är dess syskon per definition en lista över
    // fel kort — då räcker det att kortet är en bildkandidat alls. ART_STRONG
    // (0,75) är ett absolut golv som bulk-cellerna missar med marginal: en
    // Probopass med bildpoäng 0,722 hamnade i "övrigt" och trängdes ut ur
    // listan av tolv Groudon-syskon, så användaren kunde inte ens VÄLJA rätt
    // kort (2026-08-01).
    if ((artScores?.get(c.cardId) ?? 0) >= ART_STRONG) return 2;
    if (nameWeight !== 1 && artScores?.has(c.cardId)) return 2;
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
  imageDataUrl: string,
  role?: string
): Promise<ScanResult> {
  const quota = await getScannerQuota(userId, planTier, role);
  if (quota.remaining <= 0) {
    // Kvoten är per KALENDERMÅNAD (startOfMonthUtc) — copyn sa förut "i dag/
    // i morgon", vilket var fel och förvirrande när gränsen slog till.
    throw new ServiceError(
      429,
      planTier === "PREMIUM"
        ? `Du har nått månadens gräns på ${quota.limit} skanningar. Kvoten nollställs den 1:a.`
        : `Du har använt dina ${quota.limit} gratis skanningar denna månad. Uppgradera till Pro för fler.`
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
  /** Modellens HP-läsning (kortets största tal), null när oläst. */
  guessedHp: number | null;
  confidence: number;
  candidates: ScanCandidate[];
  /** Vision-anropets tokental (API:ts usage), null när anropet hoppades över. */
  usage: { inputTokens: number; outputTokens: number } | null;
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
function decodeFingerprint(b64: string | undefined, expected: number): Int8Array | null {
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length !== expected) return null;
    return new Int8Array(buf.buffer, buf.byteOffset, buf.length);
  } catch {
    return null;
  }
}

/**
 * Avkodar inset-svepet till frågor (färg + ev. struktur, parade per position)
 * och slänger tysta felaktigheter. Tom lista = ingen bildsignal.
 * Struktur utan giltig färg i samma position kastas — färgen är bäraren.
 */
function decodeFingerprints(
  list: string[] | undefined,
  structs?: string[] | undefined
): ArtQuery[] {
  if (!list?.length) return [];
  // Taket speglar API-schemat: en klient ska inte kunna beställa hundra sökningar.
  return list.slice(0, 8).flatMap((b64, i) => {
    const color = decodeFingerprint(b64, FINGERPRINT_BYTES);
    if (!color) return [];
    return [{ color, struct: decodeFingerprint(structs?.[i], STRUCT_BYTES) }];
  });
}

/** Rutor × inset-svep. Taken binder serverns CPU per skanning. */
function decodeFrames(
  frames: string[][] | undefined,
  structFrames?: string[][] | undefined
): ArtQuery[][] {
  if (!frames?.length) return [];
  return frames
    .slice(0, MAX_FRAMES)
    .map((f, i) => decodeFingerprints(f, structFrames?.[i]))
    .filter((f) => f.length > 0);
}

export interface BulkCellResult {
  /** Cellens index i klientens rutnät (position bevaras även när celler är tomma). */
  cell: number;
  candidates: ScanCandidate[];
  /** Trust-regeln höll — cellen behöver ingen vision, träffen är bevisad. */
  confident: boolean;
  artTop: number | null;
  /** ScannerJob-id för en bokförd träff — bär klientens korrigering vidare
   *  (feedback-vägen). Saknas för osäkra celler: de bokförs av /identify. */
  scanId?: string;
}

/**
 * BULK-SKANNING (Fas 1, 2026-08-01): en pärmsida/bordsyta fångas i EN bild,
 * klienten delar upp den i celler (rutnätsoverlay = placeringsguide, funkar
 * för pärmficka OCH lösa kort på ett bord) och skickar VARJE cells
 * avtryckssvep hit. Ren bildmatchning — ingen vision, ingen kvot, inga
 * ScannerJob-rader (12 rader per sida vore diagnostikbrus; de osäkra cellerna
 * går vidare till /identify som bokför precis som vanligt).
 *
 * Återanvänder HELA kandidatkedjan genom matchCards med tom OCR — exakt samma
 * väg som en vision-hoppad skanning: tryckningar expanderas, värden hämtas,
 * syskonlistan byggs. En cell = en frame → trust-regeln döms på basvillkoret
 * (marginal ≥ 0,10), aldrig samstämmighetssänkningen.
 *
 * Kostnadsform: ≤12 celler × ≤8 avtryck ≈ ~1 s CPU mot indexet i minnet +
 * PK-uppslag för kandidaterna. Neon-vänligt, $0 per sida.
 */
export async function identifyCellsArt(
  cells: Array<{ fingerprints: string[]; structFingerprints?: string[] }>,
  /**
   * Bokför träffar och gör dem RÄTTNINGSBARA.
   *
   * ⛔ Utan det här är en bildavgjord bulk-cell osynlig: den skapade inget
   * ScannerJob, så (a) den räknades inte mot kvoten trots att den identifierade
   * ett kort, och (b) en korrigering i kandidatlistan hade inget jobb-id att
   * fästa vid och FÖRSVANN. Mätt 2026-08-02: ägaren rättade ett kort i en
   * niokortsfångst och rättelsen gick förlorad — och det är just rättelser som
   * bygger facitsetet, dvs hela förbättringsslingan.
   */
  owner?: { userId: string; isAdmin: boolean }
): Promise<BulkCellResult[]> {
  const out: BulkCellResult[] = [];
  for (const [i, cell] of cells.entries()) {
    const sweep = decodeFingerprints(cell.fingerprints, cell.structFingerprints);
    if (sweep.length === 0) {
      out.push({ cell: i, candidates: [], confident: false, artTop: null });
      continue;
    }
    const artMatches = await searchByFingerprints(sweep, ART_CANDIDATES);
    const artScores = new Map(artMatches.map((m) => [m.cardId, m.score]));
    const confidentId = artConfidentFrom(artMatches, []);
    const candidates = await matchCards(
      // Samma tomma OCR som när vision hoppas över: bilden bär hela bedömningen.
      { rawText: "", confidence: confidentId ? 0.95 : 0 },
      artScores,
      confidentId
    );
    // Bara SÄKRA celler bokförs: en osäker cell skickas vidare av klienten till
    // /identify och bokförs DÄR — annars skulle samma kort räknas två gånger.
    let scanId: string | undefined;
    if (owner && confidentId !== null && candidates.length > 0) {
      scanId = await recordScanUsage(
        owner.userId,
        owner.isAdmin
          ? {
              v: 1,
              provider: "bild",
              artTop: artMatches[0]?.score ?? null,
              artTopLabel: await describeArtMatches(artMatches.slice(0, 3)),
              chosen: {
                cardId: candidates[0].cardId,
                name: candidates[0].name,
                number: candidates[0].number,
                setName: candidates[0].setName,
                score: candidates[0].score,
              },
              // Avtrycken (264 byte styck) så replayen kan återge beslutet —
              // aldrig bilden. Samma form som enkelskanningens diagnostik.
              frames: [cell.fingerprints.slice(0, 7)],
              structFrames: cell.structFingerprints
                ? [cell.structFingerprints.slice(0, 7)]
                : [],
            }
          : undefined,
        true
      );
    }
    out.push({
      cell: i,
      candidates,
      confident: confidentId !== null,
      artTop: artMatches[0]?.score ?? null,
      scanId,
    });
  }
  return out;
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
    /** Strukturavtryck, parade positionsvis med färgavtrycken ovan. */
    structFingerprints?: string[];
    structFrames?: string[][];
  } = {}
): Promise<IdentifyResult> {
  const adapter = getOcrAdapter(opts.precise);
  // BILDEN FÖRST, MODELLEN VID BEHOV (2026-07-31): sökningen är ~40 ms CPU mot
  // ett index i minnet; vision-anropet är 1–2 s och kostar per anrop. Är
  // bildträffen BEVISAT säker (poäng + marginal, regeln med 100 % uppmätt
  // precision över 660 frågor) hoppas Haiku över helt: snabbare OCH billigare.
  // Tvetydiga fall — inklusive alla tryckningar med identisk konst, som per
  // konstruktion ger pytteliten marginal — går fortfarande till modellen.
  // Kostnaden för sekvensen i det osäkra fallet är bara sökningens ~40 ms.
  const frames = decodeFrames(opts.fingerprintFrames, opts.structFrames);
  const single =
    frames.length === 0
      ? decodeFingerprints(opts.fingerprints, opts.structFingerprints)
      : [];
  const detailed = frames.length
    ? await searchByFramesDetailed(frames, ART_CANDIDATES)
    : single.length
      ? { best: await searchByFingerprints(single, ART_CANDIDATES), frameTops: [] }
      : { best: [], frameTops: [] };
  const artMatches = detailed.best;

  const artScores = new Map(artMatches.map((m) => [m.cardId, m.score]));
  // MARGINALEN till tvåan är det som avgör om bildträffen går att lita på —
  // poängen ensam skiljer inte rätt från fel. Med full ruta-samstämmighet
  // sänks marginalkravet (temporalt bevis) — se artConfidentFrom/ART_AGREE_MARGIN.
  const artConfidentCardId = artConfidentFrom(artMatches, detailed.frameTops);

  // `precise` = användaren bad uttryckligen om modellen — hoppa aldrig då.
  const skipVision = artConfidentCardId !== null && !opts.precise;
  const ocr: OcrResult = skipVision
    ? { rawText: "", confidence: 0.95 }
    : await adapter.extractCardInfo(imageDataUrl, opts.detailDataUrl);

  // Bilden ensam räcker som signal — texten kan vara helt oläslig.
  const [candidates, artTopLabel] = await Promise.all([
    matchCards(ocr, artScores, artConfidentCardId),
    describeArtMatches(artMatches.slice(0, 3)),
  ]);

  // FABRICERADE NUMMER SER UT SOM BEVIS (mätt 2026-07-30): modellen läste
  // "Dragonite 4/102" ur en suddig fångst → exakt träff på Fossil Dragonite,
  // visad UTAN frågetecken. Ett nummer-drivet val som bildens FULLA topplista
  // inte känns vid märks därför som osäkert — valet står kvar (numret är
  // fortfarande den starkaste signalen på fysiska kort), men det ser inte
  // längre ut som ett bevis när den andra signalen säger emot.
  const top = candidates[0];
  const guessedNum = parseGuessedNumber(ocr.guessedNumber);
  const numberContradictedByArt =
    top !== undefined &&
    guessedNum !== null &&
    cardNumberSortKey(top.number) === guessedNum.sortKey &&
    artScores.size >= ART_CANDIDATES &&
    !artScores.has(top.cardId);

  return {
    provider: skipVision ? "bild" : adapter.name,
    guessedName: ocr.guessedName ?? null,
    guessedNumber: ocr.guessedNumber ?? null,
    guessedEra: ocr.guessedEra ?? null,
    guessedHp: ocr.guessedHp ?? null,
    confidence: ocr.confidence,
    usage: ocr.usage ?? null,
    candidates,
    ambiguous: isAmbiguous(candidates) || numberContradictedByArt,
    artTop: artMatches.length > 0 ? artMatches[0].score : null,
    artTopLabel,
  };
}

/** Kortmetadata för live-träffchippen — id:na är stabila, cachea i processen
 *  så pollandet inte väcker Neon per ruta. Taket skyddar mot obegränsad växt. */
const artMetaCache = new Map<
  string,
  { name: string; number: string; setName: string }
>();
const ART_META_CACHE_MAX = 4000;

export interface ArtLiveResult {
  candidates: Array<{
    cardId: string;
    name: string;
    number: string;
    setName: string;
    score: number;
  }>;
  /** Avstånd topp-1 → topp-2 (olika kort). Null när tvåa saknas. */
  margin: number | null;
  /** Trust-regeln (poäng + marginal) — 100 % uppmätt precision. */
  confident: boolean;
}

/**
 * LIVE-IDENTIFIERING PÅ ENBART BILDEN — ingen vision-modell, ingen bild upp.
 *
 * Det här är det som gör skannern "millisekundsnabb" som konkurrenternas:
 * klienten pollar med ~1 kB avtryck medan användaren siktar, sökningen är
 * ~40 ms CPU mot indexet i minnet, och när på varandra följande rutor pekar på
 * samma kort låser chippen INNAN slutaren trycks. Noll AI-kostnad per poll —
 * därför räknas pollen inte mot skanningskvoten (kvoten binder vision-kostnad).
 */
export async function identifyCardArt(opts: {
  fingerprints?: string[];
  structFingerprints?: string[];
}): Promise<ArtLiveResult> {
  const queries = decodeFingerprints(opts.fingerprints, opts.structFingerprints);
  if (queries.length === 0) return { candidates: [], margin: null, confident: false };
  const matches = await searchByFingerprints(queries, 5);
  if (matches.length === 0) return { candidates: [], margin: null, confident: false };

  const missing = matches.filter((m) => !artMetaCache.has(m.cardId));
  if (missing.length > 0) {
    const rows = await prisma.card.findMany({
      where: { id: { in: missing.map((m) => m.cardId) } },
      select: { id: true, name: true, number: true, set: { select: { name: true } } },
    });
    if (artMetaCache.size + rows.length > ART_META_CACHE_MAX) artMetaCache.clear();
    for (const r of rows) {
      artMetaCache.set(r.id, { name: r.name, number: r.number, setName: r.set.name });
    }
  }

  const margin = matches.length >= 2 ? matches[0].score - matches[1].score : null;
  return {
    candidates: matches.flatMap((m) => {
      const meta = artMetaCache.get(m.cardId);
      return meta ? [{ cardId: m.cardId, ...meta, score: m.score }] : [];
    }),
    margin,
    confident:
      margin !== null && matches[0].score >= ART_TRUST_SCORE && margin >= ART_TRUST_MARGIN,
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
