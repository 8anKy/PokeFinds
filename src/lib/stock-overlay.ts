/**
 * LAGERÖVERLÄGG FÖR /pris (2026-10-12) — nattens snapshot + lanens senaste lagerbesked.
 *
 * `/pris` läser bara nattens katalogsnapshot (lib/catalog-snapshot.ts), så en butik som
 * sålt slut 13:00 stod kvar "I lager" i svaret till nästa natt — trots att lanen redan
 * sett det och skickat en lagersynk till appen. Varje hit som når `/api/cron/restock-hit`
 * (påfyllning, prissänkning, tyst lagersynk) skrivs därför HÄR, på volymen, innan något
 * annat händer — även när rutten skjuter upp DB-skrivningen (`onlyIfAwake`) eller larmen
 * är pausade. Överlägget är alltså FÄRSKARE än databasen, och kostar noll Neon-tid.
 * ⛔ Bara besked NYARE än snapshoten appliceras; snapshoten vinner annars (den är byggd
 *    ur databasen efter att besket skrevs dit).
 * ⛔ Nyckeln är exakt (butik, URL) — samma som offerns `retailerId_url`. Ingen gissning.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { snapshotDir, type SnapshotEntry } from "./catalog-snapshot";

export interface StockNote {
  /** Lagerstatus lanen såg */
  s: "IN_STOCK" | "PREORDER" | "LIMITED" | "OUT_OF_STOCK";
  /** Pris i öre när lanen hade ett (> 0), annars null = orört */
  p: number | null;
  /** När lanen såg det (ms) */
  at: number;
}
export type StockOverlay = Record<string, StockNote>;

/** Besked äldre än så här är ändå ersatta av en nyare snapshot. */
export const OVERLAY_MAX_AGE_MS = 48 * 3600_000;

export function overlayKey(storeName: string, url: string): string {
  return `${storeName}\t${url}`;
}

export interface OverlayHit {
  storeName: string;
  storeUrl: string;
  to: StockNote["s"];
  priceOre: number | null;
  at: number;
}

/** Nytt överlägg (eller null om inget ändrades): nyaste beskedet per (butik, URL) vinner. */
export function mergeOverlay(prev: StockOverlay, hits: readonly OverlayHit[], now = Date.now()): StockOverlay | null {
  let changed = false;
  const next: StockOverlay = {};
  for (const [k, v] of Object.entries(prev)) {
    if (now - v.at <= OVERLAY_MAX_AGE_MS) next[k] = v;
    else changed = true;
  }
  for (const h of hits) {
    const key = overlayKey(h.storeName, h.storeUrl);
    const cur = next[key];
    if (cur && cur.at >= h.at) continue;
    const note: StockNote = { s: h.to, p: h.priceOre != null && h.priceOre > 0 ? h.priceOre : (cur?.p ?? null), at: h.at };
    if (cur && cur.s === note.s && cur.p === note.p) {
      // Samma besked igen (lanen erbjuder en uppskjuten synk varje minut): tiden flyttas
      // fram så att beskedet överlever en snapshot som byggts innan databasen fick det —
      // men filen skrivs bara om var 10:e minut för det.
      next[key] = { ...cur, at: h.at };
      if (h.at - cur.at > 10 * 60_000) changed = true;
      continue;
    }
    next[key] = note;
    changed = true;
  }
  return changed ? next : null;
}

/**
 * Snapshotens offers med lanens nyare besked pålagda. `updatedAt` = senaste besked som
 * ändrade något (ms), null om inget gjorde det.
 */
export function applyStockOverlay(
  entry: SnapshotEntry,
  overlay: StockOverlay
): { entry: SnapshotEntry; updatedAt: number | null } {
  const since = Date.parse(entry.prices.at);
  let updatedAt: number | null = null;
  const offers = entry.prices.offers.map((o) => {
    const note = overlay[overlayKey(o.retailer.name, o.url)];
    if (!note || (Number.isFinite(since) && note.at <= since)) return o;
    const price = note.p ?? o.price;
    if (note.s === o.stockStatus && price === o.price) return o;
    updatedAt = Math.max(updatedAt ?? 0, note.at);
    return { ...o, stockStatus: note.s, price };
  });
  return updatedAt == null ? { entry, updatedAt } : { entry: { ...entry, prices: { ...entry.prices, offers } }, updatedAt };
}

// ---- Fil på volymen (bredvid snapshotens generationer, som städningen inte rör) ----------

function overlayFile(): string {
  return path.join(snapshotDir(), "stock-overlay.json");
}

let memo: { mtimeMs: number; data: StockOverlay } | null = null;

export async function readStockOverlay(): Promise<StockOverlay> {
  try {
    const file = overlayFile();
    const stat = await fs.stat(file);
    if (memo && memo.mtimeMs === stat.mtimeMs) return memo.data;
    const data = JSON.parse(await fs.readFile(file, "utf8")) as StockOverlay;
    memo = { mtimeMs: stat.mtimeMs, data };
    return data;
  } catch {
    return {};
  }
}

/** En skrivning i taget i processen — läs, slå ihop, byt atomiskt. */
let chain: Promise<void> = Promise.resolve();

export function recordStockOverlay(hits: readonly OverlayHit[]): Promise<void> {
  chain = chain
    .then(async () => {
      const next = mergeOverlay(await readStockOverlay(), hits);
      if (!next) return;
      const file = overlayFile();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(next), "utf8");
      await fs.rename(tmp, file);
    })
    .catch((e) => console.warn("[stock-overlay] kunde inte skriva:", e instanceof Error ? e.message : e));
  return chain;
}
