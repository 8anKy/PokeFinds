import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// RevenueCat-event → vad planTier ska bli. null = ignorera (t.ex. CANCELLATION =
// "förnyas inte" men access finns kvar till EXPIRATION fyrar). Se RC webhook-docs.
export function planForEvent(type: string): "PREMIUM" | "FREE" | null {
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "NON_RENEWING_PURCHASE":
    case "SUBSCRIPTION_EXTENDED":
      return "PREMIUM";
    case "EXPIRATION":
      return "FREE";
    default:
      return null;
  }
}

export async function POST(req: Request) {
  // Verifiering = delad hemlig Authorization-header satt i RevenueCat-dashboarden.
  if (req.headers.get("authorization") !== process.env.REVENUECAT_WEBHOOK_AUTH) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event = body?.event;
  const userId: unknown = event?.app_user_id;
  // RC anonyma id:n börjar med $RCAnonymousID — koppla aldrig dem till en user.
  if (typeof userId !== "string" || userId.startsWith("$RCAnonymousID")) {
    return new Response("ok", { status: 200 });
  }

  const plan = planForEvent(String(event?.type));
  if (plan) {
    // updateMany = ingen krasch om id:t inte finns (raderat konto etc).
    await prisma.user.updateMany({ where: { id: userId }, data: { planTier: plan } });
  }
  return new Response("ok", { status: 200 });
}
