/** Databasnära vakter för katalogmatchning, atomisk skrivning och ångra. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportDraftRow } from "@/lib/import-rows";
import { parseImportNumber } from "@/lib/import-normalize";
import { VARIANT_REVERSE_HOLO } from "@/lib/print-variant";

const cardSetFindMany = vi.fn();
const cardFindMany = vi.fn();
const productFindMany = vi.fn();
const importFindUnique = vi.fn();
const importFindMany = vi.fn();
const importFindFirst = vi.fn();
const importCreate = vi.fn();
const importUpdate = vi.fn();
const itemCreateMany = vi.fn();
const itemDeleteMany = vi.fn();
const transaction = vi.fn();
const matchProduct = vi.fn();

const tx = {
  collectionImport: {
    findUnique: (...args: unknown[]) => importFindUnique(...args),
    create: (...args: unknown[]) => importCreate(...args),
    update: (...args: unknown[]) => importUpdate(...args),
  },
  collectionItem: {
    createMany: (...args: unknown[]) => itemCreateMany(...args),
    deleteMany: (...args: unknown[]) => itemDeleteMany(...args),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    cardSet: { findMany: (...args: unknown[]) => cardSetFindMany(...args) },
    card: { findMany: (...args: unknown[]) => cardFindMany(...args) },
    product: { findMany: (...args: unknown[]) => productFindMany(...args) },
    collectionImport: {
      findUnique: (...args: unknown[]) => importFindUnique(...args),
      findMany: (...args: unknown[]) => importFindMany(...args),
      findFirst: (...args: unknown[]) => importFindFirst(...args),
      update: (...args: unknown[]) => importUpdate(...args),
    },
    collectionItem: {
      deleteMany: (...args: unknown[]) => itemDeleteMany(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("@/scrapers/matching", () => ({
  matchProduct: (...args: unknown[]) => matchProduct(...args),
}));

import { commitImport, resolveImportRows, undoImport } from "@/services/collection-import";

beforeEach(() => {
  for (const mock of [
    cardSetFindMany, cardFindMany, productFindMany, importFindUnique,
    importFindMany, importFindFirst, importCreate, importUpdate,
    itemCreateMany, itemDeleteMany, transaction, matchProduct,
  ]) mock.mockReset();

  cardSetFindMany.mockResolvedValue([]);
  cardFindMany.mockResolvedValue([]);
  productFindMany.mockResolvedValue([]);
  importUpdate.mockResolvedValue({});
  itemCreateMany.mockResolvedValue({ count: 0 });
  itemDeleteMany.mockResolvedValue({ count: 0 });
  transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
});

function draft(overrides: Partial<ImportDraftRow> = {}): ImportDraftRow {
  return {
    row: 1,
    name: "Pikachu",
    setName: "",
    setCode: "",
    number: parseImportNumber(""),
    quantity: 1,
    condition: "NEAR_MINT",
    language: "EN",
    variantLabel: null,
    purchasePrice: null,
    purchaseDate: null,
    estimatedValue: null,
    gradingCompany: null,
    grade: null,
    notes: null,
    externalId: null,
    slug: null,
    itemType: "Card",
    ...overrides,
  };
}

function card(id: string, setId: string, number: string) {
  return {
    id,
    name: "Pikachu",
    number,
    setId,
    imageUrl: null,
    language: "EN",
    tcgExternalId: null,
    set: {
      name: setId === "set-151" ? "151" : "Base Set",
      releaseDate: new Date(setId === "set-151" ? "2023-09-22" : "1999-01-09"),
    },
  };
}

describe("resolveImportRows", () => {
  it("låter set + nummer avgöra och väljer radens tryckning", async () => {
    cardSetFindMany.mockResolvedValue([
      { id: "set-151", name: "151", externalId: "sv3pt5", language: "EN" },
      { id: "set-base", name: "Base Set", externalId: "base1", language: "EN" },
    ]);
    cardFindMany
      .mockResolvedValueOnce([card("wrong", "set-base", "25"), card("right", "set-151", "25")])
      .mockResolvedValueOnce([card("right", "set-151", "25")]);
    productFindMany.mockResolvedValue([
      { id: "regular", cardId: "right", title: "Pikachu", slug: "regular", imageUrl: null, variantLabel: null, setId: "set-151" },
      { id: "reverse", cardId: "right", title: "Pikachu Reverse", slug: "reverse", imageUrl: null, variantLabel: VARIANT_REVERSE_HOLO, setId: "set-151" },
    ]);

    const [result] = await resolveImportRows([
      draft({ setName: "151", number: parseImportNumber("025/165"), variantLabel: VARIANT_REVERSE_HOLO }),
    ]);

    expect(result.status).toBe("matched");
    expect(result.kind).toBe("setNumber");
    expect(result.match).toMatchObject({ cardId: "right", productId: "reverse" });
  });

  it("returnerar alternativ i stället för att gissa vid ett tvetydigt namn", async () => {
    cardFindMany.mockResolvedValue([
      card("old", "set-base", "58"),
      card("new", "set-151", "25"),
    ]);
    productFindMany.mockResolvedValue([
      { id: "p-old", cardId: "old", title: "Pikachu", slug: "old", imageUrl: null, variantLabel: null, setId: "set-base" },
      { id: "p-new", cardId: "new", title: "Pikachu", slug: "new", imageUrl: null, variantLabel: null, setId: "set-151" },
    ]);

    const [result] = await resolveImportRows([draft()]);

    expect(result.status).toBe("ambiguous");
    expect(result.match).toBeNull();
    expect(result.options.map((x) => x.cardId)).toEqual(["new", "old"]);
  });
});

describe("commitImport och undoImport", () => {
  it("skapar importhuvud och alla poster i samma transaktion", async () => {
    importCreate.mockResolvedValue({
      id: "import-1", userId: "user-1", undoneAt: null,
    });

    const result = await commitImport("user-1", {
      fileName: "samling.csv",
      fingerprint: "abc123",
      source: "generic",
      items: [{
        row: 1,
        name: "Okänt promokort",
        cardId: null,
        productId: null,
        quantity: 2,
        condition: null,
        language: null,
        purchasePrice: 12_500,
        purchaseDate: "2026-01-02T00:00:00.000Z",
        estimatedValue: null,
        gradingCompany: null,
        grade: null,
        notes: "Pärm A",
      }],
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(itemCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        importId: "import-1",
        customTitle: "Okänt promokort",
        quantity: 2,
        purchasePrice: 12_500,
      })],
    });
    expect(importUpdate).toHaveBeenCalledWith({
      where: { id: "import-1" },
      data: { rowCount: { increment: 1 }, matchedCount: { increment: 0 } },
    });
    expect(result).toEqual({ importId: "import-1", imported: 1, matched: 0 });
  });

  it("avbryter innan importhuvudet räknas upp när en post inte kan skrivas", async () => {
    importCreate.mockResolvedValue({ id: "import-1", userId: "user-1", undoneAt: null });
    itemCreateMany.mockRejectedValue(new Error("foreign key"));
    await expect(commitImport("user-1", {
      fileName: "samling.csv",
      fingerprint: "abc123",
      source: "generic",
      items: [{
        row: 1, name: "Pikachu", cardId: "card-1", productId: null, quantity: 1,
        condition: null, language: null, purchasePrice: null, purchaseDate: null,
        estimatedValue: null, gradingCompany: null, grade: null, notes: null,
      }],
    })).rejects.toThrow("foreign key");
    expect(importUpdate).not.toHaveBeenCalled();
  });

  it("ångrar bara den aktuella användarens importerade poster", async () => {
    importFindUnique.mockResolvedValue({ id: "import-1", userId: "user-1", undoneAt: null });
    itemDeleteMany.mockResolvedValue({ count: 37 });

    await expect(undoImport("user-1", "import-1")).resolves.toEqual({ removed: 37 });
    expect(itemDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1", importId: "import-1" } });
    expect(importUpdate).toHaveBeenCalledWith({
      where: { id: "import-1" },
      data: { undoneAt: expect.any(Date) },
    });
  });
});
