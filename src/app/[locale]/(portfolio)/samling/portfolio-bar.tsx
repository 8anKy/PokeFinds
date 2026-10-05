"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { PortfolioChips } from "@/components/features/portfolio-chips";
import {
  PortfolioCreateSheet,
  PortfolioManageSheet,
  PortfolioVisibilitySheet,
} from "@/components/features/portfolio-sheets";
import { IconLock, IconSettings } from "@/components/ui/icons";
import { openPaywallOrNavigate } from "@/lib/paywall";
import { setLastPortfolioId, type PortfolioSummary } from "@/lib/portfolios-client";

/**
 * Pärmraden överst på /samling: "Alla" + en chip per pärm + "+". Valet bor i
 * URL:en (`?parm=<id>`) — sidan är `force-dynamic` och servern räknar värde,
 * graf, vinst och topplista för JUST den pärmen, så ett byte är en navigering,
 * inte ett klientfilter. Kugghjulet bor i rubrikraden (`PortfolioManageButton`).
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
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

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
      <PortfolioCreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => go(created.id)}
      />
    </div>
  );
}

/**
 * Pärmens offentlig/privat + inställningar, i rubrikraden bredvid "Min samling"
 * (ägarbeslut 2026-10-05: knappen skymde pärmchipsen på raden under).
 *
 * Mål: den valda pärmen — eller den ENDA pärmen när kontot bara har en (då finns
 * ingen "Alla"-chip och inget är valt; förut syntes knappen då inte alls, och en
 * medlem skapade en ny tom pärm bara för att nå reglaget). På "Alla" med flera
 * pärmar öppnar den synlighetsarket med ett reglage per pärm.
 */
export function PortfolioManageButton({
  portfolios,
  selectedId,
}: {
  portfolios: PortfolioSummary[];
  selectedId: string | null;
}) {
  const t = useTranslations("Portfolios");
  const router = useRouter();
  const [managing, setManaging] = useState<PortfolioSummary | null>(null);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const target =
    portfolios.find((p) => p.id === selectedId) ?? (portfolios.length === 1 ? portfolios[0] : null);
  const publicCount = portfolios.filter((p) => p.isPublic).length;
  if (portfolios.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (target ? setManaging(target) : setVisibilityOpen(true))}
        aria-label={target ? t("manageAria", { name: target.name }) : t("visibilityAria")}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-surface-border bg-surface px-3 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
      >
        {target ? (
          target.isPublic ? (
            <span className="text-holo-cyan">{t("publicBadge")}</span>
          ) : (
            <IconLock size={13} />
          )
        ) : publicCount === 0 ? (
          <IconLock size={13} />
        ) : (
          <span className="text-holo-cyan">
            {t("publicSome", { count: publicCount, total: portfolios.length })}
          </span>
        )}
        <IconSettings size={14} />
      </button>

      <PortfolioManageSheet
        portfolio={managing}
        onClose={() => setManaging(null)}
        onChanged={(next) => {
          if (next) router.refresh();
          else router.push("/samling");
        }}
      />
      <PortfolioVisibilitySheet
        portfolios={portfolios}
        open={visibilityOpen}
        onClose={() => setVisibilityOpen(false)}
        onChanged={() => router.refresh()}
      />
    </>
  );
}
