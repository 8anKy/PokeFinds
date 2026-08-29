import { AuthError, auth, requireEntitledUser } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { readDeviceId } from "@/lib/guest-device";

/**
 * VEM skannar? Inloggad användare (med ev. känd enhet) eller en GÄST-enhet.
 * Skannerns routes tog förut `requireEntitledUser()` rakt av; gästskanningen
 * (2026-08-29) lägger en enhetsidentitet bredvid, aldrig i stället för, den.
 *
 * ⛔ Gäst BARA när det inte finns någon session. En inloggad användare med
 * enhets-header är en användare — enheten följer bara med så kvoten kan slås
 * ihop (max av konto och enhet) och enheten länkas till kontot.
 */
export type ScanActor =
  | { kind: "user"; user: Awaited<ReturnType<typeof requireEntitledUser>>; deviceId: string | null; ip: string }
  | { kind: "guest"; deviceId: string; ip: string };

export async function resolveScanActor(req: Request): Promise<ScanActor> {
  const deviceId = readDeviceId(req.headers);
  const ip = clientIp(req);
  const session = await auth();
  if (session?.user) {
    const user = await requireEntitledUser();
    return { kind: "user", user, deviceId, ip };
  }
  if (deviceId) return { kind: "guest", deviceId, ip };
  throw new AuthError(401, "Du måste vara inloggad.");
}

/** Nyckel för rate-limit: per konto eller per enhet. */
export function actorKey(actor: ScanActor): string {
  return actor.kind === "user" ? `u:${actor.user.id}` : `d:${actor.deviceId}`;
}
