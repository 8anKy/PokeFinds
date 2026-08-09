/**
 * GET /api/admin/sentry-test — skickar ett testevent till Sentry och flushar
 * synkront, så att mottagningen går att verifiera end-to-end mot dashboarden.
 * Behålls (admin-gated, ofarlig): DSN/miljö kan gå sönder tyst igen, och utan
 * ett kontrollerat testevent går "0 events" inte att skilja från "0 fel".
 */
import * as Sentry from "@sentry/nextjs";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMIN");
    const eventId = Sentry.captureMessage(
      "Sentry-verifiering: testevent från /api/admin/sentry-test",
      "warning"
    );
    // Utan flush kan svaret gå ut innan eventet lämnat processen — testet ska
    // vara deterministiskt: svarar routen ok ska eventet vara AVSKICKAT.
    const flushed = await Sentry.flush(5000);
    return jsonOk({
      ok: true,
      eventId,
      flushed,
      hint: "Kolla Issues-flödet i Sentry — eventet ska synas inom någon minut.",
    });
  } catch (e) {
    return apiError(e);
  }
}
