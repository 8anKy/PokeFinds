"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { parseKronorToOre } from "@/lib/purchase-price";
import { hapticGlide } from "@/lib/haptics";
import { hasAuthHint } from "@/lib/auth-hint";
import { getSharedSession } from "@/lib/client-session";
import { openPaywallOrNavigate } from "@/lib/paywall";
import {
  PRICED_CONDITIONS,
  priceForCondition,
  type ConditionPriceTable,
  type PricedCondition,
} from "@/lib/condition-prices";
import {
  COLLECTION_GRADING_ISSUERS,
  collectionGrading,
  gradesForCollectionIssuer,
  gradingPayload,
} from "@/lib/graded-slab";
import { gradedSoldValue, type GradedSalePoint } from "@/lib/graded-value";
import { GradedSlab } from "@/components/features/graded-slab";
import { FREE_PORTFOLIO_LIMIT, PRO_PORTFOLIO_LIMIT } from "@/lib/portfolio-limit";
import { PortfolioCreateSheet } from "@/components/features/portfolio-sheets";
import {
  loadPortfolios,
  preferredPortfolioId,
  setLastPortfolioId,
  type PortfolioSummary,
} from "@/lib/portfolios-client";
import { IconCalendar, IconCards, IconCheck, IconPackage, IconPlus, IconX } from "@/components/ui/icons";
import type { GradedHistory } from "@/services/graded";

export interface QuickAddDraft {
  quantity: number;
  /** Öre, heltal. Utelämnas helt när fältet lämnats blankt (≠ 0 kr). */
  purchasePrice?: number;
  /** "YYYY-MM-DD" — bara när användaren valt något annat än idag (2026-10-25). */
  purchaseDate?: string;
  /** Pärm att spara i. Utelämnad = standardpärmen. */
  portfolioId?: string;
  /** Gradering — bara när BÅDE bolag och betyg valts (2026-10-15). */
  gradingCompany?: string;
  grade?: string;
  /** Skick (2026-10-23, väljs redan vid tillägg). Bara för kort; utelämnat = NM (schemats default). */
  condition?: PricedCondition;
  /** Vald tryckning när den skiljer sig från produkten arket öppnades för. */
  productId?: string;
}

/** Det kvittot efter tillägget behöver (toasten säger VAR kortet hamnade och hur många man nu har). */
export interface QuickAddMeta {
  portfolioName: string | null;
  /** "Near Mint" / "PSA 10" / null för förseglat. */
  detailLabel: string | null;
  /** Antal av produkten man ägde innan (null = okänt). */
  ownedBefore: number | null;
}

/** En tryckning arket kan spara som (produkten själv först). */
export interface QuickAddVariantOption {
  productId: string;
  /** Syskonets slug — graderade affärer hämtas per tryckning. Valfri (äldre anropare). */
  slug?: string;
  /** `null` = vanlig version. */
  label: string | null;
  /** Rubrikpriset i öre — NM-raden. */
  headlinePrice: number | null;
  conditionPrices: ConditionPriceTable | null;
}

/** Produkten arket öppnades för. Utan `slug` hämtar arket ingenting själv. */
export interface QuickAddProduct {
  id: string;
  slug?: string;
  title: string;
  imageUrl?: string | null;
}

interface CollectionQuickAddSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (draft: QuickAddDraft, meta: QuickAddMeta) => void;
  /** Sparar just nu → knappen låses så ett dubbeltryck inte lägger till två gånger. */
  saving?: boolean;
  /** Skickas vidare till arket (t.ex. `sm:mx-auto sm:max-w-md` på produktsidan). */
  panelClassName?: string;
  /** Kort (inte förseglat): skick, gradering och tryckning. */
  gradeable?: boolean;
  product?: QuickAddProduct;
  /**
   * Tryckningar att välja mellan (produktsidan har dem redan). Första posten = produkten
   * själv. Utelämnat ⇒ arket hämtar dem ur produktens detalj-payload när det öppnas.
   */
  variantOptions?: QuickAddVariantOption[];
}

/** Det arket läser ur `/api/products/[slug]/detail` (delad, cachad payload). */
interface DetailSlice {
  id: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  variantLabel?: string | null;
  conditionPrices?: ConditionPriceTable | null;
  variants: { id?: string; slug: string; label: string | null; lowestPrice: number | null; conditionPrices?: ConditionPriceTable | null }[];
  stats: { lowestPrice: number | null };
  set: { name: string } | null;
  facts: { releaseDate: string | null } | null;
}

interface OwnedSummary {
  total: number;
  groups: { quantity: number; condition: string; gradingCompany: string | null; grade: string | null; portfolioId: string | null }[];
}

/** API:t (`/api/collection`) tar quantity 1..10000 — samma tak här, annars 400. */
const MAX_QTY = 10000;
/** Skicken i kamerans ordning: sämst till vänster, Near Mint förvalt. */
const CONDITION_ROW = [...PRICED_CONDITIONS].reverse();
/** Visningsnamn per lagrat bolag — "Beckett" lagras som förut men heter BGS i raden. */
const ISSUER_LABEL: Record<string, string> = { Beckett: "BGS" };
/** Tidigaste valbara köpdag när setets släppdatum är okänt (första TCG-släppet). */
const EARLIEST_DATE = "1996-10-20";

