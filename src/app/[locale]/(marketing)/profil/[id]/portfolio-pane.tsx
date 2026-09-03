import { getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/format";
import type { computeCollectionValue } from "@/services/collection";
import { LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCards, IconLock } from "@/components/ui/icons";

type CollectionSummary = Awaited<ReturnType<typeof computeCollectionValue>>;

/**
 * Profilens Portfölj-flik: personens samling på Foilio. Samma integritetsregel
 * som förut — andra ser bara objekt + antal när samlingen är publik, aldrig
 * belopp; ägaren ser sitt eget värde. `collection` är null när samlingen är
 * privat och betraktaren inte är ägaren.
 */
export async function PortfolioPane({
  collection,
  isOwnProfile,
  userName,
}: {
  collection: CollectionSummary | null;
  isOwnProfile: boolean;
  userName: string;
}) {
  const t = await getTranslations("Profile");

  if (!collection) {
    return (
      <EmptyState
        icon={<IconLock size={32} />}
        title={t("portfolioPrivate", { name: userName })}
        description=""
      />
    );
  }

  if (collection.topItems.length === 0) {
    return (
      <EmptyState
        icon={<IconCards size={32} />}
        title={isOwnProfile ? t("portfolioEmptyOwn") : t("noItems")}
        description=""
        action={
          isOwnProfile ? (
            <LinkButton href="/samling" size="sm" variant="outline">
              {t("openPortfolio")}
            </LinkButton>
          ) : undefined
        }
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("collectionTitle")}</CardTitle>
        {isOwnProfile ? (
          <span className="font-display text-lg font-bold text-holo-cyan">
            {formatPrice(collection.totalValue)}
          </span>
        ) : (
          <span className="text-sm text-ink-faint">
            {t("itemsCount", { count: collection.itemCount })}
          </span>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <ol className="divide-y divide-surface-border">
          {collection.topItems.map((item, index) => (
            <li key={item.id} className="flex items-center gap-3 px-5 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-holo-cyan/10 text-xs font-bold text-holo-cyan">
                {index + 1}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.name}</p>
              <span className="shrink-0 text-xs text-ink-muted">
                {t("pieces", { count: item.quantity })}
              </span>
              {isOwnProfile && (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {formatPrice(item.totalValue)}
                </span>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
      {isOwnProfile && (
        <CardFooter>
          <LinkButton href="/samling" size="sm" variant="outline">
            {t("openPortfolio")}
          </LinkButton>
        </CardFooter>
      )}
    </Card>
  );
}
