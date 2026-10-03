"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch, apiErrorCode } from "@/lib/client-api";
import { STORE_OBSERVATIONS, type StoreObservation, type locationSchema } from "@/lib/community-stores";
import { FORUM_RULES_CODE } from "@/lib/profanity";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Label, Select, Input, Textarea, FieldError } from "@/components/ui/input";
import { ProductPicker, type PickedProduct } from "./product-picker";
import { ImagePicker, type PickedImage } from "./image-picker";
import { requestForumRules } from "./forum-rules-gate";
import type { CommunityStoreDto } from "@/services/community-stores";
import type { z } from "zod";

export function StoreReportSheet({ store, onClose, onSubmitted }: { store: CommunityStoreDto; onClose: () => void; onSubmitted: () => void }) {
  const t = useTranslations("LocalStores");
  const router = useRouter();
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [status, setStatus] = useState<StoreObservation>("SEEN");
  const [when, setWhen] = useState("now");
  const [visitTime, setVisitTime] = useState("");
  const [comment, setComment] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [location, setLocation] = useState<z.infer<typeof locationSchema>>();
  const [locationMessage, setLocationMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  function locate() {
    if (!navigator.geolocation) { setLocationMessage(t("locationUnavailable")); return; }
    setLocating(true);
    setLocation(undefined); setLocationMessage("");
    navigator.geolocation.getCurrentPosition(pos => {
      setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, sampledAt: new Date(pos.timestamp).toISOString() });
      setLocationMessage(t("locationReceived")); setLocating(false);
    }, () => { setLocationMessage(t("locationUnavailable")); setLocating(false); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  }
  async function submit() {
    if (!product) { setError(t("productRequired")); return; }
    const productLabel = product.title;
    if (images.some(i => i.uploading || i.error)) { setError(t("waitImages")); return; }
    const observed = when === "now" ? new Date() : new Date(visitTime);
    if (!Number.isFinite(observed.getTime())) { setError(t("visitRequired")); return; }
    setBusy(true); setError(undefined);
    try {
      const groups = await apiFetch<{ items: { slug: string; isMarketplace: boolean }[] }>("/api/community/groups");
      const group = groups.items.find(g => g.slug === "allmant") ?? groups.items.find(g => !g.isMarketplace);
      if (!group) throw new Error(t("unavailable"));
      await apiFetch<{ id: string }>("/api/community/posts", { method: "POST", body: {
        groupSlug: group.slug,
        title: `${productLabel} · ${store.name}`.slice(0, 120),
        content: comment.trim() || t(`observation.${status}`),
        images: images.filter(i => i.key).map(i => ({ key: i.key, thumbKey: i.thumbKey })),
        storeReport: { storeId: store.id, productSlug: product.slug, observation: status,
          observedAt: observed.toISOString(), ...(when === "now" && location ? { location } : {}) },
      } });
      onSubmitted(); onClose(); router.refresh();
    } catch (e) {
      if (apiErrorCode(e) === FORUM_RULES_CODE) requestForumRules();
      setError(e instanceof Error ? e.message : t("error"));
      setBusy(false);
    }
  }
  return (
    <BottomSheet open title={store.name} closeLabel={t("close")} onClose={() => !busy && onClose()}
      footer={<Button className="w-full" onClick={() => void submit()} disabled={!product || busy || images.some(i => i.uploading)}>{busy ? t("saving") : t("shareStatus")}</Button>}>
      <div className="space-y-5 pb-2">
        <p className="text-xs text-ink-muted">{store.address} · {store.city}</p>
        <div><Label htmlFor="status-product">{t("product")}</Label>
          <ProductPicker inputId="status-product" inlineResults value={product} onChange={next => { setProduct(next); setError(undefined); }} disabled={busy} />
        </div>
        <fieldset disabled={busy}><legend className="mb-2 text-sm font-medium text-ink">{t("whatSaw")}</legend>
          <div className="grid grid-cols-3 gap-2">{STORE_OBSERVATIONS.map(s => <label key={s} className="cursor-pointer">
            <input type="radio" name="store-observation" className="peer sr-only" value={s} checked={status === s} onChange={() => setStatus(s)} />
            <span className="flex min-h-11 items-center justify-center rounded-xl border border-surface-border px-2 text-sm text-ink-muted peer-checked:border-holo-cyan/50 peer-checked:bg-holo-cyan/10 peer-checked:text-holo-cyan peer-focus-visible:ring-2 peer-focus-visible:ring-holo-cyan">{t(`statusShort.${s}`)}</span>
          </label>)}</div>
        </fieldset>
        <details className="border-t border-surface-border pt-3"><summary className="cursor-pointer text-sm text-ink-muted">{t("moreDetails")}</summary><div className="mt-4 space-y-4">
          <div><Label htmlFor="report-when">{t("whenVisit")}</Label><Select id="report-when" value={when} disabled={busy} onChange={e => { setWhen(e.target.value); setLocation(undefined); setLocationMessage(""); }}><option value="now">{t("now")}</option><option value="earlier">{t("earlier")}</option></Select>
            {when === "earlier" && <Input aria-label={t("visitTime")} type="datetime-local" value={visitTime} onChange={e => setVisitTime(e.target.value)} disabled={busy} />}</div>
          {when === "now" && store.latitude != null && store.longitude != null && <div><Button variant="ghost" onClick={locate} disabled={busy || locating}>{locating ? t("locating") : t("checkLocation")}</Button><p className="mt-2 text-xs text-ink-muted">{t("locationPrivacy")}</p><p className="text-xs text-ink-muted" role="status">{locationMessage}</p></div>}
          <div><Label htmlFor="report-comment">{t("comment")}</Label><Textarea id="report-comment" value={comment} maxLength={10000} disabled={busy} onChange={e => setComment(e.target.value)} /></div>
          <ImagePicker value={images} onChange={setImages} disabled={busy} />
        </div></details>
        <p className="text-xs text-ink-faint">{t("disclaimer")}</p>
        {error && <FieldError message={error} />}
      </div>
    </BottomSheet>
  );
}
