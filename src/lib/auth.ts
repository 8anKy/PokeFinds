import { type NextAuthOptions, getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { rateLimit, peekRateLimit, clearRateLimit } from "@/lib/rate-limit";
import { isPro } from "@/lib/plan";
import { SESSION_MAX_AGE } from "@/lib/session-cookie";
import type { Role, PlanTier } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      planTier: PlanTier;
      /** Referral-Pro t.o.m. (#10) — med i sessionen så isPro(sessionUser) räknar rätt. */
      bonusProUntil: string | null;
      /** Stripe-prenumeration (webben) t.o.m. — samma skäl som ovan: utan den i
       *  token:en hade isPro(sessionUser) sagt FREE för en betalande webbkund. */
      stripeProUntil: string | null;
      /** Pro-förmåner? = planTier PREMIUM, admin-roll, aktiv referral-bonus
       *  ELLER aktiv Stripe-prenumeration. Grinda features på DENNA, aldrig på
       *  planTier (som en utgången prenumeration nollar). Se lib/plan.ts. */
      isPro: boolean;
      onboardingCompleted: boolean;
    };
  }
  interface User {
    id: string;
    role: Role;
    planTier: PlanTier;
    /** Referral-Pro t.o.m. (#10) — ISO-sträng i JWT:n. */
    bonusProUntil: string | null;
    /** Stripe-Pro t.o.m. — ISO-sträng i JWT:n. */
    stripeProUntil: string | null;
    onboardingCompleted: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    planTier: PlanTier;
    bonusProUntil: string | null;
    stripeProUntil: string | null;
    onboardingCompleted: boolean;
    refreshedAt: number;
  }
}

// Hur ofta en session får läsa om roll/plan/onboarding ur DB. Bounds bara
// OUT-OF-BAND-ändringar (RC-webhook, admin-redigering) — `trigger === "update"`
// nedan läser om DIREKT, så onboarding och allt annat vi själva styr är opåverkat.
//
// ⛔ VAR 5 MINUTER, VILKET ÄR EXAKT NEONS MINSTA DEBITERADE FÖNSTER (300 s).
// Sämsta möjliga värde: jwt-callbacken kör vid varje getServerSession, så en
// aktiv inloggad session beväpnade ett nytt 300-sekundersfönster precis när det
// förra löpte ut → computen hann aldrig somna. Mätt 2026-08-05: ~37 väckningar/
// dygn totalt, och compute är ~95 % av Neon-notan (egress ryms i fribeloppet).
// 30 min = 2 omläsningar/timme i stället för 12, utan att någon funktion väntar.
//
// ⛔ NÄR KÖPFLÖDET WIRE:AS UPP måste det kalla `session.update()` efter ett
// lyckat köp/restore. `src/lib/purchases.ts` har idag INGA anropare, så inget
// köp sker i appen och TTL:n är enda vägen in för webhookens planTier. Den dag
// någon kopplar in `purchasePremium()` utan ett update()-anrop får en betalande
// kund vänta upp till 30 minuter på sitt Pro — utan att något felar.
const TOKEN_REFRESH_MS = 30 * 60 * 1000;

