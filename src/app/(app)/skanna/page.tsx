"use client";

/**
 * Kortskanner (capture-baserad) — rikta kameran mot ett kort och TRYCK på
 * slutarknappen för att fånga EN ruta. Bilden stannar i appen (canvas → JPEG i
 * minnet, sparas ALDRIG i kamerarullen) och skickas till /api/scanner/identify.
 * Träffar samlas i en lista; granska och lägg till hela batchen i samlingen.
 * (Live-loopen är borttagen — användaren bestämmer när en bild tas.) Skick bedöms
 * separat under /gradera.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, LinkButton } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCamera,
  IconCards,
  IconChart,
  IconCheck,
  IconChevronLeft,
  IconSearch,
  IconSettings,
  IconSparkle,
  IconTrash,
  IconUpload,
  IconX,
} from "@/components/ui/icons";

interface Candidate {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  rarity: string;
  imageUrl: string | null;
  slug: string | null;
  score: number;
  estimatedValue: number | null;
}

interface IdentifyResponse {
  provider: string;
  guessedName: string | null;
  guessedNumber: string | null;
  confidence: number;
  candidates: Candidate[];
}

type ScanStatus = "identifying" | "matched" | "nomatch" | "error";

interface ScanItem {
  id: string;
  status: ScanStatus;
  captured: string; // data-URL, endast i minnet
  match: Candidate | null;
  candidates: Candidate[];
  confidence: number;
  quantity: number;
  condition: string;
  language: string;
}

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

const CONDITION_LABEL: Record<string, string> = Object.fromEntries(
  CONDITIONS.map((c) => [c.value, c.label])
);

const CAPTURE_MAX = 1280; // px bredd på fångad ruta — högre = tydligare korttext för OCR
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MIN_MATCH_CONF = 0.2;

type CameraState = "starting" | "live" | "error" | "unsupported";
type View = "launch" | "capture" | "review";

let scanCounter = 0;
const nextId = () => `scan-${Date.now()}-${scanCounter++}`;

/** Fångar en nedskalad JPEG-ruta ur videoflödet (i minnet, ej i kamerarullen). */
function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): string | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const scale = Math.min(1, CAPTURE_MAX / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function SkannaPage() {
  const { toast } = useToast();
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const [view, setView] = useState<View>("capture");
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraError, setCameraError] = useState("");
  const [configError, setConfigError] = useState("");
  const [provider, setProvider] = useState<string | null>(null);

  const [scans, setScans] = useState<ScanItem[]>([]);
  const [flash, setFlash] = useState(false);
  const [shutterCooling, setShutterCooling] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultCondition, setDefaultCondition] = useState("NEAR_MINT");
  const [defaultLanguage, setDefaultLanguage] = useState("EN");
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const [addingAll, setAddingAll] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);

  const overlayOpen = view !== "launch";
  const isMock = provider === "mock";

  const matched = useMemo(
    () => scans.filter((s) => s.status === "matched" && s.match),
    [scans]
  );
  const noMatchCount = useMemo(
    () => scans.filter((s) => s.status === "nomatch" || s.status === "error").length,
    [scans]
  );
  const total = useMemo(
    () =>
      matched.reduce(
        (sum, s) => sum + (s.match?.estimatedValue ?? 0) * s.quantity,
        0
      ),
    [matched]
  );

  // ---- Identifiering -------------------------------------------------------

  const runIdentify = useCallback(
    async (dataUrl: string): Promise<IdentifyResponse | null> => {
      try {
        const res = await fetch("/api/scanner/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl, precise: true }),
        });
        const data = (await res.json()) as IdentifyResponse & { error?: string };
        if (!res.ok) {
          if (res.status === 503 && data.error) setConfigError(data.error);
          return null;
        }
        setConfigError("");
        setProvider(data.provider);
        return data;
      } catch {
        return null;
      }
    },
    []
  );

  const identifyInto = useCallback(
    async (id: string, dataUrl: string) => {
      const data = await runIdentify(dataUrl);
      setScans((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          if (!data) return { ...s, status: "error" };
          const top = data.candidates[0];
          if (top && data.confidence >= MIN_MATCH_CONF) {
            return {
              ...s,
              status: "matched",
              match: top,
              candidates: data.candidates,
              confidence: data.confidence,
            };
          }
          return { ...s, status: "nomatch", candidates: data.candidates };
        })
      );
    },
    [runIdentify]
  );

  // ---- Kamera --------------------------------------------------------------

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      return;
    }
    setCameraState("starting");
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setCameraState("live");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setCameraError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Kameraåtkomst nekades. Tillåt kameran i webbläsaren, eller välj en bild från enheten."
          : name === "NotFoundError"
            ? "Ingen kamera hittades. Välj en bild från enheten istället."
            : "Kunde inte starta kameran. Välj en bild från enheten istället."
      );
      setCameraState("error");
    }
  }, []);

  const openScanner = useCallback(() => {
    setView("capture");
    setAddedCount(null);
    void startCamera();
  }, [startCamera]);

  const closeScanner = useCallback(() => {
    if (scans.length > 0 && addedCount === null) {
      const ok = window.confirm(
        `Du har ${scans.length} oskannade träffar. Stäng skannern och kasta dem?`
      );
      if (!ok) return;
    }
    stopCamera();
    // Skannern ÄR fliken nu → stäng = lämna fliken (router, ej hård nav i Capacitor).
    router.back();
  }, [scans.length, addedCount, stopCamera, router]);

  // Stoppa kameran när komponenten lämnas helt.
  useEffect(() => () => stopCamera(), [stopCamera]);

  // Öppna kameran när capture-vyn visas OCH återanslut strömmen om videon
  // monterats om (review→capture monterar ett nytt <video> → annars svart bild).
  // ponytail: launch-vyn nedan är kvar som oåtkomlig fallback (close navigerar bort).
  useEffect(() => {
    if (view !== "capture") return;
    const v = videoRef.current;
    if (streamRef.current) {
      if (v && v.srcObject !== streamRef.current) {
        v.srcObject = streamRef.current;
        void v.play().catch(() => undefined);
      }
    } else {
      void startCamera();
    }
  }, [view, startCamera]);

  // Lås body-scroll + Escape-stäng medan overlayn är öppen, fokusera stäng-knapp.
  useEffect(() => {
    if (!overlayOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // INGEN auto-fokus på stäng-knappen: effekten re-körs vid varje delete
    // (closeScanner-dep byter identitet) → programmatisk focus tände en cyan
    // :focus-visible-ring på X/tillbaka-knappen. Escape lyssnar på window ändå.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (detailsId) setDetailsId(null);
        else if (settingsOpen) setSettingsOpen(false);
        else if (view === "review") setView("capture");
        else closeScanner();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, detailsId, settingsOpen, view, closeScanner]);

  // ---- Fånga / ladda upp ---------------------------------------------------

  const addScan = useCallback(
    (dataUrl: string) => {
      const id = nextId();
      setScans((prev) => [
        ...prev,
        {
          id,
          status: "identifying",
          captured: dataUrl,
          match: null,
          candidates: [],
          confidence: 0,
          quantity: 1,
          condition: defaultCondition,
          language: defaultLanguage,
        },
      ]);
      void identifyInto(id, dataUrl);
    },
    [defaultCondition, defaultLanguage, identifyInto]
  );

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || cameraState !== "live" || shutterCooling) return;
    const dataUrl = captureFrame(video, canvas);
    if (!dataUrl) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    setShutterCooling(true);
    window.setTimeout(() => setShutterCooling(false), 450);
    addScan(dataUrl);
  }, [cameraState, shutterCooling, addScan]);

  function handleFile(file: File): boolean {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Fel filtyp", description: "Välj en bildfil (JPG, PNG eller WebP).", variant: "error" });
      return false;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: "Bilden är för stor", description: "Max 8 MB.", variant: "error" });
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") addScan(reader.result);
    };
    reader.readAsDataURL(file);
    return true;
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  // ---- Granska / lägg till -------------------------------------------------

  const patchScan = useCallback((id: string, patch: Partial<ScanItem>) => {
    setScans((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeScan = useCallback((id: string) => {
    setScans((prev) => prev.filter((s) => s.id !== id));
    setDetailsId((d) => (d === id ? null : d));
  }, []);

  const chooseCandidate = useCallback((id: string, cand: Candidate) => {
    setScans((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: "matched", match: cand } : s
      )
    );
    setDetailsId(null);
  }, []);

  async function addAll() {
    if (matched.length === 0) return;
    setAddingAll(true);
    let ok = 0;
    for (const s of matched) {
      try {
        const res = await fetch("/api/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardId: s.match!.cardId,
            quantity: s.quantity,
            condition: s.condition,
            language: s.language,
            ...(s.match!.estimatedValue != null
              ? { estimatedValue: s.match!.estimatedValue }
              : {}),
          }),
        });
        if (res.ok) ok += 1;
      } catch {
        /* fortsätt med nästa */
      }
    }
    setAddingAll(false);
    setAddedCount(ok);
    toast({
      title: ok === matched.length ? "Tillagt i samlingen" : "Delvis tillagt",
      description:
        ok === matched.length
          ? `${ok} kort lades till i din samling.`
          : `${ok} av ${matched.length} kort lades till.`,
      variant: ok === matched.length ? "success" : "error",
    });
  }

  const detailsItem = detailsId ? scans.find((s) => s.id === detailsId) ?? null : null;

  // =========================================================================
  // Launch-skärm (i app-skalet)
  // =========================================================================
  if (view === "launch") {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <h1 className="font-display text-2xl font-semibold text-ink">Skanna kort</h1>

        {isMock && <MockNotice />}
        {configError && <ConfigNotice text={configError} />}

        <div className="relative overflow-hidden rounded-2xl border border-surface-border bg-surface-gradient p-6 shadow-card">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-holo-cyan/10 blur-3xl"
          />
          <div className="relative flex flex-col items-center gap-5 py-2 text-center">
            {/* Animerad skanruta — signalerar igenkänning, ger sidan liv */}
            <div className="relative grid h-24 w-24 place-items-center rounded-2xl bg-holo-cyan/5 text-holo-cyan ring-1 ring-holo-cyan/20">
              <IconCamera size={34} />
              {(
                [
                  "left-2 top-2 border-l-2 border-t-2 rounded-tl-md",
                  "right-2 top-2 border-r-2 border-t-2 rounded-tr-md",
                  "left-2 bottom-2 border-l-2 border-b-2 rounded-bl-md",
                  "right-2 bottom-2 border-r-2 border-b-2 rounded-br-md",
                ] as const
              ).map((c) => (
                <span key={c} className={cn("absolute h-4 w-4 border-holo-cyan/70", c)} aria-hidden />
              ))}
              <span className="pointer-events-none absolute inset-2 overflow-hidden rounded-xl" aria-hidden>
                <span className="absolute inset-x-0 top-0 h-0.5 animate-scanline bg-gradient-to-r from-transparent via-holo-cyan to-transparent shadow-[0_0_12px_2px_rgba(45,212,191,0.6)]" />
              </span>
            </div>
            <div className="flex w-full flex-col gap-2.5">
              <Button onClick={openScanner} size="lg" className="w-full">
                <IconCamera size={18} /> Starta skanner
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => fileInputRef.current?.click()}
                className="w-full"
              >
                <IconUpload size={16} /> Välj bild
              </Button>
            </div>
            <p className="text-xs text-ink-faint">
              Bilden stannar i appen — inget sparas i kamerarullen.
            </p>
          </div>
        </div>

        <Link
          href="/gradera"
          className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised px-4 py-3 text-sm text-ink-muted transition-colors hover:border-holo-cyan/40 hover:text-ink"
        >
          Bedöma skicket istället?
          <span className="font-medium text-holo-cyan">Gradera med AI →</span>
        </Link>

        {/* Så funkar det — ikon-driven flödesöversikt (fyller ytan, minimal text) */}
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-surface-border bg-surface-raised/60 p-4">
          {(
            [
              { icon: IconCamera, label: "Fånga kortet" },
              { icon: IconSparkle, label: "Vi känner igen det" },
              { icon: IconChart, label: "Se marknadsvärdet" },
            ] as const
          ).map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-2 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-holo-cyan/10 text-holo-cyan">
                <Icon size={18} />
              </span>
              <span className="text-[11px] leading-tight text-ink-muted">{label}</span>
            </div>
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && handleFile(file)) setView("review");
          }}
        />
        {/* Dolda element så refs finns även från launch (vid uppladdning). */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  // =========================================================================
  // Overlay (capture + review) — fullskärm, immersivt
  // =========================================================================
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kortskanner"
      className="fixed inset-0 z-[60] flex flex-col bg-black text-ink"
    >
      {/* Topbar */}
      <div className="relative z-20 flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          ref={closeBtnRef}
          type="button"
          onClick={
            view === "review"
              ? () => (streamRef.current ? setView("capture") : closeScanner())
              : closeScanner
          }
          aria-label={view === "review" ? "Tillbaka till kameran" : "Stäng skannern"}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-ink backdrop-blur transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
        >
          {view === "review" ? <IconChevronLeft size={20} /> : <IconX size={20} />}
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-ink">
            {view === "review" ? "Granska träffar" : "Skanna kort"}
          </p>
        </div>
        <div className="h-10 w-10" aria-hidden="true" />
      </div>

      {view === "capture" ? (
        <CaptureView
          videoRef={videoRef}
          canvasRef={canvasRef}
          cameraState={cameraState}
          cameraError={cameraError}
          flash={flash}
          scans={scans}
          total={total}
          matchedCount={matched.length}
          isMock={isMock}
          shutterCooling={shutterCooling}
          onRetryCamera={() => void startCamera()}
          onCapture={capture}
          onGallery={() => fileInputRef.current?.click()}
          onSettings={() => setSettingsOpen(true)}
          onReview={() => setView("review")}
          onOpenDetails={setDetailsId}
        />
      ) : (
        <ReviewView
          scans={scans}
          matchedCount={matched.length}
          noMatchCount={noMatchCount}
          total={total}
          addingAll={addingAll}
          addedCount={addedCount}
          onPatch={patchScan}
          onRemove={removeScan}
          onOpenDetails={setDetailsId}
          onAddAll={() => void addAll()}
          onScanMore={() => {
            setScans([]);
            setAddedCount(null);
            setView("capture");
          }}
          onClose={closeScanner}
        />
      )}

      {/* Settings-sheet */}
      {settingsOpen && (
        <SettingsSheet
          condition={defaultCondition}
          language={defaultLanguage}
          onCondition={setDefaultCondition}
          onLanguage={setDefaultLanguage}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Scan-details-sheet */}
      {detailsItem && (
        <ScanDetailsSheet
          item={detailsItem}
          onClose={() => setDetailsId(null)}
          onChoose={(c) => chooseCandidate(detailsItem.id, c)}
          onRemove={() => removeScan(detailsItem.id)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}

/* ===========================================================================
 * Capture-vy
 * ======================================================================== */
function CaptureView(props: {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  cameraState: CameraState;
  cameraError: string;
  flash: boolean;
  scans: ScanItem[];
  total: number;
  matchedCount: number;
  isMock: boolean;
  shutterCooling: boolean;
  onRetryCamera: () => void;
  onCapture: () => void;
  onGallery: () => void;
  onSettings: () => void;
  onReview: () => void;
  onOpenDetails: (id: string) => void;
}) {
  const {
    videoRef,
    canvasRef,
    cameraState,
    cameraError,
    flash,
    scans,
    total,
    matchedCount,
    isMock,
    shutterCooling,
  } = props;

  return (
    <>
      {/* Kameralager (fyller bakom) */}
      <div className="absolute inset-0 z-0 bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Kameraflöde"
          className={cn(
            "h-full w-full object-cover",
            cameraState === "live" ? "block" : "hidden"
          )}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Vinjett upptill/nedtill för läsbarhet */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/85 to-transparent"
        />

        {cameraState !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            {cameraState === "starting" ? (
              <>
                <span className="animate-pulse-soft text-holo-cyan">
                  <IconCamera size={40} />
                </span>
                <p className="text-sm text-ink-muted">Startar kameran…</p>
              </>
            ) : cameraState === "unsupported" ? (
              <>
                <IconCamera size={40} className="text-ink-faint" />
                <p className="text-sm font-medium text-ink">Kamera stöds inte här</p>
                <p className="max-w-xs text-xs text-ink-faint">
                  Välj en bild från enheten med galleriknappen nedan.
                </p>
              </>
            ) : (
              <>
                <IconAlertTriangle size={36} className="text-fall" />
                <p className="max-w-xs text-sm text-ink-muted">{cameraError}</p>
                <Button variant="outline" onClick={props.onRetryCamera}>
                  Försök igen
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Kortram-overlay */}
      {cameraState === "live" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          <div className="relative mb-[14vh] aspect-[5/7] w-[68%] max-w-[20rem]">
            <CornerFrame />
          </div>
        </div>
      )}

      {/* Capture-flash */}
      {flash && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 bg-white/80 animate-fade-in"
        />
      )}

      {/* Botten: hint, strip, kontroller */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {isMock && (
          <p className="mx-auto rounded-full bg-black/70 px-3 py-1 text-center text-[11px] font-medium text-holo-gold ring-1 ring-holo-gold/30 backdrop-blur">
            Demoläge — träffar är exempel ur katalogen
          </p>
        )}

        {scans.length > 0 && <ScanStrip scans={scans} total={total} onOpen={props.onOpenDetails} />}

        {scans.length === 0 && cameraState === "live" && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-center text-sm text-ink-muted">
              Håll kortet inom ramen och tryck på knappen
            </p>
            <Link
              href="/produkter"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-2 text-sm font-medium text-ink backdrop-blur transition-colors hover:bg-white/15"
            >
              <IconSearch size={16} /> Manuell inmatning
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between">
          {/* Galleri */}
          <button
            type="button"
            onClick={props.onGallery}
            aria-label="Välj bild från enheten"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-ink backdrop-blur transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
          >
            <IconUpload size={20} />
          </button>

          {/* Inställningar */}
          <button
            type="button"
            onClick={props.onSettings}
            aria-label="Skannerinställningar"
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
          >
            <IconSettings size={20} />
          </button>

          {/* Slutare */}
          <button
            type="button"
            onClick={props.onCapture}
            disabled={cameraState !== "live"}
            aria-label="Ta bild av kortet"
            className={cn(
              "flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full ring-4 ring-white/30 transition-transform",
              "disabled:opacity-40",
              shutterCooling ? "scale-90" : "active:scale-90"
            )}
          >
            <span className="h-[3.6rem] w-[3.6rem] rounded-full bg-white shadow-[0_2px_12px_rgba(0,0,0,0.4)]" />
          </button>

          {/* Bekräfta/granska */}
          <button
            type="button"
            onClick={props.onReview}
            disabled={scans.length === 0}
            aria-label="Granska träffar"
            className={cn(
              "relative flex h-12 w-12 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan",
              scans.length > 0
                ? "bg-holo-cyan text-black hover:bg-holo-cyan/90"
                : "bg-white/10 text-ink-faint"
            )}
          >
            <IconCheck size={22} />
            {matchedCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rise px-1 text-[11px] font-semibold tabular-nums text-black">
                {matchedCount}
              </span>
            )}
          </button>

          {/* Symmetri-spacer mot galleriknappen */}
          <span className="h-12 w-12" aria-hidden="true" />
        </div>
      </div>
    </>
  );
}

function CornerFrame() {
  return (
    <div className="absolute inset-0">
      {/* mjuk ram */}
      <div className="absolute inset-0 rounded-2xl border border-white/25" />
      {/* animerad skanningslinje */}
      <div className="pointer-events-none absolute inset-1 overflow-hidden rounded-2xl">
        <div className="absolute inset-x-0 top-0 h-0.5 animate-scanline bg-gradient-to-r from-transparent via-holo-cyan to-transparent shadow-[0_0_12px_2px_rgba(45,212,191,0.6)]" />
      </div>
      {/* hörn-parenteser i accentfärg */}
      {(
        [
          "left-0 top-0 border-l-2 border-t-2 rounded-tl-2xl",
          "right-0 top-0 border-r-2 border-t-2 rounded-tr-2xl",
          "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-2xl",
          "right-0 bottom-0 border-r-2 border-b-2 rounded-br-2xl",
        ] as const
      ).map((c) => (
        <span
          key={c}
          className={cn("absolute h-8 w-8 border-holo-cyan", c)}
        />
      ))}
    </div>
  );
}

function ScanStrip({
  scans,
  total,
  onOpen,
}: {
  scans: ScanItem[];
  total: number;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl bg-black/55 p-2.5 backdrop-blur">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {scans.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpen(s.id)}
            className="flex w-40 shrink-0 animate-scale-in items-center gap-2 rounded-xl bg-white/8 p-2 text-left transition-colors hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
          >
            <ScanThumb item={s} />
            <span className="min-w-0 flex-1">
              {s.status === "identifying" ? (
                <span className="block text-xs text-ink-muted">Identifierar…</span>
              ) : s.status === "matched" && s.match ? (
                <>
                  <span className="block truncate text-xs font-medium text-ink">
                    {s.match.name}
                  </span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    #{s.match.number}
                  </span>
                  <span className="block text-xs font-semibold tabular-nums text-holo-cyan">
                    {s.match.estimatedValue != null ? formatPrice(s.match.estimatedValue) : "–"}
                  </span>
                </>
              ) : (
                <span className="block text-xs font-medium text-fall">Ingen träff</span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between px-1 pt-1.5">
        <span className="text-[11px] text-ink-faint">
          {scans.length} {scans.length === 1 ? "skanning" : "skanningar"}
        </span>
        <span className="text-sm font-semibold text-ink">
          Totalt: <span className="tabular-nums text-holo-cyan">{formatPrice(total)}</span>
        </span>
      </div>
    </div>
  );
}

function ScanThumb({ item, size = "sm" }: { item: ScanItem; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-24 w-[4.3rem]" : "h-14 w-10";
  if (item.status === "identifying") {
    return (
      <span
        className={cn(
          "flex shrink-0 animate-pulse-soft items-center justify-center rounded-md bg-white/10",
          dim
        )}
      >
        <IconCards size={16} className="text-ink-faint" />
      </span>
    );
  }
  const src = item.match?.imageUrl ?? item.captured;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={item.match?.name ?? "Skannat kort"}
      className={cn("shrink-0 rounded-md object-cover", dim)}
    />
  );
}

/* ===========================================================================
 * Review-vy
 * ======================================================================== */
function ReviewView(props: {
  scans: ScanItem[];
  matchedCount: number;
  noMatchCount: number;
  total: number;
  addingAll: boolean;
  addedCount: number | null;
  onPatch: (id: string, patch: Partial<ScanItem>) => void;
  onRemove: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onAddAll: () => void;
  onScanMore: () => void;
  onClose: () => void;
}) {
  const {
    scans,
    matchedCount,
    noMatchCount,
    total,
    addingAll,
    addedCount,
    onPatch,
    onRemove,
    onOpenDetails,
  } = props;

  const done = addedCount !== null;

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex-1 overflow-y-auto px-4 pb-40">
        <p className="py-3 text-sm text-ink-muted">
          Lägger till i:{" "}
          <span className="font-semibold text-holo-cyan">Min samling</span>
        </p>

        {scans.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <IconCards size={32} className="text-ink-faint" />
            <p className="text-sm text-ink-muted">Inga skanningar ännu.</p>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {scans.map((s) => (
            <li key={s.id}>
             <SwipeToDelete onDelete={() => onRemove(s.id)}>
              {s.status === "matched" && s.match ? (
                <div className="flex gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => onOpenDetails(s.id)}
                    className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
                    aria-label="Visa skanningsdetaljer"
                  >
                    <ScanThumb item={s} size="lg" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{s.match.name}</p>
                        <p className="truncate text-xs text-ink-muted">
                          {s.match.setName} · #{s.match.number}
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-holo-cyan">
                        {s.match.estimatedValue != null ? formatPrice(s.match.estimatedValue) : "–"}
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-ink-faint">Skick</span>
                        <Select
                          value={s.condition}
                          onChange={(e) => onPatch(s.id, { condition: e.target.value })}
                          className="h-9 text-sm"
                        >
                          {CONDITIONS.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-ink-faint">Språk</span>
                        <Select
                          value={s.language}
                          onChange={(e) => onPatch(s.id, { language: e.target.value })}
                          className="h-9 text-sm"
                        >
                          {LANGUAGES.map((l) => (
                            <option key={l.value} value={l.value}>{l.label}</option>
                          ))}
                        </Select>
                      </label>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <Stepper
                        value={s.quantity}
                        onChange={(q) => onPatch(s.id, { quantity: q })}
                      />
                      <button
                        type="button"
                        onClick={() => onRemove(s.id)}
                        className="text-xs text-ink-faint underline-offset-2 hover:text-fall hover:underline"
                      >
                        Ta bort
                      </button>
                    </div>
                  </div>
                </div>
              ) : s.status === "identifying" ? (
                <div className="flex items-center gap-3 p-3">
                  <ScanThumb item={s} size="lg" />
                  <p className="text-sm text-ink-muted">Identifierar…</p>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.captured}
                    alt="Skannat kort utan träff"
                    className="h-24 w-[4.3rem] shrink-0 rounded-md object-cover opacity-80"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">Ingen träff</p>
                    <p className="text-xs text-ink-muted">
                      Kunde inte matcha kortet automatiskt.
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onOpenDetails(s.id)}
                        className="text-xs font-medium text-holo-cyan hover:underline"
                      >
                        Sök manuellt
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(s.id)}
                        className="text-xs text-ink-faint hover:text-fall"
                      >
                        Ta bort
                      </button>
                    </div>
                  </div>
                </div>
              )}
             </SwipeToDelete>
            </li>
          ))}
        </ul>
      </div>

      {/* Sticky botten-CTA */}
      <div className="absolute inset-x-0 bottom-0 border-t border-surface-border bg-surface/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div>
            <p className="text-xs text-ink-muted">
              {matchedCount} matchade
              {noMatchCount > 0 && (
                <span className="text-fall"> · {noMatchCount} utan träff</span>
              )}
            </p>
            <p className="text-lg font-semibold text-ink">
              Totalt: <span className="tabular-nums text-holo-cyan">{formatPrice(total)}</span>
            </p>
          </div>
          {done ? (
            <div className="flex items-center gap-2">
              <LinkButton href="/samling" variant="outline">
                Visa samling
              </LinkButton>
              <Button onClick={props.onScanMore}>Skanna fler</Button>
            </div>
          ) : (
            <Button
              onClick={props.onAddAll}
              loading={addingAll}
              disabled={matchedCount === 0}
              className="px-5"
            >
              Lägg till {matchedCount > 0 ? `${matchedCount} ` : ""}i samlingen
            </Button>
          )}
        </div>
        {done && (
          <p className="mt-2 text-center text-xs text-rise">
            <IconCheck size={13} className="mr-1 inline" />
            {addedCount} kort tillagda i din samling.
          </p>
        )}
      </div>
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-surface-border">
      <button
        type="button"
        aria-label="Minska antal"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-8 w-8 items-center justify-center text-ink-muted hover:text-ink disabled:opacity-40"
        disabled={value <= 1}
      >
        −
      </button>
      <span className="w-8 text-center text-sm font-medium tabular-nums text-ink">{value}</span>
      <button
        type="button"
        aria-label="Öka antal"
        onClick={() => onChange(Math.min(9999, value + 1))}
        className="flex h-8 w-8 items-center justify-center text-ink-muted hover:text-ink"
      >
        +
      </button>
    </div>
  );
}

/* ===========================================================================
 * Settings-sheet
 * ======================================================================== */
function SettingsSheet(props: {
  condition: string;
  language: string;
  onCondition: (v: string) => void;
  onLanguage: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Standardval för nya skanningar" onClose={props.onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="def-condition">Skick</Label>
          <Select
            id="def-condition"
            value={props.condition}
            onChange={(e) => props.onCondition(e.target.value)}
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="def-language">Språk</Label>
          <Select
            id="def-language"
            value={props.language}
            onChange={(e) => props.onLanguage(e.target.value)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-ink-faint">
          Gäller kort du skannar härnäst. Du kan ändra per kort i granskningen.
        </p>
        <Button onClick={props.onClose}>Klar</Button>
      </div>
    </Sheet>
  );
}

/* ===========================================================================
 * Scan-details-sheet (Din bild vs Din träff)
 * ======================================================================== */
function ScanDetailsSheet(props: {
  item: ScanItem;
  onClose: () => void;
  onChoose: (c: Candidate) => void;
  onRemove: () => void;
}) {
  const { item } = props;
  const alternatives = item.candidates.filter(
    (c) => c.cardId !== item.match?.cardId
  );

  return (
    <Sheet title="Skanningsdetaljer" onClose={props.onClose}>
      <div className="flex flex-col gap-5">
        {/* Din bild vs din träff */}
        <div className="grid grid-cols-2 gap-3">
          <figure className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.captured}
              alt="Din bild"
              className="aspect-[5/7] w-full rounded-xl object-cover ring-1 ring-surface-border"
            />
            <figcaption className="text-xs text-ink-faint">Din bild</figcaption>
          </figure>
          <figure className="flex flex-col items-center gap-2">
            {item.match?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.match.imageUrl}
                alt="Din träff"
                className="aspect-[5/7] w-full rounded-xl object-cover ring-1 ring-holo-cyan/40"
              />
            ) : (
              <span className="flex aspect-[5/7] w-full items-center justify-center rounded-xl bg-surface-overlay text-ink-faint ring-1 ring-surface-border">
                <IconSearch size={24} />
              </span>
            )}
            <figcaption className="text-xs text-ink-faint">
              {item.match ? "Din träff" : "Ingen träff"}
            </figcaption>
          </figure>
        </div>

        {/* Träff-meta */}
        {item.match && (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-ink">{item.match.name}</p>
                <p className="truncate text-sm text-ink-muted">
                  {item.match.setName} · #{item.match.number}
                </p>
              </div>
              <p className="shrink-0 text-lg font-semibold tabular-nums text-holo-cyan">
                {item.match.estimatedValue != null ? formatPrice(item.match.estimatedValue) : "–"}
              </p>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              Skick {CONDITION_LABEL[item.condition]} · raw (ograderat) ·
              Marknadstrend (Cardmarket)
            </p>
          </div>
        )}

        {/* Alternativ */}
        {alternatives.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">
              {item.match ? "Inte rätt? Välj ett annat" : "Möjliga träffar"}
            </p>
            <div className="flex flex-col gap-1.5">
              {alternatives.slice(0, 5).map((c) => (
                <button
                  key={c.cardId}
                  type="button"
                  onClick={() => props.onChoose(c)}
                  className="flex items-center gap-3 rounded-xl border border-surface-border p-2 text-left transition-colors hover:border-holo-cyan/50 hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
                >
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-surface-overlay text-ink-faint">
                      <IconCards size={14} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                    <span className="block truncate text-xs text-ink-faint">
                      {c.setName} · #{c.number}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                    {c.estimatedValue != null ? formatPrice(c.estimatedValue) : "–"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Åtgärder */}
        <div className="flex flex-wrap gap-2">
          {item.match?.slug ? (
            <LinkButton href={`/produkter/${item.match.slug}`} variant="outline">
              Visa produkt & prishistorik <IconArrowRight size={15} />
            </LinkButton>
          ) : (
            <LinkButton
              href={`/produkter?q=${encodeURIComponent(item.match?.name ?? "")}`}
              variant="outline"
            >
              <IconSearch size={15} /> Sök manuellt
            </LinkButton>
          )}
          <Button variant="ghost" onClick={props.onRemove}>
            Ta bort skanning
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/* ===========================================================================
 * Svep-för-att-radera — vänstersvep avslöjar röd raderingsyta; släpp förbi
 * halva kortet → radera (samma glid + 0.25s ease som sheet-svepet). Native
 * pointer-events + pan-y så vertikal listscroll förblir webbläsarens.
 * ======================================================================== */
function SwipeToDelete({
  onDelete,
  children,
}: {
  onDelete: () => void;
  children: ReactNode;
}) {
  const fgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dragging = false;
    let axis: "x" | "y" | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      axis = null;
      dx = 0;
      startX = e.clientX;
      startY = e.clientY;
      fg.style.transition = "none";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      // Vänta tills riktningen är tydlig; vertikalt → släpp till native scroll.
      if (axis === null) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
        if (axis === "y") {
          dragging = false;
          return;
        }
        fg.setPointerCapture(e.pointerId);
      }
      dx = Math.min(0, mx); // bara vänster
      fg.style.transform = `translateX(${dx}px)`;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        fg.style.transform = "";
        return;
      }
      fg.style.transition = "transform 0.25s ease";
      if (-dx > fg.offsetWidth / 2) {
        fg.style.transform = "translateX(-110%)";
        window.setTimeout(() => {
          onDelete();
          // Blur:a EFTER att React flyttat fokus (nästa frame) annars hinner
          // CTA:n fånga fokus och visa en cyan ring när listan tömts.
          requestAnimationFrame(() =>
            (document.activeElement as HTMLElement | null)?.blur?.()
          );
        }, 230);
      } else {
        fg.style.transform = "";
      }
    };

    fg.addEventListener("pointerdown", onDown);
    fg.addEventListener("pointermove", onMove);
    fg.addEventListener("pointerup", onUp);
    fg.addEventListener("pointercancel", onUp);
    return () => {
      fg.removeEventListener("pointerdown", onDown);
      fg.removeEventListener("pointermove", onMove);
      fg.removeEventListener("pointerup", onUp);
      fg.removeEventListener("pointercancel", onUp);
    };
  }, [onDelete]);

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-end bg-fall px-6 text-white"
      >
        <IconTrash size={22} />
      </div>
      <div
        ref={fgRef}
        style={{ touchAction: "pan-y" }}
        className="relative rounded-2xl border border-surface-border bg-surface-raised"
      >
        {children}
      </div>
    </div>
  );
}

/* ===========================================================================
 * Bottom-sheet-primitiv
 * ======================================================================== */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  // Svep nedåt på handtaget/rubriken för att stänga. Pointer-capture gör att
  // ALLA move-events går hit när fingret väl tagit i handtaget — webbläsarens
  // egen scroll/bounce kan inte stjäla gesten. touch-action:none på handtaget
  // stoppar native scroll från att ens starta där. Transformen skrivs direkt
  // på panelen (mjukare än React-state per ruta). Panelens kropp scrollar som
  // vanligt — draget och scrollen krockar inte eftersom de bor på olika ytor.
  useEffect(() => {
    const panel = panelRef.current;
    const handle = handleRef.current;
    if (!panel || !handle) return;
    let startY = 0;
    let dy = 0;
    let dragging = false;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      startY = e.clientY;
      dy = 0;
      // animate-fade-in-up (fill-mode: both) pinnar transform och överröstar
      // vår inline-transform → måste rensas, annars syns ingen följning/glid.
      panel.style.animation = "none";
      panel.style.transition = "none";
      handle.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      panel.style.transform = `translateY(${dy}px)`;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = "transform 0.25s ease";
      if (dy > 100) {
        panel.style.transform = "translateY(110%)";
        window.setTimeout(onClose, 230);
      } else {
        panel.style.transform = "";
      }
    };

    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    return () => {
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Stäng"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
      />
      <div
        ref={panelRef}
        className="relative max-h-[85%] overflow-y-auto rounded-t-3xl border-t border-surface-border bg-surface-raised p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card animate-fade-in-up"
      >
        {/* Dragyta: handtag + rubrik. touch-action:none → ingen native scroll här. */}
        <div
          ref={handleRef}
          style={{ touchAction: "none" }}
          className="-mx-5 -mt-5 cursor-grab px-5 pb-4 pt-5 active:cursor-grabbing"
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-surface-border" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Stäng"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-overlay hover:text-ink"
        >
          <IconX size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

/* ===========================================================================
 * Notiser
 * ======================================================================== */
function MockNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-holo-cyan/30 bg-holo-cyan/5 px-4 py-3">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-holo-cyan">
        <IconSparkle size={18} />
      </span>
      <p className="text-sm text-ink-muted">
        <span className="font-semibold text-ink">Demoläge:</span> igenkänningen körs
        med en simulerad tjänst, så träffarna är exempel ur katalogen.
      </p>
    </div>
  );
}

function ConfigNotice({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-fall/30 bg-fall/5 px-4 py-3">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-fall">
        <IconAlertTriangle size={18} />
      </span>
      <p className="text-sm text-ink-muted">{text}</p>
    </div>
  );
}
