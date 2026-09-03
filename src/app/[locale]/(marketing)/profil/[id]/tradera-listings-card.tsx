import { getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { SafeImage } from "@/components/ui/safe-image";
import { IconExternalLink, IconPackage } from "@/components/ui/icons";
import { traderaSellerProfileUrl, type SellerListing } from "@/lib/tradera-seller-items";

/** Rutnätet visar högst så här många; "Visa alla på Tradera" tar resten. */
const MAX_SHOWN = 12;

/**
 * "Till salu på Tradera" — säljarens aktiva Pokémon-annonser, hämtade av
 * sidan via `getTraderaSellerListingsCached` (1 h, ingen DB). Renderas bara när
 * ägaren själv slagit på visningen i Inställningar (`showTraderaListings`).
 *
 * Varje ruta är en extern länk rakt till annonsen: köpet sker hos Tradera, vi
 * är bara skyltfönstret. Priset är en AVLÄSNING (ledande bud eller Köp nu) och
 * kan ha ändrats sedan cachen fylldes — därför inget "nu"-ord i copyn.
 */
export async function TraderaListingsCard({
  listings,
  traderaUserId,
  isOwnProfile,
}: {
  listings: SellerListing[];
  traderaUserId: string;
  isOwnProfile: boolean;
}) {
  // Andras tomma lista renderas inte alls: ett tomt kort på någon annans profil
  // säger bara "den här personen har inget till salu", vilket ingen bad om.
  // Ägaren ser det tomma läget så hen förstår att reglaget faktiskt är på.
  if (listings.length === 0 && !isOwnProfile) return null;

  const t = await getTranslations("Profile");
  const shown = listings.slice(0, MAX_SHOWN);

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>{t("traderaTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-muted">{t("traderaEmpty")}</p>
        ) : (
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
                      {l.itemType === "buyNow" && (
                        <Badge variant="info">{t("listingBuyNow")}</Badge>
                      )}
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
        )}
      </CardContent>
      {/* Bar id räcker i Traderas profil-URL (aliaset är valfritt) — verifierat 2026-09-03. */}
      <CardFooter>
        <a
          href={traderaSellerProfileUrl(traderaUserId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-holo-cyan hover:underline"
        >
          {t("traderaViewAll")}
          <IconExternalLink size={14} />
        </a>
      </CardFooter>
    </Card>
  );
}
