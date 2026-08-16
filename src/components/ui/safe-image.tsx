"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, type ReactNode } from "react";

/**
 * Namngivna bildproportioner.
 *
 * Talen bär KVOTEN, inte ett påstående om filens pixlar: webbläsaren använder
 * `width`/`height` för att räkna ut förhållandet och reservera rutan innan
 * bilden kommit — CSS:en bestämmer sedan den faktiska storleken. De är ändå
 * satta i samma storleksordning som källbilderna, så att ett anropsställe som
 * INTE sätter någon storlek i CSS renderar en rimlig ruta i stället för 5×7 px.
 */
const RATIOS = {
  /** Enskilt kort i en ruta som hugger om motivet (trading-card ≈ 5:7). */
  card: [500, 700],
  /** Katalogens kvadratiska bildbrunn — sealed OCH singlar skalas in i den. */
  square: [600, 600],
} as const;

export type SafeImageRatio = keyof typeof RATIOS | "auto";

interface SafeImageProps {
  src: string | null | undefined;
  alt: string;
  /** Visas när src saknas ELLER när bilden inte gick att ladda. */
  fallback: ReactNode;
  className?: string;
  /**
   * Bildens proportion — sätter både `width`/`height` och CSS `aspect-ratio` så
   * att rutan är reserverad före laddning (inget layoutskift på 4G).
   *
   * ⛔ Default är `"auto"` MED FLIT. Setlogotyperna är olika breda (vissa nästan
   * kvadratiska, vissa väldigt liggande) och renderas med `max-h-*`/`max-w-*`
   * UTAN fast ruta — tvingar man på dem en kvot blir de utdragna. Ange en
   * namngiven kvot bara där formatet faktiskt är känt.
   */
  ratio?: SafeImageRatio;
}

/**
 * <img> som degraderar till en placeholder i stället för webbläsarens trasiga
 * bild-ikon + alt-text-ruta.
 *
 * Varför: produktbilderna kommer från källor vi inte äger (Cardmarkets bild-CDN,
 * butikernas foton). Cardmarket saknar helt render för en del SKU:er — särskilt
 * blistrar/checklanes — och flyttar då och då bilder till nya bucketar; butiker
 * byter CDN. Katalogen såg då trasig ut för besökaren fast bara EN bild fattades.
 * Datat städas separat (scripts/fix-missing-images.ts); det här är golvet som
 * garanterar att en död bild-URL aldrig syns som en bugg.
 */
export function SafeImage({ src, alt, fallback, className, ratio = "auto" }: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  const dims = ratio === "auto" ? null : RATIOS[ratio];
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      // Attributen och `aspect-ratio` hör IHOP och gör olika jobb: attributen ger
      // webbläsaren kvoten redan i HTML:en, `aspect-ratio` håller kvar den när
      // CSS:en sätter EN av dimensionerna (t.ex. `w-full`) — utan den hade
      // attributen skalats bort och höjden fallit till 0 tills bilden laddat.
      // Sätter CSS:en BÅDA (`h-full w-full` i en redan reserverad brunn) vinner
      // CSS:en och raden är gratis.
      width={dims?.[0]}
      height={dims?.[1]}
      style={dims ? { aspectRatio: `${dims[0]} / ${dims[1]}` } : undefined}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
