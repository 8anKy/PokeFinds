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

/**
 * ⛔ GEMENER MED FLIT — `fetchpriority`, inte `fetchPriority`.
 *
 * React lärde sig camelCase-stavningen först i 19. React 18 (som vi kör) känner
 * inte igen den, skriver dev-varningen "React does not recognize the
 * `fetchPriority` prop on a DOM element" och lägger ändå ut attributet i
 * gemener, eftersom HTML-attribut är skiftlägesokänsliga. Alltså: samma
 * resultat i webbläsaren, men brus i konsolen. `next/image` gör exakt samma val
 * internt (`getDynamicProps` väljer stavning på React-version).
 *
 * Att det sprids in i stället för att skrivas som ett vanligt JSX-attribut är
 * inte kosmetika: `@types/react` typar bara camelCase-varianten, och en
 * spridning kontrolleras inte som "överflödig prop". Byts React till 19 är
 * rätt åtgärd att byta till attributet `fetchPriority="high"` och ta bort
 * hela den här konstanten.
 */
const PRIORITY_ATTRS = { fetchpriority: "high" } as const;

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
  /**
   * Opt-in: hämta bilden DIREKT (`loading="eager"` + hög hämtningsprioritet) i
   * stället för när den närmar sig vyn.
   *
   * ⛔ Default är `false` MED FLIT och ska förbli det. `lazy` är rätt för de
   * hundratals bilder ett katalogrutnät innehåller — sätts flaggan brett tävlar
   * alla bilder om samma bandbredd och den ENDA som spelar roll för LCP blir
   * långsammare, inte snabbare. Flaggan hör hemma på bilden besökaren redan
   * tittar på när sidan målas: produktsidans huvudbild och de första korten i
   * ett rutnät.
   *
   * ⚠️ Ändrar INGA pixlar. Attributen styr NÄR webbläsaren hämtar filen, aldrig
   * vad som ritas — rutan är redan reserverad via `ratio`/CSS.
   */
  priority?: boolean;
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
export function SafeImage({
  src,
  alt,
  fallback,
  className,
  ratio = "auto",
  priority = false,
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  const dims = ratio === "auto" ? null : RATIOS[ratio];
  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      // `loading` säger BARA "hämta nu", inte "hämta först": en eager bild ställer
      // sig ändå i webbläsarens låga prioritetskö tillsammans med resten av
      // bilderna. `fetchpriority=high` är det som lyfter den förbi kön, och de två
      // hör därför ihop — sätter man bara den ena flyttar sig ingenting mätbart.
      {...(priority ? PRIORITY_ATTRS : {})}
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
