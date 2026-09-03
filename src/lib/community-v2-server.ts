import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { communityV2Allowed, communityV2PublicFlag } from "@/lib/community-v2-gate";

/**
 * Serversidans läsning av community-grinden för DYNAMISKA sidor och API-rutter
 * (middleware täcker inte /api). Läser UA ur begäran och rollen ur sessionen.
 *
 * ⛔ Gör sidan dynamisk (`headers()`). Anropa ALDRIG från en ISR-sida — där
 * sköter middleware grinden (omdirigering före cachen), och en ISR-sida som
 * läser headers tappar sin cache och väcker Neon per visning.
 */
export async function communityV2Request(sessionRole?: string | null): Promise<boolean> {
  const ua = headers().get("user-agent");
  let role = sessionRole;
  if (role === undefined) {
    const session = await auth();
    role = session?.user?.role ?? null;
  }
  return communityV2Allowed({ userAgent: ua, role, publicFlag: communityV2PublicFlag() });
}

/** För API-rutter: 404 (inte 403) — funktionen "finns inte" för den som inte ser den. */
export async function assertCommunityV2(sessionRole?: string | null): Promise<void> {
  if (!(await communityV2Request(sessionRole))) {
    throw new ServiceError(404, "Hittades inte.");
  }
}
