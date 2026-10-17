/**
 * Native push till ANDROID via Firebase Cloud Messaging, HTTP v1-API (2026-10-17).
 * iOS går fortfarande direkt mot Apple (lib/apns.ts); `lib/push.ts` delar upp tokens.
 *
 * Inget SDK: ett tjänstekonto signerar en JWT (RS256, Nodes crypto) som byts mot en
 * OAuth-token hos Google (cachas ~55 min), och varje token får ett eget anrop — v1 har
 * ingen multicast.
 *
 * Krävs i env (annars är Android-push av och sendFcm en no-op):
 *   FCM_SERVICE_ACCOUNT — tjänstekontots JSON-nyckel från Firebase (rå JSON eller base64)
 */
import { createSign } from "node:crypto";
import type { PushPayload } from "@/lib/apns";

/** Androids notiskanal — skapas av appen (push-client.ts) innan registreringen. */
export const ANDROID_CHANNEL_ID = "alerts";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let account: ServiceAccount | null | undefined;
let cachedToken: { value: string; expiresAt: number } | null = null;

function getAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const raw = process.env.FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return (account = null);
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error("fält saknas");
    account = { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch (e) {
    // Felkonfiguration ska synas i loggen, inte bli en tyst no-op.
    console.error("[fcm] FCM_SERVICE_ACCOUNT går inte att läsa:", e instanceof Error ? e.message : e);
    account = null;
  }
  return account;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

/** FCM-meddelandet för en token. Ren — testad i tests/unit/push-routing.test.ts. */
export function fcmMessage(token: string, payload: PushPayload) {
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      // data-värden måste vara strängar. `url` läses av push-manager.tsx vid tryck.
      ...(payload.url ? { data: { url: payload.url } } : {}),
      android: {
        priority: "HIGH",
        notification: { channel_id: ANDROID_CHANNEL_ID, sound: "default" },
      },
    },
  };
}

/** Svar som betyder att TOKEN är död (avinstallerad app, utgången registrering). */
function isDeadToken(status: number, body: string): boolean {
  if (status === 404) return true; // UNREGISTERED
  return status === 400 && /UNREGISTERED|registration token is not a valid|INVALID_ARGUMENT.*token/i.test(body);
}

/**
 * Skickar till Android-tokens. Returnerar de tokens Google förkastat så anroparen kan
 * städa bort dem — samma kontrakt som `sendPush` i apns.ts.
 */
export async function sendFcm(tokens: string[], payload: PushPayload): Promise<{ invalidTokens: string[] }> {
  const sa = getAccount();
  if (!sa || tokens.length === 0) return { invalidTokens: [] };

  let bearer: string;
  try {
    bearer = await accessToken(sa);
  } catch (e) {
    // Drabbar varje Android-push — loggas högt, kastar inte (larmet/mejlet är redan levererat).
    console.error("[fcm] kunde inte hämta OAuth-token:", e instanceof Error ? e.message : e);
    return { invalidTokens: [] };
  }

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const invalidTokens: string[] = [];
  const otherFailures: string[] = [];
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify(fcmMessage(token, payload)),
        });
        if (res.ok) return;
        const body = await res.text();
        if (isDeadToken(res.status, body)) invalidTokens.push(token);
        else otherFailures.push(`${res.status}`);
      } catch (e) {
        otherFailures.push(e instanceof Error ? e.message : "nätverksfel");
      }
    })
  );
  // Samma regel som apns.ts: ett fel som inte är en död token är nästan alltid
  // konfiguration (fel projekt, återkallad nyckel) och drabbar alla — logga det.
  if (otherFailures.length > 0) {
    console.error(
      `[fcm] ${otherFailures.length} av ${tokens.length} push misslyckades: ${[...new Set(otherFailures)].join(", ")}`
    );
  }
  return { invalidTokens };
}
