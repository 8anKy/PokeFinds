/**
 * ON-DEVICE NUMMERLÄSNING I APPEN (ML Kit) — SKUGGLÄGE (2026-09-01).
 *
 * Appen läser samlarnumret LOKALT ur samma nederkantsremsa som redan skickas
 * till servern som `detail`, och skickar tolkningen som telemetri bredvid
 * Geminis läsning. ⛔ **INGET I SVARET PÅVERKAS.** Syftet är ett fälttal:
 * hur ofta läser den gratis vägen numret rätt, per stratum, och hur lång tid
 * tar det — först på det talet fattas beslutet att låta numret avgöra
 * (fas 2 i project_scanner_field_fingerprints_and_free_ocr).
 *
 * VARFÖR ML KIT OCH INTE TESSERACT: mätt 2026-08-31 på 43 riktiga remsor —
 * tesseract 25,6 % (bästa variant) / 44,2 % (bästa-av-7) mot Gemini 94,9 %.
 * Siffrorna är ~20 px, vita med mörk kontur ovanpå konsten, plastficka och
 * rörelseoskärpa: olösligt för klassisk segmentering, vardag för ML Kits
 * modell. Gratis, offline, ingen nätverkstrafik.
 *
 * PLATTFORM: bara nativt (`Capacitor.isNativePlatform()`); webben får
 * `undefined` utan att något importeras. ⛔ JS:et är HOSTAT och laddas även av
 * en ÄLDRE appbinär utan pluginet — då kastar Capacitor UNIMPLEMENTED och vi
 * stänger av oss tyst för resten av sessionen. Skickar INGET i det läget
 * (inte `err`), annars hade varje gammal app spammat telemetrin.
 * ⚠️ iOS: pluginet är CocoaPods-only (Googles ML Kit saknar SPM) medan
 * ios/App bygger med SPM — tills det är löst tar iOS UNIMPLEMENTED-vägen.
 *
 * FILVÄGEN: pluginet vill ha en FILSÖKVÄG, inte base64. Remsan skrivs till
 * app-cachen (Filesystem, Directory.Cache), läses, och tas bort. Ett roterande
 * filnamn (8 platser) så att bulkens seriella celler inte skriver över varandra
 * om en radering släpar.
 */
import { analyzeStripText } from "@/lib/local-number-read";

export interface LocalNumberPayload {
  /** Väggklockstid för hela läsningen (filskrivning + igenkänning), ms. */
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

async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Capacitors "pluginet finns inte i den här binären" — äldre app, eller iOS utan Pods. */
function isUnimplemented(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return code === "UNIMPLEMENTED" || /not implemented|not available|UNIMPLEMENTED/i.test(msg);
}

async function recognize(dataUrl: string): Promise<string> {
  const [{ Filesystem, Directory }, { TextRecognition }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor-mlkit/text-recognition"),
  ]);
  const base64 = dataUrl.replace(/^data:image\/[a-z+.-]+;base64,/i, "");
  const path = `foilio-strip-${seq++ % 8}.jpg`;
  const { uri } = await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache });
  try {
    const { text } = await TextRecognition.processImage({ path: uri });
    return text;
  } finally {
    void Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
  }
}

/**
 * Läser numret ur remsan. `undefined` = kördes inte (webb, äldre app, iOS
 * utan pluginet) — då skickas inget. Ett objekt = kördes; `printed: null`
 * utan `err` betyder att OCR:n svarade men texten bar inget nummer, vilket
 * är en MISS i mätningen och måste bokföras som en.
 */
export async function readNumberStripNative(
  dataUrl: string,
  timeoutMs = READ_TIMEOUT_MS
): Promise<LocalNumberPayload | undefined> {
  if (state === "unsupported") return undefined;
  if (!(await isNative())) {
    state = "unsupported";
    return undefined;
  }
  const t0 = performance.now();
  try {
    const text = await withTimeout(recognize(dataUrl), timeoutMs);
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
 * Värm upp modellen när kameran går live. Första igenkänningen på Android
 * laddar modellen (~1 s); utan uppvärmning hade första skanningen i varje
 * session ätit det ur sin tidsgräns och bokförts som "timeout". Kör en
 * 64×32 vit JPEG — resultatet kastas. No-op på webben och när läget är känt.
 */
export function warmUpLocalNumberReader(): void {
  if (state !== "unknown") return;
  void (async () => {
    if (!(await isNative())) {
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
      await withTimeout(recognize(c.toDataURL("image/jpeg", 0.8)), WARMUP_TIMEOUT_MS);
      state = "ready";
    } catch (e) {
      if (isUnimplemented(e)) state = "unsupported";
    }
  })();
}
