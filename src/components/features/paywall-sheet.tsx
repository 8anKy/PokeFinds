"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ProHoloCard } from "@/components/features/pro-holo-card";
import { ProSpecTable } from "@/components/features/pro-spec-table";
import { UpgradeButton } from "@/components/features/upgrade-button";
import { registerPaywallOpen } from "@/lib/paywall";
import { onOverlayElevationChange, overlayIsElevated } from "@/lib/product-overlay-open";
import { pausableFeatures, proOnlyRows, type SpecRow } from "@/lib/pricing-features";
import { priceAlertsPausedClient } from "@/lib/price-alerts-pause";
import { restockAlertsPausedClient } from "@/lib/restock-alerts-pause";

/**
 * Paywall-arket — Pro-kortet, det du låser upp och köpknappen, i ett bottenark
 * över den vy användaren står i. Monteras EN gång i rot-layouten och öppnas
 * imperativt via `openPaywall()` (lib/paywall.ts) från varje Pro-låst yta.
 *
 * ⛔ Arket ÄR INTE en andra paywall. Köpknappen är samma `UpgradeButton` som på
 * `/priser` (Apple/Google i appen, Stripe på webben, aldrig tvärtom), och raderna
 * kommer ur samma `Pricing.specRows*` med samma pausflaggor — så en avstängd
 * larmfunktion kan inte säljas här och glömmas där. Förnyelsevillkoret och båda de
 * legala länkarna står vid knappen även här (Apple 3.1.2 gäller varje köpställe).
 *
 * `webCheckout` kommer från servern (rot-layouten läser `stripeCheckoutAdvertised()`)
 * av samma skäl som på prissidan: en egen NEXT_PUBLIC_-flagga hade blivit en andra
 * sanning om huruvida det går att betala.
 *
 * Innehållet renderas BARA när arket är öppet: UpgradeButton bär en effekt som
 * hanterar återkomsten från Stripe (`?checkout=klar`) och den ska köras av sidans
 * instans, inte av ett stängt ark i rot-layouten.
 */
export function PaywallSheetHost({ webCheckout }: { webCheckout: boolean }) {
  const [open, setOpen] = useState(false);
  // Skannern är fixed z-[60] över hela appen; öppnas arket därifrån måste det
  // lyftas över den — samma mekanism som produkt-overlayn (registerFullscreenHost).
  const [elevated, setElevated] = useState(false);

  useEffect(() => {
    setElevated(overlayIsElevated());
    return onOverlayElevationChange(setElevated);
  }, []);

  useEffect(() => {
    registerPaywallOpen(() => setOpen(true));
    return () => registerPaywallOpen(null);
  }, []);

  if (!open) return null;
  return <PaywallSheet onClose={() => setOpen(false)} webCheckout={webCheckout} elevated={elevated} />;
}

function PaywallSheet({
  onClose,
  webCheckout,
  elevated,
}: {
  onClose: () => void;
  webCheckout: boolean;
  elevated: boolean;
}) {
  const t = useTranslations("Paywall");
  const tp = useTranslations("Pricing");
  // Bara raderna där Pro skiljer sig — arket säljer skillnaden, sidan visar allt.
  const rows = proOnlyRows(
    pausableFeatures(tp.raw("specRows") as SpecRow[], [
      { items: tp.raw("specRowsPrice") as SpecRow[], paused: priceAlertsPausedClient() },
      { items: tp.raw("specRowsRestock") as SpecRow[], paused: restockAlertsPausedClient() },
    ])
  );

  return (
    <BottomSheet
      open
      title={t("title")}
      onClose={onClose}
      closeLabel={t("close")}
      elevated={elevated}
      // Desktop: ett ark som spänner hela fönsterbredden läser som en banner, inte
      // som en dialog. Centrerat och kortsmalt från sm: — mobilen är orörd.
      panelClassName="sm:mx-auto sm:mb-6 sm:w-full sm:max-w-md sm:rounded-[20px]"
      footer={
        <>
          <UpgradeButton webCheckout={webCheckout} compact />
          <p className="mt-2.5 text-center text-[11px] leading-snug text-ink-faint">{tp("subRenewNote")}</p>
          <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 text-[11px] text-ink-muted">
            <Link href="/villkor" onClick={onClose} className="underline underline-offset-2 hover:text-ink">
              {tp("legalTerms")}
            </Link>
            <span aria-hidden="true" className="text-ink-faint">
              ·
            </span>
            <Link href="/integritetspolicy" onClick={onClose} className="underline underline-offset-2 hover:text-ink">
              {tp("legalPrivacy")}
            </Link>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-1.5 w-full py-2 text-center text-sm text-ink-faint transition-colors hover:text-ink-muted"
          >
            {t("notNow")}
          </button>
        </>
      }
    >
      <div className="flex flex-col items-center pb-2 pt-1">
        <ProHoloCard size="compact" showHint={false} />
        <p className="mt-5 text-center font-display text-[26px] font-bold leading-none tracking-tight text-ink">
          {tp("heroPrice")}
        </p>
        <p className="mt-2 text-center text-sm text-ink-muted">{t("lead")}</p>
        <ProSpecTable
          rows={rows}
          freeLabel={tp("specFree")}
          proLabel={tp("specPro")}
          compact
          className="mt-4 w-full"
        />
        <Link
          href="/priser"
          onClick={onClose}
          className="mt-3 text-xs font-medium text-holo-cyan underline-offset-2 hover:underline"
        >
          {t("seeAll")}
        </Link>
      </div>
    </BottomSheet>
  );
}
