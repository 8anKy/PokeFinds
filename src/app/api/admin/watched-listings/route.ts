/**
 * BEVAKADE LÄNKAR — admin-API (`WatchedListing`).
 *
 * ⛔ VARFÖR FUNKTIONEN FINNS: butiksfeedarna är vår enda upptäcktsväg och de är inte
 * kompletta. Goblinen publicerade 30th Celebration-ETB:n 2026-09-03 utan att URL:en
 * någonsin dök upp i kollektions-JSON:en, `/products.json`, sökindexet, sitemapen
 * eller Atom-feeden. En människa som HAR länken kan lägga in den här, och lanen
 * frågar sidan i stället för feeden. Se `src/scrapers/watched-listing.ts`.
 *
 * ⛔ URL:en MÅSTE höra till butikens egen domän. Utan den kontrollen blir listan en
 * öppen "hämta vilken URL som helst från våra servrar"-yta (SSRF), och lanen hade
 * dessutom tolkat svaret som butikens lagerstatus. Kontrollen görs mot
 * `Retailer.websiteUrl` — samma värd butikens feed hämtas från.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeAuditLog } from "@/services/analytics";
import { sameHost } from "@/lib/watched-listing-url";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  retailerId: z.string().min(1),
  url: z.string().url("Ogiltig URL."),
  note: z.string().trim().max(500).optional(),
});

export async function GET() {
  try {
    await requireRole("ADMIN");
    const items = await prisma.watchedListing.findMany({
      include: { retailer: { select: { name: true } } },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    });
    return jsonOk({ items });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const input = createSchema.parse(await req.json());

    const retailer = await prisma.retailer.findUnique({
      where: { id: input.retailerId },
      select: { id: true, name: true, websiteUrl: true },
    });
    if (!retailer) return jsonOk({ error: "Butiken finns inte." }, { status: 404 });

    // ⛔ SSRF-grinden. Se filhuvudet.
    if (!sameHost(retailer.websiteUrl, input.url)) {
      return jsonOk(
        {
          error:
            `URL:en måste ligga på ${new URL(retailer.websiteUrl).hostname} — ` +
            "en bevakad länk är butikens egen produktsida, inget annat.",
        },
        { status: 400 }
      );
    }

    // Frågesträngen strippas INTE: Shopifys `?variant=…` pekar ut en specifik SKU och
    // är identitet, inte brus (en sortimentssida säljer tre olika boxar).
    const url = input.url.trim();

    const existing = await prisma.watchedListing.findUnique({
      where: { retailerId_url: { retailerId: retailer.id, url } },
      select: { id: true, isActive: true },
    });
    if (existing) {
      // Redan bevakad — slå på den igen i stället för att skapa en dubblett.
      const row = await prisma.watchedListing.update({
        where: { id: existing.id },
        data: { isActive: true, note: input.note ?? undefined },
        include: { retailer: { select: { name: true } } },
      });
      return jsonOk({ item: row, reactivated: !existing.isActive });
    }

    const item = await prisma.watchedListing.create({
      data: {
        retailerId: retailer.id,
        url,
        note: input.note,
        addedById: admin.id,
      },
      include: { retailer: { select: { name: true } } },
    });

    await writeAuditLog({
      userId: admin.id,
      action: "watchedListing.create",
      entityType: "WatchedListing",
      entityId: item.id,
      metadata: { retailer: retailer.name, url },
    });

    return jsonOk({ item }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
