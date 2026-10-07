/**
 * KATALOGSNAPSHOTEN — läsdelen (2026-10-07).
 *
 * ⛔ VARFÖR: produktsidan var ett skal UTAN priser för att en crawler-träff inte
 * skulle väcka Neon (se produkter/[slug]/page.tsx). Priset var alltså osynligt för
 * Google: 26 "–" per sida, ingen butikslista, ingen Product-nod — och en sida utan
 * pris rankar inte på "<produkt> pris". Snapshoten löser båda: varje natt (Neon är
 * redan vaken i cardmarket-refresh) skrivs skalet + priserna för varje synlig
 * produkt till Railway-volymen, och sidan läser HÄRIFRÅN. En rendering kostar då
 * en filläsning, aldrig en DB-fråga — och därför tål sidan en kort ISR-TTL igen.
 *
 * ⛔ INGEN `prisma` I DEN HÄR FILEN. Den importeras av sidans rendering; byggdelen
 * (med databasen) bor i services/catalog-snapshot.ts.
 *
 * Layout på volymen:
 *   <dir>/CURRENT              — namnet på den gällande generationen (byts atomiskt)
 *   <dir>/<generation>/<xx>.json.gz — 256 skärvor, nyckel = md5(slug)[0..2]
 * En ny generation byggs bredvid och pekas ut först när den är KOMPLETT — en läsare
 * ser aldrig en halvskriven snapshot.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { ProductShellData } from "@/services/products";

export const SNAPSHOT_SHARDS = 256;

/** En post = skalet MED priser (`prices` alltid satt). */
export type SnapshotEntry = ProductShellData & { prices: NonNullable<ProductShellData["prices"]> };
export type SnapshotShard = Record<string, SnapshotEntry>;

export function snapshotDir(): string {
  if (process.env.CATALOG_SNAPSHOT_DIR) return process.env.CATALOG_SNAPSHOT_DIR;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "catalog-snapshot");
  }
  return path.join(process.cwd(), ".catalog-snapshot");
}

/** Skärvan en slug bor i: två hex-tecken ur md5 ⇒ 256 jämnstora skärvor. */
export function shardKey(slug: string): string {
  return createHash("md5").update(slug).digest("hex").slice(0, 2);
}

/** Processminne: generationens namn (styrs av CURRENT:s mtime) + några skärvor. */
let current: { mtimeMs: number; generation: string } | null = null;
const shardMemo = new Map<string, SnapshotShard>();
const SHARD_MEMO_MAX = 8;

async function currentGeneration(dir: string): Promise<string | null> {
  const file = path.join(dir, "CURRENT");
  try {
    const stat = await fs.stat(file);
    if (current && current.mtimeMs === stat.mtimeMs) return current.generation;
    const generation = (await fs.readFile(file, "utf8")).trim();
    current = { mtimeMs: stat.mtimeMs, generation };
    shardMemo.clear();
    return generation;
  } catch {
    return null;
  }
}

/**
 * Skalet + priserna för en slug, eller `null` (ingen snapshot, produkten saknas i den,
 * eller läsfel). `null` betyder ALDRIG "produkten finns inte" — anroparen faller då
 * tillbaka på den vanliga skal-läsningen.
 */
export async function readSnapshotEntry(slug: string): Promise<SnapshotEntry | null> {
  try {
    const dir = snapshotDir();
    const generation = await currentGeneration(dir);
    if (!generation) return null;
    const file = path.join(dir, generation, `${shardKey(slug)}.json.gz`);
    let shard = shardMemo.get(file);
    if (!shard) {
      shard = JSON.parse(gunzipSync(await fs.readFile(file)).toString("utf8")) as SnapshotShard;
      if (shardMemo.size >= SHARD_MEMO_MAX) shardMemo.delete(shardMemo.keys().next().value as string);
      shardMemo.set(file, shard);
    }
    return shard[slug] ?? null;
  } catch {
    return null;
  }
}
