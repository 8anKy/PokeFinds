/**
 * SKANNERMOTORN UTAN AI — SKUGGLÄGE (2026-09-30).
 *
 * Varje inloggad skanning skickas OCKSÅ till skannermotorn (`scanner-engine/`, egen Railway-tjänst:
 * SIFT + faiss + RANSAC, ingen AI) och motorns svar bokförs som `ScannerJob.result.shadow`.
 * ⛔ PÅVERKAR INGET I SVARET — användaren ser dagens skanner. Syftet är att mäta motorn mot
 * användarnas egna domar (`userChosen`) i 1–2 veckor innan Gemini stängs av.
 *
 * Av tills `SCANNER_ENGINE_URL` + `SCANNER_ENGINE_SECRET` är satta (då är det här en no-op).
 * Fire-and-forget: ett långsamt eller nere motoranrop får aldrig fördröja eller fälla skanningen.
 * Bilden går bara till VÅR egen tjänst och sparas inte där.
 *
 * ⛔ SKRIVS SOM ATOMISK JSONB-SAMMANSLAGNING (`result || {shadow}`), aldrig läs-ändra-skriv:
 * feedback-rutten skriver om hela `result` med sin `userChosen`, och en läs-ändra-skriv här hade
 * kunnat radera användarens dom.
 */
import { prisma } from "@/lib/db";

const TIMEOUT_MS = 15_000;

export interface EngineResponse {
  best?: string | null;
  candidates?: { cardId: string; inliers?: number }[];
  regionSwapFrom?: string | null;
  ms?: number;
  msA?: number;
  error?: string;
  reason?: string;
}

export interface ShadowRecord {
  v: 1;
  best: string | null;
  top: string[];
  inliers: number[];
  ms: number | null;
  swap?: string;
  err?: string;
}

export function engineShadowEnabled(): boolean {
  return !!process.env.SCANNER_ENGINE_URL?.trim() && !!process.env.SCANNER_ENGINE_SECRET?.trim();
}

/** Motorns svar → det vi bokför (ren, testad). Topp-5 räcker för "låg rätt kort nära toppen?". */
export function shadowRecord(res: EngineResponse | null, err?: string): ShadowRecord {
  if (!res || err || res.error) {
    return { v: 1, best: null, top: [], inliers: [], ms: null, err: err ?? res?.error ?? "no-response" };
  }
  const top = (res.candidates ?? []).slice(0, 5);
  return {
    v: 1,
    best: res.best ?? null,
    top: top.map((c) => c.cardId),
    inliers: top.map((c) => c.inliers ?? 0),
    ms: typeof res.ms === "number" ? res.ms : null,
    ...(res.regionSwapFrom ? { swap: res.regionSwapFrom } : {}),
    ...(res.reason ? { err: res.reason } : {}),
  };
}

function jpegBytes(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

/** Skicka fångsten till motorn och bokför svaret på jobbet. Returnerar direkt. */
export function runEngineShadow(jobId: string, imageDataUrl: string): void {
  if (!engineShadowEnabled()) return;
  const body = jpegBytes(imageDataUrl);
  if (!body) return;
  const url = `${process.env.SCANNER_ENGINE_URL!.trim().replace(/\/$/, "")}/identify`;
  void (async () => {
    let record: ShadowRecord;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "image/jpeg", "x-engine-secret": process.env.SCANNER_ENGINE_SECRET!.trim() },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      record = res.ok ? shadowRecord((await res.json()) as EngineResponse) : shadowRecord(null, `http-${res.status}`);
    } catch (e) {
      record = shadowRecord(null, (e as Error).name === "TimeoutError" ? "timeout" : "unreachable");
    }
    await prisma.$executeRaw`
      UPDATE "ScannerJob"
      SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('shadow', ${JSON.stringify(record)}::jsonb)
      WHERE id = ${jobId}`.catch((e) => console.warn("[engine-shadow] kunde inte bokföra:", (e as Error).message));
  })();
}
