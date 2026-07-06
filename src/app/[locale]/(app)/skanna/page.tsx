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
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { Button, LinkButton } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { hasAuthHint } from "@/lib/auth-hint";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCamera,
  IconCards,
  IconCheck,
  IconChevronLeft,
  IconSearch,
  IconSettings,
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
  remaining?: number;
}

interface ScanQuota {
  remaining: number;
  limit: number;
  isPremium: boolean;
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
  errorMessage?: string;
}

const CONDITIONS = [
  { value: "MINT", label: "Mint" },
  { value: "NEAR_MINT", label: "Near Mint" },
  { value: "EXCELLENT", label: "Excellent" },
  { value: "GOOD", label: "Good" },
  { value: "PLAYED", label: "Played" },
  { value: "POOR", label: "Poor" },
] as const;

const CONDITION_LABEL: Record<string, string> = Object.fromEntries(
  CONDITIONS.map((c) => [c.value, c.label])
);

const CAPTURE_MAX = 1280; // px bredd på fångad ruta — högre = tydligare korttext för OCR
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MIN_MATCH_CONF = 0.2;

type CameraState = "starting" | "live" | "error" | "unsupported";
type View = "capture" | "review";

let scanCounter = 0;
const nextId = () => `scan-${Date.now()}-${scanCounter++}`;

/** Skalar ner en uppladdad bild till samma storlek som kamerarutorna (längsta sida
 *  ≤ CAPTURE_MAX). Råa mobilfoton (8 MB → ~11 MB base64) sprängde API-routens
 *  storleksgräns OCH kostade onödigt många vision-tokens per skanning. */
function downscaleDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = Math.min(1, CAPTURE_MAX / longest);
      if (scale === 1 && dataUrl.startsWith("data:image/jpeg")) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

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

// Klient-gate: utloggad → redirecta till login I APPEN (router.replace = SPA-nav,
// ingen hård navigering som Capacitor kastar till Safari). Scanner monteras (och
// kameran startar) först när inloggning bekräftats, så ingen kamera-flash.
export default function SkannaPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  // Kör EN gång ([] deps). Med [router] kunde detta re-köras när kamera-permission
  // beviljas (→ re-render → instabil router-ref) och router.replace loopa = flimmer.
  useEffect(() => {
    if (hasAuthHint()) setAuthed(true);
    else router.replace("/logga-in?callbackUrl=/skanna");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!authed) return null;
  return <Scanner />;
}

