"use client";

/**
 * "Dela" på samlingen (2026-10-06, tillväxtlistan punkt 1): en story-bild med de tre
 * mest värdefulla posterna i en solfjäder, totalvärdet, 30-dagarsförändringen och
 * värdekurvan — med användarens personliga inbjudningslänk i sidfoten.
 *
 * ⛔ Talen är sidans egna (`computeCollectionValue` för vald pärm) — samma totalvärde
 *    och samma kurva som heron ovanför. Förändringen räknas som heron räknar den
 *    (sista punkten mot första i fönstret), så bild och app säger samma sak.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { IconShare } from "@/components/ui/icons";
import { ShareCardPanel } from "@/components/features/share-card-panel";
import { renderCollectionShareCard, type ShareChartPoint } from "@/lib/share-card";
import { shareChangeOverDays, shareChartWindow } from "@/lib/share-card-data";
import { formatPrice } from "@/lib/format";

export function CollectionShareButton(props: {
  /** Pärmens namn, eller null för hela samlingen. */
  portfolioName: string | null;
  totalValue: number;
  itemCount: number;
  chart: ShareChartPoint[];
  top: { imageUrl: string | null; fallbackImageUrl: string | null }[];
}) {
  const t = useTranslations("ShareCard");
  const [open, setOpen] = useState(false);
  const title = props.portfolioName ?? t("collectionName");
  const chart = shareChartWindow(props.chart, 90);
  const change = shareChangeOverDays(props.chart, 30, t("period30"));

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={t("collectionOpen")}>
        <IconShare size={15} />
        {t("open")}
      </Button>
      <BottomSheet
        open={open}
        title={t("collectionTitle")}
        closeLabel={t("back")}
        onClose={() => setOpen(false)}
        panelClassName="sm:mx-auto sm:max-w-md"
      >
        {open && (
          <ShareCardPanel
            source="collection"
            previewMax="58dvh"
            safeBottom
            name={title}
            render={(domain) =>
              renderCollectionShareCard({
                title,
                subtitle: t("collectionItems", { count: props.itemCount }),
                value: { label: t("collectionValueLabel"), text: formatPrice(props.totalValue) },
                change,
                chart: chart.points,
                chartPeriod: t("chartDays", { days: chart.days }),
                top: props.top,
                footer: { lead: t("collectionFooterLead"), domain },
              })
            }
          />
        )}
      </BottomSheet>
    </>
  );
}
