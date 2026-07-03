"use client";

/**
 * Gradera kort — ladda upp fram- och baksidesbild, få en AI-uppskattad
 * PSA-liknande gradering (delpoäng + helhet). Mobil först: kameraupptagning via
 * <input capture>. Detta är en uppskattning, inte en officiell gradering.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
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

const SUB_LABELS: { key: keyof SubScores; label: string }[] = [
  { key: "centering", label: "Centrering" },
  { key: "corners", label: "Hörn" },
  { key: "edges", label: "Kanter" },
  { key: "surface", label: "Yta" },
];

/** Färg utifrån grad (1–10): grönt högt, turkos mitten, gult/rött lågt. */
function gradeTone(score: number): string {
  if (score >= 9) return "text-rise";
  if (score >= 7) return "text-holo-cyan";
  if (score >= 5) return "text-amber-400";
  return "text-fall";
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-sm text-ink-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-overlay">
        <div
          className="h-full rounded-full bg-holo-cyan transition-[width] duration-500"
          style={{ width: `${Math.round((score / 10) * 100)}%` }}
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
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onPick}
        className={cn(
          "flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          preview
            ? "border-holo-cyan/40"
            : "border-surface-border hover:border-holo-cyan/50 hover:bg-surface-overlay"
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`Förhandsvisning: ${label}`}
            className="h-full w-full rounded-lg object-contain"
          />
        ) : (
          <>
            <span aria-hidden="true" className="text-ink-faint">
              <IconCamera size={30} />
            </span>
            <p className="text-sm font-medium text-ink">{label}</p>
            <p className="text-xs text-ink-faint">Tryck för att fota eller välja</p>
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
      toast({ title: "Fel filtyp", description: "Välj en bildfil.", variant: "error" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({
        title: "Bilden är för stor",
        description: "Max 5 MB — prova att komprimera bilden.",
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
      if (!res.ok) throw new Error(data.error ?? "Graderingen misslyckades.");
      setResult(data);
      setQuota(data.quota);
      void loadJobs();
    } catch (err) {
      toast({
        title: "Kunde inte gradera kortet",
        description: err instanceof Error ? err.message : "Okänt fel.",
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
        <h1 className="font-display text-2xl font-semibold text-ink">Gradera kort</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Fota fram- och baksidan så ger vår AI en uppskattad gradering av kortets
          skick — centrering, hörn, kanter och yta.
        </p>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-amber-400">
          <IconAlertTriangle size={18} />
        </span>
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-ink">AI-uppskattning:</span> detta är
          inte en officiell PSA- eller BGS-gradering, utan en vägledande bedömning
          baserad på dina bilder. Använd den som riktmärke.
        </p>
      </div>

      {/* Kvot (gratis) */}
      {quota?.limit != null && (
        <div className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised px-4 py-3 text-sm">
          <span className="text-ink-muted">
            {quota.isPremium ? "Graderingar denna månad:" : "Gratis graderingar denna månad:"}{" "}
            <span className="font-semibold text-ink">
              {quota.used} / {quota.limit}
            </span>
          </span>
          {limitReached && !quota.isPremium && (
            <LinkButton href="/priser" size="sm" variant="secondary">
              Uppgradera till Pro
            </LinkButton>
          )}
        </div>
      )}

      {/* Uppladdning */}
      <Card>
        <CardHeader>
          <CardTitle>1. Lägg till bilder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <ImageDropzone
              label="Framsida"
              preview={front}
              onPick={() => frontRef.current?.click()}
              inputRef={frontRef}
              onChange={onChange("front")}
            />
            <ImageDropzone
              label="Baksida"
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
              Gradera kort
            </Button>
            {grading && (
              <span className="text-sm text-ink-muted">Analyserar skicket…</span>
            )}
            {limitReached && (
              <span className="text-sm text-amber-400">
                {quota?.isPremium
                  ? "Dagens graderingar är slut — tillbaka i morgon."
                  : "Dagens gratis graderingar är slut."}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resultat */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>2. Bedömt skick</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center gap-5">
              <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl border border-surface-border bg-surface">
                <span
                  className={cn(
                    "font-display text-4xl font-bold tabular-nums",
                    gradeTone(result.result.overall)
                  )}
                >
                  {result.result.overall.toFixed(1)}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                  av 10
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">Helhetsgrad</p>
                <p className="mt-1 text-sm text-ink-muted">{result.result.rationale}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {SUB_LABELS.map(({ key, label }) => (
                <ScoreBar key={key} label={label} score={result.result.subScores[key]} />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
              <span>Konfidens: {Math.round(result.result.confidence * 100)} %</span>
              <span>Modell: {result.result.modelUsed}</span>
            </div>

            <p className="rounded-lg bg-surface-overlay px-3 py-2 text-xs text-ink-muted">
              Vill du spara kortet? Lägg till det i din{" "}
              <Link href="/samling" className="font-medium text-holo-cyan hover:underline">
                samling
              </Link>{" "}
              och ange gradingbolag &ldquo;Foilio AI&rdquo; med graden ovan.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Historik */}
      <Card>
        <CardHeader>
          <CardTitle>Senaste graderingar</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs === null ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={<IconSparkle size={32} />}
              title="Inga graderingar ännu"
              description="Dina graderade kort dyker upp här. Lägg till en fram- och baksidesbild ovan."
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
                          ? "Misslyckades"
                          : job.overallGrade != null
                            ? `Grad ${job.overallGrade.toFixed(1)} / 10`
                            : "Gradering"}
                      </p>
                      <p className="text-xs text-ink-faint">
                        {new Date(job.createdAt).toLocaleString("sv-SE")}
                        {job.modelUsed ? ` · ${job.modelUsed}` : ""}
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
