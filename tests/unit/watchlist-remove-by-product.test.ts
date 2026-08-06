/**
 * Att slå AV en produktbevakning.
 *
 * Klockan i produktkortet känner PRODUKTEN, aldrig bevakningsradens id — därför
 * en egen väg nycklad på produkt. Första versionen (2026-08-06) saknade den helt:
 * klockan kunde bara slås PÅ, och ett tryck på en redan bevakad produkt visade en
 * hänvisning till bevakningslistan i stället för att stänga av. Rapporterat av
 * ägaren samma dag.
 *
 * Ägarskapet är hela poängen med testerna nedan: `deleteMany` med BÅDE userId och
 * productId är det som hindrar att någon raderar någon annans bevakning genom att
 * gissa ett produkt-id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteMany = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    watchlistItem: {
      deleteMany: (...a: unknown[]) => deleteMany(...a),
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

import { listWatchedProductIds, removeWatchlistItemByProduct } from "@/services/watchlist";

beforeEach(() => {
  deleteMany.mockReset().mockResolvedValue({ count: 1 });
  findMany.mockReset().mockResolvedValue([]);
});

describe("removeWatchlistItemByProduct", () => {
  it("raderar på användare OCH produkt", async () => {
    const result = await removeWatchlistItemByProduct("user-1", "prod-1");

    expect(result).toEqual({ deleted: true });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", productId: "prod-1" },
    });
  });

  it("scopar ALLTID på userId — annars raderar ett gissat produkt-id någon annans rad", async () => {
    await removeWatchlistItemByProduct("user-1", "prod-1");

    const where = (deleteMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.userId).toBe("user-1");
  });

  it("kastar 404 när raden inte fanns (redan borttagen i en annan flik)", async () => {
    deleteMany.mockResolvedValue({ count: 0 });

    await expect(removeWatchlistItemByProduct("user-1", "prod-1")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("listWatchedProductIds", () => {
  it("returnerar bara id:n, scopade till användaren", async () => {
    findMany.mockResolvedValue([{ productId: "a" }, { productId: "b" }]);

    const ids = await listWatchedProductIds("user-1");

    expect(ids).toEqual(["a", "b"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { productId: true },
    });
  });

  it("tom lista när inget bevakas — aldrig null", async () => {
    expect(await listWatchedProductIds("user-1")).toEqual([]);
  });
});
