import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatPrice, formatRelative } from "@/lib/format";
import { computeCollectionValue } from "@/services/collection";
import { listUserAchievements } from "@/services/achievements";
import { communityV2Request } from "@/lib/community-v2-server";
import { getTraderaSellerListingsCached, type SellerListing } from "@/lib/tradera-seller-items";
import { POST_CATEGORY_VARIANTS } from "@/lib/community-labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconCheck, IconHeart, IconMessage, IconSparkle } from "@/components/ui/icons";
import { MessageButton } from "./message-button";
import { TraderaListingsCard } from "./tradera-listings-card";

export const dynamic = "force-dynamic";

/**
 * ⛔ PROFILSIDAN INDEXERAS INTE (2026-08-17). Sidan är `force-dynamic` och gör
 * `auth()` + tre DB-frågor per visning — varje crawl är alltså en Neon-väckning
 * (minst 300 s debiterad tid) för en sida vars enda värde är för den som redan
 * har länken. Att en användares namn, rykte och offentliga samling hamnar i ett
 * sökresultat är dessutom inget hen har bett om.
 *
 * ⛔ Alternativet var ett `Disallow: /profil/` i robots.ts — VALT BORT med flit:
 * en disallowad URL HÄMTAS ALDRIG, så Google läser aldrig noindex-taggen och
 * URL:en förblir behörig för URL-only-indexering (bar länk, ingen titel, går
 * inte att få bort). Noindex kräver att sidan får hämtas — den ena gången.
 *
 * Realiserad crawl-volym är ändå ~noll: INGENTING i repot länkar till /profil/
 * (verifierat med `git grep "profil/"` 2026-08-17) och sitemapen listar den inte.
 * Kostnaden är alltså inte det bindande skälet, integriteten är det.
 *
 * ⛔ Lägg INTE till `alternatesFor()` här. En kanonisk tagg är en INBJUDAN att
 * crawla, och en ocachad force-dynamic DB-sida är precis vad vi inte vill bjuda
 * in till. `follow: false` av samma skäl: de utgående länkarna pekar bara till
 * community-inlägg, som redan nås via /community:s egen lista — ingen
 * upptäcktsväg går förlorad.
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
  const tPost = await getTranslations("PostCategory");
  const [session, user] = await Promise.all([
    auth(),
    prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        reputationScore: true,
        isPublicCollection: true,
        createdAt: true,
        showTraderaListings: true,
        traderaUserId: true,
        discordUserId: true,
        _count: { select: { posts: true, sales: true } },
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

  const [recentPosts, collection, allAchievements, tA, listings] = await Promise.all([
    prisma.communityPost.findMany({
      where: { userId: user.id, isHidden: false },
      select: {
        id: true,
        title: true,
        category: true,
        createdAt: true,
        _count: { select: { likes: true, comments: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    user.isPublicCollection || isOwnProfile ? computeCollectionValue(user.id) : Promise.resolve(null),
    listUserAchievements(user.id),
    getTranslations("Achievements"),
    // Ingen DB: en Tradera-rundtur per profil och timme (cachad), annars [].
    traderaUserId
      ? getTraderaSellerListingsCached(traderaUserId)
      : Promise.resolve<SellerListing[]>([]),
  ]);

  /**
   * ⛔ INTE ALLA UTMÄRKELSER ÄR OFFENTLIGA. Profilsidan kan läsas av vem som helst
   * med länken, och "Första försäljningen"/"Vinstaffär" avslöjar att personen
   * SÄLJER kort, och gör det med vinst — det är affärsinformation om en privatperson,
   * inte en merit att sprida åt dem. Skanning och gradering avslöjar användningsmönster.
   * Vitlista i stället för svartlista: en NY utmärkelse ska default vara PRIVAT tills
   * någon aktivt bestämt att den tål att visas.
   * På sin EGEN profil ser man allt — där finns ingen att skydda sig från.
   */
  const PUBLIC_ACHIEVEMENTS = new Set([
    "forsta_kortet",
    "samlare",
    "setjagare",
    "fullt_set",
    "setmastare",
    "arsmedlem",
    "discordare",
    "fadder",
  ]);
  const achievements = isOwnProfile
    ? allAchievements
    : allAchievements.filter((a) => PUBLIC_ACHIEVEMENTS.has(a.key));

  // Enkla utmärkelser
  const badges: { label: string; variant: "holo" | "info" | "success" }[] = [];
  if (user.reputationScore > 100) badges.push({ label: t("badgeVeteran"), variant: "holo" });
  if (user.isPublicCollection) badges.push({ label: t("badgeCollector"), variant: "info" });
  if (user._count.posts > 10) badges.push({ label: t("badgeActive"), variant: "success" });

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

  // Inlägg bor i forumet när grinden släppt igenom, annars i det gamla communityt.
  const postHref = (id: string) => (communityV2 ? `/forum/t/${id}` : `/community/${id}`);

  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
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
          <p className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-ink-muted sm:justify-start">
            <span className="inline-flex items-center gap-1.5">
              <IconSparkle size={15} className="text-holo-gold" />
              <span className="tabular-nums">{user.reputationScore}</span> {t("reputation")}
            </span>
            <span aria-hidden="true" className="text-ink-faint">·</span>
            <span>{t("memberSince", { date: formatDate(user.createdAt) })}</span>
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
          {(badges.length > 0 || achievements.length > 0) && (
            <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
              {badges.map((b) => (
                <Badge key={b.label} variant={b.variant}>
                  {b.label}
                </Badge>
              ))}
              {/* ⚠️ De tre märkena ovan räknas LIVE och kan försvinna igen; de nedan
                  är lagrade fakta och kan aldrig tas ifrån någon. Samma rad, olika
                  hållbarhet — vet om det innan du slår ihop dem. */}
              {achievements.map((a) => (
                <Badge
                  key={a.id}
                  variant={a.variant}
                  title={tA(`${a.key}.desc`, { count: a.threshold })}
                >
                  {tA(`${a.key}.name`)}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {/* Bara inloggade som inte är ägaren; utloggade ser ingenting (ingen
            inloggningsuppmaning här — profilen är ingen försäljningsyta). */}
        {communityV2 && session?.user && !isOwnProfile && <MessageButton userId={user.id} />}
      </div>

      {/* Offentlig samling */}
      {collection && (user.isPublicCollection || isOwnProfile) && (
        <Card className="mt-8">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("collectionTitle")}</CardTitle>
            {isOwnProfile ? (
              <span className="font-display text-lg font-bold text-holo-cyan">
                {formatPrice(collection.totalValue)}
              </span>
            ) : (
              <span className="text-sm text-ink-faint">{t("itemsCount", { count: collection.itemCount })}</span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {collection.topItems.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                {t("noItems")}
              </p>
            ) : (
              <ol className="divide-y divide-surface-border">
                {collection.topItems.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-holo-cyan/10 text-xs font-bold text-holo-cyan">
                      {index + 1}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {item.name}
                    </p>
                    <span className="shrink-0 text-xs text-ink-muted">{t("pieces", { count: item.quantity })}</span>
                    {isOwnProfile && (
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                        {formatPrice(item.totalValue)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {/* Till salu på Tradera (community v2 + ägarens eget val) */}
      {traderaUserId && (
        <TraderaListingsCard
          listings={listings}
          traderaUserId={traderaUserId}
          isOwnProfile={isOwnProfile}
        />
      )}

      {/* Senaste inlägg */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>{t("recentPosts")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentPosts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">
              {t("noPosts", { name: user.name })}
            </p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {recentPosts.map((post) => (
                <li key={post.id}>
                  <Link
                    href={postHref(post.id)}
                    className="block px-5 py-3 transition-colors hover:bg-surface-overlay/50"
                  >
                    <div className="flex items-center gap-2">
                      {/* Kategorin är nullable sedan forumet (grupper ersatte den). */}
                      {post.category && (
                        <Badge variant={POST_CATEGORY_VARIANTS[post.category]}>
                          {tPost(post.category)}
                        </Badge>
                      )}
                      <span className="text-xs text-ink-faint">
                        {formatRelative(post.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium text-ink">{post.title}</p>
                    <p className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
                      <span className="inline-flex items-center gap-1">
                        <IconHeart size={13} />
                        <span className="tabular-nums">{post._count.likes}</span>
                        <span className="sr-only">{t("likes")}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <IconMessage size={13} />
                        <span className="tabular-nums">{post._count.comments}</span>
                        <span className="sr-only">{t("comments")}</span>
                      </span>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
