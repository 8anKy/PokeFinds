import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { trackEvent } from "@/services/analytics";

export const dynamic = "force-dynamic";

/**
 * Lättviktig engagemangs-spårning. Klienten skjuter iväg (fire-and-forget,
 * sendBeacon/keepalive) en händelse när en produkt visas, klickas fram ur en
 * lista, eller väljs ur sökförslagen. Matar "Trendar" + admin-engagemang.
 *
 * Skriver BARA in händelsen (opersonlig, via trackEvent → AnalyticsEvent, ingen
 * userId/IP lagras). Nyckeln är produktens slug (det klientens länkar/vyer bär).
 * Ingen produkt-uppslagning här — en påhittad slug faller bort i hydreringssteget
 * vid aggregering, så vi slipper en Neon-läsning per vy.
 */
const bodySchema = z.object({
  type: z.enum(["product_view", "list_click", "search_click"]),
  slug: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
    // Generöst tak — en vanlig bläddrarsession genererar många händelser; taket
    // finns bara för att en enskild klient inte ska kunna blåsa upp topplistan.
    const { ok } = await rateLimit(`track:${ip}`, 200, 60 * 1000);
    if (!ok) return jsonOk({ ok: true }); // tyst drop — spårning får aldrig störa

    const { type, slug } = bodySchema.parse(await req.json());
    await trackEvent(type, slug);
    return jsonOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
