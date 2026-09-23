/**
 * "IDAG"-KORTET I SAMLINGEN (ägarbeslut 2026-09-23): hur mycket samlingen rörde sig
 * sedan förra prisdagen, och vilka poster som rörde sig mest — en daglig anledning
 * att öppna appen, eftersom talen byts en gång per dygn när prisjobben kört.
 *
 * Ren funktion (samlingstjänsten matar in poster + deras dagliga snapshots).
 *
 * ⛔ SAMMA METOD SOM VÄRDEGRAFEN: förändringen ankras i postens AKTUELLA värde
 *    (samma tal som "Totalt värde") och trenden används bara för den RELATIVA
 *    rörelsen — värde(igår) = nuvärde × trend(igår)/trend(idag). Två metoder hade
 *    gett ett "Idag"-tal som inte stämmer med grafens sista steg.
 * ⛔ BARA MÄTBART RÄKNAS. En post räknas när den har en snapshot för den senaste
 *    prisdagen OCH dagen före (inget glapp), senaste dagen är färsk (idag eller igår,
 *    UTC), och den ägdes redan dagen före. Annars är dess förändring OKÄND, inte 0.
 *    Ingen mätbar post ⇒ `null` ⇒ kortet visas inte. En gissad rörelse är värre än
 *    ingen.
 */

export interface DailySnap {
  /** `PriceSnapshot.date` — UTC-dygn (`@db.Date`). */
  date: Date;
  avgPrice: number;
}

export interface DailyItem {
  id: string;
  /**
   * Samma vara i flera poster (lots — köpt vid olika tillfällen) ska vara EN rad i
   * listan, inte tre med samma namn. Produkt-/kort-id; utelämnad = postens id.
   */
  groupKey?: string;
  name: string;
  quantity: number;
  /** Aktuellt värde per styck (öre) — samma som samlingens "Totalt värde". */
  current: number;
  /** När posten kom in i samlingen (ms). */
  ownedFrom: number;
  /** Dagliga snapshots, stigande datum. */
  snaps: DailySnap[];
}

export interface DailyMover {
  id: string;
  name: string;
  /** Förändring i öre för HELA posten (styckförändring × antal). */
  deltaOre: number;
}

export interface DailyChange {
  /** Summerad förändring (öre) över de mätbara posterna. */
  deltaOre: number;
  /** Förändring i procent av de mätbara posternas värde förra prisdagen. null = ingen bas. */
  percent: number | null;
  /** De största rörelserna i kronor, upp och ned, störst först (max `MOVER_LIMIT`). */
  movers: DailyMover[];
  /** Antal poster som ingick. */
  measured: number;
}

export const MOVER_LIMIT = 3;
const DAY_MS = 86_400_000;

function utcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function computeDailyChange(items: DailyItem[], now: Date = new Date()): DailyChange | null {
  const today = utcDay(now.getTime());
  let delta = 0;
  let yesterdayTotal = 0;
  let measured = 0;
  const byGroup = new Map<string, DailyMover>();

  for (const item of items) {
    if (item.current <= 0 || item.quantity <= 0 || item.snaps.length < 2) continue;
    const latest = item.snaps[item.snaps.length - 1];
    const prev = item.snaps[item.snaps.length - 2];
    const latestDay = utcDay(latest.date.getTime());
    const prevDay = utcDay(prev.date.getTime());
    if (today - latestDay > DAY_MS) continue; // inaktuell: senaste prisdagen är äldre än igår
    if (latestDay - prevDay !== DAY_MS) continue; // glapp i serien — ingen dygnsförändring
    if (item.ownedFrom > prevDay + DAY_MS - 1) continue; // ägdes inte förra prisdagen
    if (latest.avgPrice <= 0 || prev.avgPrice <= 0) continue;

    const before = Math.round(item.current * (prev.avgPrice / latest.avgPrice));
    const itemDelta = (item.current - before) * item.quantity;
    delta += itemDelta;
    yesterdayTotal += before * item.quantity;
    measured += 1;
    const key = item.groupKey ?? item.id;
    const group = byGroup.get(key);
    if (group) group.deltaOre += itemDelta;
    else byGroup.set(key, { id: item.id, name: item.name, deltaOre: itemDelta });
  }

  if (measured === 0) return null;
  const movers = [...byGroup.values()].filter((m) => m.deltaOre !== 0);
  movers.sort((a, b) => Math.abs(b.deltaOre) - Math.abs(a.deltaOre));
  return {
    deltaOre: delta,
    percent: yesterdayTotal > 0 ? Math.round((delta / yesterdayTotal) * 10000) / 100 : null,
    movers: movers.slice(0, MOVER_LIMIT),
    measured,
  };
}
