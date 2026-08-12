import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";

export const dynamic = "force-dynamic";

/**
 * Admin: radera en kreatörskod.
 *
 * ⛔ **BARA KODER UTAN VÄRVADE KONTON.** `User.creatorCodeId` har `onDelete: SetNull`,
 * så en radering nollar tyst attributionen på varje konto koden värvat — dvs den
 * ENDA kopplingen mellan kreatören och de användare hon levererat, och därmed
 * underlaget du betalar henne på. Det finns ingen väg tillbaka: `User` bär bara
 * FK:n, inte kodsträngen, så ens en manuell återställning är omöjlig efteråt.
 *
 * Raderingsknappen är alltså till för STÄDNING (felstavade koder, testrader), inte
 * för att avsluta ett samarbete. Det senare är `isActive: false`, som stoppar nya
 * attributioner och rabatten men behåller historiken.
 *
 * ⚠️ En kod med 0 konton kan mycket väl vara publicerad ändå (kreatören har lagt
 * upp videon, ingen har registrerat sig än). Raderas den slutar länken attribuera
 * TYST — `?ref=` mot en okänd kod ger ingen varning någonstans, den bara försvinner.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await requireRole("ADMIN");

    const code = await prisma.creatorCode.findUnique({
      where: { id: params.id },
      select: { id: true, code: true, creatorName: true, _count: { select: { users: true } } },
    });
    if (!code) throw new ServiceError(404, "Koden hittades inte.");

    if (code._count.users > 0) {
      throw new ServiceError(
        409,
        `${code.code} har värvat ${code._count.users} konto${
          code._count.users === 1 ? "" : "n"
        } och kan inte raderas — då förlorar du underlaget du betalar ${
          code.creatorName
        } på. Stäng av koden med Aktiv-rutan i stället.`
      );
    }

    await prisma.creatorCode.delete({ where: { id: code.id } });

    await writeAuditLog({
      userId: admin.id,
      action: "creatorCode.delete",
      entityType: "CreatorCode",
      entityId: code.id,
      metadata: { code: code.code, creatorName: code.creatorName },
    });

    return jsonOk({ deleted: code.id });
  } catch (e) {
    return apiError(e);
  }
}
