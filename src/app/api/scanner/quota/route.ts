/**
 * GET /api/scanner/quota — skanningskvoten för den som skannar (badge).
 * Inloggad: månadens kvot (slås ihop med enhetens månad när appen skickar
 * enhets-id). Gäst i appen: 10 livstid per enhet. Se src/lib/guest-device.ts.
 */
import { apiError, jsonOk } from "@/lib/api";
import { previewAllowedFor } from "@/lib/feature-preview";
import { effectivePlanTier, isPro } from "@/lib/plan";
import { resolveScanActor } from "@/lib/scan-actor";
import { getScannerQuota } from "@/services/scanner";
import { getGuestQuota, linkDeviceToUser } from "@/services/scanner/guest-device";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const actor = await resolveScanActor(req);
    if (actor.kind === "guest") {
      const { remaining, limit } = await getGuestQuota(actor.deviceId, actor.ip);
      return jsonOk({ remaining, limit, isPremium: false, guest: true, counter: false });
    }
    const { user, deviceId } = actor;
    // Enheten länkas till kontot redan här: den som skapade konto efter tio
    // gästskanningar ska se den sammanslagna kvoten direkt, inte efter nästa scan.
    if (deviceId) await linkDeviceToUser(deviceId, user.id, actor.ip);
    const { remaining, limit } = await getScannerQuota(
      user.id,
      effectivePlanTier(user),
      user.role,
      deviceId
    );
    // `counter`: räknaren i skannerremsan + nudgen (förhandsvisning, feature-preview.ts).
    return jsonOk({
      remaining,
      limit,
      isPremium: isPro(user),
      guest: false,
      counter: previewAllowedFor("SCAN_COUNTER", user),
    });
  } catch (e) {
    return apiError(e);
  }
}
