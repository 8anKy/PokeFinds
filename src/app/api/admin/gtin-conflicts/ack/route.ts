import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { currentConflictKeyForProduct } from "@/services/gtin-conflicts";

export const dynamic = "force-dynamic";

/**
 * Admin: KVITTERA (markera OK) en granskad streckkods-konflikt. Sätter
 * `Product.gtinConflictAckKey` till produktens NUVARANDE konfliktnyckel (serversidan
 * räknar om den — klienten kan inte diktera vad som kvitteras). Vyn döljer då konflikten
 * tills en ny avvikande kod ändrar nyckeln. Se src/services/gtin-conflicts.ts.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const { productId } = (await req.json()) as { productId?: string };
    if (!productId) throw new ServiceError(400, "productId krävs.");

    const key = await currentConflictKeyForProduct(productId);
    if (!key) throw new ServiceError(409, "Produkten har ingen aktiv konflikt att kvittera.");

    await prisma.product.update({
      where: { id: productId },
      data: { gtinConflictAckKey: key },
    });
    await writeAuditLog({
      userId: admin.id,
      action: "gtinConflict.ack",
      entityType: "Product",
      entityId: productId,
      metadata: { conflictKey: key },
    });

    return jsonOk({ acked: productId, key });
  } catch (e) {
    return apiError(e);
  }
}
