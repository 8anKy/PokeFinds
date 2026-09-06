"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconUpload, IconX } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";

export const MAX_IMAGES = 6;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
/** Miniatyren som trådlistan visar (kortet är 80×80; 2× för retina + marginal). */
const THUMB_EDGE = 320;
const THUMB_QUALITY = 0.72;

export interface PickedImage {
  /** Lokalt id för listan (inte nyckeln — den finns först efter uppladdning). */
  id: string;
  previewUrl: string;
  key: string | null;
  /** Miniatyrens nyckel, null när den inte gick att göra (flödet klarar sig utan). */
  thumbKey: string | null;
  width: number | null;
  height: number | null;
  uploading: boolean;
  error: string | null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

/** Glest prov av alfakanalen — räcker för "har bilden genomskinlighet alls?". */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  const step = Math.max(4, Math.floor(data.length / 4 / 20_000) * 4);
  for (let i = 3; i < data.length; i += step) {
    if (data[i] < 250) return true;
  }
  return false;
}

/**
 * Skalar ner till ≤1600 px på långsidan i klienten. JPEG 0,82 som regel; PNG
 * behålls bara när bilden faktiskt har genomskinlighet (annars är en PNG av
 * ett foto 5–10× större för ingenting). EXIF (inkl. GPS) försvinner på köpet
 * — canvasen ritar pixlar, inte metadata. Webbläsaren har redan roterat
 * enligt EXIF-orienteringen när <img> avkodats.
 */
async function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error("encode");
  return blob;
}

/** Samma bild i ≤320 px — ritas ur den redan nedskalade canvasen, inte ur filen. */
async function makeThumb(source: HTMLCanvasElement, type: string): Promise<Blob | null> {
  try {
    const scale = Math.min(1, THUMB_EDGE / Math.max(source.width, source.height));
    if (scale >= 1) return null; // redan liten — originalet duger som miniatyr
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await encode(canvas, type, type === "image/png" ? undefined : THUMB_QUALITY);
  } catch {
    return null;
  }
}

async function downscale(
  file: File
): Promise<{ blob: Blob; thumb: Blob | null; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0, width, height);
    const keepPng = file.type === "image/png" && hasTransparency(ctx, width, height);
    const type = keepPng ? "image/png" : "image/jpeg";
    const blob = await encode(canvas, type, keepPng ? undefined : JPEG_QUALITY);
    // Samma filtyp som originalet: serverns nyckel behåller ändelsen.
    const thumb = await makeThumb(canvas, type);
    return { blob, thumb, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function upload(
  blob: Blob,
  thumb: Blob | null,
  width: number,
  height: number
): Promise<{ key: string; thumbKey: string | null }> {
  const png = blob.type === "image/png";
  const form = new FormData();
  form.append("file", blob, png ? "bild.png" : "bild.jpg");
  if (thumb) form.append("thumb", thumb, png ? "mini.png" : "mini.jpg");
  form.append("width", String(width));
  form.append("height", String(height));
  const res = await fetch("/api/community/upload", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  const data = (await res.json().catch(() => null)) as {
    key?: string;
    thumbKey?: string | null;
    error?: string;
  } | null;
  if (!res.ok || !data?.key) throw new Error(data?.error || "upload");
  return { key: data.key, thumbKey: data.thumbKey ?? null };
}

/**
 * Bildval för komponisten. Renderar INGENTING om servern säger att lagringen
 * är avstängd (`GET /api/community/upload` → `{ enabled: false }`) — forumet
 * fungerar utan bilder, och en knapp som alltid felar är sämre än ingen knapp.
 */
export function ImagePicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedImage[];
  onChange: (next: PickedImage[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("Forum");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/community/upload", { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<{ enabled: boolean }>) : { enabled: false }))
      .then((d) => {
        if (!cancelled) setEnabled(!!d.enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(id: string, changes: Partial<PickedImage>) {
    onChange(valueRef.current.map((img) => (img.id === id ? { ...img, ...changes } : img)));
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES - valueRef.current.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length === 0) return;

    const entries: PickedImage[] = picked.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      previewUrl: URL.createObjectURL(f),
      key: null,
      thumbKey: null,
      width: null,
      height: null,
      uploading: true,
      error: null,
    }));
    onChange([...valueRef.current, ...entries]);

    await Promise.all(
      picked.map(async (file, i) => {
        const entry = entries[i];
        try {
          const { blob, thumb, width, height } = await downscale(file);
          const { key, thumbKey } = await upload(blob, thumb, width, height);
          patch(entry.id, { key, thumbKey, width, height, uploading: false });
        } catch (e) {
          patch(entry.id, {
            uploading: false,
            error: e instanceof Error && e.message !== "upload" ? e.message : t("composerUploadFailed"),
          });
        }
      })
    );
  }

  function remove(id: string) {
    const img = valueRef.current.find((i) => i.id === id);
    if (img) URL.revokeObjectURL(img.previewUrl);
    onChange(valueRef.current.filter((i) => i.id !== id));
  }

  if (enabled !== true) return null;
  const full = value.length >= MAX_IMAGES;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">{t("composerImages")}</span>
        <span className="text-xs text-ink-faint">{t("composerImagesHint", { max: MAX_IMAGES })}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {value.map((img) => (
          <div
            key={img.id}
            className={cn(
              "relative h-20 w-20 overflow-hidden rounded-lg border bg-surface-overlay",
              img.error ? "border-fall" : "border-surface-border"
            )}
          >
            <img src={img.previewUrl} alt="" className="h-full w-full object-cover" />
            {img.uploading && (
              <div className="absolute inset-0 grid place-items-center bg-surface/60">
                <Spinner size="sm" />
              </div>
            )}
            {img.error && (
              <div className="absolute inset-x-0 bottom-0 bg-fall/90 px-1 py-0.5 text-[10px] leading-tight text-surface">
                {img.error}
              </div>
            )}
            <button
              type="button"
              onClick={() => remove(img.id)}
              aria-label={t("composerRemoveImage")}
              className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-surface/80 text-ink hover:bg-surface"
            >
              <IconX size={12} />
            </button>
          </div>
        ))}
        {!full && (
          <Button
            type="button"
            variant="secondary"
            className="h-20 w-20 flex-col gap-1 px-0 text-xs"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <IconUpload size={18} />
            {t("composerAddImages")}
          </Button>
        )}
      </div>
    </div>
  );
}
