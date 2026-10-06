"use client";

/**
 * Förhandsvisning + dela-knapp för delningskortet (`lib/share-card.ts`).
 *
 * Bilden ritas NÄR panelen öppnas, inte i trycket på "Dela": Web Share kräver
 * att anropet sker i användarens tryck, och en ritning som laddar kortkonst
 * hinner annars förbruka den tillfälliga aktiveringen (Safari nekar då tyst).
 * Förhandsvisningen är dessutom själva poängen — man delar det man ser.
 *
 * Inloggade får sin PERSONLIGA inbjudningslänk tryckt i sidfoten (foilio.se/i/<kod>,
 * lib/invite-link.ts) — utom där `printLink={false}` (graderingens slab: ägarbeslut
 * 2026-10-01) — och en "Länk"-knapp som kopierar den. Länken skickas INTE med i
 * delningen: en bild + text/URL i samma ark kan få Instagram-storyn att falla bort
 * ur iOS-arket, och storyn är huvudfallet. Gäster får bara foilio.se.
 *
 * VIDEO (2026-10-01, `spin`): "Bild | Video" ovanför förhandsvisningen. Videon
 * kodas DIREKT när Video väljs, aldrig i trycket på Dela — av samma skäl som
 * bilden ritas i förväg (aktiveringen hade gått ut under de sekunder kodningen tar).
 * Förhandsvisningen är slabben som snurrar live (samma ritning som videon) och den
 * går att vrida med fingret.
 *
 * SIDOR (2026-10-06, `pages`): flera bilder av samma sak — produktens story-bild och
 * en liggande. Förhandsvisningen sveps i sidled (scroll-snap) med prickar under,
 * och Dela delar den bild som syns. Alla sidor ritas när panelen öppnas, av samma
 * skäl som ovan.
 *
 * Knapparna bär bara text (ägarbeslut 2026-10-06).
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { detectShareMode, shareFilename, shareImage, type ShareMode } from "@/lib/share-image";
import type { GradeSpinLayers } from "@/lib/share-card";
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from "@/lib/share-card";
import { drawSpinFrame, encodeSpinVideo, spinAngleAt, spinVideoSize } from "@/lib/slab-spin";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

interface InviteLink {
  label: string;
  url: string;
}

/** En hämtning per sidladdning; null = gäst eller fel (bilden får då "foilio.se"). */
let inviteLinkPromise: Promise<InviteLink | null> | null = null;
function loadInviteLink(): Promise<InviteLink | null> {
  inviteLinkPromise ??= fetch("/api/invites/link")
    .then((r) => (r.ok ? (r.json() as Promise<InviteLink>) : null))
    .catch(() => null);
  return inviteLinkPromise;
}

/** Länken får aldrig hålla bilden som gisslan: efter 3 s ritas den med foilio.se. */
function inviteLinkWithin(ms: number): Promise<InviteLink | null> {
  return Promise.race([
    loadInviteLink(),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
  ]);
}

type Kind = "image" | "video";

/** En bild i arket. `wide` = liggande (16:9), annars story (9:16). */
export interface SharePage {
  key: string;
  render: (domain: string) => Promise<Blob>;
  wide?: boolean;
}

