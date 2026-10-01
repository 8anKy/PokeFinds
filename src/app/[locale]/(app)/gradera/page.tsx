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
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";
import { takeGradePrefill } from "@/lib/grade-prefill";
import { renderGradeShareCard } from "@/lib/share-card";
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
  quota: Quota;
  worth?: GradingWorthDto | null;
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
function GradingWorthPanel({ worth, overall }: { worth: GradingWorthDto; overall: number }) {
  const t = useTranslations("Grading");
  const nearest = Math.round(overall) * 10;
  return (
    <div className="rounded-xl border border-surface-border p-4">
      <p className="text-sm font-semibold text-ink">{t("worthTitle")}</p>
      <ul className="mt-3 divide-y divide-surface-border text-sm">
        <li className="flex items-center justify-between py-2">
          <span className="text-ink-muted">{t("worthRaw")}</span>
          <span className="font-semibold tabular-nums text-ink">{formatPrice(worth.rawOre)}</span>
        </li>
        {worth.rows.map((r) => (
          <li key={r.gradeTenths} className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2">
              <span className="font-medium text-ink">PSA {r.gradeTenths / 10}</span>
              {r.gradeTenths === nearest && (
                <span className="rounded-md bg-holo-cyan/15 px-1.5 py-0.5 text-[10px] font-bold text-holo-cyan">
                  {t("worthYours")}
                </span>
              )}
            </span>
            <span className="text-right">
              {r.medianOre != null ? (
                <span className="font-semibold tabular-nums text-holo-cyan">{formatPrice(r.medianOre)}</span>
              ) : (
                <span aria-hidden="true" className="select-none font-semibold text-ink-faint blur-[5px]">
                  0 000 kr
                </span>
              )}
              <span className="block text-[11px] text-ink-faint">
                {t("worthSold", { count: r.count, source: r.source === "ebay" ? "eBay" : "Tradera" })}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {worth.rows.length === 0 && <p className="mt-1 text-xs text-ink-muted">{t("worthNoSales")}</p>}
      {worth.locked && (
        <ProCta source="grading-worth" size="sm" className="mt-3 w-full">
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
  const [centering, setCentering] = useState<Record<CenteringSide, CenteringOutcome | null>>({
    front: null,
    back: null,
  });
  const [toolSide, setToolSide] = useState<CenteringSide | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const tc = useTranslations("Centering");
  const ts = useTranslations("ShareCard");

  // Skannern → gradering: framsidan och kortets namn är redan kända.
  useEffect(() => {
    const p = takeGradePrefill();
    if (!p) return;
    setFront(p.front);
    setCardHint(p.cardName);
    setSetHint(p.setName);
  }, []);

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
      if (side === "front") setFront(dataUrl);
      else setBack(dataUrl);
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
          cardName: cardHint ?? undefined,
          centering:
            centering.front || centering.back
              ? { front: centeringPayload(centering.front), back: centeringPayload(centering.back) }
              : undefined,
        }),
      });
      const data = (await res.json()) as GradeResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("gradeFailMsg"));
      setResult(data);
      setQuota(data.quota);
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
  function gradeShareInput(r: GradeResponse) {
    const label = r.result.cardLabel
      ? splitLabel(r.result.cardLabel, true)
      : splitLabel(r.result.cardName);
    const topRight = tc("axisTopRight").toLowerCase();
    const parts: string[] = [];
    if (centering.front) parts.push(`${t("frontShort")} ${ratiosText(centering.front.result, topRight)}`);
    if (centering.back) parts.push(`${t("backShort")} ${ratiosText(centering.back.result, topRight)}`);
    return {
      // Katalogbilden när kortet är styrkt (skarpast i en story); annars användarens
      // kort utskuret längs stödlinjerna; sist råfotot.
      imageUrl: r.result.cardImageUrl ?? centering.front?.cropDataUrl ?? null,
      fallbackImageUrl: centering.front?.cropDataUrl ?? front,
      name: label?.name ?? t("shareUnknownCard"),
      subtitle: label?.subtitle ?? "",
      overall: r.result.overall,
      subScores: SUB_LABELS.map(({ key, labelKey }) => ({ label: t(labelKey), value: r.result.subScores[key] })),
      labelEyebrow: t("shareEyebrow"),
      outOf: t("outOf10"),
      centeringLine: parts.length ? `${t("shareCenteringLead")} · ${parts.join(" · ")}` : null,
      disclaimer: t("shareDisclaimer"),
      footer: { lead: t("shareFooterLead"), domain: "foilio.se" },
    };
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
        <Card className="animate-scale-in">
          <CardHeader>
            <CardTitle>{t("step2")}</CardTitle>
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
              previewMax="58dvh"
              name={splitLabel(result.result.cardLabel ?? result.result.cardName)?.name ?? t("shareUnknownCard")}
              render={() => renderGradeShareCard(gradeShareInput(result))}
            />
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
                return (
                  <li key={job.id} className="flex items-center gap-3 py-3">
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
