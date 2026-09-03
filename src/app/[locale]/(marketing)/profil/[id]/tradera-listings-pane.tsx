import { getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SafeImage } from "@/components/ui/safe-image";
import { IconExternalLink, IconPackage, IconStore } from "@/components/ui/icons";
import { traderaSellerProfileUrl, type SellerListing } from "@/lib/tradera-seller-items";

/** Rutnätet visar högst så här många; "Visa alla på Tradera" tar resten. */
const MAX_SHOWN = 12;

/**
 * Profilens Tradera-flik — säljarens aktiva Pokémon-annonser, hämtade av sidan
 * via `getTraderaSellerListingsCached` (1 h, ingen DB). `traderaUserId` är null
 * när ägaren inte slagit på visningen (`showTraderaListings`); fliken finns då
 * bara på den EGNA profilen, med en väg till inställningen.
 *
 * Varje ruta är en extern länk rakt till annonsen: köpet sker hos Tradera, vi
 * är bara skyltfönstret. Priset är en AVLÄSNING (ledande bud eller Köp nu) och
 * kan ha ändrats sedan cachen fylldes — därför inget "nu"-ord i copyn.
 */
export async function TraderaListingsPane({
  listings,
  traderaUserId,
  isOwnProfile,
}: {
  listings: SellerListing[];
  traderaUserId: string | null;
  isOwnProfile: boolean;
}) {
  const t = await getTranslations("Profile");

  if (!traderaUserId) {
    if (!isOwnProfile) return null;
    return (
      <EmptyState
        icon={<IconStore size={32} />}
        title={t("traderaOff")}
        description=""
        action={
          <LinkButton href="/installningar" size="sm" variant="outline">
            {t("traderaSettings")}
          </LinkButton>
        }
      />
    );
  }

  const viewAll = (
    <a
      href={traderaSellerProfileUrl(traderaUserId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-holo-cyan hover:underline"
    >
      {t("traderaViewAll")}
      <IconExternalLink size={14} />
    </a>
  );

  if (listings.length === 0) {
    return (
      <EmptyState
        icon={<IconPackage size={32} />}
        title={t("traderaEmpty")}
        description=""
        action={viewAll}
      />
    );
  }

  const shown = listings.slice(0, MAX_SHOWN);

  return (
    <div>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((l) => (
          <li key={l.itemId}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col overflow-hidden rounded-lg border border-surface-border transition-colors hover:bg-surface-overlay/50"
            >
              <div className="aspect-square w-full overflow-hidden bg-surface-overlay">
                <SafeImage
                  src={l.imageUrl}
                  alt={l.title}
                  className="h-full w-full object-cover"
                  fallback={
                    <div
                      aria-hidden="true"
                      className="flex h-full w-full items-center justify-center text-ink-faint"
                    >
                      <IconPackage size={28} />
                    </div>
                  }
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                <div className="flex items-center gap-2">
                  {l.itemType === "auction" && (
                    <Badge variant="warning">{t("listingAuction")}</Badge>
                  )}
                  {l.itemType === "buyNow" && <Badge variant="info">{t("listingBuyNow")}</Badge>}
                  <span className="ml-auto text-sm font-semibold tabular-nums text-ink">
                    {formatPrice(l.priceOre)}
                  </span>
                </div>
                <p className="line-clamp-2 text-xs leading-snug text-ink-muted transition-colors group-hover:text-ink">
                  {l.title}
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
      {/* Bar id räcker i Traderas profil-URL (aliaset är valfritt) — verifierat 2026-09-03. */}
      <div className="mt-4">{viewAll}</div>
    </div>
  );
}
