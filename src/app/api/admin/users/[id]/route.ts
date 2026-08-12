import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { hasRole, requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { syncDiscordRoles } from "@/services/discord-sync";
import { bonusUntilFromDateInput } from "@/lib/plan";
import { PlanTier, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  role: z.nativeEnum(Role).optional(), // kräver SUPERADMIN
  planTier: z.nativeEnum(PlanTier).optional(),
  isPublicCollection: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
  /**
   * Gratis Pro t.o.m. detta datum (YYYY-MM-DD), eller null för att ta bort.
   *
   * ⛔ DET HÄR ÄR RÄTT SPAK FÖR EN GÅVA — INTE `planTier`. planTier ÄGS av
   * RevenueCat-webhooken, vars EXPIRATION sätter FREE OVILLKORLIGT: en Pro som
   * satts för hand här hade kunnat nollas tyst av en orelaterad app-prenumeration.
   * `planTier: PREMIUM` BLOCKERAR dessutom Stripe-kassan ("Du har redan Pro via
   * appen"), så mottagaren aldrig kunnat teckna ett riktigt abonnemang efteråt.
   * bonusProUntil är en av de fyra oberoende Pro-källorna i isPro() och löper ut
   * av sig själv. Se lib/plan.ts.
   */
  bonusProUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum måste vara YYYY-MM-DD.")
    .nullable()
    .optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole("ADMIN");
    const input = updateSchema.parse(await req.json());

    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true },
    });
    if (!target) throw new ServiceError(404, "Användaren hittades inte.");

    // Rolländringar kräver SUPERADMIN
    if (input.role !== undefined && input.role !== target.role) {
      if (!hasRole(admin.role, "SUPERADMIN")) {
        throw new ServiceError(403, "Endast superadmin kan ändra roller.");
      }
      if (target.id === admin.id) {
        throw new ServiceError(400, "Du kan inte ändra din egen roll.");
      }
    }

    // Datumet gäller HELA den valda dagen — se bonusUntilFromDateInput() i lib/plan.ts
    // för varför (och varför det är UTC). Testat i tests/unit/plan.test.ts.
    const { bonusProUntil, ...rest } = input;
    const data = {
      ...rest,
      ...(bonusProUntil === undefined
        ? {}
        : {
            bonusProUntil:
              bonusProUntil === null ? null : bonusUntilFromDateInput(bonusProUntil),
          }),
    };

    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        planTier: true,
        bonusProUntil: true,
        isPublicCollection: true,
        onboardingCompleted: true,
      },
    });

    await writeAuditLog({
      userId: admin.id,
      action: "user.update",
      entityType: "User",
      entityId: params.id,
      metadata: { changes: input },
    });

    // Discord-rollen följer planen. Admin-panelen är den FJÄRDE vägen Pro kan
    // ändras (utöver länkning, Stripe och RevenueCat) och glömdes när kopplingen
    // byggdes: en Pro som satts härifrån syntes inte i Discord förrän nattens
    // avstämning. `role` räknas med — ADMIN/SUPERADMIN ÄR Pro enligt isPro().
    // ⛔ Skickar id:t, inte `updated`: den selecten saknar bonusProUntil och
    // stripeProUntil, och isPro() på en ofullständig form failar ÖPPET.
    // ⛔ `bonusProUntil` MÅSTE räknas med här. Den är en av de fyra Pro-källorna i
    // isPro(), så en gåva som sätts eller dras tillbaka ändrar Pro-status precis som
    // planTier gör — utan den här grenen syns den inte i Discord förrän nattens
    // avstämning, och en återkallad roll hade legat kvar ett dygn.
    if (
      input.planTier !== undefined ||
      input.role !== undefined ||
      input.bonusProUntil !== undefined
    ) {
      await syncDiscordRoles(params.id, "Foilio: planen ändrades i adminpanelen");
    }

    return jsonOk(updated);
  } catch (e) {
    return apiError(e);
  }
}
