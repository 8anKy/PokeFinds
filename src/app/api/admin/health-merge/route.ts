import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { recomputeProductPriceCache } from "@/services/products";
import { gtinConflict } from "@/lib/gtin";
import { mergeStubInto, mergeWouldLoseTrackRecord } from "@/jobs/dedupe-stubs";

export const dynamic = "force-dynamic";

const MergeBody = z.object({
  /** Dubblettförslags-raden i /admin/halsokoll — produkterna löses upp på serversidan. */
  findingId: z.string().min(1),
});

/**
 * Admin: MERGA ett dubblettförslag ur hälsokollen — människan är sista instansen.
 *
 * Förslagen är precis de par där LLM:en sa "samma SKU" men ordmängdsvakten protesterade,
 * så de mergas ALDRIG automatiskt (2026-08-17-incidenten: fyra oåterkalleliga fel-merges).
 * Den här knappen ÄR den mänskliga granskningen — men två hårda vakter körs ändå vid
 * utförandet, för de skyddar mot fel människan inte kan se i två titlar:
 *
 *  ⛔ mergeWouldLoseTrackRecord — stubben får inte bära mer meritlista (CM-länk/
 *     prishistorik) än målet; prisgrafen byggs bara framåt och en merge åt fel håll
 *     raderar den FÖR GOTT.
 *  ⛔ gtinConflict — bär båda produkterna olika TILLVERKAR-koder är de bevisat olika
 *     SKU:er, oavsett titlar.
 *
 * Stubben (findings productSlug) mergas IN I målet (findings url = /produkter/<slug>);
 * målet överlever. Fyndraden raderas efter merge så knappen inte kan dubbelklickas.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const { findingId } = MergeBody.parse(await req.json());

    const finding = await prisma.storeHealthFinding.findUnique({ where: { id: findingId } });
    if (!finding) throw new ServiceError(404, "Förslaget hittades inte (ny körning kan ha ersatt listan).");
    if (finding.section !== "DEDUPE_PROPOSAL")
      throw new ServiceError(400, "Bara dubblettförslag kan mergas härifrån.");

    const targetSlug = finding.url?.match(/^\/produkter\/([^/?#]+)$/)?.[1];
    if (!finding.productSlug || !targetSlug)
      throw new ServiceError(400, "Förslaget saknar produktlänkar — kör om veckokörningen.");

    const [stub, target] = await Promise.all([
      prisma.product.findUnique({
        where: { slug: finding.productSlug },
        select: { id: true, title: true, gtin: true },
      }),
      prisma.product.findUnique({
        where: { slug: targetSlug },
        select: { id: true, title: true, gtin: true, slug: true },
      }),
    ]);
    if (!stub || !target)
      throw new ServiceError(404, "En av produkterna finns inte längre (redan mergad/raderad?).");
    if (stub.id === target.id) throw new ServiceError(400, "Stubben och målet är samma produkt.");

    if (gtinConflict(stub.gtin, target.gtin))
      throw new ServiceError(
        409,
        "Produkterna bär OLIKA tillverkar-streckkoder — bevisat olika SKU:er. Mergas inte."
      );
    if (await mergeWouldLoseTrackRecord(stub.id, target.id))
      throw new ServiceError(
        409,
        "Stubben har mer meritlista (Cardmarket-länk/prishistorik) än målet — mergen skulle radera historik för gott. Be Claude granska paret i stället."
      );

    await mergeStubInto(stub.id, target.id);
    await prisma.storeHealthFinding.delete({ where: { id: finding.id } }).catch(() => {});
    await recomputeProductPriceCache();

    await writeAuditLog({
      userId: admin.id,
      action: "healthFinding.merge",
      entityType: "Product",
      entityId: target.id,
      metadata: {
        mergedStubId: stub.id,
        mergedStubTitle: stub.title,
        targetTitle: target.title,
        findingId: finding.id,
      },
    });

    return jsonOk({ merged: stub.id, into: target.id, targetSlug: target.slug });
  } catch (e) {
    return apiError(e);
  }
}
