/** Dragningen — egen fil för att `node:crypto` aldrig ska nå klientbunten (lib/giveaway.ts läses av sidan). */
import { createHash } from "node:crypto";

/**
 * Viktad, DETERMINISTISK dragning: samma deltagare + samma seed = samma utfall,
 * så den kan visas i efterhand. Deltagarna sorteras på id (ordningen i frågan
 * får inte påverka), varje runda drar ett tal ur sha256(seed:runda) och plockar
 * ut vinnaren — som sedan inte kan dras igen. Första = vinnaren, resten =
 * reserver i tur och ordning (om vinnaren inte uppfyller kraven).
 */
export function drawWinners<T extends { id: string; tickets: number }>(
  entries: T[],
  seed: string,
  count: number
): T[] {
  let pool = [...entries].filter((e) => e.tickets > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
  const winners: T[] = [];
  for (let round = 0; round < count && pool.length > 0; round++) {
    const total = pool.reduce((n, e) => n + e.tickets, 0);
    const hash = createHash("sha256").update(`${seed}:${round}`).digest("hex");
    const pick = Number(BigInt(`0x${hash}`) % BigInt(total));
    let acc = 0;
    const idx = pool.findIndex((e) => (acc += e.tickets) > pick);
    winners.push(pool[idx]);
    pool = pool.filter((_, i) => i !== idx);
  }
  return winners;
}
