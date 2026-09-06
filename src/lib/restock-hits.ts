/**
 * LARM-HITS — Discord-lanens väg till mejl och push (2026-09-06).
 *
 * Discord-lanen (scripts/discord-restock-run.ts) är den enda del av systemet som ser
 * en påfyllning inom sekunder, och den får ALDRIG röra databasen: Neon debiteras per
 * vaken tid och varje väckning köper minst 300 s. Mejl och push gick förut genom en
 * egen 10-minuterslane som höll Neon vaken 18,8 h/dygn — pausad sedan 2026-08-23.
 *
 * I stället skickar lanen en HIT (butik + butiks-URL + vår produkt-slug + övergång)
 * till appens `/api/cron/restock-hit` för varje påfyllning den POSTAR om en produkt
 * vi KÄNNER (rutt i ruttabellen). Appen väcker Neon, slår upp bevakarna, skapar
 * larmen och skickar dem — samma `checkRestockAlerts` + `dispatchPendingAlerts` som
 * alltid. Neon vaknar alltså bara när något faktiskt fyllts på. MÄTT 2026-09-05 ur
 * lanens loggar: 28 inlägg i 12 distinkta 5-minutersfönster på 26 h ≈ 1 h vaken tid
 * som TAK per dygn, mot 18,8 h för den gamla lanen.
 *
 * ⛔ FILEN ÄR DB-FRI OCH FS-FRI MED FLIT: den importeras av BÅDE lanen (som kör med en
 *    avsiktligt död DATABASE_URL) och appen. Domen om VAD som är en påfyllning tas i
 *    lanen, med exakt samma vakter som Discord-inläggen; här bor bara formen, kön och
 *    transporten. En egen dom här hade gett två sanningar om samma lagerstatus.
 * ⛔ BARA RUTTADE URL:er blir hits. En okänd URL har ingen produkt och därmed inga
 *    bevakare; dess första påfyllning når fortfarande Discord, och nattkedjan skapar
 *    produkten (auto-importen) så att NÄSTA påfyllning larmar.
 * ⛔ PRISSÄNKNINGAR ÄR INTE HITS. Ett prisinlägg är ingen påfyllning (varan har stått i
 *    lager hela tiden), och prislarmen är pausade av ett helt annat skäl.
 */
import { z } from "zod";
import type { RestockPost } from "./discord-restock";

export const restockHitSchema = z.object({
  /** Lanens state-nyckel (butik + tab + url). Dedup-nyckel i kön tillsammans med `to`. */
  key: z.string().min(1).max(2200),
  storeName: z.string().min(1).max(120),
  storeUrl: z.string().url().max(2000),
  productSlug: z.string().min(1).max(200),
  priceOre: z.number().int().nullable(),
  /** Lanens "från"-status. Kan vara "ABSENT" (fanns inte i förra feeden) → appen tolkar det som okänt. */
  from: z.string().max(24).nullable(),
  to: z.enum(["IN_STOCK", "PREORDER"]),
  /** När lanen såg övergången, ms. Styr TTL:en i kön. */
  at: z.number().int().nonnegative(),
});
export type RestockHit = z.infer<typeof restockHitSchema>;

/** Kroppen i POST /api/cron/restock-hit. */
export const restockHitBatchSchema = z.object({
  hits: z.array(restockHitSchema).min(1).max(100),
});

/**
 * Hur länge en hit får vänta på appen innan den är inaktuell. Samma tal som larmens
 * cooldown: ett larm om en påfyllning två timmar senare är ett larm om något som
 * redan är slut igen. Kön finns för Railways självomstarter (~10–30 s, 3–5 ggr/dygn)
 * och GitHubs glapp mellan jobb — inte för att spara larm över natten.
 */
export const HIT_TTL_MS = 2 * 3600_000;

/** Appens svar på en hit-batch. Räknare, aldrig kronor (kostnadsdoktrinen). */
export interface RestockHitApplyResult {
  received: number;
  /** Hits som gick att knyta till en produkt hos oss. */
  matched: number;
  /** RestockEvent-rader skrivna (lagerhistoriken på produktsidan). */
  events: number;
  /** Larmrader skapade (en per mottagare). */
  alerts: number;
  skipped: Record<string, number>;
}

export function hitDedupKey(h: Pick<RestockHit, "key" | "to">): string {
  return `${h.key}\t${h.to}`;
}

/**
 * Vilka av lanens inlägg som ska bli hits. Tar `postable` — det lanen faktiskt
 * skickar till Discord efter köpbarhetskollen — så att mejlet aldrig påstår mer än
 * kanalen. ⛔ Oberoende av om Discord KVITTERAR: ett nekat Discord-inlägg (boten
 *    tappade en rättighet) får inte tysta mejlen, det var hela poängen med två lanar.
 */
