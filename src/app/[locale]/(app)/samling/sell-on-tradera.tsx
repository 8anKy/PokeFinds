"use client";

/**
 * "Sälj på Tradera" — självständig knapp + modal per samlingsobjekt.
 * Användaren väljer pris, skick och fraktkostnad samt laddar upp ett foto på det
 * egna objektet; POST /api/tradera/sell skapar en Köp nu-annons via Tradera-API:t.
 * Kräver att Tradera-kontot är kopplat (Inställningar) — annars svarar API:t 400.
 */
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Textarea, Select, Label, FieldError } from "@/components/ui/input";
import { CONDITION_LABELS, LANGUAGE_LABELS, type CollectionRow } from "./collection-client";

type Translators = {
  t: ReturnType<typeof useTranslations>;
  tCond: ReturnType<typeof useTranslations>;
  tLang: ReturnType<typeof useTranslations>;
};

/** Standardbeskrivning att förifylla textrutan med (användaren kan redigera). */
function defaultDescription(row: CollectionRow, condition: string, tr: Translators): string {
  const condLabel = condition in CONDITION_LABELS ? tr.tCond(condition) : condition;
  const langLabel = row.language in LANGUAGE_LABELS ? tr.tLang(row.language) : row.language;
  return [
    `${row.name}${row.setName ? ` — ${row.setName}` : ""}`,
    tr.t("sellDescCondition", { condition: condLabel }),
    tr.t("sellDescLanguage", { language: langLabel }),
    "",
    tr.t("sellDescFooter"),
  ].join("\n");
}

/**
 * Läs in ett foto och skala ner till max 1600 px JPEG — ett rått mobilfoto är
 * 5–12 MB och 12 st som base64 blev en ~100 MB+ POST (långsam/omöjlig på mobilnät;
 * API:t cappar dessutom 8M tecken/bild). 1600 px räcker gott för Tradera-annonser.
 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Kunde inte läsa bilden."));
    };
    img.src = url;
  });
}

export function SellButton({
  row,
  className,
  size = "sm",
}: {
  row: CollectionRow;
  className?: string;
  size?: "sm" | "md";
}) {
  const { toast } = useToast();
  const t = useTranslations("Collection");
  const tCond = useTranslations("Condition");
  const tLang = useTranslations("Language");
  const tr: Translators = { t, tCond, tLang };
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState(row.condition);
  const [shipping, setShipping] = useState("20");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  function openModal() {
    setPrice(row.estimatedValue != null ? String(Math.round(row.estimatedValue / 100)) : "");
    setCondition(row.condition);
    setShipping("20");
    setPurchasePrice(row.purchasePrice != null ? String(Math.round(row.purchasePrice / 100)) : "");
    setDescription(defaultDescription(row, row.condition, tr));
    setImages([]);
    setError(null);
    setResultUrl(null);
    setOpen(true);
  }

  async function submit() {
    const priceKr = Math.round(Number(price));
    const shippingKr = Math.round(Number(shipping));
    if (!Number.isFinite(priceKr) || priceKr <= 0) return setError(t("sellErrPrice"));
    if (!Number.isFinite(shippingKr) || shippingKr < 0) return setError(t("sellErrShipping"));
    if (images.length === 0) return setError(t("sellErrPhoto"));

    setSaving(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/tradera/sell", {
        method: "POST",
        body: {
          collectionItemId: row.id,
          priceKr,
          shippingKr,
          condition,
          purchasePriceKr:
            purchasePrice.trim() && Number.isFinite(Number(purchasePrice))
              ? Math.round(Number(purchasePrice))
              : undefined,
          description: description.trim() || undefined,
          imagesBase64: images,
        },
      });
      setResultUrl(url);
      toast({ title: t("sellCreatedToast"), variant: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("genericFail"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size={size} variant="secondary" className={className} onClick={openModal}>
        {t("sell")}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("sellTitle")}
        footer={
          resultUrl ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("sellClose")}
              </Button>
              <a
                href={resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg bg-holo-cyan px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                {t("sellViewListing")}
              </a>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("gridSelectCancel")}
              </Button>
              <Button onClick={() => void submit()} loading={saving}>
                {t("sellCreate")}
              </Button>
            </>
          )
        }
      >
        {resultUrl ? (
          <p className="text-sm text-ink-muted">
            {t.rich("sellResultText", {
              name: row.name,
              b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
            })}
          </p>
        ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            {t.rich("sellIntro", {
              name: row.name,
              setSuffix: row.setName ? ` · ${row.setName}` : "",
              b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
            })}
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sellPrice">{t("sellPrice")}</Label>
              <Input
                id="sellPrice"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={t("sellPricePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="sellShipping">{t("sellShipping")}</Label>
              <Input
                id="sellShipping"
                inputMode="numeric"
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="sellCondition">{t("condition")}</Label>
            <Select
              id="sellCondition"
              value={condition}
              onChange={(e) => {
                const next = e.target.value;
                // Håll beskrivningens Skick-rad i synk — men bara om texten inte
                // redigerats (dvs. fortfarande är auto-texten för nuvarande skick).
                setDescription((prev) =>
                  prev === defaultDescription(row, condition, tr) ? defaultDescription(row, next, tr) : prev
                );
                setCondition(next);
              }}
            >
              {Object.keys(CONDITION_LABELS).map((value) => (
                <option key={value} value={value}>
                  {tCond(value)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="sellPurchase">{t("sellPurchasePrice")}</Label>
            <Input
              id="sellPurchase"
              inputMode="numeric"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder={t("sellPurchasePlaceholder")}
            />
          </div>

          <div>
            <Label htmlFor="sellDescription">{t("sellDescription")}</Label>
            <Textarea
              id="sellDescription"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("sellDescriptionPlaceholder")}
              // Skrolla upp fältet ovanför tangentbordet när det öppnas (mobil).
              onFocus={(e) => {
                const el = e.currentTarget;
                setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
              }}
            />
          </div>

          <div>
            <Label htmlFor="sellPhoto">{t("sellPhotos")}</Label>
            <input
              ref={fileRef}
              id="sellPhoto"
              type="file"
              accept="image/*"
              multiple
              className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-overlay file:px-3 file:py-2 file:text-sm file:text-ink"
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length === 0) return;
                const urls = await Promise.all(files.map(readAsDataUrl));
                setImages((prev) => [...prev, ...urls].slice(0, 12));
                if (fileRef.current) fileRef.current.value = ""; // tillåt samma fil igen
              }}
            />
            {images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {images.map((src, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={t("sellPhotoAlt", { n: i + 1 })}
                      className="h-20 w-20 rounded-lg object-cover bg-surface-overlay"
                    />
                    <button
                      type="button"
                      aria-label={t("sellRemovePhoto")}
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-fall text-xs font-bold text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <FieldError message={error} />
        </div>
        )}
      </Modal>
    </>
  );
}
