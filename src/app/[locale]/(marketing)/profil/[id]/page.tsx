import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { getFeed } from "@/services/community";
import { communityV2Request } from "@/lib/community-v2-server";
import { allowsPurchaseRequests } from "@/lib/purchase-requests";
import { getTraderaSellerListingsCached, type SellerListing } from "@/lib/tradera-seller-items";
import { Badge } from "@/components/ui/badge";
import { IconCheck } from "@/components/ui/icons";
import { SwipeBack } from "@/components/ui/swipe-back";
import { SwipeTabs, type SwipeTab } from "@/components/ui/swipe-tabs";
import { ThreadList } from "@/components/community/thread-list";
import { MessageButton } from "./message-button";
import { PortfolioPane } from "./portfolio-pane";
import { TraderaListingsPane } from "./tradera-listings-pane";

export const dynamic = "force-dynamic";

/**
 * ⛔ PROFILSIDAN INDEXERAS INTE (2026-08-17). Sidan är `force-dynamic` och gör
 * `auth()` + flera DB-frågor per visning — varje crawl är alltså en Neon-väckning
 * (minst 300 s debiterad tid) för en sida vars enda värde är för den som redan
 * har länken. Att en användares namn, rykte och offentliga samling hamnar i ett
 * sökresultat är dessutom inget hen har bett om.
 *
 * ⛔ Alternativet var ett `Disallow: /profil/` i robots.ts — VALT BORT med flit:
 * en disallowad URL HÄMTAS ALDRIG, så Google läser aldrig noindex-taggen och
 * URL:en förblir behörig för URL-only-indexering (bar länk, ingen titel, går
 * inte att få bort). Noindex kräver att sidan får hämtas — den ena gången.
 *
 * Realiserad crawl-volym är ändå ~noll: forumet länkar hit sedan 2026-09-03
 * (trådens författare), men forumet är självt grindat/noindex tills lansering,
 * och sitemapen listar aldrig profiler. Kostnaden är alltså inte det bindande
 * skälet, integriteten är det.
 *
 * ⛔ Lägg INTE till `alternatesFor()` här. En kanonisk tagg är en INBJUDAN att
 * crawla, och en ocachad force-dynamic DB-sida är precis vad vi inte vill bjuda
 * in till. `follow: false` av samma skäl.
 *
 * LAYOUT (ägarbeslut 2026-09-03): huvud + TRE FLIKAR — Inlägg, Portfölj, Tradera —
 * svepbara (SwipeTabs), och kant-svep tillbaka till varifrån man kom (SwipeBack).
 * Portföljen är samma cellrutnät som /samling (read-only). Tradera-fliken finns
 * bara bakom community-grinden och när ägaren slagit på visningen (eller på den
 * egna profilen, med en väg till inställningen).
 *
 * ⛔ INGA UTMÄRKELSER I HUVUDET (ägarbeslut 2026-09-03, samma kväll): raden med
 * live-räknade märken (Veteran/Samlare/Aktiv) och lagrade utmärkelser är
 * BORTTAGEN — huvudet bär bara namn, medlem sedan och förtroenderaden. Kommer
 * de tillbaka gäller vitlistan som stod här: bara forsta_kortet, samlare,
 * setjagare, fullt_set, setmastare, arsmedlem, discordare, fadder är offentliga;
 * försäljnings-, graderings- och skannermärken är affärsinformation om en
 * privatperson och visas ALDRIG för andra. `reputationScore` skrivs ingenstans i
 * kodbasen (alltid 0) — raden är BORTTAGEN tills ägaren bestämt vad talet ska vara.
 */
export async function generateMetadata({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Profile" });
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { name: true },
  });
  return {
    title: user ? t("metaSuffix", { name: user.name }) : t("metaNotFound"),
    robots: { index: false, follow: false },
  };
}

