import { cn } from "@/lib/utils";

/**
 * Scoutr-varumärkeslås: löv-F-märket + ordmärket "Scoutr". Märket bär grönt
 * (varumärkesfärg); ordmärket är neutralt så det inte krockar med UI:ts turkosa
 * accent eller med pris-upp/ner-färgerna.
 */
export function BrandLogo({
  className,
  markSize = 34,
  textClass = "text-xl",
}: {
  className?: string;
  markSize?: number;
  textClass?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/scoutr-mark.png"
        alt="Scoutr"
        width={markSize}
        height={markSize}
        style={{ width: markSize, height: markSize }}
        className="shrink-0"
      />
      <span className={cn("font-bold tracking-tight text-ink", textClass)}>Scoutr</span>
    </span>
  );
}
