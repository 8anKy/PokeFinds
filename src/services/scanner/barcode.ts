/**
 * STRECKKODSAVKODNING — sealed identifieras på ASKENS kod, inte på sitt utseende.
 *
 * VARFÖR EN EGEN VÄG FÖR SEALED: konstavtrycket (src/lib/art-fingerprint.ts) är
 * byggt för ett PLANT motiv — katalogens kortbild mot kamerans kortbild. En
 * booster box är en 3D-låda: perspektivet, glansen och vilken sida som råkar
 * vändas mot linsen ändrar färglayouten mer än skillnaden mellan två olika
 * lådor. Streckkoden har inget av det problemet — den är en EXAKT nyckel,
 * samma nummer på asken i varje butik i världen (se "GTIN = exakt
 * cross-store-nyckel" i CLAUDE.md, uppmätt täckning ~73 % av våra offers).
 *
 * KOSTNADSFORMEN ÄR HELA POÄNGEN: avkodningen sker i KLIENTEN (webbläsarens
 * egen `BarcodeDetector`), och det som skickas upp är ~14 siffror. Ingen
 * bilduppladdning, inget vision-anrop, ingen poängsättning — och därmed noll
 * rörlig kostnad per skanning. Samma princip som avtrycket: räkna hos klienten,
 * skicka nyckeln, aldrig indexet.
 *
 * ⛔ NORMALISERINGEN ÄGS AV `@/lib/gtin` OCH FÅR INTE KOPIERAS HIT. Två
 * implementationer av samma nyckel driver isär tyst — exakt den fälla
 * `Card.numberSortKey`/`cardNumberSortKey()` har ett parvis test för. Här har
 * `normalizeGtin` dessutom en roll till: den är GRINDEN. En kod som inte klarar
 * GS1-checksiffran ska ge INGENTING, aldrig en produkt. En felläst streckkod som
 * lägger fel booster box i någons samling är värre än en streckkod som inte
 * lästes alls — den första märks inte.
 *
 * ⛔ `BarcodeDetector` FINNS INTE I SAFARI/iOS WebKit (per 2026-08). Android
 * Chrome och Chromium-WebViews (= vår Capacitor-app på Android) har den; iOS
 * har den inte, i varken Safari eller WKWebView. Modulen rapporterar det ärligt
 * via `barcodeSupported()` i stället för att dra in ett JS-bibliotek på flera
 * hundra kB som fallback — den kostnaden (nedladdning för ALLA besökare, även
 * de som aldrig skannar sealed) är ett ägarbeslut, inte ett implementationsval.
 */
import { normalizeGtin } from "@/lib/gtin";

/**
 * Formaten vi ber detektorn om. Medvetet SMALT: varje extra format är fler
 * mönster att leta efter i varje videoruta (CPU på telefonen) och fler chanser
 * att läsa något som inte är en produktkod. Det här är de fyra som står på en
 * Pokémon-ask: EAN-13 (Europa/Japan), UPC-A (Nordamerika) och deras korta
 * former.
 */
export const BARCODE_FORMATS = ["ean_13", "upc_a", "ean_8", "upc_e"] as const;
export type BarcodeFormat = (typeof BARCODE_FORMATS)[number];

/** Bildkällor `BarcodeDetector.detect()` tar emot (delmängd av ImageBitmapSource). */
export type BarcodeSource =
  | HTMLVideoElement
  | HTMLCanvasElement
  | HTMLImageElement
  | ImageBitmap
  | ImageData
  | Blob;

/** En avläsning som KLARAT checksiffran. `raw` behålls för felsökning/telemetri. */
export interface BarcodeHit {
  /** Exakt vad detektorn läste, före all tolkning. */
  raw: string;
  /** Detektorns formatnamn ("ean_13" …), "unknown" när den inte säger något. */
  format: string;
  /** Kanonisk GTIN-14 — samma normalisering som katalogen (`Product.gtin`). */
  gtin: string;
}

/** Minsta möjliga typning av webbläsar-API:t (finns inte i TS lib-filerna). */
interface DetectedBarcodeLike {
  rawValue: string;
  format?: string;
}
interface BarcodeDetectorLike {
  detect(source: BarcodeSource): Promise<DetectedBarcodeLike[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function detectorCtor(): BarcodeDetectorCtor | null {
  const g = globalThis as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof g.BarcodeDetector === "function" ? g.BarcodeDetector : null;
}

/**
 * Finns webbläsarens streckkodsläsare alls?
 *
 * SYNKRON MED FLIT: anroparen behöver svaret när gränssnittet ritas (visa
 * "skanna streckkod"-läget eller inte), inte efter en promise. Att konstruktorn
 * finns betyder inte att just VÅRA format stöds — den kontrollen är asynkron och
 * ligger i `createBarcodeScanner()`, som returnerar null i det fallet.
 */
export function barcodeSupported(): boolean {
  // ⛔ AVSTÄNGT (ägarbeslut 2026-09-05): streckkodsläget syns inte längre i
  // skannern — knappen och läget grindas på den här funktionen. Koden nedan
  // ligger kvar (identify-gtin-rutten och UPC-E-logiken) men nås inte från UI:t.
  // Slå på igen: `return detectorCtor() !== null;`.
  return false;
}

/**
 * UPC-E → UPC-A. Den 8-siffriga UPC-E-strängen är INTE en giltig GTIN-8:
 * dess checksiffra är UPC-A-kodens, uträknad på den EXPANDERADE koden. Skickar
 * man den rakt in i `normalizeGtin` faller den (rätteligen) på checksiffran, och
 * en giltig ask hade tolkats som "ingen kod".
 *
 * Expansionen styrs av SISTA datasiffran (GS1:s tabell). Funktionen VALIDERAR
 * ingenting — den bara packar upp; checksiffran prövas sedan av `normalizeGtin`,
 * som förblir den enda grinden.
 */
export function expandUpcE(raw: string): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length !== 8) return null;
  // Nummersystemet är 0 eller 1 för UPC-E. Allt annat är inte en UPC-E-kod, och
  // att expandera den ändå hade fabricerat en produktkod ur skräp.
  const s = d[0];
  if (s !== "0" && s !== "1") return null;
  const [d1, d2, d3, d4, d5, d6] = d.slice(1, 7);
  const check = d[7];
  switch (d6) {
    case "0":
    case "1":
    case "2":
      return `${s}${d1}${d2}${d6}0000${d3}${d4}${d5}${check}`;
    case "3":
      return `${s}${d1}${d2}${d3}00000${d4}${d5}${check}`;
    case "4":
      return `${s}${d1}${d2}${d3}${d4}00000${d5}${check}`;
    default:
      return `${s}${d1}${d2}${d3}${d4}${d5}0000${d6}${check}`;
  }
}

