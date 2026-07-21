"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, type ReactNode } from "react";

interface SafeImageProps {
  src: string | null | undefined;
  alt: string;
  /** Visas när src saknas ELLER när bilden inte gick att ladda. */
  fallback: ReactNode;
  className?: string;
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
export function SafeImage({ src, alt, fallback, className }: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
