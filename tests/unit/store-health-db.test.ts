import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  healthAckKey,
  loadHealthAckKeys,
  replaceHealthSection,
  storeHealthDbEnabled,
} from "@/lib/store-health-findings";
import type { PrismaClient } from "@prisma/client";

/**
 * Hälsokolls-speglingen (2026-08-31): store-health-fynden skrivs till
 * StoreHealthFinding så att /admin/halsokoll visar samma backlog som Actions-loggen
 * (som varit röd tre måndagar i rad utan att någon såg det i admin).
 *
 * Två kontrakt vaktas:
 *  1. Skrivningen gatas på STORE_HEALTH_DB=1 — rapportskripten är LÄS-ONLY av
 *     kontrakt vid lokala körningar (audit-links utan --prune "skriver INGENTING").
 *  2. Workflowen MÅSTE sätta variabeln — annars förblir adminvyn tyst tom och
 *     hela poängen med speglingen försvinner, utan att någon körning blir röd.
 */

function mockPrisma() {
  const deleteMany = vi.fn().mockReturnValue("del");
  const createMany = vi.fn().mockReturnValue("create");
  const $transaction = vi.fn().mockResolvedValue([]);
  return {
    prisma: { storeHealthFinding: { deleteMany, createMany }, $transaction } as unknown as PrismaClient,
    deleteMany,
    createMany,
    $transaction,
  };
}

afterEach(() => {
  delete process.env.STORE_HEALTH_DB;
});

describe("replaceHealthSection", () => {
  it("skriver INGENTING utan STORE_HEALTH_DB=1 (läs-only-kontraktet)", async () => {
    const { prisma, $transaction } = mockPrisma();
    await replaceHealthSection(prisma, "UNDERPRICE", [
      { severity: "DEFINITE", title: "x" },
    ]);
    expect($transaction).not.toHaveBeenCalled();
    expect(storeHealthDbEnabled()).toBe(false);
  });

  it("ersätter sektionen i EN transaktion när flaggan är satt", async () => {
    process.env.STORE_HEALTH_DB = "1";
    const { prisma, deleteMany, createMany, $transaction } = mockPrisma();
    await replaceHealthSection(prisma, "UNDERPRICE", [
      { severity: "DEFINITE", title: "Surfing Pikachu", offerId: "o1", retailer: "Tradera" },
    ]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { section: "UNDERPRICE" } });
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ section: "UNDERPRICE", severity: "DEFINITE", offerId: "o1" });
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("skriver en TOM sektion också — det är så 'fixat' blir synligt i admin", async () => {
    process.env.STORE_HEALTH_DB = "1";
    const { prisma, deleteMany, createMany, $transaction } = mockPrisma();
    await replaceHealthSection(prisma, "STORE_ADAPTER", []);
    expect(deleteMany).toHaveBeenCalledWith({ where: { section: "STORE_ADAPTER" } });
    expect(createMany).not.toHaveBeenCalled();
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("kapar till 400 rader — adminvyn är en arbetslista, inte en dump", async () => {
    process.env.STORE_HEALTH_DB = "1";
    const { prisma, createMany } = mockPrisma();
    const rows = Array.from({ length: 500 }, (_, i) => ({
      severity: "REVIEW" as const,
      title: `fynd ${i}`,
    }));
    await replaceHealthSection(prisma, "LINK_REVIEW", rows);
    expect(createMany.mock.calls[0][0].data).toHaveLength(400);
  });

  it("sväljer DB-fel (best-effort) — exit-koden är larmet, inte speglingen", async () => {
    process.env.STORE_HEALTH_DB = "1";
    const { prisma, $transaction } = mockPrisma();
    $transaction.mockRejectedValueOnce(new Error("Neon nere"));
    await expect(
      replaceHealthSection(prisma, "UNDERPRICE", [{ severity: "DEFINITE", title: "x" }])
    ).resolves.toBeUndefined();
  });
});

describe("healthAckKey (kvittering av korrekta fynd)", () => {
  it("är stabil över veckans omskrivningar: offer-id när det finns, annars titeln", () => {
    expect(healthAckKey("UNDERPRICE", { offerId: "o1", title: "X" })).toBe("UNDERPRICE:o1");
    expect(healthAckKey("GTIN_CONFLICT", { offerId: null, title: "Lillie PTC" })).toBe(
      "GTIN_CONFLICT:Lillie PTC"
    );
  });

  it("inkluderar SEKTIONEN — ett kvitterat granska-fynd som senare dör återuppstår", () => {
    const asReview = healthAckKey("LINK_REVIEW", { offerId: "o1", title: "X" });
    const asDefinite = healthAckKey("LINK_DEFINITE", { offerId: "o1", title: "X" });
    expect(asReview).not.toBe(asDefinite);
  });
});

describe("loadHealthAckKeys", () => {
  it("failar ÖPPET (tom mängd) mot en databas utan tabellen — rapporten ska ändå köra", async () => {
    const prisma = {
      storeHealthAck: { findMany: vi.fn().mockRejectedValue(new Error("relation does not exist")) },
    } as unknown as PrismaClient;
    await expect(loadHealthAckKeys(prisma)).resolves.toEqual(new Set());
  });

  it("returnerar nycklarna som mängd", async () => {
    const prisma = {
      storeHealthAck: { findMany: vi.fn().mockResolvedValue([{ key: "UNDERPRICE:o1" }]) },
    } as unknown as PrismaClient;
    await expect(loadHealthAckKeys(prisma)).resolves.toEqual(new Set(["UNDERPRICE:o1"]));
  });
});

describe("store-health.yml", () => {
  const yml = readFileSync(
    resolve(__dirname, "../../.github/workflows/store-health.yml"),
    "utf8"
  );

  it("sätter STORE_HEALTH_DB=1 så att fynden faktiskt når adminvyn", () => {
    expect(yml).toMatch(/^\s*STORE_HEALTH_DB:\s*"1"\s*$/m);
  });
});
