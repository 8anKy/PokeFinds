"use client";

/**
 * Gradera kort — ladda upp fram- och baksidesbild, få en AI-uppskattad
 * PSA-liknande gradering (delpoäng + helhet). Mobil först: kameraupptagning via
 * <input capture>. Detta är en uppskattning, inte en officiell gradering.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { SafeImage } from "@/components/ui/safe-image";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { cn } from "@/lib/utils";
import { ProCta } from "@/components/features/pro-cta";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CenteringTool, type CenteringOutcome } from "@/components/features/centering-tool";
import { ShareCardPanel } from "@/components/features/share-card-panel";
import { CardSearch, type CardSearchCandidate } from "@/components/features/card-search";
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";
import { takeGradePrefill } from "@/lib/grade-prefill";
import { photoFingerprints } from "@/lib/photo-fingerprints";
import { prepareGradeSpinLayers, renderGradeShareCard } from "@/lib/share-card";
import {
  combinedPsaCap,
  formatRatio,
  isEReaderSet,
  worstShare,
  type CenteringResult,
  type CenteringSide,
} from "@/lib/centering";
import {
  IconAlertTriangle,
  IconCamera,
  IconCentering,
  IconCheck,
  IconShare,
  IconShield,
  IconSparkle,
  IconTrendingUp,
} from "@/components/ui/icons";

interface SubScores {
  centering: number;
  corners: number;
  edges: number;
  surface: number;
}

interface GradeResultDto {
  subScores: SubScores;
  overall: number;
  confidence: number;
  rationale: string;
  modelUsed: string;
  /** Kortet modellen läste av. null/undefined = gick inte att identifiera. */
  cardName?: string | null;
  /**
   * Katalogkortet, löst ur `cardName` vid graderingen (services/grading/card-link.ts).
   * Sätts BARA när samlarnumret styrkte identiteten — modellens setgissning är mätt
   * opålitlig och ett namn ensamt delas av 92 % av katalogen. null = ingen bild.
   */
  cardImageUrl?: string | null;
  cardSlug?: string | null;
  /** Katalogens egen skrivning ("Camerupt · Ascended Heroes 28"). */
  cardLabel?: string | null;
  cardSetName?: string | null;
  /** Katalogens språk ("JP" …) — slabvideons kortbaksida. */
  cardLanguage?: string | null;
  cardId?: string | null;
  /** Användarens uppmätta centrering, sparad på jobbet (services/grading/extras.ts). */
  centering?: {
    front: StoredSide | null;
    back: StoredSide | null;
    psaCap: number | null;
  } | null;
}

/** En sidas sparade mätning: den bredare sidans andel per axel, 50..100. */
interface StoredSide {
  mode: "standard" | "ereader";
  leftRight?: number;
  topBottom?: number;
  topRight?: number;
}

/** "Lönar det sig att gradera?" — se services/grading/extras.ts. */
interface GradingWorthDto {
  slug: string;
  rawOre: number | null;
  rows: { gradeTenths: number; medianOre: number | null; count: number; source: "ebay" | "tradera" }[];
  locked: boolean;
}

interface Quota {
  used: number;
  limit: number | null;
  remaining: number | null;
  isPremium: boolean;
}

interface GradeResponse {
  jobId: string;
  overallGrade: number | null;
  confidence: number | null;
  modelUsed: string | null;
  result: GradeResultDto;
  quota?: Quota;
  worth?: GradingWorthDto | null;
  /** Öppnad ur historiken: när graderingen gjordes. Fotona finns inte kvar då. */
  historyAt?: string;
}

