import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { welcomeEmail } from "@/emails/templates";
import { CREATOR_REF_COOKIE } from "@/lib/creator-ref";
import { resolveCreatorCode } from "@/services/creator-codes";
import { signupBonusUntil, signupCampaignFromEnv } from "@/lib/signup-campaign";
import type { OAuthProvider } from "@/lib/oauth-id-token";
import { baseDisplayName, uniqueDisplayName } from "@/lib/display-name";

/**
 * Ett Foilio-konto ur en verifierad Google-/Apple-identitet — delad av BÅDA
 * vägarna in (NextAuths webbflöde och appens nativa id_token), så de aldrig kan
 * glida isär i vad ett OAuth-konto får med sig.
 *
 * ⛔ **OAUTH-KONTON FÅR INTE FÖDAS FATTIGARE ÄN FORMULÄRKONTON.** Registrerings-
 * routen ger kreatörsattribution (fo_ref-cookien), kampanjbonus och välkomstmejl.
 * Allt det upprepas här — annars hade en TikTok-värvad som valde "Fortsätt med
 * Google" tyst räknats som organisk och kreatören blivit utan sin utbetalning.
 * (Inbjudningskoden hanteras INTE här: den kräver ett fält i formuläret och
 * finns inte i OAuth-knappen. Medvetet bortfall, inte glömt.)
 *
 * Ordning vid uppslag:
 *   1. providerns `sub` matchar googleId/appleId → befintligt konto, klart.
 *   2. e-posten matchar ett konto → LÄNKA (skriv sub) — bara om leverantören
 *      själv intygar adressen (`email_verified`). Annars kan den som äger en
 *      overifierad Google-adress ta över kontot med samma e-post.
 *   3. annars → nytt konto, fött verifierat (leverantören intygade adressen).
 *
 * `User.name` är case-insensitivt UNIKT (råindex User_name_lower_key) — Googles
 * visningsnamn ("Anna") krockar garanterat. `uniqueDisplayName` deduppar.
 */

export interface OAuthIdentityInput {
  provider: OAuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** Namnförslag: Googles `name`, Apples för-/efternamn (bara första gången). */
  name: string | null;
}

export type OAuthAccountResult =
  | { ok: true; created: boolean; user: OAuthUser }
  | { ok: false; reason: "no-email" | "email-unverified" | "email-taken-unverified" };

export interface OAuthUser {
  id: string;
  email: string;
  name: string;
  role: import("@prisma/client").Role;
  planTier: import("@prisma/client").PlanTier;
  bonusProUntil: Date | null;
  stripeProUntil: Date | null;
  onboardingCompleted: boolean;
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  planTier: true,
  bonusProUntil: true,
  stripeProUntil: true,
  onboardingCompleted: true,
} as const;

const nameTaken = async (candidate: string) =>
  !!(await prisma.user.findFirst({
    where: { name: { equals: candidate, mode: "insensitive" } },
    select: { id: true },
  }));

export async function findOrCreateOAuthUser(input: OAuthIdentityInput): Promise<OAuthAccountResult> {
  const idField = input.provider === "google" ? "googleId" : "appleId";

  const bySubject = await prisma.user.findUnique({
    where: { [idField]: input.subject } as { googleId: string } | { appleId: string },
    select: USER_SELECT,
  });
  if (bySubject) return { ok: true, created: false, user: bySubject };

  if (!input.email) return { ok: false, reason: "no-email" };
  if (!input.emailVerified) return { ok: false, reason: "email-unverified" };
  const email = input.email.toLowerCase().trim();

  const byEmail = await prisma.user.findUnique({ where: { email }, select: USER_SELECT });
  if (byEmail) {
    // Länka: samma person, ny inloggningsväg. Adressen är intygad av leverantören
    // och kontot behåller allt (lösenordet fungerar fortfarande parallellt).
    await prisma.user.update({ where: { id: byEmail.id }, data: { [idField]: input.subject } });
    return { ok: true, created: false, user: byEmail };
  }

  const name = await uniqueDisplayName(baseDisplayName(input.name, email), nameTaken);

  // Kreatörsattribution ur cookien middleware satte — server-side, aldrig ur
  // klientens body (se api/auth/register). `cookies()` finns i route-handler-
  // kontexten NextAuth kör i; saknas den (skript, test) ⇒ organiskt konto.
  let creatorCodeId: string | null = null;
  try {
    const raw = (await cookies()).get(CREATOR_REF_COOKIE)?.value;
    creatorCodeId = (await resolveCreatorCode(raw))?.id ?? null;
  } catch {
    creatorCodeId = null;
  }
  const now = new Date();
  const bonusUntil = signupBonusUntil(signupCampaignFromEnv(), now);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: null,
      [idField]: input.subject,
      emailVerifiedAt: now,
      creatorCodeId,
      attributedAt: creatorCodeId ? now : null,
      bonusProUntil: bonusUntil,
    },
    select: USER_SELECT,
  });

  try {
    await sendMail({ to: user.email, ...welcomeEmail(user.name) });
  } catch (e) {
    console.error(`[oauth] Välkomstmejlet till ${user.email} gick inte att skicka:`, e);
  }

  return { ok: true, created: true, user };
}
