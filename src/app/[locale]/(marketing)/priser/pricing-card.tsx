"use client";

import { useEffect, useState } from "react";
import { CardPreview } from "@/components/features/paywall-sheet";
import type { PaywallCardPreview } from "@/lib/paywall";

/**
 * Exempelkortet överst på /priser (A+). Sidan är statisk, så priset och linjen hämtas
 * i klienten ur SAMMA payload som produktsidan (`/api/products/<slug>/detail`, cachad
 * 10 min i CDN + 1 h i servern ⇒ ingen extra Neon-väckning). Bara publika fält: priset
 * och den öppna kurvan — de låsta raderna förblir platshållare.
 */
const SLUG = "umbreon-ex-sv8pt5-161";

export function PricingCard({ unlocked = false }: { unlocked?: boolean }) {
  const [preview, setPreview] = useState<PaywallCardPreview>({
    kind: "card",
    imageUrl: "https://images.pokemontcg.io/sv8pt5/161_hires.png",
    name: "Umbreon ex · 161",
    setName: "Prismatic Evolutions",
    priceOre: null,
    graded: true,
    trend: null,
  });

  useEffect(() => {
    let alive = true;
    fetch(`/api/products/${SLUG}/detail`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stats?: { lowestPrice?: number | null }; chartData?: { price: number }[] } | null) => {
        if (!alive || !d) return;
        setPreview((p) => ({
          ...p,
          priceOre: d.stats?.lowestPrice ?? null,
          trend: (d.chartData ?? []).slice(-90).map((x) => x.price),
        }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return <CardPreview preview={preview} unlocked={unlocked} />;
}