interface GradingJobDto {
  id: string;
  status: string;
  overallGrade: number | null;
  confidence: number | null;
  modelUsed: string | null;
  createdAt: string;
  result: (Partial<GradeResultDto> & { error?: string }) | null;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const SUB_LABELS: { key: keyof SubScores; labelKey: string }[] = [
  { key: "centering", labelKey: "subCentering" },
  { key: "corners", labelKey: "subCorners" },
  { key: "edges", labelKey: "subEdges" },
  { key: "surface", labelKey: "subSurface" },
];

/** Färg utifrån grad (1–10): grönt högt, turkos mitten, gult/rött lågt. */
function gradeTone(score: number): string {
  if (score >= 9) return "text-rise";
  if (score >= 7) return "text-holo-cyan";
  if (score >= 5) return "text-amber-400";
  return "text-fall";
}

/** En sidas mätning i kompakt form: "54/46 · 51/49" eller "övre/höger 52/48". */
function ratiosText(r: CenteringResult, topRightWord: string): string {
  if (r.topRight) return `${topRightWord} ${formatRatio(r.topRight)}`;
  return [r.leftRight, r.topBottom]
    .filter((x): x is NonNullable<typeof x> => x != null)
    .map(formatRatio)
    .join(" · ");
}

/** Sparad mätning → "54/46 · 52/48" eller "övre/höger 52/48". */
function storedRatiosText(side: StoredSide, topRightWord: string): string {
  const r = (wide: number) => `${Math.round(wide)}/${100 - Math.round(wide)}`;
  if (side.mode === "ereader" && side.topRight != null) return `${topRightWord} ${r(side.topRight)}`;
  return [side.leftRight, side.topBottom]
    .filter((n): n is number => n != null)
    .map(r)
    .join(" · ");
}

/** Mätningen i den form /api/grading/grade tar emot (bredaste andelen per axel). */
function centeringPayload(o: CenteringOutcome | null) {
  if (!o) return undefined;
  const r = o.result;
  return {
    mode: r.mode,
    leftRight: r.leftRight ? worstShare(r.leftRight) : undefined,
    topBottom: r.topBottom ? worstShare(r.topBottom) : undefined,
    topRight: r.topRight ? worstShare(r.topRight) : undefined,
  };
}

/**
 * Namn + undertitel för delningsbilden. Katalogens etikett ("Camerupt · Ascended
 * Heroes 28") bär numret SIST → "Ascended Heroes · #28"; modellens sträng
 * ("Torchic 65/100 · EX Crystal Guardians") lämnas som den är.
 */
function splitLabel(
  label: string | null | undefined,
  fromCatalog = false
): { name: string; subtitle: string } | null {
  if (!label) return null;
  const [name, ...rest] = label.split(" · ");
  let subtitle = rest.join(" · ").trim();
  if (fromCatalog) {
    const m = subtitle.match(/^(.*)\s+(\S+)$/);
    if (m) subtitle = `${m[1]} · #${m[2]}`;
  }
  return { name: name.trim(), subtitle };
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  // Fylls från 0 vid mount (transition animerar bara ÄNDRINGAR efter första
  // renderingen → starta på 0, sätt riktiga bredden i en effekt). Reduced
  // motion nollas globalt i globals.css.
  const [filled, setFilled] = useState(false);
  useEffect(() => setFilled(true), []);
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-sm text-ink-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-overlay">
        <div
          className="h-full rounded-full bg-holo-cyan transition-[width] duration-700 ease-out-soft"
          style={{ width: filled ? `${Math.round((score / 10) * 100)}%` : "0%" }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function ImageDropzone({
  label,
  preview,
  onPick,
  inputRef,
  onChange,
  footer,
}: {
  label: string;
  preview: string | null;
  onPick: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  /** Under bilden — centreringsknappen. */
  footer?: React.ReactNode;
}) {
  const t = useTranslations("Grading");
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onPick}
        className={cn(
          "flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed px-4 py-6 text-center transition-all duration-200 active:scale-[0.98]",
          preview
            ? "border-holo-cyan/40"
            : "border-surface-border hover:border-holo-cyan/50 hover:bg-surface-overlay"
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={t("previewAlt", { label })}
            className="h-full w-full rounded-lg object-contain"
          />
        ) : (
          <>
            <span aria-hidden="true" className="text-ink-faint">
              <IconCamera size={30} />
            </span>
            <p className="text-sm font-medium text-ink">{label}</p>
            <p className="text-xs text-ink-faint">{t("tapToCapture")}</p>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onChange}
      />
      {footer}
    </div>
  );
}

/** Knappen under ett foto: mät, eller visa mätningen och mät om. */
function CenteringButton(props: {
  outcome: CenteringOutcome | null;
  onMeasure: () => void;
}) {
  const t = useTranslations("Centering");
  const { outcome } = props;
  return (
    <button
      type="button"
      onClick={props.onMeasure}
      className={cn(
        "flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors",
        outcome
          ? "border-holo-cyan/40 bg-holo-cyan/5 text-holo-cyan hover:bg-holo-cyan/10"
          : "border-surface-border text-ink-muted hover:border-holo-cyan/50 hover:text-ink"
      )}
    >
      <IconCentering size={15} />
      <span className="truncate tabular-nums">
        {outcome ? ratiosText(outcome.result, t("axisTopRight").toLowerCase()) : t("measure")}
      </span>
    </button>
  );
}

/**
 * "LÖNAR DET SIG ATT GRADERA?" — ograderat värde mot sålda PSA-exemplar runt
 * den uppskattade graden. Underlaget visas (median + antal), aldrig en uträknad
 * vinst: avgift och frakt varierar och vi har inga verifierade tal för dem.
 */
/**
 * "Lönar det sig att gradera?" — ograderat värde som BASLINJE och varje PSA-betyg
 * som en stapel mot den, så skillnaden syns innan man läst en siffra.
 * ⛔ Ingen uträknad vinst (avgift och frakt varierar — se services/grading/extras.ts):
 *    kvoten "2,5× ograderat" är ett faktum om medianerna, inte ett löfte.
 * ⛔ Låst (gratis): staplarna ritas fulla och dämpade — en riktig längd hade
 *    avslöjat talet som är Pro.
 */
function GradingWorthPanel({ worth, overall }: { worth: GradingWorthDto; overall: number }) {
  const t = useTranslations("Grading");
  const nearest = Math.round(overall) * 10;
  const [filled, setFilled] = useState(false);
  useEffect(() => setFilled(true), []);
  const max = Math.max(worth.rawOre ?? 0, ...worth.rows.map((r) => r.medianOre ?? 0));
  const pct = (ore: number | null) => (ore != null && max > 0 ? Math.max(4, (ore / max) * 100) : 0);
  const ratio = (ore: number | null) =>
    ore != null && worth.rawOre != null && worth.rawOre > 0 ? ore / worth.rawOre : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-holo-cyan/25 bg-gradient-to-b from-holo-cyan/[0.07] to-transparent">
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-holo-cyan/15 text-holo-cyan ring-1 ring-holo-cyan/30">
          <IconTrendingUp size={16} />
        </span>
        <p className="text-sm font-semibold text-ink">{t("worthTitle")}</p>
      </div>

      <ul className="flex flex-col gap-2 p-3">
        {/* Baslinjen: vad kortet är värt som det är. */}
        <li className="rounded-xl bg-surface-overlay/40 px-3 py-2.5 ring-1 ring-surface-border">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-ink-muted">{t("worthRaw")}</span>
            <span className="text-base font-bold tabular-nums text-ink">{formatPrice(worth.rawOre)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-overlay">
            <div
              className="h-full rounded-full bg-ink-faint transition-[width] duration-700 ease-out-soft"
              style={{ width: filled ? `${pct(worth.rawOre)}%` : 0 }}
            />
          </div>
        </li>

        {worth.rows.map((r) => {
          const mine = r.gradeTenths === nearest;
          const x = ratio(r.medianOre);
          return (
            <li
              key={r.gradeTenths}
              className={cn(
                "rounded-xl px-3 py-2.5 ring-1",
                mine ? "bg-holo-cyan/10 ring-holo-cyan/40" : "bg-surface-overlay/40 ring-surface-border"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="rounded-md bg-ink px-1.5 py-0.5 text-xs font-extrabold tabular-nums tracking-wide text-surface">
                    PSA {r.gradeTenths / 10}
                  </span>
                  {mine && (
                    <span className="truncate text-[11px] font-semibold text-holo-cyan">{t("worthYours")}</span>
                  )}
                </span>
                {r.medianOre != null ? (
                  <span className="shrink-0 text-base font-bold tabular-nums text-holo-cyan">
                    {formatPrice(r.medianOre)}
                  </span>
                ) : (
                  <span aria-hidden="true" className="shrink-0 select-none text-base font-bold text-ink-faint blur-[5px]">
                    0 000 kr
                  </span>
                )}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-overlay">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700 ease-out-soft",
                    r.medianOre != null ? "bg-holo-cyan" : "bg-holo-cyan/25"
                  )}
                  style={{ width: filled ? (r.medianOre != null ? `${pct(r.medianOre)}%` : "100%") : 0 }}
                />
              </div>
              <p className="mt-1.5 flex justify-between gap-2 text-[11px] text-ink-faint">
                <span>{t("worthSold", { count: r.count, source: r.source === "ebay" ? "eBay" : "Tradera" })}</span>
                {x != null && (
                  <span className={cn("font-semibold tabular-nums", x >= 1 ? "text-rise" : "text-fall")}>
                    {t("worthRatio", { x: x.toFixed(1).replace(".", ",") })}
                  </span>
                )}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="px-4 pb-4">
        {worth.rows.length === 0 && <p className="text-xs text-ink-muted">{t("worthNoSales")}</p>}
        {worth.locked && (
          <ProCta source="grading-worth" size="sm" className="mt-1 w-full">
            {t("worthUnlock")}
          </ProCta>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          {t("worthNote")}{" "}
          <Link href={`/produkter/${worth.slug}`} className="font-semibold text-holo-cyan hover:underline">
            {t("worthAll")}
          </Link>
        </p>
      </div>
    </div>
  );
}

/** Ett kort ur bildmatchningen eller sökningen — se /api/grading/identify. */
interface IdentifiedCard {
  cardId: string;
  name: string;
  number: string;
  setName: string;
  imageUrl: string | null;
}

/**
 * "ÄR DET HÄR DITT KORT?" (2026-10-01) — skannerns bildmatchning på framsidan,
 * FÖRE graderingen. AI:n graderar fortfarande; det här avgör bara vilket kort det
 * är, så värdet och slabbens bild blir rätt. Förvalt bara när matchningen är
 * säker (mätt: noll fel), annars får användaren välja bland tre eller söka.
 */
function CardIdentityBox(props: {
  state: "loading" | "done";
  chosen: IdentifiedCard | null;
  suggestions: IdentifiedCard[];
  onChoose: (c: IdentifiedCard) => void;
  onSearch: () => void;
}) {
  const t = useTranslations("Grading");
  const [changing, setChanging] = useState(false);
  if (props.state === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-surface-overlay/40 px-3 py-3 text-sm text-ink-muted ring-1 ring-surface-border">
        <Spinner />
        {t("identifyLoading")}
      </div>
    );
  }
  const { chosen } = props;
  if (chosen && !changing) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-holo-cyan/10 p-2.5 ring-1 ring-holo-cyan/40">
        {chosen.imageUrl ? (
          <SafeImage
            src={chosen.imageUrl}
            alt=""
            className="h-16 w-[2.85rem] shrink-0 rounded object-cover"
            fallback={<span className="h-16 w-[2.85rem] shrink-0 rounded bg-surface-overlay" />}
          />
        ) : (
          <span className="h-16 w-[2.85rem] shrink-0 rounded bg-surface-overlay" />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-holo-cyan">
            <IconCheck size={12} /> {t("identifyYourCard")}
          </p>
          <p className="truncate text-sm font-semibold text-ink">{chosen.name}</p>
          <p className="truncate text-xs text-ink-faint">
            {chosen.setName} · #{chosen.number}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setChanging(true)}
          className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-ink-muted ring-1 ring-surface-border hover:text-ink"
        >
          {t("identifyChange")}
        </button>
      </div>
    );
  }
  const options = props.suggestions.slice(0, 3);
  return (
    <div className="rounded-xl bg-surface-overlay/40 p-3 ring-1 ring-surface-border">
      <p className="text-sm font-semibold text-ink">
        {options.length > 0 ? t("identifyQuestion") : t("identifyNone")}
      </p>
      {options.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {options.map((c) => (
            <li key={c.cardId}>
              <button
                type="button"
                onClick={() => {
                  props.onChoose(c);
                  setChanging(false);
                }}
                className={cn(
                  "flex w-full flex-col items-center gap-1 rounded-lg p-1.5 text-center ring-1 transition-colors",
                  chosen?.cardId === c.cardId
                    ? "bg-holo-cyan/10 ring-holo-cyan/50"
                    : "ring-surface-border hover:bg-surface-overlay"
                )}
              >
                {c.imageUrl ? (
                  <SafeImage
                    src={c.imageUrl}
                    alt=""
                    className="aspect-[63/88] w-full rounded object-cover"
                    fallback={<span className="aspect-[63/88] w-full rounded bg-surface-overlay" />}
                  />
                ) : (
                  <span className="aspect-[63/88] w-full rounded bg-surface-overlay" />
                )}
                <span className="line-clamp-1 w-full text-[11px] font-semibold text-ink">{c.name}</span>
                <span className="line-clamp-1 w-full text-[10px] text-ink-faint">
                  {c.setName} · #{c.number}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => {
            setChanging(false);
            props.onSearch();
          }}
          className="text-xs font-semibold text-holo-cyan hover:underline"
        >
          {t("identifySearch")}
        </button>
        {chosen && changing && (
          <button
            type="button"
            onClick={() => setChanging(false)}
            className="text-xs font-medium text-ink-faint hover:text-ink"
          >
            {t("identifyKeep")}
          </button>
        )}
        {!chosen && options.length > 0 && (
          <span className="text-[11px] text-ink-faint">{t("identifySkipHint")}</span>
        )}
      </div>
    </div>
  );
}

export default function GraderaPage() {
  const t = useTranslations("Grading");
  const locale = useLocale();
  const { toast } = useToast();
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradeResponse | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [jobs, setJobs] = useState<GradingJobDto[] | null>(null);
  /** Från skannern: kortets namn + set (lib/grade-prefill.ts). */
  const [cardHint, setCardHint] = useState<string | null>(null);
  const [setHint, setSetHint] = useState<string | null>(null);
  const [cardIdHint, setCardIdHint] = useState<string | null>(null);
  const [centering, setCentering] = useState<Record<CenteringSide, CenteringOutcome | null>>({
    front: null,
    back: null,
  });
  const [toolSide, setToolSide] = useState<CenteringSide | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  /** "Fel kort? Välj rätt" — användaren väljer kortet ur katalogen (api/grading/jobs/[id]/card). */
  const [pickOpen, setPickOpen] = useState(false);
  /** Sökningen öppnad FÖRE graderingen (väljer `identified`), inte för ett jobb. */
  const [pickForPhoto, setPickForPhoto] = useState(false);
  /** Bildmatchningen på framsidan — se CardIdentityBox. */
  const [idState, setIdState] = useState<"idle" | "loading" | "done">("idle");
  const [suggestions, setSuggestions] = useState<IdentifiedCard[]>([]);
  const [identified, setIdentified] = useState<IdentifiedCard | null>(null);
  const userPickedRef = useRef(false);
  const [picking, setPicking] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const tc = useTranslations("Centering");
  const ts = useTranslations("ShareCard");

  // Skannern → gradering: framsidan och kortets namn är redan kända.
  useEffect(() => {
    const p = takeGradePrefill();
    if (!p) return;
    setFront(p.front);
    setCardHint(p.cardName);
    setSetHint(p.setName);
    setCardIdHint(p.cardId);
  }, []);

  // BILDMATCHNING PÅ FRAMSIDAN — det upprätade utsnittet ur centreringsmätaren när
  // det finns (mätt topp-1 96 %), annars fotot. Inte när kortet redan kom från
  // skannern. Ett användarval skrivs aldrig över; ett automatiskt förval får
  // uppdateras när utsnittet ger ett säkrare svar.
  const idSource = centering.front?.cropDataUrl ?? front;
  useEffect(() => {
    if (!idSource || cardIdHint) {
      setIdState("idle");
      setSuggestions([]);
      return;
    }
    let alive = true;
    setIdState("loading");
    const none = { candidates: [] as IdentifiedCard[], confident: false };
    (async () => {
      const fps = await photoFingerprints(idSource).catch(() => null);
      if (!fps) return none;
      const res = await fetch("/api/grading/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fps),
      });
      if (!res.ok) return none;
      return (await res.json()) as { candidates: IdentifiedCard[]; confident: boolean };
    })()
      .catch(() => none)
      .then((r) => {
        if (!alive) return;
        setSuggestions(r.candidates);
        setIdState("done");
        if (!userPickedRef.current) setIdentified(r.confident ? r.candidates[0] ?? null : null);
      });
    return () => {
      alive = false;
    };
  }, [idSource, cardIdHint]);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/grading/jobs");
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: GradingJobDto[]; quota: Quota };
      setJobs(data.jobs);
      setQuota(data.quota);
    } catch {
      // listan är inte kritisk
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  function handleFile(file: File, side: "front" | "back") {
    if (!file.type.startsWith("image/")) {
      toast({ title: t("wrongFileType"), description: t("chooseImage"), variant: "error" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({
        title: t("tooLarge"),
        description: t("tooLargeDesc"),
        variant: "error",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (side === "front") {
        setFront(dataUrl);
        // Ett nytt foto kan vara ett annat kort — bildmatchningen tar över.
        setCardHint(null);
        setSetHint(null);
        setCardIdHint(null);
        setIdentified(null);
        userPickedRef.current = false;
      } else setBack(dataUrl);
      // En ny bild gör den gamla mätningen meningslös.
      setCentering((c) => ({ ...c, [side]: null }));
      setResult(null);
    };
    reader.readAsDataURL(file);
  }

  function onChange(side: "front" | "back") {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file, side);
      e.target.value = "";
    };
  }

  async function gradeNow() {
    if (!front || !back) return;
    setGrading(true);
    setResult(null);
    try {
      const res = await fetch("/api/grading/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // locale följer med: motiveringen skrivs av modellen och går inte att
        // översätta i efterhand — utan den kom svaret alltid på svenska.
        body: JSON.stringify({
          front,
          back,
          locale,
          cardName: identified ? `${identified.name} ${identified.number}` : cardHint ?? undefined,
          cardId: identified?.cardId ?? cardIdHint ?? undefined,
          // Valt i "Är det här ditt kort?" (eller förvalt av en SÄKER bildträff).
          cardConfirmed: identified ? true : undefined,
          artCardIds: suggestions.length ? suggestions.map((c) => c.cardId) : undefined,
          centering:
            centering.front || centering.back
              ? { front: centeringPayload(centering.front), back: centeringPayload(centering.back) }
              : undefined,
        }),
      });
      const data = (await res.json()) as GradeResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("gradeFailMsg"));
      setResult(data);
      if (data.quota) setQuota(data.quota);
      void loadJobs();
    } catch (err) {
      toast({
        title: t("gradeFailTitle"),
        description: err instanceof Error ? err.message : t("unknownError"),
        variant: "error",
      });
    } finally {
      setGrading(false);
    }
  }

  const centeringCap = combinedPsaCap([centering.front?.result, centering.back?.result]);

  /** Delningsbildens indata ur resultatet + mätningen. */
  function gradeShareInput(r: GradeResponse, domain: string) {
    const label = r.result.cardLabel
      ? splitLabel(r.result.cardLabel, true)
      : splitLabel(r.result.cardName);
    const topRight = tc("axisTopRight").toLowerCase();
    // Mätningen som sparades på JOBBET — samma väg för en färsk gradering och en
    // ur historiken (då finns varken fotona eller mätarens tillstånd kvar).
    const stored = r.result.centering;
    const parts: string[] = [];
    if (stored?.front) parts.push(`${t("frontShort")} ${storedRatiosText(stored.front, topRight)}`);
    if (stored?.back) parts.push(`${t("backShort")} ${storedRatiosText(stored.back, topRight)}`);
    const own = r.historyAt ? null : centering.front?.cropDataUrl ?? null;
    return {
      // Katalogbilden när kortet är styrkt (skarpast i en story); annars användarens
      // kort utskuret längs stödlinjerna; sist råfotot. Ur historiken: bara katalogen.
      imageUrl: r.result.cardImageUrl ?? own,
      fallbackImageUrl: r.historyAt ? null : own ?? front,
      name: label?.name ?? t("shareUnknownCard"),
      subtitle: label?.subtitle ?? "",
      overall: r.result.overall,
      subScores: SUB_LABELS.map(({ key, labelKey }) => ({ label: t(labelKey), value: r.result.subScores[key] })),
      labelEyebrow: t("shareEyebrow"),
      outOf: t("outOf10"),
      centeringLine: parts.length ? `${t("shareCenteringLead")} · ${parts.join(" · ")}` : null,
      disclaimer: t("shareDisclaimer"),
      footer: { lead: t("shareFooterLead"), domain },
      // Videons kortbaksida: japansk för japanska kort, annars den internationella.
      // Äldre graderingar saknar språket — katalognamnens "(JP)" säger samma sak.
      cardBack:
        r.result.cardLanguage === "JP" || /\(JP\)/.test(r.result.cardLabel ?? r.result.cardName ?? "")
          ? ("jp" as const)
          : ("en" as const),
    };
  }

  /**
   * ÖPPNA EN TIDIGARE GRADERING (ägarönskan 2026-10-01): resultatkortet visar den
   * sparade bedömningen, "Lönar det sig?" räknas om på begäran (priserna rör sig)
   * och delningen fungerar — med katalogbilden, för fotona sparas aldrig.
   */
  async function openJob(job: GradingJobDto) {
    const r = job.result as GradeResultDto | null;
    if (job.status !== "COMPLETED" || !r?.subScores) return;
    setResult({
      jobId: job.id,
      overallGrade: job.overallGrade,
      confidence: job.confidence,
      modelUsed: job.modelUsed,
      result: r,
      worth: null,
      historyAt: job.createdAt,
    });
    window.requestAnimationFrame(() =>
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
    try {
      const res = await fetch(`/api/grading/jobs/${job.id}/worth`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        worth: GradingWorthDto | null;
        card?: Pick<GradeResultDto, "cardId" | "cardImageUrl" | "cardSlug" | "cardLabel" | "cardSetName" | "cardLanguage"> | null;
      };
      setResult((prev) =>
        prev?.jobId === job.id
          ? { ...prev, worth: data.worth, result: data.card ? { ...prev.result, ...data.card } : prev.result }
          : prev
      );
      // Kopplades kortet nu (äldre gradering) får listraden sin bild direkt.
      if (data.card) {
        setJobs((prev) =>
          prev?.map((j) => (j.id === job.id ? { ...j, result: { ...(j.result ?? {}), ...data.card } } : j)) ?? prev
        );
      }
    } catch {
      // rutan är ett tillägg — utan den visas bedömningen ändå
    }
  }

  async function pickCard(jobId: string, c: CardSearchCandidate) {
    if (picking) return;
    setPicking(true);
    try {
      const res = await fetch(`/api/grading/jobs/${jobId}/card`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: c.cardId, slug: c.slug ?? undefined }),
      });
      const data = (await res.json().catch(() => null)) as {
        card?: Pick<GradeResultDto, "cardId" | "cardImageUrl" | "cardSlug" | "cardLabel" | "cardSetName" | "cardLanguage">;
        worth?: GradingWorthDto | null;
        error?: string;
      } | null;
      if (!res.ok || !data?.card) throw new Error(data?.error ?? t("pickCardFail"));
      const card = data.card;
      setResult((prev) =>
        prev?.jobId === jobId ? { ...prev, worth: data.worth ?? null, result: { ...prev.result, ...card } } : prev
      );
      setJobs((prev) =>
        prev?.map((j) => (j.id === jobId ? { ...j, result: { ...(j.result ?? {}), ...card } } : j)) ?? prev
      );
      setPickOpen(false);
    } catch (err) {
      toast({
        title: t("pickCardFail"),
        description: err instanceof Error ? err.message : t("unknownError"),
        variant: "error",
      });
    } finally {
      setPicking(false);
    }
  }

  const limitReached =
    quota != null && quota.remaining !== null && quota.remaining <= 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <SubpageHeader title={t("h1")} desktopTitleClassName="font-semibold" />
        <p className="text-sm text-ink-muted lg:mt-1">{t("intro")}</p>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-amber-400">
          <IconAlertTriangle size={18} />
        </span>
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-ink">{t("disclaimerLabel")}</span> {t("disclaimerText")}
        </p>
      </div>

      {/* Kvot (gratis) */}
      {quota?.limit != null && (
        <div className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised px-4 py-3 text-sm">
          <span className="text-ink-muted">
            {quota.isPremium ? t("quotaPremium") : t("quotaFree")}{" "}
            <span className="font-semibold text-ink">
              {quota.used} / {quota.limit}
            </span>
          </span>
          {limitReached && !quota.isPremium && (
            <ProCta source="grading-quota" size="sm" variant="secondary">
              {t("upgradeCta")}
            </ProCta>
          )}
        </div>
      )}

      {/* Uppladdning */}
      <Card>
        <CardHeader>
          <CardTitle>{t("step1")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <ImageDropzone
              label={t("front")}
              preview={front}
              onPick={() => frontRef.current?.click()}
              inputRef={frontRef}
              onChange={onChange("front")}
              footer={
                front ? (
                  <CenteringButton outcome={centering.front} onMeasure={() => setToolSide("front")} />
                ) : null
              }
            />
            <ImageDropzone
              label={t("back")}
              preview={back}
              onPick={() => backRef.current?.click()}
              inputRef={backRef}
              onChange={onChange("back")}
              footer={
                back ? (
                  <CenteringButton outcome={centering.back} onMeasure={() => setToolSide("back")} />
                ) : null
              }
            />
          </div>
          {cardHint && <p className="text-xs text-ink-muted">{t("fromScanner", { card: cardHint })}</p>}
          {front && !cardIdHint && idState !== "idle" && (
            <CardIdentityBox
              state={idState === "loading" ? "loading" : "done"}
              chosen={identified}
              suggestions={suggestions}
              onChoose={(c) => {
                userPickedRef.current = true;
                setIdentified(c);
              }}
              onSearch={() => {
                setPickForPhoto(true);
                setPickOpen(true);
              }}
            />
          )}
          {(centering.front || centering.back) && (
            <div className="rounded-xl border border-holo-cyan/25 bg-holo-cyan/5 px-4 py-3">
              <p className="text-sm font-semibold text-ink">{tc("summaryTitle")}</p>
              {centeringCap != null && (
                <p className="mt-0.5 text-sm font-semibold text-holo-cyan">
                  {tc("psaCapLabel")} {tc("psaCap", { grade: centeringCap })}
                </p>
              )}
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{tc("capNote")}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void gradeNow()}
              disabled={!front || !back || limitReached}
              loading={grading}
            >
              <IconShield size={16} />
              {t("gradeBtn")}
            </Button>
            {grading && (
              <span className="text-sm text-ink-muted">{t("analyzing")}</span>
            )}
            {limitReached && (
              <span className="text-sm text-amber-400">
                {quota?.isPremium ? t("limitPremium") : t("limitFree")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resultat */}
      {result && (
        <div ref={resultRef} className="scroll-mt-4">
        <Card key={result.jobId} className="animate-scale-in">
          <CardHeader>
            <CardTitle>{result.historyAt ? t("historyResultTitle") : t("step2")}</CardTitle>
            {result.historyAt && (
              <p className="text-xs text-ink-faint">{new Date(result.historyAt).toLocaleString(locale)}</p>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center gap-5">
              <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl border border-surface-border bg-surface">
                <AnimatedNumber
                  value={result.result.overall}
                  kind="decimal"
                  duration={700}
                  className={cn(
                    "font-display text-4xl font-bold",
                    gradeTone(result.result.overall)
                  )}
                />
                <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                  {t("outOf10")}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                {/* Kortet modellen läste av. Faller tillbaka på rubriken när det
                    inte gick att identifiera — vi visar hellre inget än en gissning. */}
                <p className="text-sm font-semibold text-ink">
                  {result.result.cardLabel ?? result.result.cardName ?? t("overallGrade")}
                </p>
                {/* Modellen kan läsa fel kort, och utan styrkt nummer kopplas inget —
                    användaren väljer då själv ur katalogen. Poängen rörs inte. */}
                <button
                  type="button"
                  onClick={() => setPickOpen(true)}
                  className="mt-0.5 text-xs font-medium text-holo-cyan underline-offset-2 hover:underline"
                >
                  {result.result.cardId ? t("pickCardWrong") : t("pickCardMissing")}
                </button>
                <p className="mt-1 text-sm text-ink-muted">{result.result.rationale}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {SUB_LABELS.map(({ key, labelKey }) => (
                <ScoreBar key={key} label={t(labelKey)} score={result.result.subScores[key]} />
              ))}
            </div>

            {/* Modellnamnet visas inte (ägarbeslut 2026-07-21) — vilken leverantör
                och modell som gör bedömningen är en implementationsdetalj, inte
                något användaren ska förhålla sig till. `modelUsed` loggas fortfarande
                på jobbet. Samma sak i historiken nedan. "Spara i samlingen"-tipset
                borttaget samtidigt. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
              <span>{t("confidence", { pct: Math.round(result.result.confidence * 100) })}</span>
            </div>

            {result.worth && <GradingWorthPanel worth={result.worth} overall={result.result.overall} />}

            <Button variant="outline" onClick={() => setShareOpen(true)}>
              <IconShare size={16} /> {t("shareGrade")}
            </Button>
          </CardContent>
        </Card>
        </div>
      )}

      {result && (
        <BottomSheet
          open={shareOpen}
          title={ts("title")}
          closeLabel={ts("back")}
          onClose={() => setShareOpen(false)}
          panelClassName="sm:mx-auto sm:max-w-md"
        >
          {shareOpen && (
            <ShareCardPanel
              source="grade"
              previewMax="50dvh"
              safeBottom
              name={splitLabel(result.result.cardLabel ?? result.result.cardName)?.name ?? t("shareUnknownCard")}
              // Slabben bär aldrig den personliga länken (ägarbeslut 2026-10-01).
              printLink={false}
              render={(domain) => renderGradeShareCard(gradeShareInput(result, domain))}
              spin={(domain) => prepareGradeSpinLayers(gradeShareInput(result, domain))}
            />
          )}
        </BottomSheet>
      )}

      {(result || pickForPhoto) && (
        <BottomSheet
          open={pickOpen}
          title={t("pickCardTitle")}
          closeLabel={ts("back")}
          onClose={() => {
            setPickOpen(false);
            setPickForPhoto(false);
          }}
          // FAST höjd = 84 % av ytan OVANFÖR tangentbordet (arket slutar där det
          // börjar). En höjd i dvh räknades mot hela skärmen och sköt listan in
          // under tangentbordet (ägarens skärmdump 2026-10-01).
          panelClassName="h-[84%] sm:mx-auto sm:max-w-md"
        >
          {pickOpen && (
            <div
              className={cn(
                "flex h-full flex-col pb-[max(1rem,env(safe-area-inset-bottom))]",
                picking && "pointer-events-none opacity-60"
              )}
            >
              {pickForPhoto || !result ? (
                <CardSearch
                  captured={centering.front?.cropDataUrl ?? front}
                  initialQuery={identified?.name ?? suggestions[0]?.name ?? ""}
                  selectedCardId={identified?.cardId ?? null}
                  onPick={(c) => {
                    userPickedRef.current = true;
                    setIdentified({
                      cardId: c.cardId,
                      name: c.name,
                      number: c.number,
                      setName: c.setName,
                      imageUrl: c.imageUrl,
                    });
                    setPickOpen(false);
                    setPickForPhoto(false);
                  }}
                />
              ) : (
                <CardSearch
                  captured={result.historyAt ? null : centering.front?.cropDataUrl ?? front}
                  initialQuery={
                    splitLabel(result.result.cardLabel ?? result.result.cardName)?.name ??
                    cardHint ??
                    ""
                  }
                  selectedCardId={result.result.cardId ?? null}
                  onPick={(c) => void pickCard(result.jobId, c)}
                />
              )}
            </div>
          )}
        </BottomSheet>
      )}

      {toolSide && (toolSide === "front" ? front : back) && (
        <CenteringTool
          src={(toolSide === "front" ? front : back)!}
          side={toolSide}
          defaultMode={isEReaderSet(result?.result.cardSetName ?? setHint) ? "ereader" : "standard"}
          initial={centering[toolSide]}
          onDone={(o) => setCentering((c) => ({ ...c, [o.side]: o }))}
          onClose={() => setToolSide(null)}
        />
      )}

      {/* Historik */}
      <Card>
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs === null ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={<IconSparkle size={32} />}
              title={t("noHistory")}
              description={t("noHistoryDesc")}
            />
          ) : (
            <ul className="divide-y divide-surface-border">
              {jobs.map((job) => {
                const failed = job.status === "FAILED";
                const openable = !failed && job.status === "COMPLETED" && job.result?.subScores != null;
                const active = result?.jobId === job.id;
                return (
                  <li key={job.id}>
                    <button
                      type="button"
                      disabled={!openable}
                      onClick={() => void openJob(job)}
                      aria-current={active || undefined}
                      className={cn(
                        "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors",
                        openable && "hover:bg-surface-overlay/60",
                        active && "bg-holo-cyan/5 ring-1 ring-holo-cyan/30"
                      )}
                    >
                    {/* Katalogbilden. Användarens egna foton sparas ALDRIG (dataminimering),
                        så det här är den enda bilden som finns — och den visas bara när
                        samlarnumret styrkte vilket kort det var. Saknas den faller raden
                        tillbaka på status-ikonen, exakt som förut. */}
                    {!failed && job.result?.cardImageUrl ? (
                      <SafeImage
                        src={job.result.cardImageUrl}
                        alt=""
                        className="h-14 w-10 shrink-0 rounded-md object-cover"
                        fallback={
                          <span aria-hidden="true" className="shrink-0 text-rise">
                            <IconCheck size={18} />
                          </span>
                        }
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "shrink-0",
                          failed ? "text-fall" : "text-rise"
                        )}
                      >
                        {failed ? <IconAlertTriangle size={18} /> : <IconCheck size={18} />}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {failed
                          ? t("failed")
                          : (job.result?.cardLabel ??
                            job.result?.cardName ??
                            (job.overallGrade != null
                              ? t("gradeLine", { grade: job.overallGrade.toFixed(1) })
                              : t("gradingWord")))}
                      </p>
                      <p className="text-xs text-ink-faint">
                        {/* Graden står redan stort till höger — upprepa den bara när
                            raden inte har ett kortnamn att bära. */}
                        {!failed && job.result?.cardName && job.overallGrade != null
                          ? `${t("gradeLine", { grade: job.overallGrade.toFixed(1) })} · `
                          : ""}
                        {new Date(job.createdAt).toLocaleString(locale)}
                      </p>
                    </div>
                    {!failed && job.overallGrade != null && (
                      <span
                        className={cn(
                          "shrink-0 text-lg font-bold tabular-nums",
                          gradeTone(job.overallGrade)
                        )}
                      >
                        {job.overallGrade.toFixed(1)}
                      </span>
                    )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
