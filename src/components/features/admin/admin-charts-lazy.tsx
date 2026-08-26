"use client";

/**
 * Laddar adminens recharts-grafer FÖRST efter att sidan målats — samma skäl som
 * `price-chart-lazy.tsx`: biblioteket (~100 kB) ska inte ligga i den initiala
 * bundlen. Platshållarna har samma höjd som graferna → inget layout-hopp.
 *
 * ⛔ Tratten ligger i `funnel-chart.tsx` och importeras RAKT, inte härifrån. Den
 * använder ingen recharts, och en statisk import ur den här modulen hade dragit
 * in hela biblioteket ändå och gjort det lata bygget meningslöst.
 */
import dynamic from "next/dynamic";

function Skeleton({ height }: { height: number }) {
  return (
    <div
      className="w-full animate-pulse rounded-xl bg-surface-overlay"
      style={{ height }}
      aria-hidden
    />
  );
}

export const UserGrowthChartLazy = dynamic(
  () => import("./admin-charts").then((m) => m.UserGrowthChart),
  { ssr: false, loading: () => <Skeleton height={288} /> }
);

export const ActivityChartLazy = dynamic(
  () => import("./admin-charts").then((m) => m.ActivityChart),
  { ssr: false, loading: () => <Skeleton height={312} /> }
);

export const ScanChartLazy = dynamic(() => import("./admin-charts").then((m) => m.ScanChart), {
  ssr: false,
  loading: () => <Skeleton height={248} />,
});
