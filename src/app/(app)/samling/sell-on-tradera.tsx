"use client";

/**
 * "Sälj på Tradera" — självständig knapp + modal per samlingsobjekt.
 * Användaren väljer pris, skick och fraktkostnad samt laddar upp ett foto på det
 * egna objektet; POST /api/tradera/sell skapar en Köp nu-annons via Tradera-API:t.
 * Kräver att Tradera-kontot är kopplat (Inställningar) — annars svarar API:t 400.
 */
import { useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Textarea, Select, Label, FieldError } from "@/components/ui/input";
import { CONDITION_LABELS, LANGUAGE_LABELS, type CollectionRow } from "./collection-client";

/** Standardbeskrivning att förifylla textrutan med (användaren kan redigera). */
function defaultDescription(row: CollectionRow): string {
  return [
    `${row.name}${row.setName ? ` — ${row.setName}` : ""}`,
    `Skick: ${CONDITION_LABELS[row.condition] ?? row.condition}`,
    `Språk: ${LANGUAGE_LABELS[row.language] ?? row.language}`,
    "",
    "Bilden visar det exakta objektet. Säljes av privatperson.",
  ].join("\n");
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
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
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState(row.condition);
  const [shipping, setShipping] = useState("20");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  function openModal() {
    setPrice(row.estimatedValue != null ? String(Math.round(row.estimatedValue / 100)) : "");
    setCondition(row.condition);
    setShipping("20");
    setDescription(defaultDescription(row));
    setImages([]);
    setError(null);
    setResultUrl(null);
    setOpen(true);
  }

  async function submit() {
    const priceKr = Math.round(Number(price));
    const shippingKr = Math.round(Number(shipping));
    if (!Number.isFinite(priceKr) || priceKr <= 0) return setError("Ange ett pris i kronor.");
    if (!Number.isFinite(shippingKr) || shippingKr < 0) return setError("Ogiltig fraktkostnad.");
    if (images.length === 0) return setError("Ladda upp minst ett foto på objektet.");

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
          description: description.trim() || undefined,
          imagesBase64: images,
        },
      });
      setResultUrl(url);
      toast({ title: "Annonsen är skapad på Tradera", variant: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Något gick fel.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size={size} variant="secondary" className={className} onClick={openModal}>
        Sälj
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Sälj på Tradera"
        footer={
          resultUrl ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Stäng
              </Button>
              <a
                href={resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg bg-holo-cyan px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Visa annonsen
              </a>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Avbryt
              </Button>
              <Button onClick={() => void submit()} loading={saving}>
                Skapa annons
              </Button>
            </>
          )
        }
      >
        {resultUrl ? (
          <p className="text-sm text-ink-muted">
            <span className="font-medium text-ink">{row.name}</span> ligger nu uppe på Tradera som
            Köp nu-annons. Det kan ta en liten stund innan den syns i sök.
          </p>
        ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            <span className="font-medium text-ink">{row.name}</span>
            {row.setName ? ` · ${row.setName}` : ""} läggs upp som Köp nu-annons (60 dagar).
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sellPrice">Pris (kr)</Label>
              <Input
                id="sellPrice"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="t.ex. 399"
              />
            </div>
            <div>
              <Label htmlFor="sellShipping">Frakt (kr)</Label>
              <Input
                id="sellShipping"
                inputMode="numeric"
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="sellCondition">Skick</Label>
            <Select
              id="sellCondition"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="sellDescription">Beskrivning</Label>
            <Textarea
              id="sellDescription"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Beskriv objektet…"
            />
          </div>

          <div>
            <Label htmlFor="sellPhoto">Foton på objektet (första blir huvudbild)</Label>
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
                      alt={`Foto ${i + 1}`}
                      className="h-20 w-20 rounded-lg object-cover bg-surface-overlay"
                    />
                    <button
                      type="button"
                      aria-label="Ta bort foto"
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