/**
 * Tryckningarna arket låter användaren välja mellan: produkten själv FÖRST (förvald),
 * sedan syskonen som har ett id (äldre cachade payloads saknar det ⇒ de hoppas över).
 */
export function variantOptionsOf(
  productId: string,
  variantLabel: string | null,
  headlinePrice: number | null,
  conditionPrices: ConditionPriceTable | null,
  variants: DetailSlice["variants"],
  slug?: string
): QuickAddVariantOption[] {
  const siblings = variants.filter((v): v is typeof v & { id: string } => typeof v.id === "string");
  return [
    { productId, slug, label: variantLabel, headlinePrice, conditionPrices },
    ...siblings.map((v) => ({
      productId: v.id,
      slug: v.slug,
      label: v.label,
      headlinePrice: v.lowestPrice,
      conditionPrices: v.conditionPrices ?? null,
    })),
  ];
}

/* ───────────────────────────── datum ───────────────────────────── */

interface Ymd {
  y: number;
  m: number; // 0–11
  d: number;
}
const ymdKey = (v: Ymd) => v.y * 10000 + v.m * 100 + v.d;
const toIso = (v: Ymd) => `${v.y}-${String(v.m + 1).padStart(2, "0")}-${String(v.d).padStart(2, "0")}`;
function localToday(): Ymd {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
}
function addDays(v: Ymd, days: number): Ymd {
  const t = new Date(v.y, v.m, v.d + days);
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}
function parseIsoDay(iso: string | null | undefined): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
}

type DateChoice = "today" | "yesterday" | "week" | "pick";

/**
 * TILLÄGGSARKET (designpasset 2026-10-25, "v5"): kortets konst suddig som bakgrund,
 * kortet lutat med foliereflex (eller i sin slab), värdet stort, skick/bolag/betyg
 * som kamerans lägesrad, och fyra rutor som alltid syns — antal, köpt för, version,
 * pärm. Med ett inköpspris visas köpdatum (valfritt, idag förvalt) och raden mot
 * marknaden. Version, pärm och datum väljs i ark som glider upp (samma BottomSheet).
 *
 * Datat: payloaden hämtas när arket öppnas från ett rutnät (produktsidan skickar
 * tryckningarna direkt). ⛔ Graderat värde = SÅLT, samma dom som samlingen
 * (`gradedSoldValue`), och bara för Pro — gratis ser det ograderade värdet märkt.
 */
