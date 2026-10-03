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

export function StoreReportSheet({ store, onClose }: { store: CommunityStoreDto; onClose: () => void }) {
  const t = useTranslations("LocalStores");
  const router = useRouter();
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [label, setLabel] = useState("");
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
    navigator.geolocation.getCurrentPosition(pos => {
      setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, sampledAt: new Date(pos.timestamp).toISOString() });
      setLocationMessage(t("locationReceived")); setLocating(false);
    }, () => { setLocationMessage(t("locationUnavailable")); setLocating(false); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  }
  async function submit() {
    const productLabel = product?.title ?? label.trim();
    if (productLabel.length < 2) { setError(t("productRequired")); return; }
    if (images.some(i => i.uploading || i.error)) { setError(t("waitImages")); return; }
    const observed = when === "now" ? new Date() : new Date(visitTime);
    if (!Number.isFinite(observed.getTime())) { setError(t("visitRequired")); return; }
    setBusy(true); setError(undefined);
    try {
      const groups = await apiFetch<{ items: { slug: string; isMarketplace: boolean }[] }>("/api/community/groups");
      const group = groups.items.find(g => g.slug === "allmant") ?? groups.items.find(g => !g.isMarketplace);
      if (!group) throw new Error(t("unavailable"));
      const result = await apiFetch<{ id: string }>("/api/community/posts", { method: "POST", body: {
        groupSlug: group.slug,
        title: `${productLabel} · ${store.name}`.slice(0, 120),
        content: comment.trim() || t(`observation.${status}`),
        images: images.filter(i => i.key).map(i => ({ key: i.key, thumbKey: i.thumbKey })),
        storeReport: { storeId: store.id, productLabel, productSlug: product?.slug, observation: status,
          observedAt: observed.toISOString(), ...(when === "now" && location ? { location } : {}) },
      } });
      router.refresh(); onClose(); router.push(`/forum/t/${result.id}`);
    } catch (e) {
      if (apiErrorCode(e) === FORUM_RULES_CODE) requestForumRules();
      setError(e instanceof Error ? e.message : t("error"));
      setBusy(false);
    }
  }
  return (
    <BottomSheet open title={t("reportVisit")} closeLabel={t("close")} onClose={() => !busy && onClose()}
      footer={<Button className="w-full" onClick={() => void submit()} disabled={busy || images.some(i => i.uploading)}>{busy ? t("saving") : t("publish")}</Button>}>
      <div className="space-y-4">
        <div><p className="font-medium text-ink">{store.name}</p><p className="text-sm text-ink-muted">{store.address} · {store.city}</p></div>
        <div><Label>{t("product")}</Label><ProductPicker value={product} onChange={setProduct} disabled={busy} />
          {!product && <Input aria-label={t("manualProduct")} placeholder={t("manualProduct")} value={label} maxLength={120} onChange={e => setLabel(e.target.value)} disabled={busy} />}</div>
        <div><Label htmlFor="report-status">{t("whatSaw")}</Label><Select id="report-status" value={status} disabled={busy} onChange={e => setStatus(e.target.value as StoreObservation)}>{STORE_OBSERVATIONS.map(s => <option value={s} key={s}>{t(`observation.${s}`)}</option>)}</Select></div>
        <div><Label htmlFor="report-when">{t("whenVisit")}</Label><Select id="report-when" value={when} disabled={busy} onChange={e => { setWhen(e.target.value); setLocation(undefined); setLocationMessage(""); }}><option value="now">{t("now")}</option><option value="earlier">{t("earlier")}</option></Select>
          {when === "earlier" && <Input aria-label={t("visitTime")} type="datetime-local" value={visitTime} onChange={e => setVisitTime(e.target.value)} disabled={busy} />}</div>
        {when === "now" && store.latitude != null && store.longitude != null && <div><Button variant="secondary" onClick={locate} disabled={busy || locating}>{locating ? t("locating") : t("checkLocation")}</Button><p className="mt-2 text-xs text-ink-muted">{t("locationPrivacy")}</p><p className="text-xs text-ink-muted" role="status">{locationMessage}</p></div>}
        <div><Label htmlFor="report-comment">{t("comment")}</Label><Textarea id="report-comment" value={comment} maxLength={10000} disabled={busy} onChange={e => setComment(e.target.value)} /></div>
        <ImagePicker value={images} onChange={setImages} disabled={busy} />
        <p className="text-xs text-ink-muted">{t("disclaimer")}</p>
        {error && <FieldError message={error} />}
      </div>
    </BottomSheet>
  );
}
