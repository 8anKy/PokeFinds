"use client";

/**
 * Live kortidentifierare — håll upp ett kort framför kameran så känns det igen
 * i realtid (ingen fotografering) och visar vilket kort det är + aktuellt pris.
 * Pollar nedskalade videorutor mot /api/scanner/identify (ingen ScannerJob per
 * ruta). Låser resultatet när samma kort identifieras stabilt. Faller tillbaka
 * på bilduppladdning när kamera saknas. (Skicket bedöms separat under /gradera.)
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
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

const SCAN_INTERVAL_MS = 1500;
const DOWNSCALE_MAX = 640;
const MIN_SHOW_CONF = 0.25;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// Klient-grindar: en videoruta skickas till modellen BARA när ett kort faktiskt
// hålls upp (tillräcklig bildkontrast i mittregionen) OCH hålls stilla (låg
// rörelse mot förra rutan). Pekas kameran mot en tom yta spenderas inga tokens.
const DETAIL_MIN = 12; // std-avvikelse i luminans (0–255) i mittregionen
const MOTION_MAX = 7; // medel-abs-diff mot förra rutan (0–255)

type CameraState = "idle" | "starting" | "live" | "error" | "unsupported";

export default function SkannaPage() {
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const busyRef = useRef(false);
  const lockedRef = useRef(false);
  const recentRef = useRef<string[]>([]);
  const prevLumRef = useRef<number[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string>("");
  const [configError, setConfigError] = useState<string>("");
  const [provider, setProvider] = useState<string | null>(null);

  const [match, setMatch] = useState<Candidate | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [locked, setLocked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [liveHint, setLiveHint] = useState("Håll upp ett kort framför kameran…");

  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<string>("NEAR_MINT");
  const [language, setLanguage] = useState<string>("EN");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const showMatch = useCallback((data: IdentifyResponse): string | null => {
    setProvider(data.provider);
    const top = data.candidates[0];
    if (top && data.confidence >= MIN_SHOW_CONF) {
      setMatch(top);
      setConfidence(data.confidence);
      return top.cardId;
    }
    return null;
  }, []);

  const runIdentify = useCallback(
    async (
      dataUrl: string,
      opts: { surfaceErrors?: boolean; precise?: boolean } = {}
    ): Promise<IdentifyResponse | null> => {
      try {
        const res = await fetch("/api/scanner/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl, precise: opts.precise ?? false }),
        });
        const data = (await res.json()) as IdentifyResponse & { error?: string };
        if (!res.ok) {
          if (res.status === 503 && data.error) setConfigError(data.error);
          else if (opts.surfaceErrors && data.error) {
            toast({ title: "Kunde inte identifiera", description: data.error, variant: "error" });
          }
          return null;
        }
        setConfigError("");
        return data;
      } catch {
        // Nätverksglapp under live-loopen — ignorera tyst.
        return null;
      }
    },
    [toast]
  );

  /**
   * Ritar ned en nedskalad videoruta och mäter — helt på klienten, utan tokens —
   * om ett kort hålls upp: `detail` = bildkontrast i mittregionen (tom yta → lågt),
   * `motion` = skillnad mot förra rutan (kameran rör sig → högt). Returnerar även
   * JPEG-data-URL:en så att en godkänd ruta kan skickas till modellen direkt.
   */
  const analyzeFrame = useCallback(
    (): { detail: number; motion: number; dataUrl: string } | null => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return null;
      const scale = Math.min(1, DOWNSCALE_MAX / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);

      // Mittregion = skanningsramen (58 % × 78 %, centrerad).
      const rx = Math.floor(w * 0.21);
      const ry = Math.floor(h * 0.11);
      const rw = Math.max(1, Math.floor(w * 0.58));
      const rh = Math.max(1, Math.floor(h * 0.78));
      const { data } = ctx.getImageData(rx, ry, rw, rh);
      const GRID = 24;
      const lum: number[] = [];
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          const px = Math.min(rw - 1, Math.floor(((gx + 0.5) / GRID) * rw));
          const py = Math.min(rh - 1, Math.floor(((gy + 0.5) / GRID) * rh));
          const i = (py * rw + px) * 4;
          lum.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        }
      }
      let mean = 0;
      for (const v of lum) mean += v;
      mean /= lum.length;
      let varc = 0;
      for (const v of lum) varc += (v - mean) ** 2;
      const detail = Math.sqrt(varc / lum.length);

      const prev = prevLumRef.current;
      let motion = Infinity; // första rutan saknar referens → behandla som rörlig
      if (prev && prev.length === lum.length) {
        let diff = 0;
        for (let i = 0; i < lum.length; i++) diff += Math.abs(lum[i] - prev[i]);
        motion = diff / lum.length;
      }
      prevLumRef.current = lum;

      return { detail, motion, dataUrl: canvas.toDataURL("image/jpeg", 0.7) };
    },
    []
  );

  const scanTick = useCallback(async () => {
    if (!runningRef.current) return;
    const reschedule = () => {
      if (runningRef.current)
        loopRef.current = setTimeout(() => void scanTick(), SCAN_INTERVAL_MS);
    };

    // Hoppa över helt när kortet är låst, ett anrop pågår eller fliken är dold.
    if (
      lockedRef.current ||
      busyRef.current ||
      (typeof document !== "undefined" && document.hidden)
    ) {
      reschedule();
      return;
    }

    const frame = analyzeFrame();
    if (!frame) {
      reschedule();
      return;
    }

    // GRIND: spendera inga tokens på en tom eller rörlig ruta.
    if (frame.detail < DETAIL_MIN) {
      recentRef.current = [];
      setLiveHint("Håll upp ett kort framför kameran…");
      reschedule();
      return;
    }
    if (frame.motion > MOTION_MAX) {
      setLiveHint("Håll kortet stilla…");
      reschedule();
      return;
    }

    busyRef.current = true;
    setLiveHint("Identifierar…");
    const data = await runIdentify(frame.dataUrl);
    if (!lockedRef.current && data) {
      const id = showMatch(data);
      if (id) {
        const recent = [...recentRef.current.slice(-1), id];
        recentRef.current = recent;
        // Två likadana snabbläsningar (Haiku) i rad → bekräfta EN gång med den
        // precisa modellen (Sonnet) innan vi låser. Hög träffsäkerhet, men bara
        // ett dyrare anrop per kort.
        if (recent.length >= 2 && recent[0] === recent[1]) {
          setConfirming(true);
          const precise = await runIdentify(frame.dataUrl, { precise: true });
          if (precise && precise.candidates[0] && precise.confidence >= MIN_SHOW_CONF) {
            showMatch(precise);
            lockedRef.current = true;
            setLocked(true);
          } else {
            // Precis modell osäker → lås inte på en möjlig felläsning.
            recentRef.current = [];
          }
          setConfirming(false);
        }
      } else {
        recentRef.current = [];
        setLiveHint("Håll upp ett kort framför kameran…");
      }
    }
    busyRef.current = false;
    reschedule();
  }, [analyzeFrame, runIdentify, showMatch]);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    if (loopRef.current) clearTimeout(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState("idle");
  }, []);

  const resetMatch = useCallback(() => {
    lockedRef.current = false;
    recentRef.current = [];
    prevLumRef.current = null;
    setLocked(false);
    setConfirming(false);
    setMatch(null);
    setConfidence(0);
    setAdded(false);
    setLiveHint("Håll upp ett kort framför kameran…");
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      return;
    }
    setCameraState("starting");
    setCameraError("");
    resetMatch();
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
      setLiveHint("Håll upp ett kort framför kameran…");
      runningRef.current = true;
      loopRef.current = setTimeout(() => void scanTick(), 600);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setCameraError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Kameraåtkomst nekades. Tillåt kameran i webbläsaren och försök igen."
          : name === "NotFoundError"
            ? "Ingen kamera hittades. Anslut en kamera eller ladda upp en bild nedan."
            : "Kunde inte starta kameran. Ladda upp en bild nedan istället."
      );
      setCameraState("error");
    }
  }, [resetMatch, scanTick]);

  // Stoppa kameran när komponenten lämnas.
  useEffect(() => () => stopCamera(), [stopCamera]);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Fel filtyp", description: "Välj en bildfil (JPG, PNG eller WebP).", variant: "error" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: "Bilden är för stor", description: "Max 4 MB.", variant: "error" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      lockedRef.current = false;
      recentRef.current = [];
      setLocked(false);
      setAdded(false);
      setUploadBusy(true);
      // En uppladdad bild är ett medvetet engångsval → kör direkt med den
      // precisa modellen och lås resultatet.
      void runIdentify(reader.result, { surfaceErrors: true, precise: true })
        .then((data) => {
          if (data && showMatch(data)) {
            lockedRef.current = true;
            setLocked(true);
          }
        })
        .finally(() => setUploadBusy(false));
    };
    reader.readAsDataURL(file);
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  async function addToCollection() {
    if (!match) return;
    setAdding(true);
    try {
      const res = await fetch("/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId: match.cardId,
          quantity,
          condition,
          language,
          ...(match.estimatedValue != null ? { estimatedValue: match.estimatedValue } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Kunde inte lägga till kortet.");
      setAdded(true);
      toast({ title: "Tillagt i samlingen", description: `${match.name} har lagts till.`, variant: "success" });
    } catch (err) {
      toast({
        title: "Något gick fel",
        description: err instanceof Error ? err.message : "Okänt fel.",
        variant: "error",
      });
    } finally {
      setAdding(false);
    }
  }

  const isMock = provider === "mock";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Identifiera kort</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Håll upp ett kort framför kameran — vi känner igen det direkt och visar vilket kort det
          är och dess aktuella pris. Ingen fotografering behövs.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Vill du bedöma kortets skick istället?{" "}
          <Link href="/gradera" className="font-medium text-holo-cyan hover:underline">
            Gradera kortet med AI →
          </Link>
        </p>
      </div>

      {isMock && (
        <div className="flex items-start gap-3 rounded-xl border border-holo-cyan/30 bg-holo-cyan/5 px-4 py-3">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-holo-cyan">
            <IconSparkle size={18} />
          </span>
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">Demoläge:</span> igenkänningen körs med en
            simulerad tjänst, så träffarna är exempel ur katalogen. Sätt{" "}
            <code className="rounded bg-surface-overlay px-1 text-xs">OCR_PROVIDER=claude</code> +{" "}
            <code className="rounded bg-surface-overlay px-1 text-xs">ANTHROPIC_API_KEY</code> för
            riktig bildigenkänning.
          </p>
        </div>
      )}

      {configError && (
        <div className="flex items-start gap-3 rounded-xl border border-fall/30 bg-fall/5 px-4 py-3">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-fall">
            <IconAlertTriangle size={18} />
          </span>
          <p className="text-sm text-ink-muted">{configError}</p>
        </div>
      )}

      {/* Live-kamera */}
      <Card>
        <CardHeader>
          <CardTitle>Live-skanning</CardTitle>
          {cameraState === "live" && (
            <p className="text-sm text-ink-muted">
              {locked ? "Kort identifierat ✓" : confirming ? "Bekräftar kortet…" : liveHint}
            </p>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="relative overflow-hidden rounded-xl border border-surface-border bg-surface-overlay">
            {/* Video alltid monterad så ref finns; visas bara live. */}
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="Kameraflöde för kortskanning"
              className={cn(
                "aspect-[4/3] w-full bg-black object-cover",
                cameraState === "live" ? "block" : "hidden"
              )}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraState === "live" && (
              // Skanningsram-overlay
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={cn(
                    "h-[78%] w-[58%] rounded-xl border-2 transition-colors",
                    locked ? "border-rise shadow-glow" : "border-holo-cyan/70"
                  )}
                />
              </div>
            )}

            {cameraState !== "live" && (
              <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 px-6 text-center">
                {cameraState === "starting" ? (
                  <p className="text-sm text-ink-muted">Startar kameran…</p>
                ) : cameraState === "unsupported" ? (
                  <>
                    <span aria-hidden="true" className="text-ink-faint">
                      <IconCamera size={36} />
                    </span>
                    <p className="text-sm font-medium text-ink">Kamera stöds inte här</p>
                    <p className="max-w-sm text-xs text-ink-faint">
                      Din webbläsare gav ingen kameraåtkomst. Ladda upp en bild nedan istället.
                    </p>
                  </>
                ) : cameraState === "error" ? (
                  <>
                    <span aria-hidden="true" className="text-fall">
                      <IconAlertTriangle size={32} />
                    </span>
                    <p className="max-w-sm text-sm text-ink-muted">{cameraError}</p>
                    <Button variant="outline" onClick={() => void startCamera()}>
                      Försök igen
                    </Button>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="text-ink-faint">
                      <IconCamera size={36} />
                    </span>
                    <p className="text-sm font-medium text-ink">Starta kameran och håll upp ett kort</p>
                    <p className="max-w-sm text-xs text-ink-faint">
                      Kortet identifieras automatiskt — du behöver inte ta något foto.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {cameraState === "live" ? (
              <Button variant="outline" onClick={stopCamera}>
                Stäng kameran
              </Button>
            ) : (
              <Button
                onClick={() => void startCamera()}
                loading={cameraState === "starting"}
                disabled={cameraState === "unsupported"}
              >
                Starta kameran
              </Button>
            )}
            {locked && (
              <Button variant="ghost" onClick={resetMatch}>
                Skanna nästa kort
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resultat */}
      {match && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{locked ? "Identifierat kort" : "Trolig träff"}</CardTitle>
              {locked && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rise/10 px-2 py-0.5 text-xs font-medium text-rise">
                  <IconCheck size={14} /> Stabil
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start gap-4">
              {match.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={match.imageUrl}
                  alt={match.name}
                  className="h-32 w-24 shrink-0 rounded-lg object-cover shadow-card"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-32 w-24 shrink-0 items-center justify-center rounded-lg bg-surface-overlay text-ink-faint"
                >
                  <IconCards size={28} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-ink">{match.name}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {match.setName} · #{match.number} · {match.rarity}
                </p>
                <div className="mt-3">
                  <p className="text-2xl font-semibold tabular-nums text-holo-cyan">
                    {match.estimatedValue != null ? formatPrice(match.estimatedValue) : "Pris saknas"}
                  </p>
                  <p className="text-xs text-ink-faint">Aktuellt marknadsvärde · Marknadstrend (Cardmarket)</p>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-overlay">
                    <div
                      className={cn("h-full rounded-full", locked ? "bg-rise" : "bg-holo-cyan")}
                      style={{ width: `${Math.round(confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-ink-muted">
                    {Math.round(confidence * 100)} % säkerhet
                  </span>
                </div>
              </div>
            </div>

            {/* Åtgärder */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="quantity">Antal</Label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  max={10000}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </div>
              <div>
                <Label htmlFor="condition">Skick</Label>
                <Select id="condition" value={condition} onChange={(e) => setCondition(e.target.value)}>
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="language">Språk</Label>
                <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void addToCollection()} loading={adding} disabled={added}>
                Lägg till i samlingen
              </Button>
              {match.slug ? (
                <LinkButton href={`/produkter/${match.slug}`} variant="outline">
                  Visa produkt →
                </LinkButton>
              ) : (
                <LinkButton href={`/produkter?q=${encodeURIComponent(match.name)}`} variant="outline">
                  Sök produkt →
                </LinkButton>
              )}
              {added && (
                <LinkButton href="/samling" variant="ghost">
                  Visa min samling →
                </LinkButton>
              )}
            </div>
            {!locked && (
              <p className="text-xs text-ink-faint">
                Håll kortet stilla en stund så låses identifieringen.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Uppladdning som reserv */}
      <Card>
        <CardHeader>
          <CardTitle>Ingen kamera? Ladda upp en bild</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            Välj en bild på kortet så identifierar vi det på samma sätt.
          </p>
          <div>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              loading={uploadBusy}
            >
              <IconSearch size={16} /> Välj bild
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onInputChange}
            />
          </div>
        </CardContent>
      </Card>

      {!match && cameraState !== "live" && (
        <EmptyState
          icon={<IconCards size={32} />}
          title="Inget kort identifierat ännu"
          description="Starta kameran och håll upp ett kort, eller ladda upp en bild."
        />
      )}
    </div>
  );
}
