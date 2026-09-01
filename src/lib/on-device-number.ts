/**
 * ON-DEVICE NUMMERLÄSNING I APPEN — SKUGGLÄGE (2026-09-01).
 *
 * Appen läser samlarnumret LOKALT ur samma nederkantsremsa som redan skickas
 * till servern som `detail`, och skickar tolkningen som telemetri bredvid
 * Geminis läsning. ⛔ **INGET I SVARET PÅVERKAS.** Syftet är ett fälttal:
 * hur ofta läser den gratis vägen numret rätt, per stratum, och hur lång tid
 * tar det — först på det talet fattas beslutet att låta numret avgöra
 * (fas 2 i project_scanner_field_fingerprints_and_free_ocr).
 *
 * TVÅ MOTORER, ETT KONTRAKT:
 *   iOS     → `foilio-text-recognition` (plugins/, egen): Apple Vision,
 *             systemramverk, noll beroenden, tar base64 direkt.
 *   Android → `@capacitor-mlkit/text-recognition`: ML Kit, vill ha en FILVÄG
 *             ⇒ remsan skrivs till app-cachen (Filesystem), läses, tas bort.
 *   Webb    → `undefined` utan att något importeras.
 * ⛔ ML Kit-pluginet är CocoaPods-only på iOS (Googles ML Kit saknar SPM) medan
 * ios/App genereras som SPM-projekt i Codemagic — därför den egna pluginen.
 *
 * VARFÖR INTE TESSERACT: mätt 2026-08-31 på 43 riktiga remsor — 25,6 % (bästa
 * variant) / 44,2 % (bästa-av-7) mot Gemini 94,9 %. Siffrorna är ~20 px, vita
 * med mörk kontur ovanpå konsten, plastficka och rörelseoskärpa: olösligt för
 * klassisk segmentering, vardag för en modern textmodell.
 *
 * ⛔ JS:et är HOSTAT och laddas även av en ÄLDRE appbinär utan pluginet — då
 * kastar Capacitor UNIMPLEMENTED och vi stänger av oss tyst för resten av
 * sessionen. Skickar INGET i det läget (inte `err`), annars hade varje gammal
 * app spammat telemetrin.
 */
import { analyzeStripText } from "@/lib/local-number-read";

export interface LocalNumberPayload {
  /** Väggklockstid för hela läsningen (ev. filskrivning + igenkänning), ms. */
  ms: number;
  /** Tolkat nummer, null = OCR:n läste text men inget samlarnummer. */
  printed: string | null;
  num: number | null;
  total: number | null;
  /** Antal "n/N"-kandidater i texten (fler än 1 = tvetydig remsa). */
  candidates: number;
  /**
   * Hela OCR-texten, kapad. Servern sparar den BARA för admin — den kan bära
   * illustratörsnamn och copyright, vilket inte är persondata men mer än
   * mätningen behöver för en vanlig användare.
   */
  raw?: string;
  /** "timeout" | "plugin" — läsningen KÖRDES men gav inget. Skiljs från "läste inget". */
  err?: "timeout" | "plugin";
}

const RAW_MAX = 300;
/** Över det här är talet lika bra bokfört som ett fel — och användaren väntar. */
const READ_TIMEOUT_MS = 2500;
const WARMUP_TIMEOUT_MS = 8000;

type Platform = "ios" | "android" | "web";
type State = "unknown" | "ready" | "unsupported";
let state: State = "unknown";
let seq = 0;

const TIMEOUT = Symbol("timeout");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(TIMEOUT), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function platform(): Promise<Platform> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return "web";
    return Capacitor.getPlatform() === "ios" ? "ios" : "android";
  } catch {
    return "web";
  }
}

/** Capacitors "pluginet finns inte i den här binären" — äldre app utan pluginet. */
function isUnimplemented(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return code === "UNIMPLEMENTED" || /not implemented|not available|UNIMPLEMENTED/i.test(msg);
}

function stripPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/[a-z+.-]+;base64,/i, "");
}

async function recognizeIos(base64: string): Promise<string> {
  const { FoilioTextRecognition } = await import("foilio-text-recognition");
  const { text } = await FoilioTextRecognition.recognize({ base64 });
  return text;
}

async function recognizeAndroid(base64: string): Promise<string> {
  const [{ Filesystem, Directory }, { TextRecognition }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor-mlkit/text-recognition"),
  ]);
  // Roterande filnamn (8 platser) så bulkens seriella celler inte skriver
  // över varandra om en radering släpar.
  const path = `foilio-strip-${seq++ % 8}.jpg`;
  const { uri } = await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache });
  try {
    const { text } = await TextRecognition.processImage({ path: uri });
    return text;
  } finally {
    void Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
  }
}

async function recognize(dataUrl: string, on: Platform): Promise<string> {
  const base64 = stripPrefix(dataUrl);
  return on === "ios" ? recognizeIos(base64) : recognizeAndroid(base64);
}

/**
 * Läser numret ur remsan. `undefined` = kördes inte (webb, äldre app utan
 * pluginet) — då skickas inget. Ett objekt = kördes; `printed: null` utan
 * `err` betyder att OCR:n svarade men texten bar inget nummer, vilket är en
 * MISS i mätningen och måste bokföras som en.
 */
export async function readNumberStripNative(
  dataUrl: string,
  timeoutMs = READ_TIMEOUT_MS
): Promise<LocalNumberPayload | undefined> {
  if (state === "unsupported") return undefined;
  const on = await platform();
  if (on === "web") {
    state = "unsupported";
    return undefined;
  }
  const t0 = performance.now();
  try {
    const text = await withTimeout(recognize(dataUrl, on), timeoutMs);
    state = "ready";
    const { number, candidates } = analyzeStripText(text);
    return {
      ms: Math.round(performance.now() - t0),
      printed: number?.printed ?? null,
      num: number?.num ?? null,
      total: number?.total ?? null,
      candidates,
      raw: text.slice(0, RAW_MAX),
    };
  } catch (e) {
    if (isUnimplemented(e)) {
      state = "unsupported";
      return undefined;
    }
    return {
      ms: Math.round(performance.now() - t0),
      printed: null,
      num: null,
      total: null,
      candidates: 0,
      err: e === TIMEOUT ? "timeout" : "plugin",
    };
  }
}

/**
 * Värm upp motorn när kameran går live. Första igenkänningen laddar modellen
 * (~1 s på Android, kortare på iOS); utan uppvärmning hade första skanningen
 * i varje session ätit det ur sin tidsgräns och bokförts som "timeout". Kör
 * en 64×32 vit JPEG — resultatet kastas. No-op på webben och när läget är känt.
 */
export function warmUpLocalNumberReader(): void {
  if (state !== "unknown") return;
  void (async () => {
    const on = await platform();
    if (on === "web") {
      state = "unsupported";
      return;
    }
    try {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 32;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      await withTimeout(recognize(c.toDataURL("image/jpeg", 0.8), on), WARMUP_TIMEOUT_MS);
      state = "ready";
    } catch (e) {
      if (isUnimplemented(e)) state = "unsupported";
    }
  })();
}
