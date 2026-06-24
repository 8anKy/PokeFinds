import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatPrice } from "@/lib/format";
import { getTrending, getTopDrops } from "@/services/market";
import { getPriceHistory, searchProducts } from "@/services/products";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PriceChange } from "@/components/ui/price-change";
import { ProductCard } from "@/components/features/product-card";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";
import { NativeHomeRedirect } from "@/components/native-home-redirect";
import {
  IconArrowRight,
  IconBell,
  IconCamera,
  IconChart,
  IconCheck,
  IconMessage,
  IconPackage,
  IconPlus,
  IconSparkle,
  IconTrendingDown,
  IconTrendingUp,
} from "@/components/ui/icons";

// Startsidans data ändras ~en gång/dygn → cacha (ISR). Sparar Vercel CPU + Neon.
export const revalidate = 3600;

const FAQ: { q: string; a: string }[] = [
  {
    q: "Är Foilio gratis?",
    a: "Ja. Med ett gratiskonto kan du bevaka upp till 10 produkter, hantera en grundläggande samling och ta del av marknadsdata. Pro låser upp obegränsade bevakningar, alla restock-larm, AI-gradering och avancerad analys.",
  },
  {
    q: "Vilka butiker bevakar ni?",
    a: "Vi följer ett växande antal svenska återförsäljare av Pokémon TCG. Listan utökas löpande — saknar du en butik får du gärna höra av dig.",
  },
  {
    q: "Hur ofta uppdateras priserna?",
    a: "Priser och lagerstatus hämtas in löpande, flera gånger per dygn. Varje produktsida visar när datan senast uppdaterades.",
  },
  {
    q: "Hur funkar restock-alerts?",
    a: "Du bevakar en produkt och väljer restock-alert. Så fort vi upptäcker att produkten finns i lager igen hos någon butik skickar vi en notis — i appen och via e-post om du vill.",
  },
];

async function getShowcase() {
  const grouped = await prisma.priceSnapshot.groupBy({
    by: ["productId"],
    _count: { productId: true },
    orderBy: { _count: { productId: "desc" } },
    take: 1,
  });
  const productId = grouped[0]?.productId;
  if (!productId) return null;
  const [product, history] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      select: { title: true, slug: true },
    }),
    getPriceHistory(productId, 90),
  ]);
  if (!product) return null;
  return {
    product,
    points: history.map((s) => ({ date: new Date(s.date).toISOString(), price: s.avgPrice })),
  };
}

type Mover = Awaited<ReturnType<typeof getTrending>>[number];

function MoverRow({ mover }: { mover: Mover }) {
  return (
    <li>
      <Link
        href={`/produkter/${mover.product.slug}`}
        className="group flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-overlay/60"
      >
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink group-hover:text-holo-cyan transition-colors duration-150">
          {mover.product.title}
        </p>
        <span data-price className="shrink-0 text-sm font-semibold text-ink">
          {formatPrice(mover.lastPrice)}
        </span>
        <PriceChange percent={mover.changePercent} className="w-[4.5rem] shrink-0 justify-end" />
      </Link>
    </li>
  );
}

const FEATURES = [
  {
    icon: IconBell,
    title: "Prisbevakning & restock-alerts",
    text: "Sätt ett målpris eller bevaka lagerstatus. Vi meddelar dig direkt när något händer.",
  },
  {
    icon: IconSparkle,
    title: "Samlingsvärde",
    text: "Registrera din samling och se vad den är värd — uppdaterat med aktuell marknadsdata.",
  },
  {
    icon: IconChart,
    title: "Marknadstrender",
    text: "Prisindex, trendkurvor och de största prisfallen — allt i ett svep.",
  },
  {
    icon: IconCamera,
    title: "Kortskanning",
    text: "Skanna korten med kameran och lägg till dem i samlingen på sekunder.",
  },
  {
    icon: IconMessage,
    title: "Community",
    text: "Dela pulls, diskutera trades och följ andra svenska samlare.",
  },
  {
    icon: IconPackage,
    title: "Transparent prisdata",
    text: "Varje produktsida visar källa och senaste uppdatering. Inga dolda justeringar.",
  },
];

