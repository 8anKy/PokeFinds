import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonCached } from "@/lib/api";
import { ServiceError } from "@/lib/errors";
import { getPriceHistory } from "@/services/products";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { days } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const product = await prisma.product.findUnique({
      where: { slug: params.slug },
      select: { id: true },
    });
    if (!product) throw new ServiceError(404, "Produkten hittades inte.");

    const history = await getPriceHistory(product.id, days);
    return jsonCached({ days, history }, 600);
  } catch (e) {
    return apiError(e);
  }
}
