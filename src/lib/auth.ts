import { type NextAuthOptions, getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import bcrypt from "bcryptjs";
import { appleClientSecretFromEnv } from "@/lib/apple-client-secret";
import { verifyIdToken, type OAuthProvider } from "@/lib/oauth-id-token";
import { findOrCreateOAuthUser, type OAuthUser } from "@/services/oauth-account";
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

/**
 * Hur gammal `User.lastSeenAt` får bli innan den skrivs om (15 min).
 *
 * ⛔ **SKRIVNINGEN ÅKER SNÅLSKJUTS, DEN BETALAR INGEN EGEN VÄCKNING.** Den sker
 * bara inne i grenen nedan som REDAN läste användarraden — Neon är alltså
 * bevisligen vaken i exakt det ögonblicket, och en liten UPDATE kostar då
 * ingenting mätbart. Neon debiteras per VAKEN TID (minst 300 s per väckning),
 * så en egen `lastSeenAt`-ping per sidladdning hade varit precis det misstag som
 * höll computen vaken dygnet runt 2026-07-07.
 *
 * Följden är att fältet är UNGEFÄRLIGT: "senast online" kan ligga upp till ~15
 * min efter verkligheten, och en användare som bara läser publika ISR-sidor utan
 * att träffa en autentiserad route syns inte alls. Adminvyn säger därför
 * "senast sedd", inte "online nu".
 */
const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

/** Apples client secret (signerad JWT ur .p8) — null ⇒ Apple-providern registreras inte. */
const appleSecret = appleClientSecretFromEnv();
/** Speglar NextAuths egen `useSecureCookies`-härledning: https ⇒ `__Secure-`-prefix. */
const secureCookies = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");

/** Kontot i den form NextAuth stoppar i JWT:n (samma fält som lösenordsvägen). */
function toAuthUser(user: OAuthUser) {
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
}

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
    // OAuth-fel (nekad länkning, avbrutet Apple-flöde) landar på inloggningen
    // med ?error=… i stället för NextAuths egen felsida.
    error: "/logga-in",
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
        // ⛔ passwordHash är NULL för konton skapade via Google/Apple — de har
        // inget lösenord att jämföra mot, och bcrypt.compare mot null kastar.
        // Räknas som ett misslyckat försök precis som fel lösenord (samma svar
        // utåt, så vägen inte avslöjar vilka adresser som är Google-konton).
        const valid =
          !!user?.passwordHash && (await bcrypt.compare(credentials.password, user.passwordHash));
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
    /**
     * NATIVA inloggningar i appen. Google blockerar sitt OAuth-webbflöde i
     * inbäddade WebViews, så appen kör leverantörens nativa SDK (Capacitor-
     * plugin, lib/social-login.ts) och skickar hit id_token. Verifieringen
     * (signatur, iss, aud, exp) sker i lib/oauth-id-token.ts; kontot slås upp/
     * skapas i EXAKT samma tjänst som webbflödet nedan.
     */
    CredentialsProvider({
      id: "native-token",
      name: "Google/Apple (app)",
      credentials: {
        provider: { label: "Provider", type: "text" },
        idToken: { label: "ID-token", type: "text" },
        name: { label: "Namn", type: "text" },
      },
      async authorize(credentials) {
        const provider = credentials?.provider;
        if ((provider !== "google" && provider !== "apple") || !credentials?.idToken) return null;
        const identity = await verifyIdToken(provider as OAuthProvider, credentials.idToken);
        if (!identity) return null;
        const result = await findOrCreateOAuthUser({
          ...identity,
          // Apple skickar namnet BARA vid första auktoriseringen och aldrig i
          // token — appen skickar det med som förslag. Bara ett förslag: det
          // deduppas och trunkeras som allt annat.
          name: identity.name ?? (credentials.name?.trim() || null),
        });
        if (!result.ok) return null;
        return toAuthUser(result.user);
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    ...(appleSecret && process.env.APPLE_CLIENT_ID
      ? [
          AppleProvider({
            clientId: process.env.APPLE_CLIENT_ID,
            clientSecret: appleSecret,
          }),
        ]
      : []),
  ],
  /**
   * ⛔ Apple svarar med `response_mode=form_post` — ett CROSS-SITE POST till vår
   * callback. Cookies med `SameSite=Lax` (NextAuths default) skickas INTE med
   * ett sådant anrop, så PKCE-verifieraren och callback-URL:en är borta när
   * svaret kommer ⇒ "OAuthCallback"-fel för varje Apple-inloggning på webben.
   * Just de två cookiesarna sätts därför `SameSite=None` (kräver Secure ⇒ bara
   * på https; i dev på http lämnas defaulten). Sessionscookien rörs INTE —
   * den sätts först EFTER callbacken, av vårt eget svar.
   */
  cookies: secureCookies
    ? {
        pkceCodeVerifier: {
          name: "__Secure-next-auth.pkce.code_verifier",
          options: { httpOnly: true, sameSite: "none", path: "/", secure: true, maxAge: 900 },
        },
        callbackUrl: {
          name: "__Secure-next-auth.callback-url",
          options: { sameSite: "none", path: "/", secure: true },
        },
      }
    : undefined,
  callbacks: {
    /**
     * Webbflödet (Google/Apple via NextAuth): här byts leverantörens profil mot
     * VÅRT konto. Utan adapter är `user` annars leverantörens profilobjekt
     * (id = deras `sub`), och jwt-callbacken hade stoppat det i token:en som om
     * det vore ett Foilio-id. Objektet muteras på plats — samma referens når
     * jwt-callbacken direkt efter. `false` ⇒ /logga-in?error=AccessDenied.
     */
    async signIn({ user, account, profile }) {
      if (!account || (account.provider !== "google" && account.provider !== "apple")) return true;
      const p = (profile ?? {}) as { email?: string; email_verified?: boolean | string; name?: string };
      const result = await findOrCreateOAuthUser({
        provider: account.provider,
        subject: account.providerAccountId,
        email: typeof p.email === "string" ? p.email : null,
        emailVerified: p.email_verified === true || p.email_verified === "true",
        name: typeof p.name === "string" ? p.name : null,
      });
      if (!result.ok) {
        console.warn(`[oauth] ${account.provider}-inloggning nekad: ${result.reason}`);
        return false;
      }
      Object.assign(user, toAuthUser(result.user));
      return true;
    },
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

          // "Senast online" — se LAST_SEEN_THROTTLE_MS. Raden är redan hämtad, så
          // vi vet om värdet behöver röras utan att fråga DB:n en extra gång.
          //
          // ⛔ Fel SVÄLJS. Exakt samma regel som sessionsförnyelsen i middleware:
          // ett misslyckat statistikfält får aldrig ge 500 på varje sida för alla
          // inloggade. En saknad tidsstämpel är en tom cell i adminpanelen.
          const seenAt = fresh.lastSeenAt?.getTime() ?? 0;
          if (Date.now() - seenAt > LAST_SEEN_THROTTLE_MS) {
            await prisma.user
              .update({ where: { id: fresh.id }, data: { lastSeenAt: new Date() } })
              .catch(() => undefined);
          }
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
