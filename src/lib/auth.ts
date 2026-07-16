import { type NextAuthOptions, getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { rateLimit, peekRateLimit, clearRateLimit } from "@/lib/rate-limit";
import { isPro } from "@/lib/plan";
import type { Role, PlanTier } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      planTier: PlanTier;
      /** Pro-förmåner? = planTier PREMIUM ELLER admin-roll. Grinda features på DENNA,
       *  aldrig på planTier (som en utgången prenumeration nollar). Se lib/plan.ts. */
      isPro: boolean;
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

// Webbklient-id:t är publikt (bakas in i appens JS) — hemligheten är GOOGLE_CLIENT_SECRET.
// Servern accepterar båda namnen så Railway bara behöver NEXT_PUBLIC-varianten + secret.
const GOOGLE_WEB_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
// Googles publika signeringsnycklar (JWKS) — jose cachar och roterar själv.
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/**
 * Delad Google-kontologik (#12): länka via e-post eller skapa färdigverifierad
 * användare. Används av BÅDE webbens OAuth-callback och appens id-token-flöde.
 * - Befintlig e-post → länka + bocka av e-postverifieringen (Google har bevisat adressen).
 * - Ny e-post → unikt namn (lower(name) är ett unikt index → sifferSuffix vid krock)
 *   och slumpad lösenordshash ("glömt lösenord" funkar om de vill sätta ett riktigt).
 */
async function linkOrCreateGoogleUser(emailRaw: string, displayName?: string | null) {
  const email = emailRaw.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.emailVerifiedAt) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { emailVerifiedAt: new Date(), verificationToken: null },
      });
    }
    return existing;
  }
  const base = (displayName ?? email.split("@")[0]).trim().slice(0, 40) || "Tränare";
  let name = base;
  for (let i = 0; i < 5; i++) {
    const taken = await prisma.user.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (!taken) break;
    name = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(randomUUID(), 10),
      emailVerifiedAt: new Date(),
    },
  });
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  pages: {
    signIn: "/logga-in",
  },
  providers: [
    // Google-login (#12). Visas/registreras bara när OAuth-uppgifterna finns i miljön —
    // utan dem beter sig allt exakt som förut. Ingen adapter behövs med JWT-sessioner:
    // kontot knyts till vår User via e-post i signIn-callbacken nedan.
    ...(GOOGLE_WEB_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: GOOGLE_WEB_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    // Nativa appens Google-inloggning (#12): Google blockerar redirect-OAuth i
    // inbäddade webviews, så Capacitor-pluginen (@capgo/capacitor-social-login) kör
    // Googles NATIVA dialog och ger en id-token. Den verifieras här KRYPTOGRAFISKT
    // mot Googles publika nycklar (signatur + issuer + audience = vårt client id) —
    // samma tillit som webbens redirect-flöde, ingen secret behövs för detta ben.
    ...(GOOGLE_WEB_CLIENT_ID
      ? [
          CredentialsProvider({
            id: "google-idtoken",
            name: "Google (app)",
            credentials: { idToken: { label: "idToken", type: "text" } },
            async authorize(credentials) {
              if (!credentials?.idToken) return null;
              try {
                const { payload } = await jwtVerify(credentials.idToken, GOOGLE_JWKS, {
                  issuer: ["https://accounts.google.com", "accounts.google.com"],
                  audience: GOOGLE_WEB_CLIENT_ID,
                });
                const email = typeof payload.email === "string" ? payload.email : null;
                if (!email || payload.email_verified !== true) return null;
                const user = await linkOrCreateGoogleUser(
                  email,
                  typeof payload.name === "string" ? payload.name : null
                );
                return {
                  id: user.id,
                  email: user.email,
                  name: user.name,
                  role: user.role,
                  planTier: user.planTier,
                  onboardingCompleted: user.onboardingCompleted,
                };
              } catch (err) {
                console.warn(
                  "[google-idtoken] verifiering misslyckades:",
                  err instanceof Error ? err.message : err
                );
                return null;
              }
            },
          }),
        ]
      : []),
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
    // Webbens Google-OAuth: se till att en User-rad finns INNAN jwt-callbacken läser
    // den (länkning/skapande delas med appens id-token-flöde — se linkOrCreateGoogleUser).
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      const email = user.email?.toLowerCase().trim();
      if (!email) return false;
      await linkOrCreateGoogleUser(email, profile?.name ?? null);
      return true;
    },
    async jwt({ token, user, account, trigger }) {
      if (account?.provider === "google" && token.email) {
        // OAuth-`user.id` är GOOGLES id, inte vårt — slå upp vår User via e-posten
        // (signIn-callbacken ovan har just garanterat att raden finns).
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email.toLowerCase() },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.planTier = dbUser.planTier;
          token.onboardingCompleted = dbUser.onboardingCompleted;
          token.refreshedAt = Date.now();
        }
      } else if (user) {
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
      session.user.isPro = isPro({ planTier: token.planTier, role: token.role });
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