export function ShareCardPanel(props: {
  /**
   * Ritar bilden — `renderShareCard` (skanning) eller `renderGradeShareCard`.
   * `domain` är sidfotens adress: den personliga länken, eller "foilio.se".
   */
  render?: (domain: string) => Promise<Blob>;
  /** Flera bilder att svepa mellan (ersätter `render`). Första sidan visas först. */
  pages?: SharePage[];
  /** Kortets namn: filnamnet och förhandsvisningens alt-text. */
  name: string;
  /** Var delningen kom ifrån, t.ex. "scan" — spåras som `share_card`. */
  source: string;
  /** Utelämnas när arket själv har en stängknapp. */
  onBack?: () => void;
  /** Förhandsvisningens tak när föräldern inte har fast höjd (t.ex. "60dvh"). */
  previewMax?: string;
  /**
   * I ett BottomSheet utan fot: arkets kropp lägger ingen luft för hemindikatorn,
   * så knappen hamnade under den på iPhone (ägarens skärmdump 2026-10-01).
   */
  safeBottom?: boolean;
  /** false ⇒ bilden får "foilio.se", aldrig den personliga länken (kopieringen finns kvar). */
  printLink?: boolean;
  /** Lagren för den snurrande slabben ⇒ "Bild | Video" visas (om telefonen kan koda video). */
  spin?: (domain: string) => Promise<GradeSpinLayers>;
  /**
   * Ett val som ändrar bilden (graderingens "Katalogbild | Mitt foto"). Står i SAMMA
   * rad och form som "Bild | Video"; ett byte ritar om bilden och videon.
   */
  choice?: { value: string; options: { key: string; label: string }[]; onChange: (key: string) => void };
}) {
  const t = useTranslations("ShareCard");
  const { source } = props;
  const printLink = props.printLink !== false;
  const pages: SharePage[] = props.pages ?? (props.render ? [{ key: "story", render: props.render }] : []);
  const [blobs, setBlobs] = useState<(Blob | null)[]>([]);
  const [previews, setPreviews] = useState<(string | null)[]>([]);
  const [page, setPage] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<ShareMode | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [link, setLink] = useState<InviteLink | null>(null);
  const [copied, setCopied] = useState(false);

  const [kind, setKind] = useState<Kind>("image");
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [layers, setLayers] = useState<GradeSpinLayers | null>(null);
  const [video, setVideo] = useState<Blob | null>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void detectShareMode().then((m) => alive && setMode(m));
    if (props.spin) void spinVideoSize().then((s) => alive && setVideoSize(s));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    setFailed(false);
    setBlobs([]);
    setPreviews([]);
    inviteLinkWithin(3000)
      .then(async (l) => {
        if (alive) setLink(l);
        const domain = printLink ? l?.label ?? "foilio.se" : "foilio.se";
        // En i taget: första sidan syns så fort den är klar.
        for (let i = 0; i < pages.length; i++) {
          const b = await pages[i].render(domain);
          if (!alive) return;
          const url = URL.createObjectURL(b);
          urls.push(url);
          setBlobs((prev) => Object.assign([...prev], { [i]: b }));
          setPreviews((prev) => Object.assign([...prev], { [i]: url }));
        }
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // Ritas om vid ett nytt försök eller ett nytt val — indata är annars fast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, props.choice?.value]);

  // Video valt första gången: lagren ritas och kodningen startar direkt.
  useEffect(() => {
    if (kind !== "video" || !props.spin || !videoSize || layers || videoFailed) return;
    let alive = true;
    track("share_card", `${source}:video_open`);
    props
      .spin(printLink ? link?.label ?? "foilio.se" : "foilio.se")
      .then(async (l) => {
        if (!alive) return;
        setLayers(l);
        const v = await encodeSpinVideo(l, videoSize, (p) => alive && setVideoProgress(p));
        if (alive) setVideo(v);
      })
      .catch(() => alive && setVideoFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, videoSize, props.choice?.value]);

  /** Nytt val: videon gäller den gamla bilden — kasta den, så kodas en ny. */
  function choose(key: string) {
    if (!props.choice || key === props.choice.value) return;
    setLayers(null);
    setVideo(null);
    setVideoProgress(0);
    setVideoFailed(false);
    props.choice.onChange(key);
  }

  useEffect(() => {
    track("share_card", `${source}:open`);
  }, [source]);

  const sharing = kind === "video" ? video : blobs[page] ?? null;
  const preview = previews[0] ?? null;
  /** Spåras per sida: "product:shared", "product_wide:shared". */
  const pageSource = page > 0 && pages[page] ? `${source}_${pages[page].key}` : source;

  async function onShare() {
    if (!sharing || !mode || busy) return;
    setBusy(true);
    try {
      const outcome = await shareImage(
        sharing,
        shareFilename(
          page > 0 && pages[page] ? `${props.name}-${pages[page].key}` : props.name,
          kind === "video" ? "mp4" : "jpg"
        ),
        mode,
        t("title")
      );
      if (outcome !== "cancelled") track("share_card", `${pageSource}:${kind === "video" ? "video_" : ""}${outcome}`);
      if (outcome === "saved") {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
      }
    } catch {
      if (kind === "video") setVideoFailed(true);
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function onCopyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      track("share_card", `${source}:copy_link`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* urklipp nekat */
    }
  }

  const frameStyle = props.previewMax ? { maxHeight: props.previewMax } : undefined;
  const showToggle = !!props.spin && !!videoSize;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4",
        props.safeBottom && "pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      )}
    >
      {(showToggle || props.choice) && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
          {props.choice && (
            <Segmented
              value={props.choice.value}
              options={props.choice.options}
              onChange={choose}
              compact={showToggle}
            />
          )}
          {showToggle && (
            <Segmented
              value={kind}
              options={[
                { key: "image", label: t("kindImage") },
                { key: "video", label: t("kindVideo") },
              ]}
              onChange={(k) => setKind(k as Kind)}
              compact={!!props.choice}
            />
          )}
        </div>
      )}

      <div className="flex min-h-[160px] flex-1 items-center justify-center">
        {kind === "video" && layers ? (
          <SpinPreview layers={layers} style={frameStyle} label={t("previewAlt", { name: props.name })} />
        ) : kind === "image" && pages.length > 1 && !failed ? (
          <div className="flex h-full w-full flex-col items-center gap-3">
            <div
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
                if (i !== page) setPage(i);
              }}
              style={props.previewMax ? { height: props.previewMax } : undefined}
              className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {pages.map((pg, i) => (
                <div key={pg.key} className="flex h-full w-full shrink-0 snap-center items-center justify-center px-1">
                  {previews[i] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previews[i]!}
                      alt={t("previewAlt", { name: props.name })}
                      className={cn(
                        "block h-auto max-h-full w-auto max-w-full animate-scale-in rounded-2xl object-contain ring-1 ring-surface-border",
                        pg.wide ? "aspect-[16/9]" : "aspect-[9/16]"
                      )}
                    />
                  ) : (
                    <div
                      className={cn(
                        "flex max-h-full max-w-full flex-col items-center justify-center gap-3 rounded-2xl bg-surface-overlay text-ink-faint ring-1 ring-surface-border",
                        pg.wide ? "aspect-[16/9] w-full" : "aspect-[9/16] h-full"
                      )}
                    >
                      <Spinner />
                      <span className="text-xs">{t("rendering")}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex shrink-0 gap-2" role="tablist" aria-label={t("pagesLabel")}>
              {pages.map((pg, i) => (
                <button
                  key={pg.key}
                  type="button"
                  role="tab"
                  aria-selected={i === page}
                  aria-label={t("pageN", { n: i + 1, total: pages.length })}
                  onClick={() => {
                    const el = scroller.current;
                    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
                  }}
                  className={cn("h-2 w-2 rounded-full transition-colors", i === page ? "bg-holo-cyan" : "bg-surface-border")}
                />
              ))}
            </div>
          </div>
        ) : kind === "image" && preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={t("previewAlt", { name: props.name })}
            style={frameStyle}
            className="block aspect-[9/16] h-auto max-h-full w-auto max-w-full animate-scale-in rounded-2xl object-contain ring-1 ring-surface-border"
          />
        ) : (
          <div
            style={props.previewMax ? { height: props.previewMax } : undefined}
            className="flex aspect-[9/16] h-full max-w-full flex-col items-center justify-center gap-3 rounded-2xl bg-surface-overlay text-ink-faint ring-1 ring-surface-border"
          >
            {(kind === "image" ? failed : videoFailed) ? (
              <>
                <p className="px-4 text-center text-sm text-ink-muted">{t("error")}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (kind === "image") setAttempt((n) => n + 1);
                    else {
                      setLayers(null);
                      setVideo(null);
                      setVideoProgress(0);
                      setVideoFailed(false);
                    }
                  }}
                >
                  {t("retry")}
                </Button>
              </>
            ) : (
              <>
                <Spinner />
                <span className="text-xs">{t("rendering")}</span>
              </>
            )}
          </div>
        )}
      </div>

      <p className="shrink-0 text-center text-xs text-ink-muted">
        {kind === "video" ? t("hintVideo") : link && printLink ? t("hintInvite") : t("hint")}
      </p>

      <div className="flex shrink-0 gap-2">
        {props.onBack && (
          <Button variant="ghost" onClick={props.onBack}>
            {t("back")}
          </Button>
        )}
        {mode !== null && (
          <Button
            className="flex-1"
            onClick={() => void onShare()}
            disabled={!sharing || mode === undefined}
            loading={busy}
          >
            {saved
              ? t("saved")
              : kind === "video" && !video
                ? t("makingVideo", { pct: Math.round(videoProgress * 100) })
                : kind === "video"
                  ? mode === "download"
                    ? t("saveVideo")
                    : t("shareVideo")
                  : mode === "download"
                    ? t("saveImage")
                    : t("shareImage")}
          </Button>
        )}
        {link && (
          <Button variant="outline" onClick={() => void onCopyLink()} aria-label={t("copyLink")}>
            {copied ? t("linkCopied") : t("copyLinkShort")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Den levande förhandsvisningen: samma ritning och samma rörelse som videon, i halv
 * upplösning. Dra med fingret för att vrida själv; släpp så glider den tillbaka in
 * i loopen.
 */
function SpinPreview(props: { layers: GradeSpinLayers; style?: React.CSSProperties; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; offset: number; active: boolean }>({ x: 0, offset: 0, active: false });

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const scale = canvas.width / SHARE_CARD_WIDTH;
    let raf = 0;
    let clock = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const d = drag.current;
      if (!d.active) {
        clock += dt;
        d.offset *= 0.88; // fjädrar tillbaka in i loopen
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawSpinFrame(ctx, props.layers, spinAngleAt(clock) + d.offset);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [props.layers]);

  return (
    <canvas
      ref={ref}
      width={SHARE_CARD_WIDTH / 2}
      height={SHARE_CARD_HEIGHT / 2}
      role="img"
      aria-label={props.label}
      style={props.style}
      className="block aspect-[9/16] h-auto max-h-full w-auto max-w-full touch-none rounded-2xl ring-1 ring-surface-border"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, offset: drag.current.offset, active: true };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d.active) return;
        d.offset += (e.clientX - d.x) * 0.9;
        d.x = e.clientX;
      }}
      onPointerUp={() => {
        drag.current.active = false;
      }}
      onPointerCancel={() => {
        drag.current.active = false;
      }}
    />
  );
}

/** Arkets väljare — samma pillerform för "Bild | Video" och graderingens bildval. */
function Segmented(props: {
  value: string;
  options: { key: string; label: string }[];
  onChange: (key: string) => void;
  /** Två väljare i samma rad ⇒ smalare knappar så båda ryms på en telefon. */
  compact?: boolean;
}) {
  return (
    <div className="flex rounded-full bg-surface-overlay p-1 ring-1 ring-surface-border">
      {props.options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => props.onChange(o.key)}
          aria-pressed={props.value === o.key}
          className={cn(
            "rounded-full py-1.5 text-sm font-semibold transition-colors",
            props.compact ? "px-3.5" : "px-5",
            props.value === o.key ? "bg-holo-cyan text-surface" : "text-ink-muted hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
