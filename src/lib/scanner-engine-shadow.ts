/**
 * SKANNERMOTORN UTAN AI — skuggläge + motorläge (2026-09-30).
 *
 * SKUGGLÄGE: varje inloggad skanning skickas OCKSÅ till skannermotorn (`scanner-engine/`, egen
 * Railway-tjänst: SIFT + faiss + RANSAC, ingen AI) och motorns svar bokförs som
 * `ScannerJob.result.shadow`. ⛔ PÅVERKAR INGET I SVARET — användaren ser dagens skanner.
 *
 * MOTORLÄGE (`SCANNER_ENGINE_PRIMARY=admin`): för ADMIN är det motorns svar som visas och Gemini
 * anropas aldrig. Steget före att slå på det för alla; samma kod, bara en bredare grind.
 *
 * Av tills `SCANNER_ENGINE_URL` + `SCANNER_ENGINE_SECRET` är satta (då är allt här en no-op).
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
  /** Bildvektorns topp-5 (inlärd modell, sedan 2026-10-08) — oberoende av geometrin. */
  embTop?: string[];
  /** Geometrin räckte inte (< EMB_FALLBACK_INLIERS) och bildvektorns etta blev svaret. */
  embDecided?: boolean;
  /** Satt av `pickByLocalNumber` (vår sida, inte motorn): ettan före telefonens nummer bytte den. */
  numberSwapFrom?: string;
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
  /** Bildvektorns topp-5 — så modellen kan mätas ENSAM mot facit, inte bara via `best`. */
  emb?: string[];
  /** `best` kom från bildvektorn (för lite geometri), inte från motorns verifiering. */
  embDecided?: true;
  err?: string;
  /** Motorns svar VAR det som visades (motorläge) — inte bara en skugga. */
  primary?: true;
  /** Telefonens lästa nummer bytte ettan mot ett namnsyskon i topp-5 — kortet motorn först valde. */
  numSwap?: string;
}

/**
 * TELEFONENS NUMMER AVGÖR MELLAN NAMNSYSKON (2026-10-14). Motorn matchar på konsten, och samma konst
 * finns ofta på flera kort med samma namn — engelska och japanska trycket, omtryck. Läste appen ett
 * samlarnummer (`localNumber.num`, on-device) som INTE är ettans men är ett namnsyskons i topp-5, blir
 * syskonet ettan.
 *
 * MÄTT på 14 dygns skuggsvar mot användarnas val (n=2 100): 49 rättade, 4 förstörda, 82,8 → 85,0 %.
 * ⛔ Bara SAMMA NAMN (" (JP)" bortskalat): numret ensamt över hela topp-5 gav 55/6, och dagens skanners
 * "lokala numret väljer bland bildens topp-15" gav 1 rättad mot 4 förstörda (rules/scanner.md).
 * ⛔ Sessionens språkhint mättes samtidigt och är INTE med: 45 rättade mot 54 förstörda.
 *
 * Byter bara kort-id mellan platserna — inlier-talen står kvar på sina platser, för konsten (det
 * inliers mäter) är densamma och motorlägets säkerhetsgrind ska inte falla av ett språkbyte.
 */
export function pickByLocalNumber(
  res: EngineResponse,
  localNum: number | null | undefined,
  cards: Map<string, { name: string; number: string }>
): EngineResponse {
  const list = res.candidates ?? [];
  if (localNum == null || !list.length) return res;
  const bestId = res.best ?? list[0].cardId;
  const best = cards.get(bestId);
  if (!best || numberInt(best.number) === localNum) return res;
  const i = list.slice(0, 5).findIndex((c) => {
    const card = cards.get(c.cardId);
    return c.cardId !== bestId && !!card && baseName(card.name) === baseName(best.name) && numberInt(card.number) === localNum;
  });
  if (i < 0) return res;
  const winner = list[i].cardId;
  const bi = list.findIndex((c) => c.cardId === bestId);
  const swapped = list.map((c, k) =>
    k === i ? { ...c, cardId: bi >= 0 ? bestId : c.cardId } : k === bi ? { ...c, cardId: winner } : c
  );
  return { ...res, best: winner, candidates: swapped, numberSwapFrom: bestId };
}

function baseName(name: string): string {
  return name.replace(/\s*\(JP\)\s*$/i, "").trim().toLowerCase();
}

