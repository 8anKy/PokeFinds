"use client";

/**
 * "Dela" på produktvyn (2026-10-06): cirkeln uppe till höger på scenen öppnar en
 * story-bild med produktbilden, rubrikpriset, 30-dagarsförändringen och grafen
 * (`renderProductShareCard`), och en liggande variant att svepa till
 * (`renderProductWideShareCard`, 2026-10-06). Inloggade får sin personliga inbjudningslänk i
 * sidfoten — samma ark och regler som skanningens delningskort.
 *
 * ⛔ Bilden visar exakt vyns tal: `stats.lowestPrice` (rubrikpriset), `change30`
 *    och `chartData`. Saknas priset utelämnas raden — aldrig "0 kr".
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ProductDetailData } from "@/services/products";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CircleButton } from "@/components/ui/back-circle";
import { IconShare } from "@/components/ui/icons";
import { ShareCardPanel } from "@/components/features/share-card-panel";
import { renderProductShareCard, renderProductWideShareCard, type ProductShareInput } from "@/lib/share-card";
import { shareChartWindow, shareChangeFromPercent } from "@/lib/share-card-data";
import { formatPrice } from "@/lib/format";
import { overlayIsElevated } from "@/lib/product-overlay-open";

export function ProductShareButton({
  data,
  categoryLabel,
  className,
}: {
  data: ProductDetailData;
  categoryLabel: string;
  className?: string;
}) {
  const t = useTranslations("ShareCard");
  const [open, setOpen] = useState(false);
  const [elevated, setElevated] = useState(false);

  const chart = shareChartWindow(data.chartData, 90);
  const change = shareChangeFromPercent(data.change30, t("period30"));
  const input = (domain: string): ProductShareInput => ({
    imageUrl: data.imageUrl,
    name: data.title,
    subtitle: [data.set?.name, categoryLabel].filter(Boolean).join(" · "),
    shape: data.category === "SINGLE_CARD" ? "card" : "box",
    value:
      data.stats.lowestPrice != null && data.stats.lowestPrice > 0
        ? { label: t("productValueLabel"), text: formatPrice(data.stats.lowestPrice) }
        : null,
    change,
    chart: chart.points,
    chartPeriod: t("chartDays", { days: chart.days }),
    footer: { lead: t("productFooterLead"), domain },
  });

  return (
    <>
      <CircleButton
        label={t("productOpen")}
        onClick={() => {
          // Öppnad ur skannern ligger overlayn över kameravyn — arket måste med.
          setElevated(overlayIsElevated());
          setOpen(true);
        }}
        className={className}
      >
        <IconShare size={18} />
      </CircleButton>
      <BottomSheet
        open={open}
        title={t("productTitle")}
        closeLabel={t("back")}
        onClose={() => setOpen(false)}
        elevated={elevated}
        panelClassName="sm:mx-auto sm:max-w-md"
      >
        {open && (
          <ShareCardPanel
            key={data.slug}
            source="product"
            previewMax="58dvh"
            safeBottom
            name={data.title}
            pages={[
              { key: "story", render: (domain) => renderProductShareCard(input(domain)) },
              { key: "wide", wide: true, render: (domain) => renderProductWideShareCard(input(domain)) },
            ]}
          />
        )}
      </BottomSheet>
    </>
  );
}
