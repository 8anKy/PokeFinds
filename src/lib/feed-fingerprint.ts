import { createHash } from "node:crypto";
import type { StockStatus } from "@prisma/client";

/**
 * Fingeravtryck av HELA feed-läget (url → lagerstatus). Låter restock-skanningen
 * köras TÄTARE utan mer Neon-compute: oförändrat avtryck = ingen lagerstatus har
 * flippat → DB-fasen hoppas (ren HTTP, Neon sover). Pris ingår INTE (bara stock) så
 * prisruck inte väcker Neon i onödan. En ny URL ändrar avtrycket → väcker + fångas.
 * VIKTIGT: måste ändras när stock ändras, annars missas restocks (grinden fastnar i skip).
 *
 * Ligger i egen fil (node:crypto) och importeras BARA av CLI-wrappern + tester —
 * ALDRIG av runner.ts/restock.ts, som Next buntar via instrumentation (node-builtins
 * går inte att bunta där → byggfel). Se scripts/restock-watch-run.ts.
 */
export function feedFingerprint(items: { url: string; stockStatus: StockStatus }[]): string {
  const lines = items.map((it) => `${it.url}\t${it.stockStatus}`).sort();
  return createHash("sha1").update(lines.join("\n")).digest("hex");
}
