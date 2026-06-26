/**
 * Native push till iOS via Apple APNs (token-baserad .p8-auth). INGEN Firebase —
 * vi pratar direkt med Apple. Enhetstokens lagras i Postgres (PushToken).
 *
 * node-apn är en ren Node-lib (http2/tls/fs). Vi laddar den via runtime-require
 * (__non_webpack_require__, samma mönster som scheduler.ts) så att webpack aldrig
 * försöker bundla Node-built-ins i instrumentation-/edge-bundles.
 *
 * Krävs i env (annars är push avstängd och sendPush en no-op):
 *   APNS_KEY        — innehållet i .p8-nyckeln (radbrytningar som \n går bra)
 *   APNS_KEY_ID     — nyckelns Key ID
 *   APNS_TEAM_ID    — Apple Developer Team ID
 *   APNS_BUNDLE_ID  — appens bundle-id (default se.foilio.app)
 *   APNS_PRODUCTION — "true" för produktions-APNs (annars sandbox)
 */
declare const __non_webpack_require__: typeof require;
const nodeRequire =
  typeof __non_webpack_require__ !== "undefined" ? __non_webpack_require__ : require;

export interface PushPayload {
  title: string;
  body: string;
  /** Relativ app-väg att öppna vid tap, t.ex. "/produkter/abc". */
  url?: string;
}

// Minimal typ-yta för det vi använder ur @parse/node-apn (slipper bero på dess
// export-form + håller webpack borta).
interface ApnNotification {
  topic?: string;
  alert?: { title: string; body: string };
  sound?: string;
  payload?: Record<string, unknown>;
}
interface ApnSendResult {
  failed: { device: string; status?: number; response?: { reason?: string } }[];
}
interface ApnProvider {
  send(note: ApnNotification, tokens: string[]): Promise<ApnSendResult>;
}
interface ApnModule {
  Provider: new (opts: unknown) => ApnProvider;
  Notification: new () => ApnNotification;
}

let apn: ApnModule | undefined;
let provider: ApnProvider | null | undefined;

function getProvider(): ApnProvider | null {
  if (provider !== undefined) return provider;
  const key = process.env.APNS_KEY;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!key || !keyId || !teamId) {
    provider = null; // ej konfigurerat → push av
    return null;
  }
  apn ??= nodeRequire("@parse/node-apn") as ApnModule;
  provider = new apn.Provider({
    token: { key: key.replace(/\\n/g, "\n"), keyId, teamId },
    production: process.env.APNS_PRODUCTION === "true",
  });
  return provider;
}

/**
 * Skickar en push till enhetstokens. Returnerar tokens som APNs förkastat
 * (ogiltiga/avregistrerade) så anroparen kan städa bort dem ur DB:n.
 */
export async function sendPush(
  tokens: string[],
  payload: PushPayload
): Promise<{ invalidTokens: string[] }> {
  const p = getProvider();
  if (!p || tokens.length === 0) return { invalidTokens: [] };

  const note = new apn!.Notification();
  note.topic = process.env.APNS_BUNDLE_ID ?? "se.foilio.app";
  note.alert = { title: payload.title, body: payload.body };
  note.sound = "default";
  if (payload.url) note.payload = { url: payload.url };

  const result = await p.send(note, tokens);
  const invalidTokens = result.failed
    .filter(
      (f) =>
        f.status === 410 ||
        f.response?.reason === "BadDeviceToken" ||
        f.response?.reason === "Unregistered"
    )
    .map((f) => f.device);
  return { invalidTokens };
}
