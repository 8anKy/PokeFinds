import { cookies } from "next/headers";
import { decode, type JWT } from "next-auth/jwt";
import { auth } from "@/lib/auth";
import { isPro } from "@/lib/plan";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

/**
 * SESSIONEN UR COOKIEN, UTAN DATABAS (2026-09-28).
 *
 * `auth()` kör NextAuths jwt-callback, som läser om användaren ur Neon när token är
 * äldre än TOKEN_REFRESH_MS (30 min). I en server-komponent kan den nya token inte
 * skrivas tillbaka (ingen `res`), så efter 30 min gör VARJE server-render en DB-läsning
 * — och vid appstart är token nästan alltid så gammal. Mer-fliken väntade därför på att
 * Neon vaknade (p99 2–3 s i Railways mätning) innan första pixeln.
 *
 * Här dekrypteras bara cookien: namn, roll och plan som de stod när token utfärdades.
 * ⛔ Bara för det som RITAS FÖRST (skal, namn, Pro-märket). En behörighetsdom som ska
 *    vara färsk — Pro-grindar, adminrättigheter på servern — tar fortfarande `auth()`.
 * Chunkad cookie (> 4 kB, teoretiskt) eller ogiltig token ⇒ faller tillbaka på `auth()`.
 */
export interface LiteSession {
  id: string;
  name: string | null;
  role: string;
  email: string | null;
  isPro: boolean;
}

export async function readSessionLite(): Promise<LiteSession | null> {
  const jar = cookies();
  let sawCookie = false;
  for (const name of SESSION_COOKIE_NAMES) {
    if (jar.get(`${name}.0`)) sawCookie = true;
    const value = jar.get(name)?.value;
    if (!value) continue;
    sawCookie = true;
    let token: JWT | null = null;
    try {
      token = await decode({ token: value, secret: process.env.NEXTAUTH_SECRET ?? "" });
    } catch {
      token = null;
    }
    if (token && typeof token.id === "string") {
      return {
        id: token.id,
        name: typeof token.name === "string" ? token.name : null,
        role: typeof token.role === "string" ? token.role : "USER",
        email: typeof token.email === "string" ? token.email : null,
        isPro: isPro({
          planTier: token.planTier,
          role: token.role,
          bonusProUntil: token.bonusProUntil,
          stripeProUntil: token.stripeProUntil,
        }),
      };
    }
  }
  if (!sawCookie) return null;
  // Något fanns men gick inte att läsa snabbt — den långsamma vägen svarar rätt.
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? null,
    role: session.user.role,
    email: session.user.email ?? null,
    isPro: session.user.isPro,
  };
}
