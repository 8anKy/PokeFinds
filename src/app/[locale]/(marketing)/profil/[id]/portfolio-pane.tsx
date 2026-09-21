import { getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/format";
import { groupLots } from "@/lib/collection-lots";
import {
  cheapestProductSlugByCard,
  listCollection,
  valueCollectionItems,
} from "@/services/collection";
import { listPortfolios, listPublicPortfolios } from "@/services/portfolios";
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
  askOwnerId,
}: {
  userId: string;
  canSee: boolean;
  isOwnProfile: boolean;
  userName: string;
  /** Ägarens id när betraktaren får fråga "Är den till salu?", annars null (sidan avgör). */
  askOwnerId: string | null;
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

  // PÄRMAR (2026-09-21): andra ser bara de OFFENTLIGA pärmarna, ägaren alla.
  // `canSee` ovan är "minst en pärm är offentlig" (User.isPublicCollection
  // speglas av pärm-tjänsten); här filtreras posterna ned till just dem.
  const [allItems, visiblePortfolios] = await Promise.all([
    listCollection(userId),
    isOwnProfile ? listPortfolios(userId) : listPublicPortfolios(userId),
  ]);
  const visibleKeys = new Set(visiblePortfolios.map((p) => (p.isDefault ? null : p.id)));
  const items = allItems.filter((i) => visibleKeys.has(i.portfolioId));
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
  // Grupperingen sker PER PÄRM — samma kort i två pärmar är två rutor med flit.
  const toCells = (lots: typeof items): ProfileCollectionCell[] => {
    const cells = groupLots(lots).map((g) => {
      const r = g.lots[0];
      return {
        key: g.key,
        itemId: r.id,
        name: r.card?.name ?? r.product?.title ?? r.customTitle ?? r.notes ?? tc("unknownItem"),
        setName: r.card?.set?.name ?? null,
        imageUrl: r.imageUrl ?? r.card?.imageUrl ?? r.product?.imageUrl ?? null,
        slug: r.product?.slug ?? (r.cardId ? (slugByCard.get(r.cardId) ?? null) : null),
        quantity: g.quantity,
        unitValue: values.get(r.id) ?? null,
      };
    });
    // Mest värt först — samma ordning som samlingens "värde"-sortering.
    cells.sort((a, b) => (b.unitValue ?? 0) * b.quantity - (a.unitValue ?? 0) * a.quantity);
    return cells;
  };
  // En sektion per synlig pärm (rubrik bara när det finns fler än en).
  const sections = visiblePortfolios
    .map((p) => ({
      portfolio: p,
      cells: toCells(items.filter((i) => i.portfolioId === (p.isDefault ? null : p.id))),
    }))
    .filter((s) => s.cells.length > 0);
  const cellCount = sections.reduce((n, s) => n + s.cells.length, 0);
  const totalValue = sections.reduce(
    (sum, s) => sum + s.cells.reduce((acc, c) => acc + (c.unitValue ?? 0) * c.quantity, 0),
    0
  );
  let hidden = 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink">{t("collectionTitle")}</h2>
        {isOwnProfile ? (
          <span className="font-display text-lg font-bold text-holo-cyan">
            {formatPrice(totalValue)}
          </span>
        ) : (
          <span className="text-sm text-ink-faint">{t("itemsCount", { count: cellCount })}</span>
        )}
      </div>

      {/* Belopp bara till ägaren: andra får rutor med namn, set och antal. */}
      {sections.map(({ portfolio, cells }) => {
        const shown = cells.slice(0, MAX_CELLS);
        hidden += cells.length - shown.length;
        return (
          <div key={portfolio.id} className="mb-5 last:mb-0">
            {sections.length > 1 && (
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                {portfolio.name}
                <span className="text-xs font-normal text-ink-faint">
                  {t("itemsCount", { count: cells.length })}
                </span>
                {isOwnProfile && !portfolio.isPublic && (
                  <span className="text-ink-faint" title={t("binderPrivate")}>
                    <IconLock size={12} />
                  </span>
                )}
              </p>
            )}
            <ProfileCollectionGrid
              cells={isOwnProfile ? shown : shown.map((c) => ({ ...c, unitValue: null }))}
              showValues={isOwnProfile}
              ask={askOwnerId ? { ownerId: askOwnerId } : undefined}
            />
          </div>
        );
      })}

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
