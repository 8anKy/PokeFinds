import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
process.env.CATALOG_SNAPSHOT_DIR = dir;

const { readSnapshotEntry, shardKey } = await import("@/lib/catalog-snapshot");

const entry = {
  id: "p1",
  slug: "pikachu-test",
  title: "Pikachu",
  category: "SINGLE_CARD",
  language: "EN",
  description: null,
  imageUrl: null,
  set: null,
  facts: null,
  variants: [],
  prices: {
    offers: [],
    stats: { lowestPrice: 1234, lowestPriceStockStatus: "IN_STOCK", highestPrice: 1234, avgPrice: 1234, offerCount: 1 },
    affiliateRetailerIds: [],
    at: "2026-10-07T01:00:00.000Z",
  },
};

beforeAll(() => {
  fs.mkdirSync(path.join(dir, "g1"));
  fs.writeFileSync(
    path.join(dir, "g1", `${shardKey(entry.slug)}.json.gz`),
    gzipSync(JSON.stringify({ [entry.slug]: entry }))
  );
  fs.writeFileSync(path.join(dir, "CURRENT"), "g1");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("katalogsnapshoten", () => {
  it("skärvnyckeln är md5-hex — samma som Postgres left(md5(slug), 2)", () => {
    // Postgres md5() ger samma gemena hex som Node — byggets SQL-indelning och läsaren möts.
    expect(shardKey("abc")).toBe("90"); // md5("abc") = 900150983cd24fb0…
    expect(shardKey(entry.slug)).toMatch(/^[0-9a-f]{2}$/);
  });

  it("hittar en post i den gällande generationen", async () => {
    const e = await readSnapshotEntry(entry.slug);
    expect(e?.prices.stats.lowestPrice).toBe(1234);
  });

  it("saknad post eller saknad snapshot ⇒ null, aldrig ett kast", async () => {
    expect(await readSnapshotEntry("finns-inte")).toBeNull();
    fs.writeFileSync(path.join(dir, "CURRENT"), "g-saknas");
    expect(await readSnapshotEntry(entry.slug)).toBeNull();
  });
});