export function hitsFromPosts(posts: readonly RestockPost[], now: Date): RestockHit[] {
  const out: RestockHit[] = [];
  for (const p of posts) {
    if (!p.productSlug) continue;
    if (p.previousPriceOre != null) continue;
    out.push({
      key: p.key,
      storeName: p.storeName,
      storeUrl: p.storeUrl,
      productSlug: p.productSlug,
      priceOre: p.priceOre,
      from: p.transition?.from ?? null,
      to: p.preorder ? "PREORDER" : "IN_STOCK",
      at: now.getTime(),
    });
  }
  return out;
}

/**
 * Tolkning av den cachade kön. Bor i lib (testbar utan filsystem) av samma skäl som
 * `parseDiscordRestockState`: en fältvis tolkning i scriptet tappade `pending` tyst
 * i två dygn 2026-08-13. Trasiga poster hoppas — en enda korrupt rad ska inte kasta
 * hela kön.
 */
export function parsePendingHits(parsed: unknown): RestockHit[] {
  if (!parsed || typeof parsed !== "object") return [];
  const arr = Array.isArray(parsed) ? parsed : (parsed as { hits?: unknown }).hits;
  if (!Array.isArray(arr)) return [];
  const out: RestockHit[] = [];
  for (const h of arr) {
    const r = restockHitSchema.safeParse(h);
    if (r.success) out.push(r.data);
  }
  return out;
}

/**
 * Ny kö = gammal kö + nya hits, utan dubbletter (samma URL + samma slutstatus ⇒
 * den senaste vinner) och utan inaktuella (äldre än HIT_TTL_MS). Äldst först, så
 * appens cooldown ser händelserna i rätt ordning.
 */
export function mergePendingHits(
  pending: readonly RestockHit[],
  incoming: readonly RestockHit[],
  now: Date
): RestockHit[] {
  const cutoff = now.getTime() - HIT_TTL_MS;
  const byKey = new Map<string, RestockHit>();
  for (const h of [...pending, ...incoming]) {
    if (h.at < cutoff) continue;
    const k = hitDedupKey(h);
    const prev = byKey.get(k);
    if (!prev || h.at >= prev.at) byKey.set(k, h);
  }
  return [...byKey.values()].sort((a, b) => a.at - b.at);
}

/**
 * Ta bort det som levererats ur kön. En hit som köats OM (nyare `at`) medan batchen
 * var i luften ligger kvar — den är en ny övergång, inte den vi nyss skickade.
 */
export function removeDelivered(
  pending: readonly RestockHit[],
  delivered: readonly RestockHit[]
): RestockHit[] {
  const sentAt = new Map(delivered.map((h) => [hitDedupKey(h), h.at]));
  return pending.filter((h) => {
    const at = sentAt.get(hitDedupKey(h));
    return at == null || h.at > at;
  });
}

export interface SendHitsResult {
  ok: boolean;
  /** Appen svarade att restock-larmen är pausade → hitsen är inte värda att spara. */
  paused: boolean;
  /** 4xx: fel hemlighet eller ogiltig kropp — ett omförsök ger samma svar. */
  permanent: boolean;
  status: number;
  detail?: string;
  result?: RestockHitApplyResult;
}

/**
 * Transporten. ⛔ Timeout på 90 s med flit: en sovande Neon tar ~10–30 s att väcka och
 * appen skickar mejlen INNAN den svarar. Anroparen (lanen) väntar aldrig på svaret i
 * sin butiksloop — flushen körs vid sidan av.
 */
export async function sendRestockHits(
  hits: readonly RestockHit[],
  opts: { baseUrl: string; secret: string; timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<SendHitsResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/cron/restock-hit`;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": opts.secret },
      body: JSON.stringify({ hits }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        paused: false,
        permanent: res.status >= 400 && res.status < 500 && res.status !== 429,
        status: res.status,
        detail: text.slice(0, 300),
      };
    }
    let body: { paused?: boolean } & Partial<RestockHitApplyResult> = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // Tomt/ogiltigt svar med 2xx → räkna som levererat utan detaljer.
    }
    const paused = body.paused === true;
    return {
      ok: true,
      paused,
      permanent: false,
      status: res.status,
      result: paused
        ? undefined
        : {
            received: body.received ?? hits.length,
            matched: body.matched ?? 0,
            events: body.events ?? 0,
            alerts: body.alerts ?? 0,
            skipped: body.skipped ?? {},
          },
    };
  } catch (e) {
    return {
      ok: false,
      paused: false,
      permanent: false,
      status: 0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
