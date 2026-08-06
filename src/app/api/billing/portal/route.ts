import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma, withDbRetry } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripes kundportal — säga upp, byta kort, hämta kvitton.
 *
 * Egen route och inte en egenbyggd sida: uppsägning, betalmedel och kvitton är
 * precis det Stripe redan äger. Att bygga om det hade betytt egna flöden för
 * SCA-omautentisering och proration — mycket kod för noll egen produkt.
 * ⛔ Portalen gäller BARA webbköp. Den som köpt via appen hanterar sin
 * prenumeration i App Store (Upgrade.manageSub säger det).
 */
export async function POST() {
  try {
    const sessionUser = await requireUser();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) throw new ServiceError(503, "Betalning är inte färdigkonfigurerad.");

    const user = await withDbRetry(() =>
      prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: { stripeCustomerId: true },
      })
    );
    if (!user?.stripeCustomerId) {
      throw new ServiceError(404, "Du har ingen prenumeration via webben.");
    }

    const portal = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appUrl}/priser`,
      locale: "sv",
    });
    return jsonOk({ url: portal.url });
  } catch (e) {
    return apiError(e);
  }
}