export function CollectionQuickAddPopover({
  open,
  onClose,
  onConfirm,
  saving = false,
  panelClassName,
  gradeable = false,
  product,
  variantOptions: variantOptionsProp,
}: CollectionQuickAddSheetProps) {
  const t = useTranslations("Product");
  const tCond = useTranslations("Condition");
  const tDetail = useTranslations("Detail");
  const locale = useLocale();
  const router = useRouter();

  const [mode, setMode] = useState<"raw" | "graded">("raw");
  const [condition, setCondition] = useState<PricedCondition>("NEAR_MINT");
  const [company, setCompany] = useState<string>("PSA");
  const [grade, setGrade] = useState<string>("10");
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [priceText, setPriceText] = useState("");
  const [showError, setShowError] = useState(false);
  const [dateChoice, setDateChoice] = useState<DateChoice>("today");
  const [picked, setPicked] = useState<Ymd | null>(null);
  const [picker, setPicker] = useState<"version" | "portfolio" | "date" | null>(null);

  const [detail, setDetail] = useState<DetailSlice | null>(null);
  const [owned, setOwned] = useState<OwnedSummary | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [gradedHistory, setGradedHistory] = useState<Record<string, GradedHistory[]>>({});
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [canCreate, setCanCreate] = useState(true);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const slug = product?.slug;

  // Utgångsläget varje gång arket öppnas: rått, NM, 1 ex, inget pris. Pärmen MINNS —
  // den som fyller "Byteshögen" vill inte välja om per kort.
  useEffect(() => {
    if (!open) return;
    setMode("raw");
    setCondition("NEAR_MINT");
    setCompany("PSA");
    setGrade("10");
    setVariantId(null);
    setQuantity(1);
    setPriceText("");
    setShowError(false);
    setDateChoice("today");
    setPicked(null);
    setPicker(null);
    let active = true;
    loadPortfolios()
      .then((p) => {
        if (!active) return;
        setPortfolios(p.portfolios);
        setCanCreate(p.canCreate);
        setPortfolioId(preferredPortfolioId(p.portfolios));
      })
      .catch(() => undefined);
    if (hasAuthHint()) {
      void getSharedSession().then((s) => active && setIsPro(!!s?.user?.isPro));
    }
    if (slug) {
      fetch(`/api/products/${slug}/detail`)
        .then((r) => (r.ok ? (r.json() as Promise<DetailSlice>) : null))
        .then((d) => active && d && setDetail(d))
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [open, slug]);

  const variantOptions = useMemo<QuickAddVariantOption[]>(() => {
    if (variantOptionsProp && variantOptionsProp.length > 0) return variantOptionsProp;
    if (!detail || !product) return [];
    return variantOptionsOf(
      product.id,
      detail.variantLabel ?? null,
      detail.stats.lowestPrice,
      detail.conditionPrices ?? null,
      gradeable ? detail.variants : [],
      detail.slug
    );
  }, [variantOptionsProp, detail, product, gradeable]);

  const selected = variantOptions.find((o) => o.productId === variantId) ?? variantOptions[0] ?? null;
  const selectedProductId = selected?.productId ?? product?.id ?? null;
  const selectedSlug = selected?.slug ?? slug;

  // "Du har redan …" — per vald tryckning (det är den posten hamnar på).
  useEffect(() => {
    if (!open || !selectedProductId || !hasAuthHint()) {
      setOwned(null);
      return;
    }
    let active = true;
    fetch(`/api/collection/owned?productId=${encodeURIComponent(selectedProductId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<OwnedSummary>) : null))
      .then((o) => active && setOwned(o))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open, selectedProductId]);

  // Graderade affärer: bara Pro (routen kontrollerar planen), bara när läget väljs.
  useEffect(() => {
    if (!open || mode !== "graded" || !isPro || !selectedSlug || gradedHistory[selectedSlug]) return;
    let active = true;
    fetch(`/api/products/${selectedSlug}/graded`)
      .then((r) => (r.ok ? (r.json() as Promise<{ history?: GradedHistory[] }>) : null))
      .then((g) => active && g && setGradedHistory((prev) => ({ ...prev, [selectedSlug]: g.history ?? [] })))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open, mode, isPro, selectedSlug, gradedHistory]);

  const sealed = !gradeable;
  const graded = gradeable && mode === "graded";
  const headline = selected?.headlinePrice ?? detail?.stats.lowestPrice ?? null;
  const nm = priceForCondition(selected?.conditionPrices ?? null, "NEAR_MINT", headline).ore;
  const rawRow = priceForCondition(selected?.conditionPrices ?? null, condition, headline);
  const gradingValue = collectionGrading(company, grade);
  const soldValue = useMemo(() => {
    if (!graded || !gradingValue || gradingValue.issuer === "OTHER" || !selectedSlug) return null;
    const history = gradedHistory[selectedSlug] ?? [];
    const group = history.find((h) => h.issuer === gradingValue.issuer && h.gradeTenths === gradingValue.gradeTenths);
    if (!group) return null;
    const points: GradedSalePoint[] = [
      ...group.soldEbay.map((p) => ({ source: "ebay", price: p.price, soldAt: p.date })),
      ...group.sold.map((p) => ({ source: "tradera", price: p.price, soldAt: p.date })),
    ];
    return gradedSoldValue(points);
  }, [graded, gradingValue, selectedSlug, gradedHistory]);

  const gradingLabel = `${ISSUER_LABEL[company] ?? company} ${grade}`;
  const estimated = graded && soldValue == null;
  const unit = sealed ? headline : graded ? (soldValue?.valueOre ?? nm) : rawRow.ore;
  const caption: { text: string; warn?: boolean } = sealed
    ? { text: t("addCaptionSealed") }
    : graded
      ? soldValue
        ? { text: t("addCaptionSold", { count: soldValue.count, grading: gradingLabel }) }
        : !isPro
          ? { text: t("addCaptionGradedPro") }
          : { text: t("addCaptionNoSales", { grading: gradingLabel }), warn: true }
      : rawRow.source === "headline"
        ? { text: t("addCaptionMarket", { condition: tCond(condition) }) }
        : rawRow.source === "estimate"
          ? { text: t("addCaptionEstimate", { condition: tCond(condition), percent: rawRow.percent }) }
          : { text: t("addCaptionNone", { condition: tCond(condition) }) };

  const parsed = parseKronorToOre(priceText);
  const priceInvalid = parsed.kind === "invalid";
  const paidOre = parsed.kind === "ok" ? parsed.ore : null;
  const diff = paidOre != null && paidOre > 0 && unit != null ? unit - paidOre : null;
  const total = unit != null ? unit * Math.max(1, quantity) : null;

  const today = localToday();
  const release = parseIsoDay(detail?.facts?.releaseDate) ?? parseIsoDay(EARLIEST_DATE)!;
  const chosenDate: Ymd | null =
    dateChoice === "yesterday" ? addDays(today, -1) : dateChoice === "week" ? addDays(today, -7) : dateChoice === "pick" ? picked : null;

  const portfolioName = (id: string | null) =>
    (id ? portfolios.find((p) => p.id === id) : portfolios.find((p) => p.isDefault))?.name ?? null;
  const shownPortfolio = portfolios.find((p) => p.id === portfolioId) ?? portfolios.find((p) => p.isDefault) ?? null;

  const ownedLine = (() => {
    if (!owned || owned.total === 0) return null;
    if (owned.groups.length !== 1) return t("ownedTotal", { count: owned.total });
    const g = owned.groups[0];
    const what = g.gradingCompany && g.grade
      ? `${ISSUER_LABEL[g.gradingCompany] ?? g.gradingCompany} ${g.grade}`
      : g.condition === "SEALED"
        ? null
        : tCond(g.condition);
    const where = portfolios.length > 1 ? portfolioName(g.portfolioId) : null;
    return t("ownedDetail", {
      count: owned.total,
      what: what ?? "",
      where: where ?? "",
      hasWhat: what ? "yes" : "no",
      hasWhere: where ? "yes" : "no",
    });
  })();

  const step = (delta: number) => setQuantity((q) => Math.min(MAX_QTY, Math.max(1, (q || 1) + delta)));

  function confirm() {
    if (priceInvalid) {
      setShowError(true);
      return;
    }
    const grading = graded ? gradingPayload(company, grade) : {};
    onConfirm(
      {
        quantity: Math.min(MAX_QTY, Math.max(1, quantity || 1)),
        // Blankt fält utelämnas HELT. `0` betyder "köpt gratis" och är ett påstående;
        // blankt betyder "vet inte" — portföljens vinst utesluter poster utan pris med flit.
        ...(parsed.kind === "ok" ? { purchasePrice: parsed.ore } : {}),
        // Idag skickas inte: tjänsten faller redan tillbaka på skapandedagen.
        ...(parsed.kind === "ok" && chosenDate ? { purchaseDate: toIso(chosenDate) } : {}),
        ...(portfolios.length > 1 && portfolioId ? { portfolioId } : {}),
        ...grading,
        ...(gradeable && !graded ? { condition } : {}),
        // Bara när användaren bytt tryckning; annars sparas produkten arket öppnades för.
        ...(selected && selected.productId !== variantOptions[0]?.productId ? { productId: selected.productId } : {}),
      },
      {
        portfolioName: shownPortfolio?.name ?? null,
        detailLabel: sealed ? null : graded ? gradingLabel : tCond(condition),
        ownedBefore: owned ? owned.total : null,
      }
    );
  }

  const title = detail?.title ?? product?.title ?? "";
  const imageUrl = detail?.imageUrl ?? product?.imageUrl ?? null;
  const ctaPrice = total != null ? `${estimated ? "≈ " : ""}${formatPrice(total)}` : null;
  const cta = [
    quantity > 1 ? t("addCtaN", { count: quantity }) : t("quickAddConfirm"),
    ...(ctaPrice ? [ctaPrice] : []),
  ].join(" · ");

  const companyRow = COLLECTION_GRADING_ISSUERS as readonly string[];
  const gradeRow = [...gradesForCollectionIssuer(company)].reverse();

  return (
    <>
      <BottomSheet
        open={open}
        title={t("quickAddTitle")}
        onClose={onClose}
        closeLabel={t("quickAddCancel")}
        bare
        panelClassName={cn("max-h-[94%] rounded-t-[28px]", panelClassName)}
        background={
          imageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt=""
                className="absolute -left-[40%] -top-[30%] w-[180%] max-w-none opacity-55 blur-[60px] saturate-150"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 32%, rgba(0,0,0,0.9) 58%, #000 80%)",
                }}
              />
            </>
          ) : null
        }
        footer={
          <div className="space-y-2.5">
            {ownedLine && (
              <a
                href="/samling"
                className="flex h-11 items-center gap-2.5 rounded-[14px] border border-white/10 bg-white/[0.06] px-3 text-ink"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-holo-cyan/15 text-holo-cyan">
                  <IconCards size={13} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{ownedLine}</span>
                <span className="shrink-0 text-[13px] font-semibold text-holo-cyan">{t("ownedShow")}</span>
              </a>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={saving}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-holo-cyan text-[17px] font-extrabold tabular-nums text-surface shadow-[0_10px_30px_rgba(45,212,191,0.3)] transition-opacity active:opacity-90 disabled:opacity-50"
            >
              <IconPlus size={18} strokeWidth={2.8} />
              {cta}
            </button>
          </div>
        }
      >
        {/* Överdelen: stäng · Rått/Graderat (eller Förseglat) */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("quickAddCancel")}
            className="grid h-[38px] w-[38px] place-items-center rounded-full border border-white/15 bg-white/10 text-ink backdrop-blur-xl"
          >
            <IconX size={13} strokeWidth={2.8} />
          </button>
          {sealed ? (
            <span className="flex h-[38px] items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] px-4 text-sm font-bold text-ink">
              <IconPackage size={15} />
              {t("addSealed")}
            </span>
          ) : (
            <div role="radiogroup" aria-label={t("addTypeAria")} className="flex rounded-full border border-white/15 bg-white/[0.08] p-[3px] backdrop-blur-xl">
              {(["raw", "graded"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "h-8 rounded-full px-4 text-sm font-bold transition-colors",
                    mode === m ? "bg-white/90 text-surface" : "text-ink"
                  )}
                >
                  {m === "raw" ? t("addRaw") : t("addGraded")}
                </button>
              ))}
            </div>
          )}
          <span className="w-[38px]" aria-hidden />
        </div>

        {/* Scenen */}
        <div
          className={cn("mt-2 flex items-center justify-center [perspective:900px]", graded ? "h-[150px]" : sealed ? "h-[170px]" : "h-[150px]")}
        >
          {graded && gradingValue ? (
            <div className="w-[92px] [transform:rotateY(-10deg)_rotateX(6deg)] drop-shadow-[0_30px_40px_rgba(0,0,0,0.65)]">
              <GradedSlab imageUrl={imageUrl} issuer={gradingValue.issuer} gradeTenths={gradingValue.gradeTenths} alt={title} />
            </div>
          ) : sealed ? (
            imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={title}
                className="max-h-full w-[190px] object-contain [transform:rotateY(-8deg)_rotateX(4deg)] drop-shadow-[0_30px_40px_rgba(0,0,0,0.6)]"
              />
            ) : (
              <IconPackage size={48} className="text-ink-faint" />
            )
          ) : (
            <div className="relative w-[106px] overflow-hidden rounded-lg shadow-[0_30px_60px_rgba(0,0,0,0.65)] [transform:rotateY(-10deg)_rotateX(6deg)]">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={title} className="block h-auto w-full" />
              ) : (
                <div className="grid aspect-[5/7] place-items-center bg-surface-overlay text-ink-faint">
                  <IconCards size={28} />
                </div>
              )}
              <div
                aria-hidden
                className="absolute inset-0 mix-blend-screen"
                style={{
                  background:
                    "linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.32) 45%, rgba(45,212,191,0.18) 52%, rgba(255,255,255,0) 64%)",
                }}
              />
            </div>
          )}
        </div>

        {/* Värdet */}
        <div className="mt-2 flex flex-col items-center gap-0.5 text-center">
          <span className="line-clamp-1 text-sm font-semibold text-ink/70">{title}</span>
          <span
            className={cn(
              "text-[34px] font-extrabold leading-[40px] tracking-[-0.03em] tabular-nums",
              estimated ? "text-ink/60" : "text-ink"
            )}
          >
            {unit != null ? `${estimated ? "≈ " : ""}${formatPrice(unit)}` : "–"}
          </span>
          <span className={cn("flex items-center gap-1.5 text-[13px]", caption.warn ? "text-holo-gold" : "text-ink/60")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", caption.warn ? "bg-holo-gold" : unit != null ? "bg-holo-cyan" : "bg-ink-faint")} />
            {caption.text}
          </span>
        </div>

        {/* Lägesraderna */}
        {!sealed && (
          <div className="-mx-[18px] mt-2 flex flex-col">
            {graded ? (
              <>
                <ModeScroller
                  label={t("addCompanyAria")}
                  items={companyRow.map((c) => (ISSUER_LABEL[c] ?? c).toUpperCase())}
                  index={Math.max(0, companyRow.indexOf(company))}
                  itemWidth={84}
                  tracking="0.06em"
                  onChange={(i) => {
                    const next = companyRow[i];
                    setCompany(next);
                    if (!gradesForCollectionIssuer(next).includes(grade)) setGrade("10");
                  }}
                />
                <ModeScroller
                  label={t("addGradeAria")}
                  items={gradeRow}
                  index={Math.max(0, gradeRow.indexOf(grade))}
                  itemWidth={54}
                  big
                  onChange={(i) => setGrade(gradeRow[i])}
                />
              </>
            ) : (
              <ModeScroller
                label={t("quickAddCondition")}
                items={CONDITION_ROW.map((c) => tCond(c).toUpperCase())}
                index={CONDITION_ROW.indexOf(condition)}
                itemWidth={110}
                tracking="0.08em"
                onChange={(i) => setCondition(CONDITION_ROW[i])}
              />
            )}
          </div>
        )}

        {/* Posten: fyra rutor, alltid synliga */}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="flex h-[62px] items-center justify-between rounded-2xl border border-white/10 bg-white/[0.06] pl-3.5 pr-1.5">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-ink/55">{t("quantity")}</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={t("quantity")}
                value={quantity === 0 ? "" : quantity}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  setQuantity(digits ? Math.min(MAX_QTY, Number(digits)) : 0);
                }}
                onBlur={() => setQuantity((q) => (q >= 1 ? q : 1))}
                className="w-14 bg-transparent text-lg font-extrabold tabular-nums text-ink outline-none"
              />
            </span>
            <span className="flex gap-1">
              <RoundStep label={t("decreaseQuantity")} disabled={quantity <= 1} onClick={() => step(-1)}>
                −
              </RoundStep>
              <RoundStep label={t("increaseQuantity")} disabled={quantity >= MAX_QTY} onClick={() => step(1)}>
                +
              </RoundStep>
            </span>
          </div>

          <label
            className={cn(
              "flex h-[62px] cursor-text flex-col justify-center gap-0.5 rounded-2xl border px-3.5",
              paidOre != null
                ? "border-holo-cyan/45 bg-holo-cyan/10"
                : showError && priceInvalid
                  ? "border-fall bg-white/[0.06]"
                  : "border-white/10 bg-white/[0.06]"
            )}
          >
            <span className="text-xs text-ink/55">
              {t("boughtFor")} <span className="text-ink/35">· {t("optional")}</span>
            </span>
            <span className="flex items-baseline gap-1">
              <input
                type="text"
                // Svenska tangentbord ger komma; "decimal" visar det, "numeric" gör det inte.
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                placeholder={t("pricePlaceholderShort")}
                value={priceText}
                aria-invalid={showError && priceInvalid}
                onChange={(e) => {
                  setPriceText(e.target.value);
                  setShowError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-lg font-extrabold tabular-nums text-ink outline-none placeholder:text-ink/35"
              />
              <span className="text-xs text-ink/55">{t("perUnit")}</span>
            </span>
          </label>

          {!sealed && (
            <Tile label={t("version")} value={selected?.label ?? tDetail("baseVersion")} onClick={() => setPicker("version")} />
          )}
          <Tile
            label={t("quickAddPortfolio")}
            value={shownPortfolio?.name ?? t("defaultPortfolio")}
            onClick={() => setPicker("portfolio")}
            wide={sealed}
          />
        </div>
        {showError && priceInvalid && (
          <p role="alert" className="mt-1.5 text-xs text-fall">
            {t("purchasePriceInvalid")}
          </p>
        )}

        {/* Med ett inköpspris: NÄR (valfritt, idag förvalt) och mot marknaden */}
        {paidOre != null && (
          <>
            <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="mr-0.5 flex shrink-0 flex-col leading-tight">
                <span className="text-xs text-ink/55">{t("bought")}</span>
                <span className="text-[11px] text-ink/35">{t("optional")}</span>
              </span>
              {(["today", "yesterday", "week", "pick"] as const).map((c) => {
                const on = dateChoice === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => (c === "pick" ? setPicker("date") : setDateChoice(c))}
                    className={cn(
                      "flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-[11px] text-[13px] font-semibold",
                      on ? "border-white/90 bg-white/90 text-surface" : "border-white/[0.12] bg-white/[0.06] text-ink"
                    )}
                  >
                    {c === "pick" && <IconCalendar size={12} />}
                    {c === "pick" && on && picked
                      ? shortDate(picked, today, locale)
                      : t(c === "today" ? "dateToday" : c === "yesterday" ? "dateYesterday" : c === "week" ? "dateLastWeek" : "datePick")}
                  </button>
                );
              })}
            </div>
            {diff != null && (
              <div className="mt-2.5 flex items-center justify-between px-1">
                <span className="text-[13px] text-ink/60">{t("vsPurchase")}</span>
                <span className={cn("text-sm font-bold tabular-nums", diff < 0 ? "text-fall" : "text-rise")}>
                  {`${diff >= 0 ? "+" : "−"}${formatPrice(Math.abs(diff * Math.max(1, quantity)))} (${diff >= 0 ? "+" : "−"}${Math.abs(
                    (diff / paidOre!) * 100
                  ).toFixed(0)} %)`}
                </span>
              </div>
            )}
          </>
        )}
        <div className="h-1" />
      </BottomSheet>

      {/* ── Väljarna: ark som glider upp (samma BottomSheet, samma fart) ── */}
      <BottomSheet
        open={open && picker === "version"}
        title={t("version")}
        onClose={() => setPicker(null)}
        closeLabel={t("quickAddCancel")}
        centerTitle
        headerAction={{ label: t("done"), onClick: () => setPicker(null), tone: "accent" }}
        panelClassName={panelClassName}
      >
        <div className="pb-8">
          {variantOptions.map((o, i) => {
            const on = (selected?.productId ?? null) === o.productId;
            const price = priceForCondition(o.conditionPrices, condition, o.headlinePrice).ore ?? o.headlinePrice;
            const holo = /reverse|holo|foil/i.test(o.label ?? "");
            return (
              <PickerRow
                key={o.productId}
                first={i === 0}
                on={on}
                onClick={() => {
                  setVariantId(o.productId);
                  setPicker(null);
                }}
                leading={
                  <span className="relative h-[53px] w-[38px] shrink-0 overflow-hidden rounded shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center bg-surface-overlay text-ink-faint">
                        <IconCards size={14} />
                      </span>
                    )}
                    {holo && (
                      <span
                        aria-hidden
                        className="absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(125deg, rgba(167,139,250,0.35), rgba(45,212,191,0.25) 40%, rgba(244,114,182,0.3) 70%, rgba(255,255,255,0.1))",
                        }}
                      />
                    )}
                  </span>
                }
                label={o.label ?? tDetail("baseVersion")}
                right={formatPrice(price)}
              />
            );
          })}
        </div>
      </BottomSheet>

      <BottomSheet
        open={open && picker === "portfolio"}
        title={t("quickAddPortfolio")}
        onClose={() => setPicker(null)}
        closeLabel={t("quickAddCancel")}
        centerTitle
        headerAction={{ label: t("done"), onClick: () => setPicker(null), tone: "accent" }}
        panelClassName={panelClassName}
      >
        <div className="pb-8">
          {portfolios.map((p, i) => (
            <PickerRow
              key={p.id}
              first={i === 0}
              on={shownPortfolio?.id === p.id}
              onClick={() => {
                setPortfolioId(p.id);
                setLastPortfolioId(p.id);
                setPicker(null);
              }}
              leading={
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-holo-cyan/15 text-holo-cyan">
                  <FolderGlyph />
                </span>
              }
              label={p.name}
              sub={t("portfolioCount", { count: p.itemCount })}
            />
          ))}
          <PickerRow
            first={portfolios.length === 0}
            on={false}
            radio={false}
            onClick={() => {
              setPicker(null);
              if (canCreate) setCreateOpen(true);
              else openPaywallOrNavigate(router, { source: "portfolio-limit" });
            }}
            leading={
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-holo-cyan">
                <IconPlus size={18} strokeWidth={2.6} />
              </span>
            }
            label={t("newPortfolio")}
            labelClassName="text-holo-cyan"
            sub={t("newPortfolioSub", { free: FREE_PORTFOLIO_LIMIT, pro: PRO_PORTFOLIO_LIMIT })}
          />
        </div>
      </BottomSheet>

      <BottomSheet
        open={open && picker === "date"}
        title={t("purchaseDateTitle")}
        onClose={() => setPicker(null)}
        closeLabel={t("quickAddCancel")}
        centerTitle
        headerAction={{ label: t("done"), onClick: () => setPicker(null), tone: "accent" }}
        panelClassName={panelClassName}
      >
        <CalendarPicker
          locale={locale}
          today={today}
          earliest={release}
          releaseKnown={!!parseIsoDay(detail?.facts?.releaseDate)}
          value={picked}
          onPick={(d) => {
            setPicked(d);
            setDateChoice("pick");
          }}
        />
      </BottomSheet>

      <PortfolioCreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setPortfolios((prev) => [...prev, created]);
          setPortfolioId(created.id);
          setLastPortfolioId(created.id);
        }}
      />
    </>
  );
}

function shortDate(v: Ymd, today: Ymd, locale: string): string {
  const d = new Date(v.y, v.m, v.d);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(v.y !== today.y ? { year: "numeric" } : {}),
  })
    .format(d)
    .replace(".", "");
}

/* ─────────────────────────── lägesraden ─────────────────────────── */

/**
 * Kamerans lägesrad: valet står i mitten, grannarna tonar ut mot kanterna (en MASK,
 * inga svarta band — ägaren 2026-10-25). Tryck på ett värde eller dra raden i sidled.
 */
function ModeScroller({
  label,
  items,
  index,
  onChange,
  itemWidth,
  tracking = "0",
  big = false,
}: {
  label: string;
  items: string[];
  index: number;
  onChange: (i: number) => void;
  itemWidth: number;
  tracking?: string;
  big?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /** Fingrets förskjutning i px medan raden dras (null = inget drag). */
  const [drag, setDrag] = useState<number | null>(null);
  const gesture = useRef<{
    x0: number;
    y0: number;
    lastX: number;
    lastT: number;
    vx: number;
    axis: "x" | "y" | null;
    shown: number;
  } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clamp = (i: number) => Math.min(items.length - 1, Math.max(0, i));
  const baseShift = width / 2 - (index * itemWidth + itemWidth / 2);
  /** Vilket värde som står i mitten vid en given förskjutning. */
  const indexAt = (offset: number) => clamp(Math.round((width / 2 - itemWidth / 2 - (baseShift + offset)) / itemWidth));
  const shownIndex = drag == null ? index : indexAt(drag);

  const pick = (i: number) => {
    const next = clamp(i);
    if (next === index) return;
    hapticGlide();
    onChange(next);
  };

  /**
   * KONTINUERLIGT SVEP (ägaren 2026-10-25: "inte ett i taget"): raden följer fingret,
   * varje värde som passerar mitten ger ett tick, och släppet glider vidare med fingrets
   * fart innan den snäpper till närmaste värde. Lodräta drag lämnas åt arket/sidan.
   */
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    gesture.current = { x0: t.clientX, y0: t.clientY, lastX: t.clientX, lastT: e.timeStamp, vx: 0, axis: null, shown: index };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    const t = e.touches[0];
    if (!g || !t) return;
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    if (g.axis == null) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (g.axis !== "x") return;
    if (e.timeStamp > g.lastT) {
      g.vx = (t.clientX - g.lastX) / (e.timeStamp - g.lastT);
      g.lastX = t.clientX;
      g.lastT = e.timeStamp;
    }
    // Gummiband förbi ändarna, så raden inte kan dras ut i tomma intet.
    const min = width / 2 - ((items.length - 1) * itemWidth + itemWidth / 2) - baseShift;
    const max = width / 2 - itemWidth / 2 - baseShift;
    const off = dx < min ? min + (dx - min) / 3 : dx > max ? max + (dx - max) / 3 : dx;
    const now = indexAt(off);
    if (now !== g.shown) {
      g.shown = now;
      hapticGlide();
    }
    setDrag(off);
  };
  const onTouchEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.axis !== "x" || drag == null) {
      setDrag(null);
      return;
    }
    // Fart (px/ms) × 180 ms ≈ hur långt raden glider efter släppet.
    const target = indexAt(drag + g.vx * 180);
    setDrag(null);
    if (target !== index) onChange(target);
  };

  const shift = baseShift + (drag ?? 0);
  const mask = "linear-gradient(90deg, transparent 0%, #000 24%, #000 76%, transparent 100%)";

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      className="relative h-11 overflow-hidden"
      style={{ WebkitMaskImage: mask, maskImage: mask, touchAction: "pan-y" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className={cn("absolute left-0 top-0 flex", drag == null && "transition-transform duration-300")}
        style={{ transform: `translateX(${shift}px)`, transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)" }}
      >
        {items.map((it, i) => {
          const on = i === shownIndex;
          const dist = Math.abs(i - shownIndex);
          return (
            <button
              key={`${it}-${i}`}
              type="button"
              role="option"
              aria-selected={i === index}
              onClick={() => pick(i)}
              className="flex h-11 flex-col items-center justify-center gap-1 whitespace-nowrap tabular-nums"
              style={{
                width: itemWidth,
                letterSpacing: tracking,
                color: on ? "rgb(250 250 250)" : dist === 1 ? "rgba(250,250,250,0.55)" : "rgba(250,250,250,0.3)",
                fontSize: on ? (big ? 22 : 15) : big ? 17 : 13,
                fontWeight: on ? 800 : 600,
              }}
            >
              {it}
              <span className={cn("h-[5px] w-[5px] rounded-full", on ? "bg-holo-cyan" : "bg-transparent")} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── rutor ───────────────────────────── */

function Tile({ label, value, onClick, wide = false }: { label: string; value: string; onClick: () => void; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[62px] items-center justify-between rounded-2xl border border-white/10 bg-white/[0.06] pl-3.5 pr-3 text-left text-ink",
        wide && "col-span-2"
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-ink/55">{label}</span>
        <span className="truncate text-base font-bold">{value}</span>
      </span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-ink/60">
        <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
      </svg>
    </button>
  );
}

function RoundStep({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white/10 text-lg leading-none text-ink disabled:text-ink/30"
    >
      {children}
    </button>
  );
}

function FolderGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
    </svg>
  );
}

/** En rad i ett väljar-ark: direkt på arket med hårlinje, ingen ruta i rutan (ägaren 2026-10-25). */
function PickerRow({
  first,
  on,
  onClick,
  leading,
  label,
  labelClassName,
  sub,
  right,
  radio = true,
}: {
  first: boolean;
  on: boolean;
  onClick: () => void;
  leading: ReactNode;
  label: string;
  labelClassName?: string;
  sub?: string;
  right?: string;
  radio?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onClick}
      className={cn("flex h-[72px] w-full items-center gap-3 px-1 text-left", !first && "border-t border-white/[0.07]")}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate text-[17px]", on ? "font-bold" : "font-semibold", labelClassName ?? "text-ink")}>{label}</span>
        {sub && <span className="truncate text-[13px] text-ink-faint">{sub}</span>}
      </span>
      {right && (
        <span className={cn("shrink-0 text-[15px] font-semibold tabular-nums", on ? "text-ink" : "text-ink-muted")}>{right}</span>
      )}
      {radio && (
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full",
            on ? "bg-holo-cyan text-surface" : "ring-[1.5px] ring-inset ring-surface-border"
          )}
        >
          {on && <IconCheck size={13} strokeWidth={3.4} />}
        </span>
      )}
    </button>
  );
}

/* ──────────────────────────── kalendern ──────────────────────────── */

/** Måndag först; framtida dagar och dagar före setets släpp går inte att välja. */
function CalendarPicker({
  locale,
  today,
  earliest,
  releaseKnown,
  value,
  onPick,
}: {
  locale: string;
  today: Ymd;
  earliest: Ymd;
  releaseKnown: boolean;
  value: Ymd | null;
  onPick: (d: Ymd) => void;
}) {
  const t = useTranslations("Product");
  const [view, setView] = useState<{ y: number; m: number }>(() => (value ? { y: value.y, m: value.m } : { y: today.y, m: today.m }));
  const vk = view.y * 12 + view.m;
  const canPrev = vk > earliest.y * 12 + earliest.m;
  const canNext = vk < today.y * 12 + today.m;
  const shiftView = (delta: number) => {
    const k = vk + delta;
    setView({ y: Math.floor(k / 12), m: k % 12 });
  };
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(view.y, view.m, 1));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2024, 0, 1 + i)) // 2024-01-01 = måndag
  );
  const firstDow = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const longDate = (v: Ymd) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(v.y, v.m, v.d));

  return (
    <div className="pb-8">
      <div className="flex items-center justify-between pl-1.5">
        <span className="text-[17px] font-extrabold capitalize text-ink">{monthTitle}</span>
        <span className="flex gap-1">
          <button
            type="button"
            aria-label={t("prevMonth")}
            disabled={!canPrev}
            onClick={() => shiftView(-1)}
            className="grid h-10 w-10 place-items-center rounded-full text-ink disabled:text-surface-border"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <button
            type="button"
            aria-label={t("nextMonth")}
            disabled={!canNext}
            onClick={() => shiftView(1)}
            className="grid h-10 w-10 place-items-center rounded-full text-ink disabled:text-surface-border"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </span>
      </div>
      <div aria-hidden className="mt-1.5 grid grid-cols-7">
        {weekdays.map((w, i) => (
          <span key={i} className="text-center text-xs font-semibold uppercase text-ink-faint">
            {w}
          </span>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: firstDow }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: daysIn }, (_, i) => {
          const d: Ymd = { y: view.y, m: view.m, d: i + 1 };
          const k = ymdKey(d);
          const off = k > ymdKey(today) || k < ymdKey(earliest);
          const sel = !!value && k === ymdKey(value);
          const isToday = k === ymdKey(today);
          return (
            <span key={i} className="flex justify-center">
              <button
                type="button"
                disabled={off}
                aria-pressed={sel}
                aria-label={longDate(d)}
                onClick={() => onPick(d)}
                className={cn(
                  "h-10 w-10 rounded-full text-base tabular-nums",
                  sel
                    ? "bg-holo-cyan font-extrabold text-surface"
                    : off
                      ? "text-surface-border"
                      : isToday
                        ? "font-extrabold text-holo-cyan ring-[1.5px] ring-inset ring-holo-cyan/60"
                        : "font-medium text-ink"
                )}
              >
                {i + 1}
              </button>
            </span>
          );
        })}
      </div>
      <div className="mt-2 border-t border-surface-border pl-1.5 pt-2.5">
        <p className="text-sm font-bold text-ink">{value ? t("boughtOn", { date: longDate(value) }) : t("pickPurchaseDay")}</p>
        {releaseKnown && <p className="text-xs text-ink-faint">{t("setReleased", { date: longDate(earliest) })}</p>}
      </div>
    </div>
  );
}
