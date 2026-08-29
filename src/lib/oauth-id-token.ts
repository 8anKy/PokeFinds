import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Verifiering av id_token från de NATIVA inloggningarna i appen.
 *
 * I appen sker Google-/Apple-inloggningen i det nativa SDK:t (Capacitor-plugin,
 * se lib/social-login.ts) — inte via NextAuths webbflöde, som Google blockerar
 * i inbäddade WebViews. Pluginet ger oss ett id_token, och DET HÄR är enda
 * stället som avgör om det är äkta: signatur mot leverantörens JWKS, utgivare,
 * mottagare (aud) och giltighetstid. Ett token som inte klarar alla fyra är
 * ingen inloggning.
 *
 * ⛔ `aud` MÅSTE kontrolleras mot VÅRA klient-id:n. Utan det kan ett giltigt
 * Google-token utfärdat för vilken app som helst logga in dess användare hos
 * oss. Googles iOS-SDK utfärdar token för iOS-klient-id:t, Android/webb för
 * webb-klient-id:t — därför en LISTA av tillåtna aud, aldrig en sträng.
 * Apple: appens bundle-id (nativt) eller Services-ID:t (webb).
 *
 * JWKS-hämtningen cachas av jose (per process) — kostar inget per inloggning.
 */

export type OAuthProvider = "google" | "apple";

export interface VerifiedIdentity {
  provider: OAuthProvider;
  /** Leverantörens stabila användar-id (`sub`). */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** Namn ur token när leverantören skickar det (Google: alltid; Apple: aldrig i token). */
  name: string | null;
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

const compact = (values: Array<string | undefined>) =>
  values.map((v) => v?.trim()).filter((v): v is string => !!v);

/** Tillåtna mottagare per leverantör, ur miljön. Tom lista = inloggningen är avstängd. */
export function allowedAudiences(provider: OAuthProvider): string[] {
  if (provider === "google") {
    return compact([process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_IOS_CLIENT_ID]);
  }
  return compact([process.env.APPLE_CLIENT_ID, process.env.APPLE_APP_BUNDLE_ID ?? "se.foilio.app"]);
}

function readClaims(provider: OAuthProvider, payload: JWTPayload): VerifiedIdentity | null {
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  // Google: boolean. Apple: boolean ELLER strängen "true" — båda förekommer i drift.
  const ev = payload.email_verified;
  const emailVerified = ev === true || ev === "true";
  const name = typeof payload.name === "string" ? payload.name : null;
  return { provider, subject: payload.sub, email, emailVerified, name };
}

/**
 * Verifiera ett id_token. Returnerar null vid VARJE fel (ogiltig signatur, fel
 * aud/iss, utgånget, nätverksfel mot JWKS) — anroparen ska aldrig behöva skilja
 * på dem, svaret är "ingen inloggning".
 */
export async function verifyIdToken(
  provider: OAuthProvider,
  idToken: string
): Promise<VerifiedIdentity | null> {
  const audience = allowedAudiences(provider);
  if (audience.length === 0 || !idToken || idToken.length > 8192) return null;
  try {
    const { payload } =
      provider === "google"
        ? await jwtVerify(idToken, GOOGLE_JWKS, {
            issuer: ["https://accounts.google.com", "accounts.google.com"],
            audience,
          })
        : await jwtVerify(idToken, APPLE_JWKS, {
            issuer: "https://appleid.apple.com",
            audience,
          });
    return readClaims(provider, payload);
  } catch (e) {
    console.warn(`[oauth] ${provider} id_token avvisat:`, e instanceof Error ? e.message : e);
    return null;
  }
}
