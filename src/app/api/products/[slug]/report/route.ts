import { z } from "zod";
import { ProductReportKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.nativeEnum(ProductReportKind),
  note: z.string().trim().max(500).optional(),
});

/**
 * "Något fel?" på produktsidan — fel som inte hör till en enskild butiksrad (de går till
 * `/api/offers/[id]/report`). Öppen för utloggade av samma skäl som butiksanmälan: vi
 * vill hellre ha signalen än kontot. IP-broms + en öppen anmälan per (produkt, sort,
 * anmälare).
 */
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  try {
    const { ok } = await rateLimit(`product-report:${clientIp(req)}`, 10, 60 * 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många anmälningar. Försök igen senare.");

    const body = schema.parse(await req.json());
    const product = await prisma.product.findUnique({ where: { slug: params.slug }, select: { id: true } });
    if (!product) throw new ServiceError(404, "Produkten hittades inte.");

    const session = await auth();
    const reporterId = session?.user?.id ?? null;

    const existing = await prisma.productReport.findFirst({
      where: { productId: product.id, reporterId, kind: body.kind, status: "OPEN" },
      select: { id: true },
    });
    if (existing) return jsonOk({ reported: true, deduped: true });

    const data = { productId: product.id, kind: body.kind, note: body.note || null };
    try {
      await prisma.productReport.create({ data: { ...data, reporterId } });
    } catch (e) {
      // En JWT kan överleva sitt konto (raderat konto, annan databas) ⇒ FK-fel på reporterId.
      // Signalen är viktigare än avsändaren: spara anmälan anonymt.
      if ((e as { code?: string }).code !== "P2003" || reporterId == null) throw e;
      await prisma.productReport.create({ data: { ...data, reporterId: null } });
    }
    return jsonOk({ reported: true });
  } catch (e) {
    return apiError(e);
  }
}
