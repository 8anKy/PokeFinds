import { createPrivateKey, sign as cryptoSign } from "node:crypto";

/**
 * Apples "client secret" för Sign in with Apple är INTE en statisk sträng utan en
 * JWT vi själva signerar med teamets `.p8`-nyckel (ES256). Apple tillåter max
 * SEX MÅNADERS giltighet ⇒ den kan aldrig hårdkodas i en env-variabel: den
 * dagen den går ut slutar Apple-inloggningen tyst med "invalid_client".
 * Genereras därför i runtime ur nyckeln, en gång per process (Railway
 * återvinner processen minst dagligen, se lib/memory-recycle.ts).
 *
 * SYNKRON med flit: `authOptions` är en modulkonstant och NextAuth v4 tar
 * `clientSecret` som en sträng, inte ett löfte. `crypto.sign` med
 * `dsaEncoding: "ieee-p1363"` ger exakt den råa r||s-signatur JOSE kräver —
 * ingen asynkron `jose.SignJWT` behövs.
 *
 * Ren funktion under huven (`buildAppleClientSecret`) så vakttestet kan
 * verifiera formen utan riktiga nycklar.
 */

export interface AppleSecretInput {
  teamId: string;
  keyId: string;
  /** Services-ID (webb) — Apples `client_id`/`aud` i token-utbytet. */
  clientId: string;
  /** PEM-innehållet ur .p8-filen. `\n`-escapade radbrytningar accepteras. */
  privateKey: string;
  now?: Date;
  /** Giltighet i sekunder. Apple-tak: 15 777 000 (~6 mån). Default 150 dygn. */
  ttlSeconds?: number;
}

const APPLE_MAX_TTL = 15_777_000;
const DEFAULT_TTL = 60 * 60 * 24 * 150;

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function buildAppleClientSecret(input: AppleSecretInput): string {
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const ttl = Math.min(input.ttlSeconds ?? DEFAULT_TTL, APPLE_MAX_TTL);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: input.keyId }));
  const payload = b64url(
    JSON.stringify({
      iss: input.teamId,
      iat: now,
      exp: now + ttl,
      aud: "https://appleid.apple.com",
      sub: input.clientId,
    })
  );
  const key = createPrivateKey(input.privateKey.replace(/\\n/g, "\n"));
  const signature = cryptoSign("sha256", Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64url(signature)}`;
}

let cached: { secret: string; expiresAt: number } | null = null;

/**
 * Hemligheten ur miljön, eller null när Apple-inloggningen inte är konfigurerad
 * (då registreras providern helt enkelt inte). Förnyas när en tredjedel av
 * livslängden återstår — långt före Apples gräns.
 */
export function appleClientSecretFromEnv(): string | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_KEY_ID?.trim();
  const clientId = process.env.APPLE_CLIENT_ID?.trim();
  const privateKey = process.env.APPLE_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !clientId || !privateKey) return null;
  const nowMs = Date.now();
  if (cached && cached.expiresAt - nowMs > (DEFAULT_TTL * 1000) / 3) return cached.secret;
  try {
    const secret = buildAppleClientSecret({ teamId, keyId, clientId, privateKey });
    cached = { secret, expiresAt: nowMs + DEFAULT_TTL * 1000 };
    return secret;
  } catch (e) {
    console.error("[apple-secret] kunde inte signera client secret — kontrollera APPLE_PRIVATE_KEY:", e);
    return null;
  }
}
