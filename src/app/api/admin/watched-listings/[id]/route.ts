/**
 * Admin: slå av/på eller radera en bevakad länk. Se ../route.ts för vad de är.
 *
 * ⛔ AV ÄR NORMALVÄGEN, RADERA ÄR STÄDNING. `isActive: false` slutar kosta en request
 * per tick och behåller raden med sitt senaste svar — det är svaret man läser för att
 * förstå VARFÖR bevakningen inte gav något. En raderad rad tar den kunskapen med sig,
 * och nästa person lägger in samma URL igen och gör om samma upptäckt.
 *
 * ⛔ Att ta bort en bevakning tar ALDRIG bort produkten, offern eller huvudboksraden
 * den hann skapa. Bevakningen är upptäckten, inte ägandet — samma skäl som att en
 * borttagen kollektion hos butiken inte raderar det vi redan lärt oss.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await requireRole("ADMIN");
    const input = patchSchema.parse(await req.json());

    const existing = await prisma.watchedListing.findUnique({
      where: { id: params.id },
      select: { id: true, url: true },
    });
    if (!existing) throw new ServiceError(404, "Bevakningen hittades inte.");

    const item = await prisma.watchedListing.update({
      where: { id: params.id },
      data: {
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
      include: { retailer: { select: { name: true } } },
    });

    await writeAuditLog({
      userId: admin.id,
      action: "watchedListing.update",
      entityType: "WatchedListing",
      entityId: item.id,
      metadata: { url: item.url, isActive: item.isActive },
    });

    return jsonOk({ item });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await requireRole("ADMIN");

    const existing = await prisma.watchedListing.findUnique({
      where: { id: params.id },
      select: { id: true, url: true, retailer: { select: { name: true } } },
    });
    if (!existing) throw new ServiceError(404, "Bevakningen hittades inte.");

    await prisma.watchedListing.delete({ where: { id: params.id } });

    await writeAuditLog({
      userId: admin.id,
      action: "watchedListing.delete",
      entityType: "WatchedListing",
      entityId: existing.id,
      metadata: { retailer: existing.retailer.name, url: existing.url },
    });

    return jsonOk({ deleted: true });
  } catch (e) {
    return apiError(e);
  }
}
