"use client";

/**
 * "Sälj på Tradera" — självständig knapp + BOTTENARK per samlingsobjekt.
 * Användaren väljer annonstyp (Köp nu/auktion), pris, skick, frakt och foton;
 * POST /api/tradera/sell skapar annonsen via Tradera-API:t. Kräver att
 * Tradera-kontot är kopplat (Inställningar) — annars svarar API:t 400.
 *
 * ⛔ ARK, INTE MODAL (ägarbeslut 2026-09-07). Formuläret är långt och en centrerad
 * modal som "poppar" mitt på skärmen scrollade dessutom SIDAN bakom sig på mobil.
 * `BottomSheet` är appens enda glid-upp-panel: den låser kroppen, scrollar i sin
 * egen ruta och stänger på svep nedåt. Bygg aldrig en egen variant här.
 *
 * PRISET FÖRESLÅS, ALDRIG SÄTTS I HEMLIGHET: marknadspriset (postens uppskattade
 * värde) visas utskrivet, och procentknapparna räknar på DEN basen — eller på det
 * tal användaren själv skrivit in, om hen skrivit ett.
 *
 * ⛔ INGET INKÖPSPRIS HÄR. Fältet fanns för portföljens vinstberäkning och satt i
 * vägen mitt i ett SÄLJformulär (ägarbeslut 2026-09-07). Det sätts där det hör
 * hemma: inköpspris-arket på kortet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { Input, Textarea, Label, FieldError, Checkbox } from "@/components/ui/input";
import { IconCheck, IconPackage } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCommunityV2 } from "@/lib/use-community-v2";
import {
  AUCTION_DURATIONS,
  DEFAULT_AUCTION_DURATION,
  DEFAULT_PACKAGE_SIZE,
  DEFAULT_VAT_RATE,
  GRADES,
  GRADING_ISSUERS,
  PACKAGE_SIZE_KEYS,
  PRICE_STEPS,
  VAT_RATES,
  applyPricePercent,
  cheapestShippingKr,
  conditionOptionsFor,
  gradeToCondition,
  gradingLabel,
  packageSizeLabel,
  totalBuyerKr,
  vatShareKr,
  type ListingType,
  type PackageSize,
} from "@/lib/tradera-listing-options";
import { optionsForPackage } from "@/lib/tradera-shipping";
import { CONDITION_LABELS, LANGUAGE_LABELS } from "@/lib/collection-labels";

/**
 * Ett objekt att sälja. ⛔ POSTEN I SAMLINGEN ÄR IDENTITETEN: Tradera-annonsen
 * skrivs tillbaka på `CollectionItem.traderaItemId` (sold-sync, Sålt-fliken), så
 * en försäljning utan samlingspost går inte att följa upp. Skannern lägger därför
 * till korten FÖRST och skickar in id:na hit.
 */
export interface SellItem {
  /** Stabil nyckel i kön (samlingspostens id, eller skanningens). */
  key: string;
  /** Posten i samlingen, när den redan finns (portföljen). */
  collectionItemId?: string;
  /**
   * Skapar posten FÖRST NÄR annonsen faktiskt läggs upp (skannern).
   *
   * ⛔ INGET FÅR LÄGGAS I SAMLINGEN AV ATT MAN TITTAR PÅ SÄLJARKET. Vi la
   * tidigare in hela brickan när "Sälj" trycktes — den som ångrade sig hade då
   * korten i samlingen ändå, och granskningsvyn hoppade till "N kort tillagda"
   * fast ingenting sålts (ägaren 2026-09-07). Anroparen memoiserar id:t så att
   * ett andra försök på samma kort inte skapar en till post.
   */
  ensureCollectionItemId?: () => Promise<string>;
  name: string;
  setName: string | null;
  /** Katalogbilden — bara till huvudet i arket, aldrig till annonsen. */
  imageUrl: string | null;
  condition: string;
  language: string;
  /** Marknadsvärde i ÖRE. */
  estimatedValue: number | null;
  /** Löst kort (true) eller förseglad produkt (false) — styr skick och gradering. */
  isSingle: boolean;
  /** Redan graderat? Förifyller väljarna (samlingen bär fälten; skannern gör det inte). */
  gradingCompany?: string | null;
  grade?: string | null;
  /** Produktsida att koppla forumtråden till. */
  slug: string | null;
  /**
   * Foto användaren REDAN tagit (skannerns fångade ruta) — läggs in som
   * annonsens huvudbild. Att låta någon fota om ett kort de nyss fotat är
   * att be om samma arbete två gånger.
   */
  photo?: string | null;
}

/** Det som är KORTETS eget i formuläret (allt annat gäller hela högen). */
interface ItemDraft {
  price: string;
  startPrice: string;
  baseKr: number | null;
  step: number | null;
  condition: string;
  gradeCompany: string;
  gradeValue: string;
  description: string;
  images: string[];
  gradeNote: string | null;
  resultUrl: string | null;
  forumNote: string | null;
}

type Translators = {
  t: ReturnType<typeof useTranslations>;
  tCond: ReturnType<typeof useTranslations>;
  tLang: ReturnType<typeof useTranslations>;
};

/** Forumets marknadsgrupp (kurerad, id/slug satt i migrationen). */
const MARKET_GROUP_SLUG = "kop-salj-byt";

/** Forumets skick-lista saknar POOR med flit — då skickar vi inget skick alls. */
const FORUM_CONDITIONS = new Set(["MINT", "NEAR_MINT", "EXCELLENT", "GOOD", "PLAYED", "SEALED"]);

type ShippingOption = import("@/lib/tradera-shipping").ShippingOption;
interface ShippingSpan {
  weightKg: number;
  options: ShippingOption[];
}

