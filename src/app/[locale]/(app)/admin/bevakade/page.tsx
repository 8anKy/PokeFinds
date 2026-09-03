import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AdminRequired } from "../admin-required";
import { WatchedListingsClient, type WatchedRow, type StoreOption } from "./watched-client";

export const dynamic = "force-dynamic";

/**
 * BEVAKADE LÄNKAR: butiks-URL:er vi frågar direkt, för att ingen feed nämner dem.
 * Bakgrunden står i `src/scrapers/watched-listing.ts` och i modellen `WatchedListing`.
 */
export default async function AdminWatchedListingsPage() {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const [rows, sources, retailers] = await Promise.all([
    prisma.watchedListing.findMany({
      include: { retailer: { select: { name: true } } },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    }),
    // Bara butiker lanen faktiskt hämtar — en bevakning på en ej bevakad källa hade
    // aldrig frågats, och ett val som inte gör något är värre än inget val.
    prisma.scrapeSource.findMany({ where: { isActive: true }, select: { name: true, config: true } }),
    prisma.retailer.findMany({ select: { id: true, name: true, websiteUrl: true } }),
  ]);

  const watchedNames = new Set(
    sources
      .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
      .map((s) => s.name)
  );
  const stores: StoreOption[] = retailers
    .filter((r) => watchedNames.has(r.name))
    .map((r) => ({ id: r.id, name: r.name, host: hostOf(r.websiteUrl) }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  const items: WatchedRow[] = rows.map((r) => ({
    id: r.id,
    store: r.retailer.name,
    url: r.url,
    note: r.note,
    isActive: r.isActive,
    lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
    lastStatus: r.lastStatus,
    lastPriceOre: r.lastPriceOre,
    lastTitle: r.lastTitle,
    lastError: r.lastError,
  }));

  return <WatchedListingsClient rows={items} stores={stores} />;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
