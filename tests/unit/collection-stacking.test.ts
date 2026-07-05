/**
 * addCollectionItem ska stacka på en befintlig identisk post istället för att
 * skapa en ny (samma produkt/skick/språk/gradering).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const productFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    collectionItem: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    product: { findUnique: (...a: unknown[]) => productFindUnique(...a) },
  },
}));

import { addCollectionItem } from "@/services/collection";

beforeEach(() => {
  findFirst.mockReset();
  create.mockReset();
  update.mockReset();
  productFindUnique.mockReset().mockResolvedValue({ id: "prod-1" });
});

describe("addCollectionItem stacking", () => {
  it("ökar quantity på befintlig stack istället för att skapa ny", async () => {
    findFirst.mockResolvedValue({ id: "item-1", quantity: 3 });
    await addCollectionItem("user-1", { productId: "prod-1", quantity: 5 });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-1" }, data: { quantity: 8 } })
    );
  });

  it("skapar ny post när ingen matchande stack finns", async () => {
    findFirst.mockResolvedValue(null);
    await addCollectionItem("user-1", { productId: "prod-1" });
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
