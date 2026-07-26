"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatRelative } from "@/lib/format";
import { useIsAdmin } from "@/components/admin-only";
import { StockBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { IconPackage } from "@/components/ui/icons";
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
 * Rollen läses KLIENT-sida (useIsAdmin): både produktsidan och /marknad är
 * ISR-cachade, och ett server-`auth()` där gör hela appen dynamisk igen (se
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
            whenText: formatRelative(lastInStock.detectedAt),
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
              <span className="text-ink-muted">{formatRelative(event.detectedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Marknadssidans "Senaste påfyllningar" — hela katalogen, fortfarande i lager. */
export function MarketRestocks() {
  const t = useTranslations("Market");
  const isAdmin = useIsAdmin();
  const rows = useRestocks("limit=12", isAdmin);

  if (!isAdmin || rows == null) return null;

  return (
    <section className="mt-12">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
        <IconPackage size={20} className="text-holo-cyan" />
        {t("restocksTitle")}
      </h2>
      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState
            icon={<IconPackage size={32} />}
            title={t("noRestocksTitle")}
            description={t("noRestocksDesc")}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t("colProduct")}</TH>
                <TH>{t("colStore")}</TH>
                <TH>{t("colStatus")}</TH>
                <TH>{t("colWhen")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link
                      href={`/produkter/${r.product.slug}`}
                      className="font-medium hover:text-holo-cyan"
                    >
                      {r.product.title}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">{r.retailer.name}</TD>
                  <TD>
                    <StockBadge stockStatus={r.newStatus} />
                  </TD>
                  <TD className="whitespace-nowrap text-ink-muted">
                    {formatRelative(r.detectedAt)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </section>
  );
}
