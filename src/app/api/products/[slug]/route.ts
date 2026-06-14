import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { getProductBySlug } from "@/services/products";
import { trackEvent } from "@/services/analytics";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ slug: z.string().min(1) });

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = paramsSchema.parse(params);
    const product = await getProductBySlug(slug);

    await prisma.product.update({
      where: { id: product.id },
      data: { viewCount: { increment: 1 } },
    });
    await trackEvent("product_view", product.id);

    return jsonOk(product);
  } catch (e) {
    return apiError(e);
  }
}