/**
 * Rå avläsning → kanonisk GTIN-14, eller null.
 *
 * FORMATET AVGÖR TOLKNINGEN AV 8 SIFFROR. En 8-siffrig sträng är antingen en
 * EAN-8 (giltig som den är) eller en UPC-E (måste expanderas) — och de går inte
 * att skilja åt på innehållet. Att "prova båda" hade i ~1 fall av 10 gett en
 * UPC-E som råkar klara GTIN-8-checksumman, alltså en TYST felaktig produktkod.
 * Därför expanderas bara det detektorn UTTRYCKLIGEN kallar `upc_e`; utan
 * formatuppgift gissar vi aldrig.
 *
 * (Om plattformen redan lämnar UPC-E i expanderad 12-siffrig form faller den
 * igenom till den vanliga vägen — därav längdvillkoret, inte bara formatet.)
 */
export function gtinFromBarcode(
  raw: string | null | undefined,
  format?: string
): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (format === "upc_e" && digits.length === 8) {
    return normalizeGtin(expandUpcE(digits));
  }
  return normalizeGtin(raw ?? null);
}

export interface BarcodeScanner {
  /**
   * Läser en bildkälla och returnerar de avläsningar som klarade checksiffran.
   * Tom lista = ingen kod i bilden (det NORMALA utfallet per ruta) ELLER en
   * kod som inte gick att verifiera. De två skiljs inte åt med flit: båda
   * betyder "vi vet ingenting", och en avläsning vi inte litar på ska inte
   * kunna se ut som ett resultat.
   */
  detect(source: BarcodeSource): Promise<BarcodeHit[]>;
}

/**
 * Skapar en läsare, eller null när plattformen inte kan (iOS/Safari — se
 * modulens toppkommentar).
 *
 * ⛔ SKAPA EN OCH ÅTERANVÄND DEN. På Android laddar konstruktorn ner/initierar
 * Play Services-modellen första gången; en ny instans per videoruta gör den
 * jobbet om och om igen. Läsaren är tillståndslös utåt, så en instans räcker
 * för hela skannersessionen.
 */
export async function createBarcodeScanner(): Promise<BarcodeScanner | null> {
  const Ctor = detectorCtor();
  if (!Ctor) return null;

  // Konstruktorn finns ≠ våra format stöds. Chrome på Android exponerar det
  // via getSupportedFormats(); saknas metoden litar vi på konstruktorn (att
  // vägra där hade stängt av funktionen på plattformar som faktiskt klarar den).
  let formats: string[] = [...BARCODE_FORMATS];
  if (Ctor.getSupportedFormats) {
    try {
      const supported = await Ctor.getSupportedFormats();
      formats = BARCODE_FORMATS.filter((f) => supported.includes(f));
      if (formats.length === 0) return null;
    } catch {
      formats = [...BARCODE_FORMATS];
    }
  }

  let detector: BarcodeDetectorLike;
  try {
    detector = new Ctor({ formats });
  } catch {
    // Vissa Chromium-versioner kastar när ett format inte känns igen.
    return null;
  }

  return {
    async detect(source: BarcodeSource): Promise<BarcodeHit[]> {
      // En <video> som inte hunnit få pixlar får detect() att kasta på vissa
      // plattformar och returnera skräp på andra. Fråga inte innan det finns
      // något att läsa.
      if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
        if (source.readyState < 2 || source.videoWidth === 0) return [];
      }
      let found: DetectedBarcodeLike[];
      try {
        found = await detector.detect(source);
      } catch {
        // Detektorn kastar rutinmässigt vid t.ex. en tom ruta. Ett fel här är
        // inte ett fel i appen — det är "ingen kod den här gången".
        return [];
      }
      const hits: BarcodeHit[] = [];
      const seen = new Set<string>();
      for (const b of found) {
        const gtin = gtinFromBarcode(b.rawValue, b.format);
        // Ingen giltig checksiffra → koden existerar inte för oss.
        if (!gtin || seen.has(gtin)) continue;
        seen.add(gtin);
        hits.push({ raw: b.rawValue, format: b.format ?? "unknown", gtin });
      }
      return hits;
    },
  };
}