export default async function ProfilePage({ params }: { params: { locale: string; id: string } }) {
  const t = await getTranslations("Profile");
  const [session, user] = await Promise.all([
    auth(),
    prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        isPublicCollection: true,
        createdAt: true,
        showTraderaListings: true,
        traderaUserId: true,
        discordUserId: true,
        preferences: true, // allowPurchaseRequests — se lib/purchase-requests.ts
        _count: { select: { sales: true } },
      },
    }),
  ]);
  if (!user) notFound();

  const isOwnProfile = session?.user?.id === user.id;
  // Community v2-grinden (forum, meddelanden, Tradera på profilen). Rollen
  // skickas in så helpern inte kör auth() en gång till. Sidan är redan dynamisk.
  const communityV2 = await communityV2Request(session?.user?.role ?? null);
  // Annonserna visas bara när ägaren själv slagit på det — samtycket sitter på
  // kontot (`showTraderaListings`) och nollas när Tradera-kopplingen bryts.
  const traderaUserId = communityV2 && user.showTraderaListings ? user.traderaUserId : null;
  const canSeeCollection = user.isPublicCollection || isOwnProfile;
  // "Är den till salu?" på rutorna: bara inloggade, bara andras OFFENTLIGA samling,
  // bara bakom grinden och bara när ägaren inte sagt nej i Inställningar.
  const canAsk =
    communityV2 &&
    !!session?.user &&
    !isOwnProfile &&
    user.isPublicCollection &&
    allowsPurchaseRequests(user.preferences);

  const [posts, listings] = await Promise.all([
    // Även sålda/avslutade annonser — det är personens historik, inte ett flöde.
    getFeed({ authorId: user.id, status: "all", page: 1, pageSize: 20 }),
    // Ingen DB: en Tradera-rundtur per profil och kvart (cachad), annars [].
    traderaUserId
      ? getTraderaSellerListingsCached(traderaUserId)
      : Promise.resolve<SellerListing[]>([]),
  ]);

  /**
   * Förtroenderaden (community v2): kopplade konton + antal försäljningar via
   * Foilio. Den finns för Köp/Sälj/Byt — en köpare som ska skicka pengar till en
   * främling vill veta att personen är den hen utger sig för. ⚠️ Antalet
   * försäljningar är samma slags uppgift som utmärkelserna ovan håller privata
   * (personen säljer kort); här är det ägarbeslut 2026-09-03 att den tål att visas
   * som antal — aldrig belopp, aldrig vinst — och bara bakom grinden.
   */
  const trust: { key: string; label: string }[] = [];
  if (communityV2) {
    if (user.traderaUserId) trust.push({ key: "tradera", label: t("trustTradera") });
    if (user.discordUserId) trust.push({ key: "discord", label: t("trustDiscord") });
    if (user._count.sales > 0) {
      trust.push({ key: "sales", label: t("trustSales", { count: user._count.sales }) });
    }
  }

  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const tabs: SwipeTab[] = [
    {
      id: "posts",
      label: t("tabPosts"),
      content: (
        <ThreadList
          initial={posts}
          author={user.id}
          emptyText={t("noPosts", { name: user.name })}
          // Utanför grinden bor trådarna i gamla communityt (samma id:n).
          hrefBase={communityV2 ? "/forum/t" : "/community"}
        />
      ),
    },
    {
      id: "portfolio",
      label: t("tabPortfolio"),
      content: (
        <PortfolioPane
          userId={user.id}
          canSee={canSeeCollection}
          isOwnProfile={isOwnProfile}
          userName={user.name}
          askOwnerId={canAsk ? user.id : null}
        />
      ),
    },
  ];
  if (communityV2 && (traderaUserId != null || isOwnProfile)) {
    tabs.push({
      id: "tradera",
      label: t("tabTradera"),
      content: (
        <TraderaListingsPane
          listings={listings}
          traderaUserId={traderaUserId}
          isOwnProfile={isOwnProfile}
        />
      ),
    });
  }

  return (
    <SwipeBack fallback={communityV2 ? "/forum" : "/community"}>
      <div className="mx-auto w-full max-w-3xl px-2.5 py-10">
        {/* Profilhuvud */}
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={t("avatarAlt", { name: user.name })}
              className="h-20 w-20 rounded-full border border-surface-border object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-holo-gradient font-display text-2xl font-bold text-surface"
            >
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold text-ink">{user.name}</h1>
            {/* Inget rykte: `reputationScore` skrivs ingenstans (alltid 0) — raden
                togs bort 2026-09-03 tills det finns en regel bakom talet. */}
            <p className="mt-1 text-sm text-ink-muted">
              {t("memberSince", { date: formatDate(user.createdAt) })}
            </p>
            {trust.length > 0 && (
              <ul className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
                {trust.map((c) => (
                  <li key={c.key}>
                    <Badge>
                      <IconCheck size={12} className="text-holo-cyan" />
                      {c.label}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Bara inloggade som inte är ägaren; utloggade ser ingenting (ingen
              inloggningsuppmaning här — profilen är ingen försäljningsyta). */}
          {communityV2 && session?.user && !isOwnProfile && <MessageButton userId={user.id} />}
        </div>

        {/* Inlägg · Portfölj · Tradera — svep mellan flikarna. */}
        <SwipeTabs tabs={tabs} ariaLabel={t("tabsLabel")} className="mt-8" />
      </div>
    </SwipeBack>
  );
}