/** Traderas maskinnamn → namnet folk känner igen från utlämningsstället. */
const PROVIDER_NAMES: Record<string, string> = {
  PostNordStamp: "PostNord Frimärke",
  PostNordParcel: "PostNord Paket",
  SchenkerPrivpak: "Schenker",
  DHLExpress: "DHL Express",
  DHL: "DHL",
  Instabox: "Instabox",
};

function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

/** 0.05 → "50 g", 1 → "1 kg". Vikten kommer i kilo ur Traderas referensdata. */
function weightLabel(kg: number): string {
  return kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg} kg`;
}

/** Standardbeskrivning att förifylla textrutan med (användaren kan redigera). */
function defaultDescription(
  row: SellItem,
  condition: string,
  tr: Translators,
  grading: string | null
): string {
  const condLabel = condition in CONDITION_LABELS ? tr.tCond(condition) : condition;
  const langLabel = row.language in LANGUAGE_LABELS ? tr.tLang(row.language) : row.language;
  return [
    `${row.name}${row.setName ? `, ${row.setName}` : ""}`,
    grading ? `${tr.t("sellGrading")}: ${grading}` : null,
    tr.t("sellDescCondition", { condition: condLabel }),
    tr.t("sellDescLanguage", { language: langLabel }),
    "",
    tr.t("sellDescFooter"),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * Läs in ett foto och skala ner till max 1600 px JPEG — ett rått mobilfoto är
 * 5–12 MB och 12 st som base64 blev en ~100 MB+ POST (långsam/omöjlig på mobilnät;
 * API:t cappar dessutom 8M tecken/bild). 1600 px räcker gott för Tradera-annonser.
 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("read"));
    };
    img.src = url;
  });
}

/** data:-URL → Blob, så forumets uppladdning kan återanvända samma foton. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Sektionsrubrik i arket — samma vikt överallt så raderna läses som en lista. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
      {children}
    </p>
  );
}

/** Val-chip (skick, prissteg, vikt). Vald = fylld i signaturaccenten. */
function Chip({
  active,
  onClick,
  children,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "rounded-full px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-40",
        active ? "bg-holo-cyan text-surface" : "bg-surface-overlay text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Säljarket. Tar EN ELLER FLERA poster och betar av dem i tur och ordning:
 * skannern lämnar ifrån sig hela brickan, och den som just skannat fem kort ska
 * inte behöva öppna fem ark själv. Valen som gäller HELA högen (annonstyp, vikt,
 * fraktbolag, forumkryss) följer med till nästa kort; det som är kortets eget
 * (pris, skick, foto, text) börjar om.
 */
export function SellSheet({
  items,
  open,
  onClose,
  elevated = false,
}: {
  items: SellItem[];
  open: boolean;
  onClose: () => void;
  /** Arket öppnas ovanpå en helskärmsvärd (skannern ligger z-[60]). */
  elevated?: boolean;
}) {
  const { toast } = useToast();
  const t = useTranslations("Collection");
  const tc = useTranslations("Common");
  const tCond = useTranslations("Condition");
  const tLang = useTranslations("Language");
  const locale = useLocale();
  const tr: Translators = { t, tCond, tLang };
  const fileRef = useRef<HTMLInputElement>(null);
  const communityV2 = useCommunityV2();

  /** Vilket kort i högen vi står på. 0 när det bara finns ett. */
  const [index, setIndex] = useState(0);
  /** Kort som redan fått en annons — bockade i väljaren, hoppas över av "nästa". */
  const [listed, setListed] = useState<Set<string>>(new Set());
  /**
   * Halvfärdiga formulär per kort. ⛔ UTAN DEM RADERAS INMATNINGEN AV ETT BYTE:
   * den som skriver ett pris på kort 3, kikar på kort 1 och kommer tillbaka ska
   * hitta sitt pris kvar. Ref, inte state — de ritar ingenting själva.
   */
  const drafts = useRef<Map<string, ItemDraft>>(new Map());
  const row = items[Math.min(index, Math.max(0, items.length - 1))] ?? null;

  /** En LÖS singel eller en förseglad produkt — styr skick-valen och graderingen. */
  const isSingle = row?.isSingle ?? true;
  /** Marknadspriset i hela kronor — förslaget procentknapparna utgår från. */
  const suggestedKr =
    row?.estimatedValue != null ? Math.round(row.estimatedValue / 100) : null;

  const [listingType, setListingType] = useState<ListingType>("BUY_NOW");
  const [price, setPrice] = useState("");
  /** Auktionens utgångspris. Köp direkt-priset i `price` är då valfritt. */
  const [startPrice, setStartPrice] = useState("");
  const [duration, setDuration] = useState<number>(DEFAULT_AUCTION_DURATION);
  /** Basen procentknapparna räknar på: marknadspriset, eller talet användaren skrivit. */
  const [baseKr, setBaseKr] = useState<number | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [condition, setCondition] = useState(row?.condition ?? "NEAR_MINT");
  /** Gradering — Traderas EGNA termer (attribut 125/126), tomt = ograderat. */
  const [gradeCompany, setGradeCompany] = useState(row?.gradingCompany ?? "");
  const [gradeValue, setGradeValue] = useState(row?.grade ?? "");
  const [spans, setSpans] = useState<ShippingSpan[]>([]);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  /**
   * VALDA fraktsätt — flera tillåtna, köparen väljer i kassan (Traderas
   * `shippingOptions` är en lista). Nyckeln är "leverantör:produkt", eftersom
   * produkt-id:t bara är unikt ihop med leverantören.
   */
  const [shippingPicks, setShippingPicks] = useState<ShippingOption[]>([]);
  /** "Egen frakt" är ett eget val och kan kombineras med bolagen. */
  const [ownShippingOn, setOwnShippingOn] = useState(false);
  /** Paketets format — filtrerar vilka fraktsätt som ens tar försändelsen. */
  const [packageSize, setPackageSize] = useState<PackageSize>(DEFAULT_PACKAGE_SIZE);
  /** Viktväljaren är dold för lösa kort (alltid 50 g) tills någon vill ändra. */
  const [showWeights, setShowWeights] = useState(false);
  const [ownShipping, setOwnShipping] = useState("20");
  /** Moms: av för privatpersoner, på för den som redovisar moms. */
  const [vatOn, setVatOn] = useState(false);
  const [vatRate, setVatRate] = useState<number>(DEFAULT_VAT_RATE);
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [grading, setGrading] = useState(false);
  const [gradeNote, setGradeNote] = useState<string | null>(null);
  const [alsoForum, setAlsoForum] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [forumNote, setForumNote] = useState<string | null>(null);

  const isAuction = listingType === "AUCTION";
  const activePrice = isAuction ? startPrice : price;
  const ownShippingKr = Math.round(Number(ownShipping) || 0);
  /** Alla valda fraktsätt, som de skickas till Tradera. */
  const shippingChoices = [
    ...shippingPicks.map((o) => ({
      costKr: o.priceKr,
      productId: o.productId,
      providerId: o.providerId,
      ...(weightKg != null ? { weightKg } : {}),
    })),
    ...(ownShippingOn ? [{ costKr: ownShippingKr }] : []),
  ];
  // Summan visar det BILLIGASTE valet — det är minimum köparen kan hamna på.
  const shippingKr = cheapestShippingKr(shippingChoices.map((c) => c.costKr));
  const total = totalBuyerKr(Number(activePrice), shippingKr);
  const vatKr = vatOn ? vatShareKr(Number(activePrice), vatRate) : 0;

  function toggleShipping(o: ShippingOption) {
    setShippingPicks((prev) => {
      const has = prev.some((p) => p.productId === o.productId && p.providerId === o.providerId);
      return has
        ? prev.filter((p) => !(p.productId === o.productId && p.providerId === o.providerId))
        : [...prev, o];
    });
  }

  /**
   * Fyll formuläret med ETT korts uppgifter. Körs när arket öppnas och vid varje
   * hopp till nästa kort i högen. ⛔ Rör INTE annonstyp, vikt, fraktbolag eller
   * forumkrysset: den som säljer fem kort ur samma bunt skickar dem likadant, och
   * att nollställa de valen per kort hade varit fyra onödiga rundor till.
   */
  const loadItem = useCallback(
    (item: SellItem | null) => {
      if (!item) return;
      const saved = drafts.current.get(item.key);
      if (saved) {
        // Tillbaka till ett kort man redan börjat på — visa det man skrev.
        setPrice(saved.price);
        setStartPrice(saved.startPrice);
        setBaseKr(saved.baseKr);
        setStep(saved.step);
        setCondition(saved.condition);
        setGradeCompany(saved.gradeCompany);
        setGradeValue(saved.gradeValue);
        setDescription(saved.description);
        setImages(saved.images);
        setGradeNote(saved.gradeNote);
        setResultUrl(saved.resultUrl);
        setForumNote(saved.forumNote);
        setError(null);
        return;
      }
      const kr = item.estimatedValue != null ? Math.round(item.estimatedValue / 100) : null;
      const cond = item.isSingle ? item.condition : "SEALED";
      setPrice(kr != null ? String(kr) : "");
      setStartPrice(kr != null ? String(kr) : "");
      setBaseKr(kr);
      setStep(kr != null ? 0 : null);
      setCondition(cond);
      const company = item.gradingCompany ?? "";
      const gradeVal = item.grade ?? "";
      setGradeCompany(company);
      setGradeValue(gradeVal);
      setDescription(defaultDescription(item, cond, tr, gradingLabel(company, gradeVal)));
      // Skannerns egen ruta ÄR framsidan — den blir annonsens huvudbild direkt.
      setImages(item.photo ? [item.photo] : []);
      setGradeNote(null);
      setError(null);
      setResultUrl(null);
      setForumNote(null);
    },
    // tr är tre översättarfunktioner som byter identitet varje rendering; texten
    // de producerar beror bara på språket, som inte ändras mitt i ett ark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Spara undan det man skrivit på kortet man lämnar. */
  function stashDraft(key: string | undefined) {
    if (!key) return;
    drafts.current.set(key, {
      price,
      startPrice,
      baseKr,
      step,
      condition,
      gradeCompany,
      gradeValue,
      description,
      images,
      gradeNote,
      resultUrl,
      forumNote,
    });
  }

  /** Hoppa till ett kort i högen (väljaren högst upp, eller "nästa"-knappen). */
  function goTo(next: number) {
    if (next === index || next < 0 || next >= items.length) return;
    stashDraft(row?.key);
    setIndex(next);
    loadItem(items[next]);
  }

  /** Arket öppnades (eller fick en ny hög) → börja om från första kortet. */
  useEffect(() => {
    if (!open) return;
    drafts.current.clear();
    setListed(new Set());
    setIndex(0);
    setListingType("BUY_NOW");
    setDuration(DEFAULT_AUCTION_DURATION);
    setWeightKg(null);
    setPackageSize(DEFAULT_PACKAGE_SIZE);
    setShippingPicks([]);
    // Utan fraktlista (hämtningen misslyckades) är eget belopp enda vägen.
    setOwnShippingOn(false);
    setShowWeights(false);
    setOwnShipping("20");
    setVatOn(false);
    setVatRate(DEFAULT_VAT_RATE);
    setAlsoForum(false);
    loadItem(items[0] ?? null);
    // ⛔ BARA `open` I BEROENDENA. `items` är typiskt en array-literal hos
    // anroparen och byter identitet vid varje rendering — med den i listan
    // nollställdes formuläret medan användaren skrev i det.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Klar med det här kortet → nästa som INTE redan har en annons. */
  function nextItem() {
    const next = items.findIndex((it, i) => i > index && !listed.has(it.key));
    if (next === -1) {
      onClose();
      return;
    }
    goTo(next);
  }

  /** Finns det något kvar att lägga upp efter det här kortet? */
  const hasMore = items.some((it, i) => i > index && !listed.has(it.key));

  /**
   * Fraktalternativen hämtas när arket öppnas. Rutten rör ingen databas (listan
   * ligger i minnet på servern), så det här kostar ingen Neon-väckning.
   */
  useEffect(() => {
    if (!open || spans.length > 0) return;
    let alive = true;
    void apiFetch<{ spans: ShippingSpan[] }>(
      `/api/tradera/shipping-options?single=${isSingle ? 1 : 0}`
    )
      .then((data) => {
        if (!alive || data.spans.length === 0) return;
        setSpans(data.spans);
        // Lättaste spannet för ett kort, ~1 kg för sealed: en boosterbox väger
        // aldrig 50 g och en förvald vikt som är fel är värre än ingen.
        const wanted = isSingle ? data.spans[0].weightKg : 1;
        const span =
          data.spans.find((s) => s.weightKg === wanted) ?? data.spans[0];
        setWeightKg(span.weightKg);
        const fitting = optionsForPackage(span.options, DEFAULT_PACKAGE_SIZE);
        setShippingPicks(fitting[0] ? [fitting[0]] : []);
      })
      .catch(() => {
        // Tyst: utan lista står "Egen frakt" kvar, precis som förut.
      });
    return () => {
      alive = false;
    };
  }, [open, spans.length, isSingle]);

  const currentSpan = spans.find((s) => s.weightKg === weightKg) ?? null;
  /** Bara de fraktsätt som tar ett paket av den valda storleken. */
  const spanOptions = currentSpan ? optionsForPackage(currentSpan.options, packageSize) : [];

  /** Andra raden i en fraktrad: spårbart/brevlåda och hur många dagar det tar. */
  function shippingMeta(o: ShippingOption): string {
    const parts = [
      o.tracked ? t("sellShipTracked") : t("sellShipUntracked"),
      o.servicePoint ? t("sellShipServicePoint") : t("sellShipMailbox"),
    ];
    // Tradera skriver själva ut varningen på sina fraktkort; utan den ser
    // 22-kronorsfrakten bara ut som "billigast".
    if (!o.insured) parts.push(t("sellShipNotInsured"));
    if (o.minDays != null) {
      parts.push(
        o.maxDays != null && o.maxDays !== o.minDays
          ? t("sellShipDaysRange", { min: o.minDays, max: o.maxDays })
          : t("sellShipDays", { days: o.minDays })
      );
    }
    return parts.join(" · ");
  }

  /** Handinmatning äger priset: markeringen släpps och talet blir den nya basen. */
  const onPriceTyped = useCallback(
    (value: string) => {
      if (isAuction) setStartPrice(value);
      else setPrice(value);
      setStep(null);
      const n = Math.round(Number(value));
      setBaseKr(Number.isFinite(n) && n > 0 ? n : suggestedKr);
    },
    [isAuction, suggestedKr]
  );

  function applyStep(pct: number) {
    // "Marknadspris" hämtar alltid tillbaka förslaget — annars hade 0 % bara
    // gett tillbaka det tal användaren nyss skrev, vilket är en tom knapp.
    const base = pct === 0 && suggestedKr != null ? suggestedKr : baseKr;
    if (base == null || base <= 0) return;
    if (pct === 0 && suggestedKr != null) setBaseKr(suggestedKr);
    setStep(pct);
    const next = String(applyPricePercent(base, pct));
    if (isAuction) setStartPrice(next);
    else setPrice(next);
  }

  function pickCondition(value: string) {
    // Håll beskrivningens Skick-rad i synk — men bara om texten inte redigerats
    // (dvs. fortfarande är auto-texten för nuvarande skick).
    if (row) {
      const grading = gradingLabel(gradeCompany, gradeValue);
      setDescription((prev) =>
        prev === defaultDescription(row, condition, tr, grading)
          ? defaultDescription(row, value, tr, grading)
          : prev
      );
    }
    setCondition(value);
  }

  /**
   * Gradering — håller beskrivningen i synk på samma villkor som `pickCondition`
   * (bara när texten inte redigerats). ⛔ Ett bolag UTAN betyg säger ingenting om
   * kortet, så etiketten (och Tradera-attributen) kräver båda.
   */
  function pickGrading(company: string, grade: string) {
    if (row) {
      const before = gradingLabel(gradeCompany, gradeValue);
      const after = gradingLabel(company, grade);
      setDescription((prev) =>
        prev === defaultDescription(row, condition, tr, before)
          ? defaultDescription(row, condition, tr, after)
          : prev
      );
    }
    setGradeCompany(company);
    setGradeValue(grade);
  }

  /**
   * AI-gradering ur fotona som redan ligger i arket (framsida + baksida).
   * Använder SAMMA rutt och SAMMA månadskvot som /gradera — ingen ny kostnad,
   * bara en genväg för den som inte vet vad "Excellent" betyder. Graden är ett
   * FÖRSLAG: den skriver skickvalet, användaren kan ändra direkt efteråt.
   */
  async function gradeFromPhotos() {
    if (images.length < 2 || grading) return;
    setGrading(true);
    setGradeNote(null);
    setError(null);
    try {
      const data = await apiFetch<{ overallGrade: number | null }>("/api/grading/grade", {
        method: "POST",
        body: { front: images[0], back: images[1], cardName: row?.name, locale },
      });
      if (data.overallGrade == null) throw new Error(t("sellGradeFailed"));
      const next = gradeToCondition(data.overallGrade);
      pickCondition(next);
      setGradeNote(
        t("sellGradeResult", {
          grade: data.overallGrade.toFixed(1),
          condition: next in CONDITION_LABELS ? tCond(next) : next,
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sellGradeFailed"));
    } finally {
      setGrading(false);
    }
  }

  /**
   * Kopian i forumets Köp/sälj/byt-grupp. Körs EFTER att Tradera-annonsen finns,
   * så tråden kan bära `traderaUrl` — köpet görs där, tråden är anslagstavlan.
   * Best effort: annonsen är redan uppe, ett forumfel får aldrig se ut som att
   * försäljningen misslyckades.
   */
  async function crossPostToForum(traderaUrl: string) {
    const keys: { key: string; thumbKey: string | null }[] = [];
    for (const src of images.slice(0, 6)) {
      const form = new FormData();
      form.append("file", dataUrlToBlob(src), "bild.jpg");
      const res = await fetch("/api/community/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) break; // bilder är trevliga, inte nödvändiga
      const data = (await res.json()) as { key: string; thumbKey: string | null };
      keys.push({ key: data.key, thumbKey: data.thumbKey });
    }
    await apiFetch("/api/community/posts", {
      method: "POST",
      body: {
        groupSlug: MARKET_GROUP_SLUG,
        title: [row!.name, row!.setName].filter(Boolean).join(" · ").slice(0, 120),
        content: description.trim() || row!.name,
        images: keys,
        listingKind: "SELL",
        priceKr: Number(activePrice),
        ...(FORUM_CONDITIONS.has(condition) ? { condition } : {}),
        ...(row!.slug ? { productSlug: row!.slug } : {}),
        traderaUrl,
      },
    });
  }

  async function submit() {
    if (!row) return;
    const priceKr = Math.round(Number(activePrice));
    if (!Number.isFinite(priceKr) || priceKr <= 0) return setError(t("sellErrPrice"));
    if (shippingChoices.length === 0) return setError(t("sellErrNoShipping"));
    if (shippingChoices.some((c) => !Number.isFinite(c.costKr) || c.costKr < 0)) {
      return setError(t("sellErrShipping"));
    }
    if (images.length === 0) return setError(t("sellErrPhoto"));

    setSaving(true);
    setError(null);
    try {
      // Posten skapas här när anroparen inte redan har en (skannern) — se
      // ensureCollectionItemId. Kastar den fångas felet av catch nedan.
      const collectionItemId =
        row.collectionItemId ?? (row.ensureCollectionItemId ? await row.ensureCollectionItemId() : null);
      if (!collectionItemId) throw new Error(t("genericFail"));

      const { url } = await apiFetch<{ url: string }>("/api/tradera/sell", {
        method: "POST",
        body: {
          collectionItemId,
          listingType,
          ...(isAuction
            ? { startPriceKr: priceKr, durationDays: duration }
            : { priceKr }),
          shippingOptions: shippingChoices,
          ...(vatOn ? { vatPercent: vatRate } : {}),
          condition,
          ...(gradeCompany && gradeValue
            ? { gradingCompany: gradeCompany, grade: gradeValue }
            : {}),
          description: description.trim() || undefined,
          imagesBase64: images,
        },
      });
      setResultUrl(url);
      setListed((prev) => new Set(prev).add(row.key));
      toast({ title: t("sellCreatedToast"), variant: "success" });

      if (alsoForum) {
        try {
          await crossPostToForum(url);
          setForumNote(t("sellForumPosted"));
        } catch (e) {
          setForumNote(e instanceof Error ? e.message : t("sellForumFailed"));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("genericFail"));
    } finally {
      setSaving(false);
    }
  }

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    try {
      const urls = await Promise.all(files.map(readAsDataUrl));
      setImages((prev) => [...prev, ...urls].slice(0, 12));
    } catch {
      // Utan fångst blev det en ohanterad rejection — och ingenting i UI:t.
      setError(t("sellImageReadFailed"));
    }
    if (fileRef.current) fileRef.current.value = ""; // tillåt samma fil igen
  }

  return (
    <BottomSheet
        open={open && row != null}
        onClose={onClose}
        title={
          items.length > 1
            ? t("sellTitleOfN", { index: index + 1, total: items.length })
            : t("sellTitle")
        }
        closeLabel={tc("cancel")}
        elevated={elevated}
        panelClassName="sm:mx-auto sm:max-w-lg"
        footer={
          resultUrl ? (
            <div className="space-y-2.5">
              {/* Huvudknappen är NÄSTA KORT när det finns fler — annars fastnar
                  den som säljer fem kort i "Visa annonsen" fyra gånger i onödan. */}
              {hasMore ? (
                <>
                  <BottomSheetCta onClick={nextItem}>
                    {t("sellNextItem", {
                      done: listed.size,
                      total: items.length,
                    })}
                  </BottomSheetCta>
                  <a
                    href={resultUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-xs font-medium text-ink-faint underline underline-offset-2"
                  >
                    {t("sellViewListing")}
                  </a>
                </>
              ) : (
                <a
                  href={resultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center rounded-[10px] bg-holo-cyan px-4 py-3.5 text-sm font-bold text-surface transition-opacity active:opacity-90"
                >
                  {t("sellViewListing")}
                </a>
              )}
            </div>
          ) : (
            <>
              {/* Summan står vid knappen, inte längst upp: det är sista siffran
                  man vill se innan man trycker. */}
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <span className="text-xs text-ink-muted">
                  {isAuction ? t("sellTotalAuction") : t("sellTotalBuyNow")}
                </span>
                <span className="text-base font-bold tabular-nums text-ink">
                  {total > 0
                    ? shippingChoices.length > 1
                      ? t("sellTotalFrom", { amount: `${total} kr` })
                      : `${total} kr`
                    : "–"}
                </span>
              </div>
              <BottomSheetCta onClick={() => void submit()} disabled={saving}>
                {saving ? t("sellCreating") : t("sellCreate")}
              </BottomSheetCta>
            </>
          )
        }
      >
        {/* KORTVÄLJAREN: hela högen som miniatyrer, och den ligger UTANFÖR
            resultatgrenen — utan den gick korten bara att nå i tur och ordning,
            dvs man var tvungen att sälja kort 1 för att ens få se kort 2
            (ägaren 2026-09-07). Bocken = kortet har redan en annons. */}
        {items.length > 1 && (
          <div className="-mx-[18px] mb-5 overflow-x-auto px-[18px]">
            <div className="flex gap-2">
              {items.map((it, i) => {
                const isDone = listed.has(it.key);
                return (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => goTo(i)}
                    aria-current={i === index}
                    aria-label={it.name}
                    className={cn(
                      "relative h-[68px] w-[52px] shrink-0 overflow-hidden rounded-lg border-2 bg-surface-raised transition-colors",
                      i === index ? "border-holo-cyan" : "border-transparent opacity-60"
                    )}
                  >
                    {it.photo || it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.photo ?? it.imageUrl!}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-ink-faint">
                        <IconPackage size={16} />
                      </span>
                    )}
                    {isDone && (
                      <span className="absolute inset-0 flex items-center justify-center bg-surface/70 text-holo-cyan">
                        <IconCheck size={18} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {resultUrl ? (
          <div className="space-y-3 pb-2">
            <p className="text-sm text-ink-muted">
              {t.rich("sellResultText", {
                name: row?.name ?? "",
                b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
              })}
            </p>
            {forumNote && <p className="text-sm text-ink-muted">{forumNote}</p>}
          </div>
        ) : (
          <div className="space-y-6 pb-2">
            {/* Objektet överst: ett foto och ett namn räcker för att vara säker på
                att man säljer RÄTT exemplar innan man börjar fylla i pris. */}
            <div className="flex items-center gap-3 rounded-xl bg-surface-raised p-3">
              <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md bg-surface">
                {row?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.imageUrl!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-faint">
                    <IconPackage size={20} />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{row?.name}</p>
                {row?.setName && <p className="truncate text-xs text-ink-muted">{row.setName}</p>}
              </div>
            </div>

            {/* BILDER */}
            <div>
              <SectionLabel>{t("sellSectionPhotos")}</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {images.map((src, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={t("sellPhotoAlt", { n: i + 1 })}
                      className="h-20 w-20 rounded-xl bg-surface-overlay object-cover"
                    />
                    <button
                      type="button"
                      aria-label={t("sellRemovePhoto")}
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-fall text-xs font-bold text-white"
                    >
                      ×
                    </button>
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">
                      {i === 0 ? t("sellPhotoFront") : i === 1 ? t("sellPhotoBack") : i + 1}
                    </span>
                  </div>
                ))}
                {images.length < 12 && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-surface-border text-xs font-medium text-ink-muted transition-colors hover:border-holo-cyan hover:text-ink"
                  >
                    <span aria-hidden="true" className="text-lg leading-none">
                      +
                    </span>
                    {t("sellPhotoAdd")}
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                id="sellPhoto"
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => void addFiles(Array.from(e.target.files ?? []))}
              />
            </div>

            {/* SÅ SÄLJS DET — Köp nu eller auktion. */}
            <div>
              <SectionLabel>{t("sellSectionType")}</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                {(["BUY_NOW", "AUCTION"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setListingType(type)}
                    aria-pressed={listingType === type}
                    className={cn(
                      "rounded-xl px-4 py-3 text-sm font-bold transition-colors",
                      listingType === type
                        ? "bg-holo-cyan text-surface"
                        : "bg-surface-overlay text-ink-muted hover:text-ink"
                    )}
                  >
                    {type === "BUY_NOW" ? t("sellTypeBuyNow") : t("sellTypeAuction")}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                {isAuction ? t("sellTypeAuctionHint") : t("sellTypeBuyNowHint")}
              </p>
              {isAuction && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {AUCTION_DURATIONS.map((d) => (
                    <Chip key={d} active={duration === d} onClick={() => setDuration(d)}>
                      {t("sellDurationDays", { days: d })}
                    </Chip>
                  ))}
                </div>
              )}
            </div>

            {/* DITT PRIS */}
            <div>
              <SectionLabel>{isAuction ? t("sellStartPrice") : t("sellSectionPrice")}</SectionLabel>
              <div className="rounded-xl bg-surface-raised p-3">
                <div className="flex items-center gap-2">
                  <Input
                    id="sellPrice"
                    aria-label={isAuction ? t("sellStartPrice") : t("sellPrice")}
                    inputMode="numeric"
                    enterKeyHint="done"
                    value={activePrice}
                    onChange={(e) => onPriceTyped(e.target.value)}
                    placeholder={t("sellPricePlaceholder")}
                    className="h-12 bg-surface text-lg font-bold tabular-nums"
                  />
                  <span className="shrink-0 text-sm font-semibold text-ink-muted">kr</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {suggestedKr != null
                    ? t("sellSuggested", { price: formatPrice(row!.estimatedValue!) })
                    : t("sellNoSuggested")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {PRICE_STEPS.map((pct) => {
                    if (pct === 0 && suggestedKr == null) return null;
                    return (
                      <Chip
                        key={pct}
                        active={step === pct}
                        disabled={baseKr == null && !(pct === 0 && suggestedKr != null)}
                        onClick={() => applyStep(pct)}
                      >
                        {pct === 0
                          ? t("sellMarketChip")
                          : `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* SKICK — helt olika fråga för ett löst kort och för något förseglat. */}
            <div>
              <SectionLabel>{t("condition")}</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {conditionOptionsFor(isSingle).map((value) => (
                  <Chip
                    key={value}
                    active={condition === value}
                    onClick={() => pickCondition(value)}
                  >
                    {isSingle
                      ? value in CONDITION_LABELS
                        ? tCond(value)
                        : value
                      : t(`sellSealedCond${value}` as "sellSealedCondSEALED")}
                  </Chip>
                ))}
              </div>
              {/* Osäker? AI-graderingen svarar — ur fotona som redan ligger här.
                  Bara singlar: en förseglad box har inget skick att gradera. */}
              {isSingle && (
                <div className="mt-3 rounded-xl border border-surface-border p-3">
                  <p className="text-xs font-semibold text-ink">{t("sellUnsureTitle")}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {images.length >= 2 ? t("sellUnsureReady") : t("sellUnsureNeedsPhotos")}
                  </p>
                  {gradeNote && (
                    <p className="mt-2 text-xs font-medium text-holo-cyan">{gradeNote}</p>
                  )}
                  <div className="mt-2.5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void gradeFromPhotos()}
                      disabled={images.length < 2 || grading}
                      className="inline-flex items-center gap-2 rounded-full bg-surface-overlay px-3.5 py-2 text-xs font-semibold text-ink transition-opacity disabled:opacity-40"
                    >
                      {grading && <Spinner size="sm" />}
                      {t("sellGradeCta")}
                    </button>
                    <Link
                      href="/gradera"
                      className="text-xs font-medium text-ink-faint underline underline-offset-2 hover:text-ink"
                    >
                      {t("sellGradeOpenPage")}
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* GRADERING — bara singlar. Termerna är Traderas egna (attribut 125/126),
                så annonsen blir sökbar på "PSA 10" i deras egna filter i stället för
                att bara nämnas i texten. Valfritt: de flesta kort är ograderade. */}
            {isSingle && (
              <div>
                <SectionLabel>{t("sellGrading")}</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    active={!gradeCompany}
                    onClick={() => pickGrading("", "")}
                  >
                    {t("sellGradingNone")}
                  </Chip>
                  {GRADING_ISSUERS.map((issuer) => (
                    <Chip
                      key={issuer}
                      active={gradeCompany === issuer}
                      onClick={() => pickGrading(issuer, gradeValue)}
                    >
                      {issuer}
                    </Chip>
                  ))}
                </div>
                {gradeCompany && (
                  <>
                    <p className="mb-2 mt-3 text-xs text-ink-muted">{t("sellGrade")}</p>
                    <div className="flex flex-wrap gap-2">
                      {GRADES.map((g) => (
                        <Chip
                          key={g}
                          active={gradeValue === g}
                          onClick={() => pickGrading(gradeCompany, g)}
                        >
                          {g}
                        </Chip>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* FRAKT — Traderas egna fraktbolag och priser, per viktspann. */}
            <div>
              <SectionLabel>{t("sellSectionShipping")}</SectionLabel>
              {spans.length > 0 && (
                <>
                  <p className="mb-2 text-xs text-ink-muted">{t("sellShippingHint")}</p>
                  {/* VIKTEN ÄR PRISET hos Tradera — men den behöver bara FRÅGAS när
                      vi inte redan vet den. Ett löst kort i fodral och kuvert väger
                      alltid under 50 g; en ETB, en display och en box gör inte det,
                      så sealed får väljaren öppen. Raden går alltid att öppna. */}
                  {/* PAKETETS FORMAT — Traderas egna Small/Medium/Large, samma
                      tre steg som deras fraktväljare, och de filtrerar listan
                      nedan likadant. Precis som vikten frågas den BARA när vi
                      inte redan vet svaret: ett löst kort i fodral och kuvert är
                      alltid Small (ägaren 2026-09-07). */}
                  {(showWeights || !isSingle) && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {PACKAGE_SIZE_KEYS.map((size) => (
                        <Chip
                          key={size}
                          active={packageSize === size}
                          onClick={() => {
                            setPackageSize(size);
                            // De valda produkterna kanske inte tar det nya
                            // formatet — behåll bara dem som gör det.
                            setShippingPicks((prev) =>
                              currentSpan
                                ? prev.filter((p) =>
                                    optionsForPackage(currentSpan.options, size).some(
                                      (o) =>
                                        o.productId === p.productId && o.providerId === p.providerId
                                    )
                                  )
                                : []
                            );
                          }}
                        >
                          <span className="block leading-tight">
                            {t(`sellSize${size}` as "sellSizeSMALL")}
                            <span
                              className={cn(
                                "block text-[10px] font-medium",
                                packageSize === size ? "text-surface/70" : "text-ink-faint"
                              )}
                            >
                              {packageSizeLabel(size)}
                            </span>
                          </span>
                        </Chip>
                      ))}
                    </div>
                  )}
                  {weightKg != null && (
                    <div className="mb-2 flex items-center gap-2 text-xs">
                      <span className="text-ink-muted">
                        {t("sellWeightIs", { weight: weightLabel(weightKg) })}
                        {" · "}
                        {t("sellPackageIs", { size: t(`sellSize${packageSize}` as "sellSizeSMALL") })}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowWeights((v) => !v)}
                        className="font-medium text-holo-cyan underline underline-offset-2"
                      >
                        {showWeights ? tc("close") : t("sellWeightChange")}
                      </button>
                    </div>
                  )}
                  {(showWeights || !isSingle) && (
                    <div className="flex flex-wrap gap-2">
                      {spans.map((s) => (
                        <Chip
                          key={s.weightKg}
                          active={weightKg === s.weightKg}
                          onClick={() => {
                            // Nytt viktspann = andra produkter och priser; de
                            // gamla valen pekar på produkter som inte längre
                            // gäller, så de nollställs till det billigaste.
                            setWeightKg(s.weightKg);
                            const fitting = optionsForPackage(s.options, packageSize);
                            setShippingPicks(fitting[0] ? [fitting[0]] : []);
                          }}
                        >
                          {weightLabel(s.weightKg)}
                        </Chip>
                      ))}
                    </div>
                  )}
                  <ul className="mt-3 space-y-1.5">
                    {spanOptions.map((o) => {
                      const active = shippingPicks.some(
                        (p) => p.productId === o.productId && p.providerId === o.providerId
                      );
                      return (
                        <li key={`${o.providerId}:${o.productId}`}>
                          <button
                            type="button"
                            onClick={() => toggleShipping(o)}
                            aria-pressed={active}
                            className={cn(
                              "flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold transition-colors",
                              active
                                ? "bg-holo-cyan text-surface"
                                : "bg-surface-raised text-ink hover:bg-surface-overlay"
                            )}
                          >
                            <span className="min-w-0 text-left">
                              <span className="block truncate">{providerName(o.provider)}</span>
                              <span
                                className={cn(
                                  "block text-[11px] font-medium",
                                  active ? "text-surface/70" : "text-ink-faint"
                                )}
                              >
                                {shippingMeta(o)}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2 tabular-nums">
                              {o.priceKr} kr
                              {active && <IconCheck size={16} />}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    <li>
                      <button
                        type="button"
                        onClick={() => setOwnShippingOn((v) => !v)}
                        aria-pressed={ownShippingOn}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold transition-colors",
                          ownShippingOn
                            ? "bg-holo-cyan text-surface"
                            : "bg-surface-raised text-ink hover:bg-surface-overlay"
                        )}
                      >
                        {t("sellShippingOwn")}
                        <span className="flex shrink-0 items-center gap-2 tabular-nums">
                          {ownShippingOn && (
                            <>
                              {ownShippingKr} kr
                              <IconCheck size={16} />
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  </ul>
                  {spanOptions.length === 0 && (
                    <p className="mt-2 text-xs text-ink-muted">{t("sellShippingNoneFit")}</p>
                  )}
                  {/* FLERA FRAKTSÄTT ÄR TILLÅTNA — köparen väljer i kassan
                      (Traderas shippingOptions är en lista). Ett enda val var
                      vår begränsning, inte deras (ägaren 2026-09-07). */}
                  <p className="mt-2 text-xs text-ink-faint">{t("sellShippingMulti")}</p>
                </>
              )}
              {(ownShippingOn || spans.length === 0) && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    id="sellShipping"
                    aria-label={t("sellShipping")}
                    inputMode="numeric"
                    value={ownShipping}
                    onChange={(e) => setOwnShipping(e.target.value)}
                    className="h-11 bg-surface"
                  />
                  <span className="shrink-0 text-sm font-semibold text-ink-muted">kr</span>
                </div>
              )}
            </div>

            {/* MOMS — bara för den som redovisar moms. ⛔ Av som standard: en
                privatperson som säljer ur sin egen samling redovisar ingen moms,
                och ett förifyllt fält hade fått folk att påstå motsatsen. */}
            <div>
              <SectionLabel>{t("sellSectionVat")}</SectionLabel>
              <div className="rounded-xl border border-surface-border p-3">
                <Checkbox
                  id="sellVat"
                  label={t("sellVatToggle")}
                  checked={vatOn}
                  onChange={(e) => setVatOn(e.target.checked)}
                />
                <p className="mt-1.5 text-xs text-ink-muted">{t("sellVatHint")}</p>
                {vatOn && (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {VAT_RATES.map((rate) => (
                        <Chip key={rate} active={vatRate === rate} onClick={() => setVatRate(rate)}>
                          {rate} %
                        </Chip>
                      ))}
                    </div>
                    {/* Priset är INKLUSIVE moms — beloppet räknas baklänges ur
                        det, aldrig som ett påslag ovanpå. */}
                    <p className="mt-2.5 text-xs text-ink-muted">
                      {t("sellVatOfPrice", { amount: `${vatKr} kr` })}
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* ANNONSTEXT */}
            <div>
              <SectionLabel>{t("sellSectionDescription")}</SectionLabel>
              <Label htmlFor="sellDescription" className="sr-only">
                {t("sellDescription")}
              </Label>
              <Textarea
                id="sellDescription"
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("sellDescriptionPlaceholder")}
                className="bg-surface"
                // Skrolla upp fältet ovanför tangentbordet när det öppnas (mobil).
                onFocus={(e) => {
                  const el = e.currentTarget;
                  setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
                }}
              />
            </div>

            {/* Kopian i forumet — bara för den som ser community-funktionerna. */}
            {communityV2 && (
              <div className="rounded-xl border border-surface-border p-3">
                <Checkbox
                  id="sellAlsoForum"
                  label={t("sellAlsoForum")}
                  checked={alsoForum}
                  onChange={(e) => setAlsoForum(e.target.checked)}
                />
                <p className="mt-1.5 text-xs text-ink-muted">{t("sellAlsoForumHint")}</p>
              </div>
            )}

            <FieldError message={error} />
          </div>
        )}
    </BottomSheet>
  );
}

/**
 * Knappen på en samlingspost. Arket i sig klarar flera poster (skannern skickar
 * hela brickan) — här är högen alltid ett kort.
 */
export function SellButton({
  item,
  className,
  size = "sm",
}: {
  item: SellItem;
  className?: string;
  size?: "sm" | "md";
}) {
  const t = useTranslations("Collection");
  const [open, setOpen] = useState(false);
  // Ny array-identitet vid varje rendering hade startat om arket mitt i (effekten
  // som laddar högen tittar på `items`) — därför en stabil referens per post.
  const items = useMemo(() => [item], [item]);

  return (
    <>
      <Button size={size} variant="secondary" className={className} onClick={() => setOpen(true)}>
        {t("sell")}
      </Button>
      <SellSheet items={items} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