/** Första sifferföljden i kortets nummer ("TG07" → 7, "SWSH034" → 34) — samma form som appens `num`. */
function numberInt(n: string): number | null {
  const m = n.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** `pickByLocalNumber` med topp-5:s namn/nummer ur katalogen (≤ 5 rader på primärnyckel). */
export async function applyLocalNumber(res: EngineResponse, localNum: number | null | undefined): Promise<EngineResponse> {
  if (localNum == null || res.error || !res.candidates?.length) return res;
  const ids = res.candidates.slice(0, 5).map((c) => c.cardId);
  if (res.best && !ids.includes(res.best)) ids.push(res.best);
  try {
    const rows = await prisma.card.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, number: true } });
    return pickByLocalNumber(res, localNum, new Map(rows.map((r) => [r.id, r])));
  } catch (e) {
    console.warn("[engine] nummerkontrollen hoppades över:", (e as Error).message);
    return res;
  }
}

export function engineShadowEnabled(): boolean {
  return !!process.env.SCANNER_ENGINE_URL?.trim() && !!process.env.SCANNER_ENGINE_SECRET?.trim();
}

/** Visas motorns svar för den här användaren? Bara admin, bara när spaken står på. */
export function engineModeFor(role: string | null | undefined): boolean {
  if (!engineShadowEnabled()) return false;
  const mode = (process.env.SCANNER_ENGINE_PRIMARY ?? "").trim();
  if (mode === "all") return true;
  return mode === "admin" && (role === "ADMIN" || role === "SUPERADMIN");
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
    ...(res.embTop?.length ? { emb: res.embTop.slice(0, 5) } : {}),
    ...(res.embDecided ? { embDecided: true as const } : {}),
    ...(res.numberSwapFrom ? { numSwap: res.numberSwapFrom } : {}),
    ...(res.reason ? { err: res.reason } : {}),
  };
}

function engineUrl(path: string): string {
  return `${process.env.SCANNER_ENGINE_URL!.trim().replace(/\/$/, "")}${path}`;
}

function jpegBytes(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

/**
 * Fråga motorn om en fångst. Returnerar svaret, eller `{ error }` vid fel — aldrig ett kast.
 *
 * ⛔ MOTORN SOVER MELLAN PASSEN (serverless): första anropet väcker den, men anslutningen nekas
 * medan containern startar — mätt 2026-09-30 blev första skanningen i passet "unreachable".
 * Nätverksfel försöks därför om efter 3 och 8 s; HTTP-fel och timeout aldrig.
 */
export async function callEngine(imageDataUrl: string): Promise<EngineResponse> {
  if (!engineShadowEnabled()) return { error: "disabled" };
  const body = jpegBytes(imageDataUrl);
  if (!body) return { error: "bad-image" };
  let last: EngineResponse = { error: "unreachable" };
  for (const waitMs of [0, 3000, 8000]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    try {
      const res = await fetch(engineUrl("/identify"), {
        method: "POST",
        headers: { "content-type": "image/jpeg", "x-engine-secret": process.env.SCANNER_ENGINE_SECRET!.trim() },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return res.ok ? ((await res.json()) as EngineResponse) : { error: `http-${res.status}` };
    } catch (e) {
      last = { error: (e as Error).name === "TimeoutError" ? "timeout" : "unreachable" };
      if (last.error === "timeout") return last;
    }
  }
  return last;
}

/** Väck motorn i förväg (skannern öppnades) så första kortet slipper kallstarten. Returnerar direkt. */
export function wakeEngine(): void {
  if (!engineShadowEnabled()) return;
  void fetch(engineUrl("/health"), { signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
}

/** Bokför motorns svar på jobbet (atomisk jsonb-merge, se filhuvudet). */
export async function recordShadow(jobId: string, record: ShadowRecord): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ScannerJob"
    SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('shadow', ${JSON.stringify(record)}::jsonb)
    WHERE id = ${jobId}`.catch((e) => console.warn("[engine-shadow] kunde inte bokföra:", (e as Error).message));
}

/** Skicka fångsten till motorn och bokför svaret på jobbet. Returnerar direkt. */
export function runEngineShadow(jobId: string, imageDataUrl: string, localNum?: number | null): void {
  if (!engineShadowEnabled()) return;
  void (async () => {
    const res = await applyLocalNumber(await callEngine(imageDataUrl), localNum);
    await recordShadow(jobId, res.error ? shadowRecord(null, res.error) : shadowRecord(res));
  })();
}
