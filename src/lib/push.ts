/**
 * Push till telefoner — iOS via Apple (apns.ts), Android via Firebase (fcm.ts).
 * Alla avsändare anropar den här, aldrig apns/fcm direkt, så att ingen väg blir iOS-only igen.
 *
 * Tokens delas upp på FORMATET, inte på `PushToken.platform`: en APNs-token är alltid 64
 * hex-tecken, en FCM-token aldrig. Då behöver anroparna inte hämta plattformen, och en
 * rad med fel platform-fält kan inte skicka en token till fel tjänst.
 */
import { sendPush as sendApns, type PushPayload } from "@/lib/apns";
import { sendFcm } from "@/lib/fcm";

export type { PushPayload };

export function isApnsToken(token: string): boolean {
  return /^[0-9a-f]{64}$/i.test(token);
}

export async function sendPush(tokens: string[], payload: PushPayload): Promise<{ invalidTokens: string[] }> {
  const ios = tokens.filter(isApnsToken);
  const android = tokens.filter((t) => !isApnsToken(t));
  const [a, f] = await Promise.all([sendApns(ios, payload), sendFcm(android, payload)]);
  return { invalidTokens: [...a.invalidTokens, ...f.invalidTokens] };
}
