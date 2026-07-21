"use client";

/**
 * Gradera kort — ladda upp fram- och baksidesbild, få en AI-uppskattad
 * PSA-liknande gradering (delpoäng + helhet). Mobil först: kameraupptagning via
 * <input capture>. Detta är en uppskattning, inte en officiell gradering.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button, LinkButton } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { PageBackButton } from "@/components/layout/page-back-button";
import { cn } from "@/lib/utils";
import {
  IconAlertTriangle,
  IconCamera,
  IconCheck,
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
}: {
  label: string;
  preview: string | null;
  onPick: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
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
        body: JSON.stringify({ front, back }),
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

  const limitReached =
    quota != null && quota.remaining !== null && quota.remaining <= 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <PageBackButton />
        <h1 className="font-display text-2xl font-semibold text-ink">{t("h1")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("intro")}
        </p>
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
            <LinkButton href="/priser" size="sm" variant="secondary">
              {t("upgradeCta")}
            </LinkButton>
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
            />
            <ImageDropzone
              label={t("back")}
              preview={back}
              onPick={() => backRef.current?.click()}
              inputRef={backRef}
              onChange={onChange("back")}
            />
          </div>
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
                <p className="text-sm font-semibold text-ink">{t("overallGrade")}</p>
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
          </CardContent>
        </Card>
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
                    <span
                      aria-hidden="true"
                      className={cn(
                        "shrink-0",
                        failed ? "text-fall" : "text-rise"
                      )}
                    >
                      {failed ? <IconAlertTriangle size={18} /> : <IconCheck size={18} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">
                        {failed
                          ? t("failed")
                          : job.overallGrade != null
                            ? t("gradeLine", { grade: job.overallGrade.toFixed(1) })
                            : t("gradingWord")}
                      </p>
                      <p className="text-xs text-ink-faint">
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
