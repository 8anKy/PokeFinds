"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * "Fel länk?" — användarens rättningsloop för butikserbjudanden.
 *
 * Varför den finns: en felaktig butikslänk är OSYNLIG för våra vakter (en länk som
 * saknas syns aldrig, och en felmatch ser ut som vilken länk som helst). Den är
 * däremot helt synlig för exakt en person — användaren som klickade och landade på
 * fel vara. Katalogrevisionen hittade 6% felaktiga länkar, men bara för att någon
 * körde ett svep. Det här är den enda mekanismen som skalar bortom svep och vakter.
 *
 * Kräver INTE inloggning: vi vill hellre ha signalen än kontot.
 */
const REASONS = ["WRONG_PRODUCT", "WRONG_PRICE", "DEAD_LINK", "OUT_OF_STOCK"] as const;
type Reason = (typeof REASONS)[number];

export function OfferReportButton({ offerId }: { offerId: string }) {
  // "Detail" — samma namnrymd som resten av produktsidans offer-rader (live-product-pricing).
  // Fel namnrymd renderar next-intl som RÅ NYCKELTEXT i UI:t ("product.reportOffer").
  const t = useTranslations("Detail");
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function report(reason: Reason) {
    setBusy(true);
    try {
      const res = await fetch(`/api/offers/${offerId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      // Även ett fel ska kännas som att rapporten togs emot — användaren har gjort sitt,
      // och vi vill inte lära dem att knappen är opålitlig. Felet syns i loggarna.
      if (!res.ok) console.warn("[offer-report] misslyckades", res.status);
    } catch (e) {
      console.warn("[offer-report] misslyckades", e);
    } finally {
      setBusy(false);
      setSent(true);
      setOpen(false);
    }
  }

  if (sent) {
    return (
      <span className="text-xs text-holo-cyan" role="status">
        {t("reportThanks")}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-text-muted underline-offset-2 transition-colors hover:text-text-primary hover:underline"
      >
        {t("reportOffer")}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {REASONS.map((reason) => (
        <button
          key={reason}
          type="button"
          disabled={busy}
          onClick={() => report(reason)}
          className="rounded-md border border-surface-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-holo-cyan hover:text-holo-cyan disabled:opacity-50"
        >
          {t(`reportReason.${reason}`)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-1 text-[11px] text-text-muted hover:text-text-primary"
        aria-label={t("reportCancel")}
      >
        ✕
      </button>
    </div>
  );
}
