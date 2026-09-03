import { getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/format";
import { groupLots } from "@/lib/collection-lots";
import {
  cheapestProductSlugByCard,
  listCollection,
  valueCollectionItems,
} from "@/services/collection";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCards, IconLock } from "@/components/ui/icons";
import { ProfileCollectionGrid, type ProfileCollectionCell } from "./profile-collection-grid";

/** Fler rutor än så här visar profilen inte — ägaren har /samling, andra har sett nog. */
const MAX_CELLS = 60;

/**
 * Profilens Portfölj-flik: personens samling på Foilio i SAMMA cellformat som
 * samlingens eget rutnät (ägarbeslut 2026-09-03: "cell format like we already
 * have", inte en rankad lista). Samma integritetsregel som förut — andra ser
 * objekt + antal när samlingen är publik, ALDRIG belopp; ägaren ser sina värden.
 *
 * Data: samma tre läsningar som /samling (poster, live-värden, kortets
 * billigaste produkt-slug) men utan historik/movers — sidan är redan dynamisk
 * och det här är ett tryck på en flik, inte en crawl-yta.
 */
export async function PortfolioPane({
  userId,
  canSee,
  isOwnProfile,
  userName,
}: {
  userId: string;
  canSee: boolean;
  isOwnProfile: boolean;
  userName: string;
}) {
  const [t, tc] = await Promise.all([getTranslations("Profile"), getTranslations("Collection")]);

  if (!canSee) {
    return (
      <EmptyState
        icon={<IconLock size={32} />}
        title={t("portfolioPrivate", { name: userName })}
        description=""
      />
    );
  }

  const items = await listCollection(userId);
  if (items.length === 0) {
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

  const cardIds = items.map((i) => i.cardId).filter((v): v is string => v != null);
  const [values, slugByCard] = await Promise.all([
    valueCollectionItems(items),
    cheapestProductSlugByCard(cardIds),
  ]);

  // En ruta per VARA: flera köp av samma kort blir en ruta med totalantal.
  const groups = groupLots(items);
  const cells: ProfileCollectionCell[] = groups.map((g) => {
    const r = g.lots[0];
    return {
      key: g.key,
      name: r.card?.name ?? r.product?.title ?? r.notes ?? tc("unknownItem"),
      setName: r.card?.set?.name ?? null,
      imageUrl: r.imageUrl ?? r.card?.imageUrl ?? r.product?.imageUrl ?? null,
      slug: r.product?.slug ?? (r.cardId ? (slugByCard.get(r.cardId) ?? null) : null),
      quantity: g.quantity,
      unitValue: values.get(r.id) ?? null,
    };
  });
  // Mest värt först — samma ordning som samlingens "värde"-sortering.
  cells.sort((a, b) => (b.unitValue ?? 0) * b.quantity - (a.unitValue ?? 0) * a.quantity);

  const totalValue = cells.reduce((sum, c) => sum + (c.unitValue ?? 0) * c.quantity, 0);
  const shown = cells.slice(0, MAX_CELLS);
  const hidden = cells.length - shown.length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink">{t("collectionTitle")}</h2>
        {isOwnProfile ? (
          <span className="font-display text-lg font-bold text-holo-cyan">
            {formatPrice(totalValue)}
          </span>
        ) : (
          <span className="text-sm text-ink-faint">{t("itemsCount", { count: cells.length })}</span>
        )}
      </div>

      {/* Belopp bara till ägaren: andra får rutor med namn, set och antal. */}
      <ProfileCollectionGrid
        cells={isOwnProfile ? shown : shown.map((c) => ({ ...c, unitValue: null }))}
        showValues={isOwnProfile}
      />

      {(hidden > 0 || isOwnProfile) && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {hidden > 0 ? (
            <span className="text-sm text-ink-muted">{t("portfolioMore", { count: hidden })}</span>
          ) : (
            <span />
          )}
          {isOwnProfile && (
            <LinkButton href="/samling" size="sm" variant="outline">
              {t("openPortfolio")}
            </LinkButton>
          )}
        </div>
      )}
    </div>
  );
}
