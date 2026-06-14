"use client";

/**
 * Skanna kort — ladda upp en kortbild, identifiera kortet via OCR
 * (demo: mock-adapter) och lägg till det i samlingen.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import Link from "next/link";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import {
  IconAlertTriangle,
  IconCamera,
  IconCards,
  IconCheck,
  IconSearch,
  IconSparkle,
} from "@/components/ui/icons";

interface Candidate {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  rarity: string;
  imageUrl: string | null;
  score: number;
  estimatedValue: number | null;
}

interface ScanResponse {
  jobId: string;
  status: string;
  confidence: number | null;
  candidates: Candidate[];
}

interface ScannerJobDto {
  id: string;
  status: string;
  confidence: number | null;
  createdAt: string;
  result: {
    ocr?: { guessedName?: string | null };
    confirmedCardId?: string;
    candidates?: Candidate[];
  } | null;
}

const MAX_FILE_BYTES = 4 * 1024 * 1024;

const CONDITIONS = [
  { value: "MINT", label: "Mint" },
  { value: "NEAR_MINT", label: "Near Mint" },
  { value: "EXCELLENT", label: "Excellent" },
  { value: "GOOD", label: "Good" },
  { value: "PLAYED", label: "Played" },
  { value: "POOR", label: "Poor" },
] as const;

const LANGUAGES = [
  { value: "SV", label: "Svenska" },
  { value: "EN", label: "Engelska" },
  { value: "JP", label: "Japanska" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "Köad",
  RUNNING: "Analyserar",
  COMPLETED: "Klar",
  FAILED: "Misslyckades",
  CANCELLED: "Avbruten",
};

export default function SkannaPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<string>("NEAR_MINT");
  const [language, setLanguage] = useState<string>("EN");
  const [confirming, setConfirming] = useState(false);
  const [added, setAdded] = useState(false);
  const [jobs, setJobs] = useState<ScannerJobDto[] | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/scanner/jobs");
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: ScannerJobDto[] };
      setJobs(data.jobs);
    } catch {
      // Tyst — listan är inte kritisk.
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Fel filtyp",
        description: "Välj en bildfil (JPG, PNG eller WebP).",
        variant: "error",
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({
        title: "Bilden är för stor",
        description: "Max 4 MB — prova att förminska eller komprimera bilden.",
        variant: "error",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(typeof reader.result === "string" ? reader.result : null);
      setScan(null);
      setSelected(null);
      setAdded(false);
    };
    reader.readAsDataURL(file);
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function identify() {
    if (!preview) return;
    setScanning(true);
    setScan(null);
    setSelected(null);
    setAdded(false);
    try {
      const res = await fetch("/api/scanner/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: preview }),
      });
      const data = (await res.json()) as ScanResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Skanningen misslyckades. Försök igen.");
      }
      setScan(data);
      void loadJobs();
    } catch (err) {
      toast({
        title: "Kunde inte analysera bilden",
        description: err instanceof Error ? err.message : "Okänt fel.",
        variant: "error",
      });
    } finally {
      setScanning(false);
    }
  }

  async function confirm() {
    if (!scan || !selected) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/scanner/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: scan.jobId,
          cardId: selected.cardId,
          quantity,
          condition,
          language,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Kunde inte lägga till kortet.");
      }
      setAdded(true);
      toast({
        title: "Tillagt i samlingen",
        description: `${selected.name} har lagts till i din samling.`,
        variant: "success",
      });
      void loadJobs();
    } catch (err) {
      toast({
        title: "Något gick fel",
        description: err instanceof Error ? err.message : "Okänt fel.",
        variant: "error",
      });
    } finally {
      setConfirming(false);
    }
  }

  function reset() {
    setPreview(null);
    setScan(null);
    setSelected(null);
    setAdded(false);
  }

  const bestGuess = scan?.candidates[0]?.name ?? "";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Skanna kort</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Fotografera eller ladda upp en bild på ditt kort, så identifierar vi det och
          lägger till det i din samling — på några sekunder.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Vill du bedöma kortets skick istället?{" "}
          <Link href="/gradera" className="font-medium text-holo-cyan hover:underline">
            Gradera kortet med AI →
          </Link>
        </p>
      </div>

      {/* Demo-banner */}
      <div className="flex items-start gap-3 rounded-xl border border-holo-cyan/30 bg-holo-cyan/5 px-4 py-3">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-holo-cyan">
          <IconSparkle size={18} />
        </span>
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-ink">Demoläge:</span> skanningen körs just nu
          med en simulerad OCR-tjänst. Resultaten är exempel ur vår kortkatalog — en riktig
          bildanalys kopplas in inom kort.
        </p>
      </div>

      {/* Uppladdning */}
      <Card>
        <CardHeader>
          <CardTitle>1. Ladda upp en bild</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Ladda upp kortbild"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragging
                ? "border-holo-cyan bg-holo-cyan/10"
                : "border-surface-border hover:border-holo-cyan/50 hover:bg-surface-overlay"
            )}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Förhandsvisning av uppladdat kort"
                className="max-h-64 rounded-lg object-contain shadow-card"
              />
            ) : (
              <>
                <span aria-hidden="true" className="text-ink-faint">
                  <IconCamera size={36} />
                </span>
                <p className="text-sm font-medium text-ink">
                  Dra och släpp en bild här, eller klicka för att välja
                </p>
                <p className="text-xs text-ink-faint">JPG, PNG eller WebP · max 4 MB</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onInputChange}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void identify()} disabled={!preview} loading={scanning}>
              Identifiera kort
            </Button>
            {preview && (
              <Button variant="ghost" onClick={reset} disabled={scanning}>
                Börja om
              </Button>
            )}
            {scanning && (
              <span className="text-sm text-ink-muted">Analyserar bilden…</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resultat */}
      {scan && (
        <Card>
          <CardHeader>
            <CardTitle>2. Är detta ditt kort?</CardTitle>
            {scan.confidence != null && (
              <p className="text-sm text-ink-muted">
                Analysens säkerhet: {Math.round(scan.confidence * 100)} %
              </p>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {scan.candidates.length === 0 ? (
              <EmptyState
                icon={<IconSearch size={32} />}
                title="Inga träffar"
                description="Vi kunde tyvärr inte matcha bilden mot vår kortkatalog. Prova en skarpare bild eller sök manuellt."
                action={<LinkButton href="/produkter" variant="outline">Sök manuellt</LinkButton>}
              />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {scan.candidates.map((c) => {
                    const isSelected = selected?.cardId === c.cardId;
                    return (
                      <button
                        key={c.cardId}
                        type="button"
                        onClick={() => {
                          setSelected(c);
                          setAdded(false);
                        }}
                        aria-pressed={isSelected}
                        className={cn(
                          "flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
                          isSelected
                            ? "border-holo-cyan bg-holo-cyan/10 shadow-glow"
                            : "border-surface-border bg-surface-raised hover:border-holo-cyan/50"
                        )}
                      >
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.imageUrl}
                            alt={c.name}
                            className="h-20 w-14 shrink-0 rounded object-cover"
                          />
                        ) : (
                          <div
                            aria-hidden="true"
                            className="flex h-20 w-14 shrink-0 items-center justify-center rounded bg-surface-overlay text-ink-faint"
                          >
                            <IconCards size={22} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                            {c.estimatedValue != null && (
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-holo-cyan">
                                {formatPrice(c.estimatedValue)}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-ink-muted">
                            {c.setName} · #{c.number} · {c.rarity}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-overlay">
                              <div
                                className="h-full rounded-full bg-holo-cyan"
                                style={{ width: `${Math.round(c.score * 100)}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-ink-muted">
                              {Math.round(c.score * 100)} %
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <p className="text-sm text-ink-muted">
                  Hittade vi inte rätt?{" "}
                  <Link
                    href={`/produkter?q=${encodeURIComponent(bestGuess)}`}
                    className="font-medium text-holo-cyan hover:underline"
                  >
                    Sök manuellt
                  </Link>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bekräfta */}
      {scan && selected && (
        <Card>
          <CardHeader>
            <CardTitle>3. Lägg till i samlingen</CardTitle>
            <p className="text-sm text-ink-muted">
              {selected.name} · {selected.setName} · #{selected.number}
            </p>
            {selected.estimatedValue != null && (
              <p className="mt-1 text-sm text-ink-muted">
                Uppskattat värde:{" "}
                <span className="font-semibold text-holo-cyan">
                  {formatPrice(selected.estimatedValue)}
                </span>{" "}
                <span className="text-ink-faint">· Marknadstrend (Cardmarket)</span>
              </p>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="quantity">Antal</Label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  max={10000}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                />
              </div>
              <div>
                <Label htmlFor="condition">Skick</Label>
                <Select
                  id="condition"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="language">Språk</Label>
                <Select
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void confirm()} loading={confirming} disabled={added}>
                Lägg till i samlingen
              </Button>
              {added && (
                <LinkButton href="/samling" variant="outline">
                  Visa min samling →
                </LinkButton>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Senaste skanningar */}
      <Card>
        <CardHeader>
          <CardTitle>Senaste skanningar</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs === null ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={<IconCards size={32} />}
              title="Inga skanningar ännu"
              description="Dina skannade kort dyker upp här. Ladda upp din första bild ovan!"
            />
          ) : (
            <ul className="divide-y divide-surface-border">
              {jobs.map((job) => {
                const guess = job.result?.ocr?.guessedName;
                const confirmed = Boolean(job.result?.confirmedCardId);
                return (
                  <li key={job.id} className="flex items-center gap-3 py-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "shrink-0",
                        job.status === "FAILED"
                          ? "text-fall"
                          : confirmed
                            ? "text-rise"
                            : "text-ink-faint"
                      )}
                    >
                      {job.status === "FAILED" ? (
                        <IconAlertTriangle size={18} />
                      ) : confirmed ? (
                        <IconCheck size={18} />
                      ) : (
                        <IconCards size={18} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {guess ?? "Okänt kort"}
                      </p>
                      <p className="text-xs text-ink-faint">
                        {new Date(job.createdAt).toLocaleString("sv-SE")}
                        {confirmed && " · Tillagd i samlingen"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.confidence != null && (
                        <span className="text-xs tabular-nums text-ink-muted">
                          {Math.round(job.confidence * 100)} %
                        </span>
                      )}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          job.status === "COMPLETED"
                            ? "bg-rise/10 text-rise"
                            : job.status === "FAILED"
                              ? "bg-fall/10 text-fall"
                              : "bg-surface-overlay text-ink-muted"
                        )}
                      >
                        {STATUS_LABELS[job.status] ?? job.status}
                      </span>
                    </div>
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