export default async function LandingPage() {
  const [trending, drops, showcase, popular] = await Promise.all([
    getTrending(4),
    getTopDrops(4),
    getShowcase(),
    searchProducts({ sort: "popular", page: 1, pageSize: 4 }),
  ]);

  return (
    <div>
      <NativeHomeRedirect />
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/3 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-holo-cyan/8 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div className="animate-fade-in-up">
            <h1 className="max-w-xl font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-[3.5rem] lg:leading-[1.1]">
              Din kontrollpanel för{" "}
              <span className="holo-text">Pokémon&nbsp;TCG</span>
            </h1>
            <div className="foil-line mt-6 w-20 rounded-full" aria-hidden="true" />
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-muted">
              Bevaka priser, lagerstatus och värdet på din samling — samlat på
              ett ställe, uppdaterat dygnet runt.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LinkButton href="/registrera" size="lg">
                Gå med gratis
              </LinkButton>
              <LinkButton href="/produkter" variant="outline" size="lg">
                Utforska marknaden
              </LinkButton>
            </div>
          </div>

          {/* Live market snapshot */}
          {(trending.length > 0 || drops.length > 0) && (
            <div className="card-surface animate-fade-in-up overflow-hidden shadow-card [animation-delay:100ms]">
              <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">Marknaden just nu</h2>
                <span className="text-xs text-ink-faint">Senaste 7 dagarna</span>
              </div>
              {trending.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-xs font-medium text-rise">
                    <IconTrendingUp size={14} />
                    Trendar uppåt
                  </p>
                  <ul>
                    {trending.slice(0, 3).map((m) => (
                      <MoverRow key={m.productId} mover={m} />
                    ))}
                  </ul>
                </div>
              )}
              {drops.length > 0 && (
                <div className="border-t border-surface-border/60">
                  <p className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-xs font-medium text-fall">
                    <IconTrendingDown size={14} />
                    Största prisfallen
                  </p>
                  <ul>
                    {drops.slice(0, 3).map((m) => (
                      <MoverRow key={m.productId} mover={m} />
                    ))}
                  </ul>
                </div>
              )}
              <Link
                href="/marknad"
                className="flex items-center justify-center gap-1.5 border-t border-surface-border px-4 py-3 text-sm font-medium text-holo-cyan transition-colors duration-150 hover:bg-surface-overlay/60"
              >
                Se hela marknaden
                <IconArrowRight size={16} />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ── Features grid ── */}
      <section className="border-y border-surface-border bg-surface-raised/30">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <h2 className="font-display text-3xl font-bold text-ink">
            Allt du behöver som samlare
          </h2>
          <p className="mt-3 max-w-xl text-ink-muted">
            Från prisbevakning till community — verktyg byggda för den svenska marknaden.
          </p>
          <div className="stagger-list mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-xl border border-surface-border bg-surface p-6 transition-all duration-200 hover:border-surface-overlay hover:bg-surface-raised/60"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-holo-cyan/10 text-holo-cyan transition-transform duration-200 group-hover:scale-110">
                  <f.icon size={20} />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold text-ink">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Price history showcase + popular products ── */}
      {(showcase || popular.items.length > 0) && (
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="grid items-start gap-12 lg:grid-cols-2">
            {showcase && (
              <div>
                <h2 className="font-display text-2xl font-bold text-ink">
                  Prishistorik som ger dig övertaget
                </h2>
                <p className="mt-3 text-ink-muted">
                  Se hur priserna rör sig och köp när läget är rätt. Här är{" "}
                  <Link
                    href={`/produkter/${showcase.product.slug}`}
                    className="text-holo-cyan transition-colors duration-150 hover:underline"
                  >
                    {showcase.product.title}
                  </Link>{" "}
                  senaste 90 dagarna.
                </p>
                <Card className="mt-6 p-4">
                  <PriceChartLazy data={showcase.points} />
                </Card>
              </div>
            )}
            {popular.items.length > 0 && (
              <div>
                <h3 className="font-display text-2xl font-bold text-ink">
                  Populärt just nu
                </h3>
                <div className="stagger-list mt-6 grid gap-4 sm:grid-cols-2">
                  {popular.items.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={{
                        slug: p.slug,
                        title: p.title,
                        imageUrl: p.imageUrl,
                        category: p.category,
                        lowestPrice: p.lowestPrice,
                        priceChange7d: p.priceChange7dPercent,
                        stockStatus: p.lowestPriceStockStatus,
                        retailerCount: p.inStockCount,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── FAQ ── */}
      <section className="border-t border-surface-border">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h2 className="text-center font-display text-2xl font-bold text-ink">
            Vanliga frågor
          </h2>
          <div className="mt-8 space-y-3">
            {FAQ.map((item) => (
              <details key={item.q} className="card-surface group p-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium text-ink transition-colors duration-150 hover:text-holo-cyan [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <IconPlus
                    size={18}
                    className="shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-45"
                  />
                </summary>
                <p className="border-t border-surface-border px-5 py-4 text-sm leading-relaxed text-ink-muted">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl border border-surface-border bg-surface-raised p-10 text-center sm:p-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-holo-gradient opacity-[0.05]"
          />
          <h2 className="relative font-display text-2xl font-bold text-ink sm:text-3xl">
            Håll koll på marknaden innan alla andra.
          </h2>
          <p className="relative mx-auto mt-3 max-w-xl text-ink-muted">
            Skapa ett gratiskonto och börja bevaka dina favoritprodukter redan
            i dag.
          </p>
          <div className="relative mt-7 flex flex-wrap justify-center gap-3">
            <LinkButton href="/registrera" size="lg">
              Gå med gratis
            </LinkButton>
            <LinkButton href="/priser" variant="ghost" size="lg">
              Se prisplaner
            </LinkButton>
          </div>
        </div>
      </section>
    </div>
  );
}
