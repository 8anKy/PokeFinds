/**
 * ADMIN → KOPPLINGAR (2026-09-16).
 *
 * URL:er som hit-vägen band till en produkt MITT PÅ DAGEN (släppdagen, se
 * services/restock-hits.ts). Matchningen är nattkedjans egen, men en felbindning
 * här syns direkt som en främmande butik på en produktsida och som ett larm till
 * fel bevakare — därför ska varje bindning gå att hitta och ta bort på tio
 * sekunder. "Koppla bort" = samma väg som Ta bort på offern: offern raderas,
 * URL:en nekas permanent och huvudboksradens bindning nollas (ruttabellen).
 */
import type { Metadata } from "next";
import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { utcDaysAgo } from "@/lib/utils";
import { AdminRequired } from "../admin-required";
import { BindingsClient, type BindingRow } from "./bindings-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kopplingar · Admin" };

const WINDOW_DAYS = 30;

export default async function AdminBindingsPage() {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) return <AdminRequired />;

  const logs = await prisma.auditLog.findMany({
    where: { action: "restock-hit.bind", createdAt: { gte: utcDaysAgo(WINDOW_DAYS) } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, entityId: true, metadata: true, createdAt: true },
  });
  const offerIds = logs.map((l) => l.entityId).filter((x): x is string => !!x);
  const offers = await prisma.offer.findMany({
    where: { id: { in: offerIds } },
    select: {
      id: true,
      url: true,
      price: true,
      stockStatus: true,
      retailer: { select: { name: true } },
      product: { select: { title: true, slug: true } },
    },
  });
  const byId = new Map(offers.map((o) => [o.id, o]));

  const rows: BindingRow[] = logs.map((l) => {
    const m = (l.metadata ?? {}) as { storeName?: string; url?: string; title?: string; priceOre?: number | null };
    const o = l.entityId ? byId.get(l.entityId) : undefined;
    return {
      id: l.id,
      at: l.createdAt.toISOString(),
      storeName: o?.retailer.name ?? m.storeName ?? "?",
      url: o?.url ?? m.url ?? "",
      storeTitle: m.title ?? "",
      priceOre: o?.price ?? m.priceOre ?? null,
      stockStatus: o?.stockStatus ?? null,
      offerId: o?.id ?? null,
      product: o?.product ? { title: o.product.title, slug: o.product.slug } : null,
    };
  });

  return <BindingsClient rows={rows} windowDays={WINDOW_DAYS} />;
}
