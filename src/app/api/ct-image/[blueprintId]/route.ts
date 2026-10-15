import { NextResponse } from "next/server";
import { ctImageSourceUrl, isValidCtImageFile } from "@/lib/ct-image";

export const runtime = "nodejs";
// Samma cachemodell som /api/cm-image: kort route-cache (ett negativt svar självläker inom
// en timme), den riktiga cachningen är svarets `immutable`-header i webbläsare och edge.
export const revalidate = 3600;

/**
 * KORTBILDER FÖR KORT SOM BARA FINNS PÅ CARDMARKET (2026-10-15).
 *
 * Cardmarkets singelbilder ligger under en sökväg med expansionskod som deras gratiskatalog
 * inte ger oss, så /api/cm-image/{id} hittar dem inte (6 716 kort stod bildlösa). CardTraders
 * katalog — redan identitetskällan för de korten — har en bild per blueprint. Vi
 * proxyar den i stället för att länka direkt: EN hämtning per bild hamnar på deras server,
 * resten serveras ur cachen, och de kan inte se våra besökare.
 *
 * ⛔ Ingen öppen proxy: värden är fast (www.cardtrader.com/uploads/blueprints/image/), id:t
 * är siffror och filnamnet valideras (`isValidCtImageFile`) — inga snedstreck, inga punkter
 * utöver filändelsen.
 */
export async function GET(req: Request, { params }: { params: { blueprintId: string } }) {
  const id = params.blueprintId;
  const file = new URL(req.url).searchParams.get("f") ?? "";
  if (!/^\d{1,9}$/.test(id) || !isValidCtImageFile(file)) return new NextResponse("bad request", { status: 400 });
  try {
    const res = await fetch(ctImageSourceUrl(Number(id), file), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      await res.body?.cancel();
      return new NextResponse("no image", { status: 404, headers: { "cache-control": "no-store" } });
    }
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": file.toLowerCase().endsWith(".png") ? "image/png" : file.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("no image", { status: 404, headers: { "cache-control": "no-store" } });
  }
}
