import { cn } from "@/lib/utils";
import { SafeImage } from "@/components/ui/safe-image";

/**
 * Butikens logga i butiksraden — en kvadrat med 10 px radie (variant 4 i
 * produktvy-designen, ägarbeslut 2026-09-05).
 *
 * Filerna under `public/retailer-logos/` är FÄRDIGKOMPONERADE 128×128-plattor:
 * märket ligger redan på en ljus eller mörk botten vald efter märkets egen
 * ljushet (Beam och Dragon's Lair är svarta märken, Rogerz är vitt), så här
 * visas bilden bara `object-cover`. Se `scripts/fetch-retailer-logos.ts`.
 * Saknas loggan får butiken sin initial på mörk platta — samma ruta, samma
 * kant, så listan inte hoppar mellan butiker med och utan.
 */
export function RetailerLogo({
  name,
  logoUrl,
  size = 44,
  className,
}: {
  name: string;
  logoUrl: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-surface-border bg-surface-overlay font-semibold text-ink-muted",
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      <SafeImage
        src={logoUrl}
        alt=""
        ratio="square"
        className="h-full w-full object-cover"
        fallback={<span>{initial}</span>}
      />
    </span>
  );
}
