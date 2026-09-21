"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { PortfolioChips } from "@/components/features/portfolio-chips";
import { PortfolioCreateSheet, PortfolioManageSheet } from "@/components/features/portfolio-sheets";
import { IconLock, IconSettings } from "@/components/ui/icons";
import { openPaywallOrNavigate } from "@/lib/paywall";
import { setLastPortfolioId, type PortfolioSummary } from "@/lib/portfolios-client";

/**
 * Pärmraden överst på /samling: "Alla" + en chip per pärm + "+". Valet bor i
 * URL:en (`?parm=<id>`) — sidan är `force-dynamic` och servern räknar värde,
 * graf, vinst och topplista för JUST den pärmen, så ett byte är en navigering,
 * inte ett klientfilter. Kugghjulet öppnar hanteringsarket för den valda pärmen.
 *
 * Med bara EN pärm visas raden ändå, utan "Alla": chipen + "+" är hela
 * pärmfunktionens synliga yta, och "+" är gratiskontots väg till paywallen.
 */
export function PortfolioBar({
  portfolios,
  selectedId,
  canCreate,
}: {
  portfolios: PortfolioSummary[];
  /** null = Alla. */
  selectedId: string | null;
  canCreate: boolean;
}) {
  const t = useTranslations("Portfolios");
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [managing, setManaging] = useState<PortfolioSummary | null>(null);
  const selected = portfolios.find((p) => p.id === selectedId) ?? null;

  const go = (id: string | null) => {
    if (id) setLastPortfolioId(id);
    router.push(id ? `/samling?parm=${encodeURIComponent(id)}` : "/samling");
  };

  return (
    <div className="flex items-center gap-2">
      <PortfolioChips
        portfolios={portfolios}
        value={selectedId}
        onChange={go}
        allOption={portfolios.length > 1}
        counts
        className="min-w-0 flex-1 py-1"
        onCreate={() =>
          canCreate
            ? setCreateOpen(true)
            : openPaywallOrNavigate(router, { source: "portfolio-limit" })
        }
      />
      {selected && (
        <button
          type="button"
          onClick={() => setManaging(selected)}
          aria-label={t("manageAria", { name: selected.name })}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-surface-border bg-surface px-3 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          {selected.isPublic ? (
            <span className="text-holo-cyan">{t("publicBadge")}</span>
          ) : (
            <IconLock size={13} />
          )}
          <IconSettings size={14} />
        </button>
      )}

      <PortfolioCreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => go(created.id)}
      />
      <PortfolioManageSheet
        portfolio={managing}
        onClose={() => setManaging(null)}
        onChanged={(next) => {
          if (next) router.refresh();
          else go(null);
        }}
      />
    </div>
  );
}
