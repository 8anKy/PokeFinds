import { type NextAuthOptions, getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { rateLimit, peekRateLimit, clearRateLimit } from "@/lib/rate-limit";
import type { Role, PlanTier } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      planTier: PlanTier;
      onboardingCompleted: boolean;
    };
  }
  interface User {
    id: string;
    role: Role;
    planTier: PlanTier;
    onboardingCompleted: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    planTier: PlanTier;
    onboardingCompleted: boolean;
    refreshedAt: number;
  }
}

// ponytail: re-read role/plan/onboarding from DB at most this often per session.
// Bounds the staleness window for out-of-band changes (RC webhook, admin edit)
// without a DB hit on every request. Lower it if 5 min feels too slow.
const TOKEN_REFRESH_MS = 5 * 60 * 1000;

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
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
