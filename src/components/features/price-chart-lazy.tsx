"use client";

/**
 * Laddar prishistorik-grafen (recharts, ~100 kB) FÖRST efter att produktsidan
 * målats — recharts ligger då inte i sidans initiala JS-bundle, vilket gör
 * produktsidan snabbare att ladda och interagera med. En platshållare i samma
 * höjd (300px) visas tills grafen hydrerats → inget layout-hopp.
 */
import dynamic from "next/dynamic";
import type { PriceChartProps } from "@/components/features/price-chart";

const PriceChart = dynamic(
  () => import("@/components/features/price-chart").then((m) => m.PriceChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] w-full animate-pulse rounded-xl bg-surface-overlay" aria-hidden />
    ),
  }
);

export function PriceChartLazy(props: PriceChartProps) {
  return <PriceChart {...props} />;
}