export const authOptions: NextAuthOptions = {
  // ⛔ `maxAge` är ett INAKTIVITETSFÖNSTER, inte en inloggningstid — middleware
  // skriver om cookien med en färsk utgång vid användning (`renewSession`). Utan
  // den förnyelsen var talet en hård utloggning för ALLA: `getServerSession` får
  // ingen `res` i App Router och kan inte sätta cookies, och appen läser aldrig
  // `/api/auth/session`. Talet bor i lib/session-cookie.ts så de två inte kan glida
  // isär — middleware måste skriva samma livslängd som NextAuth utfärdade.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  pages: {
    signIn: "/logga-in",
  },
  providers: [
    CredentialsProvider({
      name: "E-post och lösenord",
      credentials: {
        email: { label: "E-post", type: "email" },
        password: { label: "Lösenord", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.toLowerCase().trim();
        // Broms mot lösenordsgissning: BARA misslyckade försök räknas (lyckad
        // inloggning spärrar aldrig en flitig användare). Blockera efter 10 fel/5 min.
        const failKey = `login-fail:${email}`;
        if ((await peekRateLimit(failKey)) >= 10) return null;
        const user = await prisma.user.findUnique({
          where: { email },
        });
        const valid =
          !!user && (await bcrypt.compare(credentials.password, user.passwordHash));
        if (!valid || !user) {
          await rateLimit(failKey, 10, 5 * 60_000); // räkna upp misslyckandet
          return null;
        }
        await clearRateLimit(failKey); // lyckad → nollställ
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          planTier: user.planTier,
          bonusProUntil: user.bonusProUntil?.toISOString() ?? null,
          stripeProUntil: user.stripeProUntil?.toISOString() ?? null,
          onboardingCompleted: user.onboardingCompleted,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.planTier = user.planTier;
        token.bonusProUntil = user.bonusProUntil;
        token.stripeProUntil = user.stripeProUntil;
        token.onboardingCompleted = user.onboardingCompleted;
        token.refreshedAt = Date.now();
      }
      // Re-läs från DB vid session.update() (t.ex. efter onboarding) ELLER när
      // token är äldre än TTL:n → fångar upp out-of-band ändringar (RC-webhook
      // sätter planTier=PREMIUM, admin-redigering) utan re-login.
      const stale = Date.now() - (token.refreshedAt ?? 0) > TOKEN_REFRESH_MS;
      if ((trigger === "update" || stale) && token.id) {
        const fresh = await prisma.user.findUnique({ where: { id: token.id } });
        if (fresh) {
          token.role = fresh.role;
          token.planTier = fresh.planTier;
          token.bonusProUntil = fresh.bonusProUntil?.toISOString() ?? null;
          token.stripeProUntil = fresh.stripeProUntil?.toISOString() ?? null;
          token.onboardingCompleted = fresh.onboardingCompleted;
          token.refreshedAt = Date.now();
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.planTier = token.planTier;
      session.user.bonusProUntil = token.bonusProUntil ?? null;
      session.user.stripeProUntil = token.stripeProUntil ?? null;
      session.user.isPro = isPro({
        planTier: token.planTier,
        role: token.role,
        bonusProUntil: token.bonusProUntil,
        stripeProUntil: token.stripeProUntil,
      });
      session.user.onboardingCompleted = token.onboardingCompleted;
      return session;
    },
  },
};

export function auth() {
  return getServerSession(authOptions);
}

const ROLE_LEVELS: Record<Role, number> = {
  USER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  SUPERADMIN: 3,
};

export function hasRole(userRole: Role, required: Role): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[required];
}

/** Kasta i API-routes för att kräva inloggning. Returnerar session.user. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new AuthError(401, "Du måste vara inloggad.");
  return session.user;
}

/**
 * Inloggad användare MED plan-fälten färska ur databasen.
 *
 * ⛔ ANVÄND DEN I ALLA ENTITLEMENT-GRINDAR (kvoter och Pro-funktioner), aldrig
 * bara `requireUser()`. `requireUser()` läser SESSIONSTOKEN, och token:en läser
 * bara om planen ur DB var TOKEN_REFRESH_MS (30 min) — eller när klienten
 * råkar kalla `session.update()`. RevenueCat-webhooken skriver planTier=PREMIUM
 * i DATABASEN; telefonens token vet inget om det förrän TTL:n löper ut.
 *
 * MÄTT I DRIFT 2026-08-09 (sandbox-köp i TestFlight): /priser visade "Din
 * nuvarande plan ✓" — den sidan läser DB via `/api/users/me` — medan skannern
 * i SAMMA minut sa "GRATIS · 30 skanningar kvar", för den läste token:en. Alla
 * Pro-funktioner (skanner, bulk, gradering, bevakningstak, set-bevakning) var
 * alltså döda i upp till en halvtimme efter att kunden betalat, utan att något
 * felade. En granskare hos Apple gör exakt det köpet och exakt det testet.
 *
 * ⛔ VÄLJ ALLA FYRA PLAN-FÄLTEN. `isPro()` räknar på formen, och ett fält som
 * inte är valt blir `undefined` → vakten failar ÖPPET. Samma familj som
 * stripeProUntil (2026-08-06) och variantLabel (2026-07-28).
 *
 * KOSTNAD: ett uppslag på PRIMÄRNYCKEL, i vägar som ändå gör DB-arbete
 * (kvoträkning, skrivningar). ⛔ Lägg den ALDRIG i en publik läsväg — Neon
 * debiteras per VAKEN TID, och en katalogsida får inte väcka computen.
 */
export async function requireEntitledUser() {
  const user = await requireUser();
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { planTier: true, role: true, bonusProUntil: true, stripeProUntil: true },
  });
  // Ingen rad (kontot raderat mitt i sessionen) → behåll token:ens värden och
  // låt anroparen falla på sitt eget fel. ⛔ Anta ALDRIG Pro när vi inte vet.
  if (!fresh) return user;
  const merged = {
    ...user,
    planTier: fresh.planTier,
    role: fresh.role,
    bonusProUntil: fresh.bonusProUntil?.toISOString() ?? null,
    stripeProUntil: fresh.stripeProUntil?.toISOString() ?? null,
  };
  // ⛔ `isPro` måste räknas om, inte ärvas: fältet finns på sessionsobjektet och
  // hade annars burit token:ens gamla svar vidare — precis den lögn vi rättar.
  return { ...merged, isPro: isPro(merged) };
}

export async function requireRole(role: Role) {
  const user = await requireUser();
  if (!hasRole(user.role, role)) throw new AuthError(403, "Du saknar behörighet.");
  return user;
}

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
