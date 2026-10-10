/**
 * KATALOGSNAPSHOTEN — byggdelen (2026-10-07). Läsdelen och VARFÖR: lib/catalog-snapshot.ts.
 *
 * Körs av `POST /api/cron/catalog-snapshot`, som steg i cardmarket-refresh.yml efter
 * prisjobbet — Neon är redan vaken där, så bygget köper ingen egen väckning.
 * ⛔ Aldrig egen cron, aldrig per request.
 *
 * Kostnad: ~260 smala frågor (en per skärva + syskon) i ett redan vaket fönster.
 * Minne: EN skärva i taget (~160 produkter), aldrig hela katalogen.
 *
 * ⛔ PRISERNA RÄKNAS MED SAMMA FUNKTIONER SOM DETALJ-PAYLOADEN (`summarizeDirectOffers`,
 * `serializeDirectOffers`, `toShellData`) — en egen kopia hade gett två olika
 * "lägsta pris" på samma sida, det ena i HTML:en och det andra när klienten laddat.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { prisma, withDbRetry } from "@/lib/db";
import { NOT_HIDDEN_SQL } from "@/lib/product-visibility";
import {
  shardKey,
  snapshotDir,
  SNAPSHOT_INDEX_FILE,
  SNAPSHOT_SHARDS,
  type SnapshotIndexEntry,
  type SnapshotShard,
} from "@/lib/catalog-snapshot";
import { loadTraderaSoldStats } from "@/services/tradera-sold-stats";
import {
  SHELL_SELECT,
  serializeDirectOffers,
  summarizeDirectOffers,
  toShellData,
} from "@/services/products";

const SNAPSHOT_SELECT = {
  ...SHELL_SELECT,
  offers: {
    select: {
      id: true,
      price: true,
      shippingPrice: true,
      stockStatus: true,
      url: true,
      retailerId: true,
      retailer: { select: { id: true, name: true, logoUrl: true, websiteUrl: true } },
    },
    // Samma ordning som detaljfrågan (getProductBySlugRaw).
    orderBy: { price: { sort: "asc" as const, nulls: "last" as const } },
  },
};

export interface SnapshotBuildResult {
  generation: string;
  products: number;
  withPrice: number;
  bytes: number;
  ms: number;
}

export async function buildCatalogSnapshot(): Promise<SnapshotBuildResult> {
  const started = Date.now();
  const at = new Date().toISOString();
  const dir = snapshotDir();
  const generation = `g${started}`;
  const genDir = path.join(dir, generation);
  await fs.mkdir(genDir, { recursive: true });

  // Skärvindelningen görs i SQL (md5 är inbyggt) — samma nyckel som `shardKey()`.
  const rows = await withDbRetry(() =>
    prisma.$queryRawUnsafe<{ id: string; s: string }[]>(
      `SELECT id, left(md5(slug), 2) AS s FROM "Product" WHERE ${NOT_HIDDEN_SQL}`
    )
  );
  const idsByShard = new Map<string, string[]>();
  for (const r of rows) {
    const list = idsByShard.get(r.s);
    if (list) list.push(r.id);
    else idsByShard.set(r.s, [r.id]);
  }

  // Butikernas flaggor en gång per bygge (tabellen är liten).
  const now = new Date();
  const retailers = await withDbRetry(() =>
    prisma.retailer.findMany({ select: { id: true, affiliateEnabled: true, sponsoredUntil: true } })
  );
  const affiliateIds = new Set(retailers.filter((r) => r.affiliateEnabled).map((r) => r.id));
  const sponsoredIds = new Set(
    retailers.filter((r) => r.sponsoredUntil && r.sponsoredUntil > now).map((r) => r.id)
  );

  // Sökindexet för /pris (lib/catalog-snapshot.ts) + Tradera sålt, EN fråga per bygge.
  const soldByProduct = await withDbRetry(() => loadTraderaSoldStats());
  const index: SnapshotIndexEntry[] = [];

  let products = 0;
  let withPrice = 0;
  let bytes = 0;
  for (let i = 0; i < SNAPSHOT_SHARDS; i++) {
    const key = i.toString(16).padStart(2, "0");
    const ids = idsByShard.get(key) ?? [];
    const shard: SnapshotShard = {};
    if (ids.length > 0) {
      const batch = await withDbRetry(() =>
        prisma.product.findMany({ where: { id: { in: ids } }, select: SNAPSHOT_SELECT })
      );
      const cardIds = Array.from(new Set(batch.map((p) => p.cardId).filter((c): c is string => !!c)));
      const siblings =
        cardIds.length > 0
          ? await withDbRetry(() =>
              prisma.product.findMany({
                where: { cardId: { in: cardIds } },
                select: { id: true, slug: true, variantLabel: true, cardId: true },
              })
            )
          : [];
      const byCard = new Map<string, typeof siblings>();
      for (const s of siblings) {
        const list = byCard.get(s.cardId!);
        if (list) list.push(s);
        else byCard.set(s.cardId!, [s]);
      }
      for (const p of batch) {
        const { offers, ...shellRow } = p;
        // Vakt: SQL-nyckeln och Node-nyckeln måste vara samma, annars hittar läsaren
        // aldrig posten (md5 över samma UTF-8-bytes — ska aldrig hända).
        if (shardKey(p.slug) !== key) continue;
        const shell = toShellData(
          shellRow,
          (p.cardId ? byCard.get(p.cardId) ?? [] : []).filter((s) => s.id !== p.id)
        );
        const { directOffers, stats } = summarizeDirectOffers(offers);
        shard[p.slug] = {
          ...shell,
          prices: {
            offers: serializeDirectOffers(directOffers, affiliateIds, sponsoredIds),
            stats,
            affiliateRetailerIds: Array.from(new Set(offers.map((o) => o.retailerId))).filter((id) =>
              affiliateIds.has(id)
            ),
            at,
          },
        };
        const sold = soldByProduct.get(p.id);
        index.push({
          s: p.slug,
          t: p.title,
          set: p.set?.name ?? null,
          l: p.language,
          n: p.card?.number ?? null,
          ...(sold ? { sold: [sold.medianOre, sold.count] as [number, number] } : {}),
        });
        products++;
        if (stats.lowestPrice != null) withPrice++;
      }
    }
    const gz = gzipSync(JSON.stringify(shard));
    bytes += gz.length;
    await fs.writeFile(path.join(genDir, `${key}.json.gz`), gz);
  }

  const indexGz = gzipSync(JSON.stringify(index));
  bytes += indexGz.length;
  await fs.writeFile(path.join(genDir, SNAPSHOT_INDEX_FILE), indexGz);

  // Peka ut den nya generationen ATOMISKT, städa sedan bort de gamla.
  const tmp = path.join(dir, `CURRENT.${process.pid}.tmp`);
  await fs.writeFile(tmp, generation, "utf8");
  await fs.rename(tmp, path.join(dir, "CURRENT"));
  for (const name of await fs.readdir(dir)) {
    if (name !== generation && /^g\d+$/.test(name)) {
      await fs.rm(path.join(dir, name), { recursive: true, force: true });
    }
  }

  return { generation, products, withPrice, bytes, ms: Date.now() - started };
}
