"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatRelative } from "@/lib/format";
import { useIsAdmin } from "@/components/admin-only";
import { StockBadge } from "@/components/ui/badge";
import type { StockStatus } from "@prisma/client";

/**
 * RESTOCK-HISTORIKEN ÄR ADMIN-ONLY (2026-07-26).
 *
 * Den är en driftlogg, inte en produktfunktion. En butik som pytsar ut en het vara
 * skriver dussintals lagerövergångar per dygn — Dragon's Lair togglade Pitch Black
 * Booster Box 45 gånger på tre dygn — och en besökare som läser "i lager för 4 min
 * sedan" klickar sig oftast till en slutsåld sida. Bevakarna får sina restock-larm
 * som vanligt (och de är flapp-dämpade, se checkRestockAlerts).
 *
 * Rollen läses KLIENT-sida (useIsAdmin): produktsidan är
 * ISR-cachad, och ett server-`auth()` där gör hela appen dynamisk igen (se
 * "Caching/ISR" i CLAUDE.md). Därför ligger datat inte heller i sidans payload —
 * admins hämtar det on-demand från /api/market/restocks, som gör den RIKTIGA
 * behörighetskontrollen. Att gömma en sektion skyddar ingenting i sig.
 */
interface RestockRow {
  id: string;
  newStatus: StockStatus;
  detectedAt: string;
  product: { title: string; slug: string };
  retailer: { name: string };
}

function useRestocks(query: string, enabled: boolean) {
  const [rows, setRows] = useState<RestockRow[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetch(`/api/market/restocks?${query}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: RestockRow[] }) => {
        if (alive) setRows(d.items ?? []);
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [query, enabled]);
  return rows;
}

/** Produktsidans "Restock-historik" — butikens lagerövergångar för EN produkt. */
export function ProductRestockHistory({ productId }: { productId: string }) {
  const t = useTranslations("Detail");
  const locale = useLocale();
  const isAdmin = useIsAdmin();
  const rows = useRestocks(`productId=${encodeURIComponent(productId)}&limit=20`, isAdmin);

  if (!isAdmin || rows == null) return null;
  const lastInStock = rows.find((e) => e.newStatus === "IN_STOCK");

  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold text-ink">{t("restockHistory")}</h2>
      {lastInStock && (
        <p className="mt-2 text-sm text-ink-muted">
          {t.rich("lastInStock", {
            whenText: formatRelative(lastInStock.detectedAt, locale),
            store: lastInStock.retailer.name,
            when: (chunks) => <span className="text-rise">{chunks}</span>,
          })}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{t("noRestocks")}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.slice(0, 10).map((event) => (
            <li
              key={event.id}
              className="card-surface flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <span className="text-ink">
                {event.retailer.name}
                <StockBadge stockStatus={event.newStatus} className="ml-2" />
              </span>
              <span className="text-ink-muted">{formatRelative(event.detectedAt, locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
