import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AdminRequired } from "../admin-required";
import { RetailersClient, type RetailerRow } from "./retailers-client";

export const dynamic = "force-dynamic";

export default async function AdminRetailersPage() {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const retailers = await prisma.retailer.findMany({
    include: { _count: { select: { offers: true } } },
    orderBy: { name: "asc" },
  });

  const rows: RetailerRow[] = retailers.map((r) => ({
    id: r.id,
    name: r.name,
    websiteUrl: r.websiteUrl,
    country: r.country,
    isActive: r.isActive,
    sourceType: r.sourceType,
    affiliateEnabled: r.affiliateEnabled,
    affiliateParams: r.affiliateParams,
    offerCount: r._count.offers,
  }));

  return <RetailersClient retailers={rows} />;
}
