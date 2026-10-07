/**
 * POST /api/cron/catalog-snapshot — bygger nattens katalogsnapshot på volymen
 * (skal + priser per synlig produkt; varför: src/lib/catalog-snapshot.ts).
 *
 * Anropas av cardmarket-refresh.yml efter prisjobbet (Neon redan vaken) och för hand
 * via catalog-snapshot.yml. x-cron-secret = CRON_SECRET, som de andra cron-rutterna.
 * ⛔ Ingen revalidering av produktsidorna här: deras ISR-TTL är ett dygn och de läser
 * snapshoten själva vid nästa rendering — att kasta ~63 000 sidor på en gång hade
 * bara gett ett renderingssvep.
 */
import { type NextRequest, NextResponse } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { buildCatalogSnapshot } from "@/services/catalog-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ error: "Cron är inte konfigurerat." }, { status: 503 });
    if (req.headers.get("x-cron-secret") !== secret) {
      return NextResponse.json({ error: "Ogiltig cron-hemlighet." }, { status: 401 });
    }
    const result = await buildCatalogSnapshot();
    console.log(
      `[catalog-snapshot] ${result.generation}: ${result.products} produkter (${result.withPrice} med pris), ` +
        `${Math.round(result.bytes / 1024)} KB gzip, ${Math.round(result.ms / 1000)} s`
    );
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
