"use client";

/**
 * Förhandsvisning + dela-knapp för delningskortet (`lib/share-card.ts`).
 *
 * Bilden ritas NÄR panelen öppnas, inte i trycket på "Dela": Web Share kräver
 * att anropet sker i användarens tryck, och en ritning som laddar kortkonst
 * hinner annars förbruka den tillfälliga aktiveringen (Safari nekar då tyst).
 * Förhandsvisningen är dessutom själva poängen — man delar det man ser.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IconCheck, IconShare } from "@/components/ui/icons";
import { detectShareMode, shareFilename, shareImage, type ShareMode } from "@/lib/share-image";
import { track } from "@/lib/track";

export function ShareCardPanel(props: {
  /** Ritar bilden — `renderShareCard` (skanning) eller `renderGradeShareCard`. */
  render: () => Promise<Blob>;
  /** Kortets namn: filnamnet och förhandsvisningens alt-text. */
  name: string;
  /** Var delningen kom ifrån, t.ex. "scan" — spåras som `share_card`. */
  source: string;
  /** Utelämnas när arket själv har en stängknapp. */
  onBack?: () => void;
  /** Förhandsvisningens tak när föräldern inte har fast höjd (t.ex. "60dvh"). */
  previewMax?: string;
}) {
  const t = useTranslations("ShareCard");
  const { source } = props;
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<ShareMode | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void detectShareMode().then((m) => alive && setMode(m));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setFailed(false);
    setBlob(null);
    setPreview(null);
    props
      .render()
      .then((b) => {
        if (!alive) return;
        url = URL.createObjectURL(b);
        setBlob(b);
        setPreview(url);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // Ritas om bara vid ett nytt försök — indata är fast medan panelen är öppen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    track("share_card", `${source}:open`);
  }, [source]);

  async function onShare() {
    if (!blob || !mode || busy) return;
    setBusy(true);
    try {
      const outcome = await shareImage(blob, shareFilename(props.name), mode, t("title"));
      if (outcome !== "cancelled") track("share_card", `${source}:${outcome}`);
      if (outcome === "saved") {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-[160px] flex-1 items-center justify-center">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={t("previewAlt", { name: props.name })}
            style={props.previewMax ? { maxHeight: props.previewMax } : undefined}
            className="block aspect-[9/16] h-auto max-h-full w-auto max-w-full animate-scale-in rounded-2xl object-contain ring-1 ring-surface-border"
          />
        ) : (
          <div
            style={props.previewMax ? { height: props.previewMax } : undefined}
            className="flex aspect-[9/16] h-full max-w-full flex-col items-center justify-center gap-3 rounded-2xl bg-surface-overlay text-ink-faint ring-1 ring-surface-border">
            {failed ? (
              <>
                <p className="px-4 text-center text-sm text-ink-muted">{t("error")}</p>
                <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
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

      <p className="shrink-0 text-center text-xs text-ink-muted">{t("hint")}</p>

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
            disabled={!blob || mode === undefined}
            loading={busy}
          >
            {saved ? <IconCheck size={16} /> : <IconShare size={16} />}
            {saved ? t("saved") : mode === "download" ? t("saveImage") : t("shareImage")}
          </Button>
        )}
      </div>
    </div>
  );
}
