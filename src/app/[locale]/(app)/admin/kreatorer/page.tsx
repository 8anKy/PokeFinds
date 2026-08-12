import { auth, hasRole } from "@/lib/auth";
import { getCreatorCodeStats } from "@/services/creator-codes";
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
export default async function AdminCreatorCodesPage() {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const rows = await getCreatorCodeStats();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.foilio.se";

  return <CreatorCodesClient rows={rows} appUrl={appUrl} />;
}