function Scanner() {
  const t = useTranslations("Scanner");
  const { toast } = useToast();
  const router = useRouter();

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const [view, setView] = useState<View>("capture");
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraError, setCameraError] = useState("");
  const [provider, setProvider] = useState<string | null>(null);

  const [scans, setScans] = useState<ScanItem[]>([]);
  const [flash, setFlash] = useState(false);
  const [shutterCooling, setShutterCooling] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultCondition, setDefaultCondition] = useState("NEAR_MINT");
  // Skannern är endast engelska — inget språkval.
  const defaultLanguage = "EN";
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const [addingAll, setAddingAll] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const [quota, setQuota] = useState<ScanQuota | null>(null);

  // Hämta kvoten när skannern öppnas (badge: "X skanningar kvar").
  useEffect(() => {
    let active = true;
    fetch("/api/scanner/quota")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d && typeof d.remaining === "number") setQuota(d as ScanQuota);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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
    async (dataUrl: string): Promise<IdentifyResponse | { error: string }> => {
      try {
        // Standard = billiga Haiku-modellen (ingen `precise`) — håller scan-kostnaden
        // mot Pro-priset. Sonnet körs bara på uttryckligt "försök igen, skarpare".
        const res = await fetch("/api/scanner/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
        });
        const data = (await res.json()) as IdentifyResponse & { error?: string };
        if (!res.ok) {
          return { error: data.error ?? t("genericError") };
        }
        setProvider(data.provider);
        return data;
      } catch {
        return { error: t("genericError") };
      }
    },
    [t]
  );

  const identifyInto = useCallback(
    async (id: string, dataUrl: string) => {
      const data = await runIdentify(dataUrl);
      if (!("error" in data) && typeof data.remaining === "number") {
        const r = data.remaining;
        setQuota((q) => (q ? { ...q, remaining: r } : q));
      }
      setScans((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          if ("error" in data) return { ...s, status: "error", errorMessage: data.error };
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
          ? t("cameraDenied")
          : name === "NotFoundError"
            ? t("cameraNotFound")
            : t("cameraFailed")
      );
      setCameraState("error");
    }
  }, [t]);

  // Returnerar false om stängningen avbröts (osparade träffar) → svep-gesten
  // fjädrar tillbaka i stället för att lämna skannern osynlig utanför skärmen.
  const closeScanner = useCallback((): boolean => {
    if (scans.length > 0 && addedCount === null) {
      const ok = window.confirm(t("unsavedConfirm", { count: scans.length }));
      if (!ok) return false;
    }
    stopCamera();
    // Skannern ÄR fliken nu → stäng = lämna fliken (router, ej hård nav i Capacitor).
    router.back();
    return true;
  }, [scans.length, addedCount, stopCamera, router, t]);

  // Stoppa kameran när komponenten lämnas helt.
  useEffect(() => () => stopCamera(), [stopCamera]);

  // Öppna kameran när capture-vyn visas OCH återanslut strömmen om videon
  // monterats om (review→capture monterar ett nytt <video> → annars svart bild).
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

  // Lås body-scroll + Escape-stäng medan skannern är öppen.
  useEffect(() => {
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
  }, [detailsId, settingsOpen, view, closeScanner]);

  // Svep åt HÖGER för att stänga skannern — fingret följer och skannern glider
  // ut, sedan closeScanner() (med osparade-träffar-vakten). Samma touch-event-
  // teknik som produkt-overlayn (WKWebView kapar annars gesten). BARA högersvep
  // engagerar → vänster-svep (kort-radering i granskningsvyn) + vertikal scroll
  // släpps igenom orörda.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dragging = false;
    let axis: "x" | "y" | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // Skanningsremsan scrollar horisontellt → svep där ska INTE stänga skannern.
      if ((e.target as HTMLElement)?.closest?.("[data-no-swipe]")) return;
      dragging = true;
      axis = null;
      dx = 0;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      el.style.transition = "none";
    };
    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      const t = e.touches[0];
      const mx = t.clientX - startX;
      const my = t.clientY - startY;
      if (axis === null) {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        // Bara höger-svep stänger; vänster (radera-svep) + vertikalt → släpp igenom.
        if (mx <= 0 || Math.abs(mx) <= Math.abs(my)) {
          dragging = false;
          return;
        }
        axis = "x";
      }
      e.preventDefault();
      dx = Math.max(0, mx);
      el.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        el.style.transform = "";
        return;
      }
      el.style.transition = "transform 0.25s ease";
      if (dx > el.offsetWidth / 3) {
        el.style.transform = "translateX(110%)";
        window.setTimeout(() => {
          // Avbrutet (osparade träffar) → fjädra tillbaka in.
          if (!closeScanner()) el.style.transform = "";
        }, 230);
      } else {
        el.style.transform = "";
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [closeScanner]);

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
      toast({ title: t("wrongFileType"), description: t("chooseImageFile"), variant: "error" });
      return false;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: t("tooLarge"), description: t("tooLargeDesc"), variant: "error" });
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        // Nedskalning i klienten — samma pixelbudget som kamerarutorna.
        void downscaleDataUrl(reader.result).then(addScan);
      }
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
      title: ok === matched.length ? t("addedAllTitle") : t("addedPartialTitle"),
      description:
        ok === matched.length
          ? t("addedAllDesc", { count: ok })
          : t("addedPartialDesc", { ok, total: matched.length }),
      variant: ok === matched.length ? "success" : "error",
    });
  }

  const detailsItem = detailsId ? scans.find((s) => s.id === detailsId) ?? null : null;

  // =========================================================================
  // Skanner-overlay (capture + review) — fullskärm, immersivt
  // =========================================================================
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogAria")}
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
          aria-label={view === "review" ? t("backToCamera") : t("closeScanner")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-ink backdrop-blur transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
        >
          {view === "review" ? <IconChevronLeft size={20} /> : <IconX size={20} />}
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-ink">
            {view === "review" ? t("reviewTitle") : t("captureTitle")}
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
          quota={quota}
          onUpgrade={() => router.push("/priser")}
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
          onCondition={setDefaultCondition}
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
/** Liten kvot-badge i kameravyn. Free = tappbar → /priser; Pro = bara info. */
function QuotaBadge({ quota, onUpgrade }: { quota: ScanQuota; onUpgrade: () => void }) {
  const t = useTranslations("Scanner");
  const { remaining, isPremium } = quota;
  const pill = (
    <span
      className={cn(
        "shrink-0 rounded-md px-2 py-1 text-xs font-bold tracking-wide",
        isPremium
          ? "bg-holo-cyan text-black"
          : "bg-holo-cyan/20 text-holo-cyan ring-1 ring-holo-cyan/40"
      )}
    >
      {isPremium ? t("pro") : t("free")}
    </span>
  );
  const body = (
    <span className="min-w-0 text-left">
      <span className="block text-sm font-semibold text-ink">
        {t("scansLeft", { count: remaining })}
      </span>
      <span className="block text-xs text-ink-muted">
        {isPremium ? t("renewsNextMonth") : t("tapForMore")}
      </span>
    </span>
  );
  // Lika bred som kortramen i kameravyn (w-[68%] max-w-[20rem] av helskärm).
  const cls =
    "mx-auto flex w-[min(68vw,20rem)] items-center gap-3 rounded-2xl bg-black/70 px-4 py-3 ring-1 ring-white/10 backdrop-blur";
  if (isPremium) {
    return (
      <div className={cls}>
        {pill}
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onUpgrade}
      className={cn(
        cls,
        "transition-colors hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
      )}
    >
      {pill}
      {body}
      <IconArrowRight size={18} className="ml-auto shrink-0 text-ink-muted" />
    </button>
  );
}

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
  quota: ScanQuota | null;
  onUpgrade: () => void;
  onRetryCamera: () => void;
  onCapture: () => void;
  onGallery: () => void;
  onSettings: () => void;
  onReview: () => void;
  onOpenDetails: (id: string) => void;
}) {
  const t = useTranslations("Scanner");
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
    quota,
  } = props;

  return (
    <>
      {/* Kameralager (fyller bakom) */}
      <div className="absolute inset-0 z-0 bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label={t("cameraFeed")}
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
                <p className="text-sm text-ink-muted">{t("startingCamera")}</p>
              </>
            ) : cameraState === "unsupported" ? (
              <>
                <IconCamera size={40} className="text-ink-faint" />
                <p className="text-sm font-medium text-ink">{t("cameraUnsupported")}</p>
                <p className="max-w-xs text-xs text-ink-faint">
                  {t("cameraUnsupportedHint")}
                </p>
              </>
            ) : (
              <>
                <IconAlertTriangle size={36} className="text-fall" />
                <p className="max-w-xs text-sm text-ink-muted">{cameraError}</p>
                <Button variant="outline" onClick={props.onRetryCamera}>
                  {t("retryCamera")}
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

      {/* Botten: kvot-badge, hint, strip, kontroller */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* Kvot-badgen göms när remsan visas — annars trycks den upp i kortramen
            (remsan visar ändå antalet skanningar). Syns före första skanningen. */}
        {quota && scans.length === 0 && <QuotaBadge quota={quota} onUpgrade={props.onUpgrade} />}

        {isMock && (
          <p className="mx-auto rounded-full bg-black/70 px-3 py-1 text-center text-[11px] font-medium text-holo-gold ring-1 ring-holo-gold/30 backdrop-blur">
            {t("demoMode")}
          </p>
        )}

        {scans.length > 0 && <ScanStrip scans={scans} total={total} onOpen={props.onOpenDetails} />}

        {scans.length === 0 && cameraState === "live" && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-center text-sm text-ink-muted">
              {t("holdCard")}
            </p>
            <Link
              href="/produkter"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-2 text-sm font-medium text-ink backdrop-blur transition-colors hover:bg-white/15"
            >
              <IconSearch size={16} /> {t("manualEntry")}
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between">
          {/* Galleri */}
          <button
            type="button"
            onClick={props.onGallery}
            aria-label={t("chooseFromDevice")}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-ink backdrop-blur transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
          >
            <IconUpload size={20} />
          </button>

          {/* Inställningar */}
          <button
            type="button"
            onClick={props.onSettings}
            aria-label={t("scannerSettings")}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
          >
            <IconSettings size={20} />
          </button>

          {/* Slutare */}
          <button
            type="button"
            onClick={props.onCapture}
            disabled={cameraState !== "live"}
            aria-label={t("takePhoto")}
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
            aria-label={t("reviewMatches")}
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
  const t = useTranslations("Scanner");
  return (
    <div data-no-swipe className="rounded-2xl bg-black/55 p-2.5 backdrop-blur">
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
                <span className="block text-xs text-ink-muted">{t("identifying")}</span>
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
                <span className="block text-xs font-medium text-fall">{t("noMatch")}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between px-1 pt-1.5">
        <span className="text-[11px] text-ink-faint">
          {t("scansCount", { count: scans.length })}
        </span>
        <span className="text-sm font-semibold text-ink">
          {t("total")} <span className="tabular-nums text-holo-cyan">{formatPrice(total)}</span>
        </span>
      </div>
    </div>
  );
}

function ScanThumb({ item, size = "sm" }: { item: ScanItem; size?: "sm" | "lg" }) {
  const t = useTranslations("Scanner");
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
      alt={item.match?.name ?? t("scannedCardAlt")}
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
  const t = useTranslations("Scanner");
  const tCond = useTranslations("Condition");
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
          {t("addingTo")}{" "}
          <span className="font-semibold text-holo-cyan">{t("myCollection")}</span>
        </p>

        {scans.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <IconCards size={32} className="text-ink-faint" />
            <p className="text-sm text-ink-muted">{t("noScansYet")}</p>
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
                    aria-label={t("showScanDetails")}
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

                    <div className="mt-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-ink-faint">{t("condition")}</span>
                        <Select
                          value={s.condition}
                          onChange={(e) => onPatch(s.id, { condition: e.target.value })}
                          className="h-9 text-sm"
                        >
                          {CONDITIONS.map((c) => (
                            <option key={c.value} value={c.value}>{tCond(c.value)}</option>
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
                        {t("remove")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : s.status === "identifying" ? (
                <div className="flex items-center gap-3 p-3">
                  <ScanThumb item={s} size="lg" />
                  <p className="text-sm text-ink-muted">{t("identifying")}</p>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.captured}
                    alt={t("noMatchCardAlt")}
                    className="h-24 w-[4.3rem] shrink-0 rounded-md object-cover opacity-80"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {s.status === "error" && s.errorMessage ? t("scanStopped") : t("noMatch")}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {s.errorMessage ?? t("couldntMatch")}
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onOpenDetails(s.id)}
                        className="text-xs font-medium text-holo-cyan hover:underline"
                      >
                        {t("searchManually")}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(s.id)}
                        className="text-xs text-ink-faint hover:text-fall"
                      >
                        {t("remove")}
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
              {t("matchedCount", { count: matchedCount })}
              {noMatchCount > 0 && (
                <span className="text-fall"> · {t("noMatchSuffix", { count: noMatchCount })}</span>
              )}
            </p>
            <p className="text-lg font-semibold text-ink">
              {t("total")} <span className="tabular-nums text-holo-cyan">{formatPrice(total)}</span>
            </p>
          </div>
          {done ? (
            <div className="flex items-center gap-2">
              <LinkButton href="/samling" variant="outline">
                {t("showCollection")}
              </LinkButton>
              <Button onClick={props.onScanMore}>{t("scanMore")}</Button>
            </div>
          ) : (
            <Button
              onClick={props.onAddAll}
              loading={addingAll}
              disabled={matchedCount === 0}
              // Disabled = solid dämpad yta i FULL opacitet (ej dimmad teal). Den
              // gamla disabled:opacity-50 på teal-knappen lämnade en ljus cyan
              // "spök"-remsa i WebKit:s compositing-lager när sista kortet togs bort.
              className="px-5 disabled:bg-surface-overlay disabled:text-ink-faint disabled:opacity-100"
            >
              {matchedCount > 0 ? t("addToCollectionN", { count: matchedCount }) : t("addToCollection")}
            </Button>
          )}
        </div>
        {done && (
          <p className="mt-2 text-center text-xs text-rise">
            <IconCheck size={13} className="mr-1 inline" />
            {t("cardsAdded", { count: addedCount })}
          </p>
        )}
      </div>
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useTranslations("Scanner");
  return (
    <div className="inline-flex items-center rounded-lg border border-surface-border">
      <button
        type="button"
        aria-label={t("decreaseQty")}
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-8 w-8 items-center justify-center text-ink-muted hover:text-ink disabled:opacity-40"
        disabled={value <= 1}
      >
        −
      </button>
      <span className="w-8 text-center text-sm font-medium tabular-nums text-ink">{value}</span>
      <button
        type="button"
        aria-label={t("increaseQty")}
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
  onCondition: (v: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Scanner");
  const tCond = useTranslations("Condition");
  return (
    <Sheet title={t("settingsTitle")} onClose={props.onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="def-condition">{t("condition")}</Label>
          <Select
            id="def-condition"
            value={props.condition}
            onChange={(e) => props.onCondition(e.target.value)}
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>{tCond(c.value)}</option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-ink-faint">
          {t("settingsHint")}
        </p>
        <Button onClick={props.onClose}>{t("done")}</Button>
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
  const t = useTranslations("Scanner");
  const tCond = useTranslations("Condition");
  const { item } = props;
  const alternatives = item.candidates.filter(
    (c) => c.cardId !== item.match?.cardId
  );

  return (
    <Sheet title={t("scanDetails")} onClose={props.onClose}>
      <div className="flex flex-col gap-5">
        {/* Din bild vs din träff */}
        <div className="grid grid-cols-2 gap-3">
          <figure className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.captured}
              alt={t("yourImage")}
              className="aspect-[5/7] w-full rounded-xl object-cover ring-1 ring-surface-border"
            />
            <figcaption className="text-xs text-ink-faint">{t("yourImage")}</figcaption>
          </figure>
          <figure className="flex flex-col items-center gap-2">
            {item.match?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.match.imageUrl}
                alt={t("yourMatch")}
                className="aspect-[5/7] w-full rounded-xl object-cover ring-1 ring-holo-cyan/40"
              />
            ) : (
              <span className="flex aspect-[5/7] w-full items-center justify-center rounded-xl bg-surface-overlay text-ink-faint ring-1 ring-surface-border">
                <IconSearch size={24} />
              </span>
            )}
            <figcaption className="text-xs text-ink-faint">
              {item.match ? t("yourMatch") : t("noMatch")}
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
              {t("conditionMeta", {
                condition: item.condition in CONDITION_LABEL ? tCond(item.condition) : item.condition,
              })}
            </p>
          </div>
        )}

        {/* Alternativ */}
        {alternatives.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">
              {item.match ? t("notRight") : t("possibleMatches")}
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
              {t("showProduct")} <IconArrowRight size={15} />
            </LinkButton>
          ) : (
            <LinkButton
              href={`/produkter?q=${encodeURIComponent(item.match?.name ?? "")}`}
              variant="outline"
            >
              <IconSearch size={15} /> {t("searchManually")}
            </LinkButton>
          )}
          <Button variant="ghost" onClick={props.onRemove}>
            {t("removeScan")}
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
  const t = useTranslations("Scanner");
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
        aria-label={t("close")}
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
          aria-label={t("close")}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-overlay hover:text-ink"
        >
          <IconX size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
