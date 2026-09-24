import { auth, hasRole } from "@/lib/auth";
import { getCreatorCodeStats } from "@/services/creator-codes";
import { getStripePromotionRedemptions } from "@/services/admin/stripe-promotion-redemptions";
import { AdminRequired } from "../admin-required";
import { CreatorCodesClient } from "./creator-codes-client";

export const dynamic = "force-dynamic";

/**
 * Kreatörskoder: vad varje betalt TikTok-samarbete faktiskt har levererat.
 *
 * "Konton" är siffran att betala på — den räknar ALLA som skapat konto via
 * kreatörens länk, oavsett om de köpt Pro och oavsett plattform. Pro-kolumnerna
 * är uppföljning, inte utbetalningsunderlag.
 */
export default async function AdminCreatorCodesPage({
  searchParams,
}: {
  searchParams?: { kod?: string; sida?: string };
}) {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const rawPage = Number(searchParams?.sida ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1;
  const query = searchParams?.kod ?? "";
  const [rows, redemptions] = await Promise.all([
    getCreatorCodeStats(),
    getStripePromotionRedemptions(page, query),
  ]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://foilio.se";

  return <CreatorCodesClient rows={rows} redemptions={redemptions} appUrl={appUrl} />;
}
