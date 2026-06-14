/**
 * Tester för CSV-export/-import i src/services/collection.ts.
 * Prisma mockas — vi testar formatet och radvalideringen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const collectionFindMany = vi.fn();
const collectionCreate = vi.fn();
const cardFindMany = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    collectionItem: {
      findMany: (...args: unknown[]) => collectionFindMany(...args),
      create: (...args: unknown[]) => collectionCreate(...args),
    },
    card: { findMany: (...args: unknown[]) => cardFindMany(...args) },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

import { exportCollectionCsv, importCollectionRows } from "@/services/collection";

beforeEach(() => {
  collectionFindMany.mockReset();
  collectionCreate.mockReset().mockImplementation((args: unknown) => args);
  cardFindMany.mockReset().mockResolvedValue([]);
  transaction.mockReset().mockResolvedValue([]);
});

function stubItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    quantity: 1,
    condition: "NEAR_MINT",
    language: "EN",
    purchasePrice: null,
    purchaseDate: null,
    estimatedValue: null,
    gradingCompany: null,
    grade: null,
    notes: null,
    card: null,
    product: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("exportCollectionCsv", () => {
  it("returnerar enbart header för tom samling", async () => {
    collectionFindMany.mockResolvedValue([]);
    const csv = await exportCollectionCsv("user-1");
    expect(csv).toBe(
      "name,quantity,condition,language,purchasePrice,purchaseDate,estimatedValue,gradingCompany,grade,notes"
    );
  });

  it("exporterar rader med priser i öre och datum som YYYY-MM-DD", async () => {
    collectionFindMany.mockResolvedValue([
      stubItem({
        card: { name: "Pikachu" },
        quantity: 2,
        condition: "MINT",
        language: "SV",
        purchasePrice: 12500,
        purchaseDate: new Date("2025-02-01T10:00:00Z"),
        estimatedValue: 20000,
        gradingCompany: "PSA",
        grade: "10",
      }),
    ]);

    const csv = await exportCollectionCsv("user-1");
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("Pikachu,2,MINT,SV,12500,2025-02-01,20000,PSA,10,");
  });

  it("escapar fält med kommatecken och citattecken", async () => {
    collectionFindMany.mockResolvedValue([
      stubItem({
        card: { name: 'Mew, the "best" card' },
        notes: "rad1\nrad2",
      }),
    ]);

    const csv = await exportCollectionCsv("user-1");
    const dataLine = csv.split("\n").slice(1).join("\n");
    expect(dataLine).toContain('"Mew, the ""best"" card"');
    expect(dataLine).toContain('"rad1\nrad2"');
  });

  it("använder produkttitel när kort saknas", async () => {
    collectionFindMany.mockResolvedValue([
      stubItem({ product: { title: "Booster Box" } }),
    ]);
    const csv = await exportCollectionCsv("user-1");
    expect(csv.split("\n")[1].startsWith("Booster Box,")).toBe(true);
  });
});

describe("importCollectionRows", () => {
  it("importerar giltiga rader", async () => {
    const result = await importCollectionRows("user-1", [
      { name: "Pikachu", quantity: "2", condition: "MINT", language: "EN" },
      { name: "Charizard" },
    ]);

    expect(result.imported).toBe(2);
    expect(result.errors).toEqual([]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(collectionCreate).toHaveBeenCalledTimes(2);
    const first = collectionCreate.mock.calls[0][0] as {
      data: { quantity: number; condition: string };
    };
    expect(first.data.quantity).toBe(2); // coerce sträng → tal
    expect(first.data.condition).toBe("MINT");
  });

  it("avvisar rader utan namn med radnummer i felet", async () => {
    const result = await importCollectionRows("user-1", [
      { name: "" },
      { name: "Pikachu" },
    ]);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(1);
    expect(result.errors[0].message).toContain("name");
  });

  it("avvisar ogiltig condition och negativa priser", async () => {
    const result = await importCollectionRows("user-1", [
      { name: "A", condition: "TRASIG" },
      { name: "B", purchasePrice: -5 },
    ]);

    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("matchar kort på namn (skiftlägesokänsligt)", async () => {
    cardFindMany.mockResolvedValue([{ id: "card-9", name: "Pikachu" }]);

    await importCollectionRows("user-1", [{ name: "pikachu" }]);

    const call = collectionCreate.mock.calls[0][0] as { data: { cardId?: string } };
    expect(call.data.cardId).toBe("card-9");
  });

  it("returnerar tomt resultat utan databasanrop när alla rader är ogiltiga", async () => {
    const result = await importCollectionRows("user-1", [{}, { quantity: 3 }]);
    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(cardFindMany).not.toHaveBeenCalled();
  });
});
