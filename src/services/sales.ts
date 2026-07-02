import { prisma } from "@/lib/db";

export interface SaleRow {
  id: string;
  name: string;
  setName: string | null;
  imageUrl: string | null;
  condition: string;
  language: string;
  purchasePriceOre: number | null;
  salePriceOre: number;
  soldAt: string; // ISO
}

/** Användarens sålda objekt (nyast först). */
export async function listSales(userId: string): Promise<SaleRow[]> {
  const sales = await prisma.sale.findMany({
    where: { userId },
    orderBy: { soldAt: "desc" },
  });
  return sales.map((s) => ({
    id: s.id,
    name: s.name,
    setName: s.setName,
    imageUrl: s.imageUrl,
    condition: s.condition,
    language: s.language,
    purchasePriceOre: s.purchasePriceOre,
    salePriceOre: s.salePriceOre,
    soldAt: s.soldAt.toISOString(),
  }));
}
