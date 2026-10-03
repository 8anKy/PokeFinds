"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useAuthHint } from "@/lib/auth-hint";
import { getSharedSession } from "@/lib/client-session";
import { useRouter } from "@/i18n/navigation";
import { apiFetch, apiErrorCode } from "@/lib/client-api";
import { FORUM_RULES_CODE } from "@/lib/profanity";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { SwipeTabs } from "@/components/ui/swipe-tabs";
import { GroupChips } from "./group-chips";
import { ThreadList, type FeedPage } from "./thread-list";
import { StoreReportSheet } from "./store-report-sheet";
import { requestForumRules } from "./forum-rules-gate";
import { ProductPicker, type PickedProduct } from "./product-picker";
import type { GroupSummary } from "@/services/community-groups";
import type { CommunityStoreDto } from "@/services/community-stores";

export function CommunityHub({ initial, stores: initialStores, groups }: { initial: FeedPage; stores: CommunityStoreDto[]; groups: GroupSummary[] }) {
  const t = useTranslations("LocalStores");
  const search = useSearchParams();
  const router = useRouter();
  const loggedIn = useAuthHint();
  const [viewer, setViewer] = useState<{ role: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (loggedIn) void getSharedSession().then(session => { if (!cancelled) setViewer(session?.user ?? null); });
    else setViewer(null);
    return () => { cancelled = true; };
  }, [loggedIn]);
  const [stores, setStores] = useState(initialStores);
  const [area, setArea] = useState("");
  const [storeId, setStoreId] = useState(search.get("store") ?? "");
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [appliedFilters, setAppliedFilters] = useState({ storeId: search.get("store") ?? "", city: "", productSlug: "" });
  const [reports, setReports] = useState<FeedPage | null>(null);
  const [reportVersion, setReportVersion] = useState(0);
  const [reportsActive, setReportsActive] = useState(search.get("view") === "reports");
  const [reportStore, setReportStore] = useState<CommunityStoreDto | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const [pending, setPending] = useState<CommunityStoreDto[] | null>(null);
  const [followed, setFollowed] = useState<string[] | null>(null);
  const [onlyFollowed, setOnlyFollowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState("");
  const request = useRef(0);
  // Filtren tillämpas på ett uttryckligt tryck. Ingen DB-läsning per bokstav.
  const reportQuery = new URLSearchParams({ reports: "1", ...(appliedFilters.storeId ? { store: appliedFilters.storeId } : {}), ...(appliedFilters.city ? { city: appliedFilters.city } : {}), ...(appliedFilters.productSlug ? { product: appliedFilters.productSlug } : {}) });
  const query = reportQuery.toString();
  useEffect(() => {
    if (!reportsActive) return;
    const generation = ++request.current;
    const controller = new AbortController();
    setReports(null); setError(undefined);
    apiFetch<FeedPage>(`/api/community/posts?${query}`, { signal: controller.signal }).then(data => {
      if (generation === request.current) setReports(data);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("error")); });
    return () => controller.abort();
  }, [query, reportsActive, reportVersion, t]);

  function login(): boolean {
    if (loggedIn) return true;
    router.push(`/logga-in?callbackUrl=${encodeURIComponent("/forum")}`); return false;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(undefined); setNotice("");
    try { await action(); } catch (e) {
      if (apiErrorCode(e) === FORUM_RULES_CODE) requestForumRules();
      setError(e instanceof Error ? e.message : t("error"));
    } finally { setBusy(false); }
  }
  async function loadFollows() {
    if (!login()) return;
    await run(async () => { const data = await apiFetch<{ ids: string[] }>("/api/community/stores/follow"); setFollowed(data.ids); setOnlyFollowed(true); });
  }
  function follow(id: string) {
    if (!login()) return;
    void run(async () => {
      let ids = followed;
      if (!ids) ids = (await apiFetch<{ ids: string[] }>("/api/community/stores/follow")).ids;
      const following = !ids.includes(id);
      await apiFetch("/api/community/stores/follow", { method: "POST", body: { storeId: id, following } });
      setFollowed(following ? [...ids, id] : ids.filter(i => i !== id));
      setNotice(t(following ? "followSaved" : "followRemoved"));
    });
  }
  async function suggest() {
    await run(async () => {
      await apiFetch("/api/community/stores", { method: "POST", body: { name, address, city, ...coordinates } });
      setSuggestOpen(false); setName(""); setAddress(""); setCity(""); setCoordinates(undefined); setNotice(t("suggested"));
    });
  }
  function locateStore() {
    if (!navigator.geolocation) { setError(t("locationUnavailable")); return; }
    setBusy(true); setError(undefined);
    navigator.geolocation.getCurrentPosition(pos => {
      if (pos.coords.accuracy > 100) setError(t("locationUnavailable"));
      else setCoordinates({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setBusy(false);
    }, () => { setBusy(false); setError(t("locationUnavailable")); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  }
  const normalizedArea = area.trim().toLocaleLowerCase();
  const filtered = stores.filter(s => (!normalizedArea || s.city.toLocaleLowerCase().includes(normalizedArea)) && (!onlyFollowed || followed?.includes(s.id)));
  const local = <div className="space-y-4">
    <Label htmlFor="community-area">{t("area")}</Label>
    <Input id="community-area" value={area} onChange={e => { setArea(e.target.value); setStoreId(""); }} placeholder={t("areaPlaceholder")} maxLength={80} />
    <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => onlyFollowed ? setOnlyFollowed(false) : void loadFollows()}>{t(onlyFollowed ? "allStores" : "followedStores")}</Button><Button onClick={() => { if (login()) { setError(undefined); setSuggestOpen(true); } }}>{t("suggestStore")}</Button></div>
    <p className="text-xs text-ink-muted">{t("directoryHint")}</p>
    {filtered.length === 0 && <p className="py-8 text-center text-sm text-ink-muted">{t("noStores")}</p>}
    <ul className="space-y-3">{filtered.slice(0, 100).map(store => <li key={store.id} className="card-surface space-y-3 rounded-xl p-4">
      <div><h2 className="font-display text-lg font-semibold text-ink">{store.name}</h2><p className="text-sm text-ink-muted">{store.address} · {store.city}</p></div>
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { if (login()) setReportStore(store); }}>{t("report")}</Button><Button variant="secondary" size="sm" onClick={() => { setStoreId(store.id); setAppliedFilters({ storeId: store.id, city: "", productSlug: "" }); setReportsActive(true); setReportVersion(v => v + 1); }}>{t("storeReports")}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => follow(store.id)}>{t(followed?.includes(store.id) ? "following" : "follow")}</Button>
      <a className="inline-flex min-h-10 items-center text-sm text-holo-cyan" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${store.address}, ${store.city}, Sweden`)}`} target="_blank" rel="noopener noreferrer">{t("directions")}</a></div>
      {appliedFilters.storeId === store.id && reportsActive && <div><p className="mb-3 text-xs text-ink-muted">{t("disclaimer")}</p>{reports ? <ThreadList key={query + reportVersion} initial={reports} reportQuery={query} emptyText={t("noReports")} /> : <p className="text-sm text-ink-muted">{t("loading")}</p>}</div>}
    </li>)}</ul>
    {filtered.length > 100 && <p className="text-xs text-ink-muted">{t("narrowArea")}</p>}
    {viewer && ["ADMIN", "SUPERADMIN"].includes(viewer.role) && <div className="space-y-3">
      <Button variant="secondary" disabled={busy} onClick={() => void run(async () => setPending((await apiFetch<{ items: CommunityStoreDto[] }>("/api/community/stores/moderate")).items))}>{t("reviewStores")}</Button>
      {pending?.length === 0 && <p className="text-sm text-ink-muted">{t("noPending")}</p>}
      {pending?.map(s => <div key={s.id} className="rounded-xl border border-surface-border p-3"><p className="text-sm text-ink">{s.name} · {s.address} · {s.city}</p><p className="text-xs text-ink-muted">{s.latitude != null ? `${s.latitude.toFixed(5)}, ${s.longitude?.toFixed(5)}` : t("noCoordinates")}</p><div className="mt-2 flex gap-2">{(["APPROVED", "REJECTED"] as const).map(status => <Button key={status} size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => {
        await apiFetch("/api/community/stores/moderate", { method: "PATCH", body: { id: s.id, status } });
        setPending(p => p?.filter(i => i.id !== s.id) ?? null);
        if (status === "APPROVED") setStores(p => [...p, s]);
        router.refresh();
      })}>{t(status === "APPROVED" ? "approve" : "reject")}</Button>)}</div></div>)}
    </div>}
  </div>;
  const reportPanel = <div className="space-y-4">
    <div><Label htmlFor="report-area-filter">{t("area")}</Label><Input id="report-area-filter" value={area} onChange={e => { setArea(e.target.value); setStoreId(""); }} placeholder={t("areaPlaceholder")} maxLength={80} /></div>
    <Label htmlFor="report-store-filter">{t("store")}</Label>
    <select id="report-store-filter" className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-ink" value={storeId} onChange={e => setStoreId(e.target.value)}><option value="">{t("allStores")}</option>{filtered.map(s => <option value={s.id} key={s.id}>{s.name} · {s.city}</option>)}</select>
    <ProductPicker value={product} onChange={setProduct} />
    {stores.find(s => s.id === storeId) && <Button onClick={() => { if (login()) setReportStore(stores.find(s => s.id === storeId) ?? null); }}>{t("report")}</Button>}
    <Button variant="secondary" onClick={() => { setAppliedFilters({ storeId, city: area.trim(), productSlug: product?.slug ?? "" }); setReportVersion(v => v + 1); }}>{t("storeReports")}</Button>
    <p className="text-xs text-ink-muted">{t("disclaimer")}</p>
    {reports ? <ThreadList key={query + reportVersion} initial={reports} reportQuery={query} emptyText={t("noReports")} visual /> : <p className="py-6 text-center text-sm text-ink-muted">{t("loading")}</p>}
  </div>;
  return <div className="space-y-4">
    <SwipeTabs ariaLabel={t("views")} initialId={search.get("view") === "reports" ? "reports" : "feed"} onChange={id => { if (id === "reports") setReportsActive(true); }} tabs={[
      { id: "feed", label: t("feed"), content: <div className="space-y-5"><GroupChips groups={groups} /><ThreadList initial={initial} emptyText={t("noPosts")} visual /></div> },
      { id: "nearby", label: t("nearby"), content: local },
      { id: "reports", label: t("reports"), content: reportPanel },
    ]} />
    {!suggestOpen && error && <FieldError message={error} />}
    <p className="text-sm text-holo-cyan" role="status">{notice}</p>
    {reportStore && <StoreReportSheet key={reportStore.id} store={reportStore} onClose={() => setReportStore(null)} />}
    <BottomSheet open={suggestOpen} title={t("suggestStore")} closeLabel={t("close")} onClose={() => !busy && setSuggestOpen(false)} footer={<Button className="w-full" disabled={busy || name.trim().length < 2 || address.trim().length < 3 || city.trim().length < 2} onClick={() => void suggest()}>{t(busy ? "saving" : "submitSuggestion")}</Button>}>
      <div className="space-y-4"><p className="text-sm text-ink-muted">{t("suggestHint")}</p>
        <div><Label htmlFor="store-name">{t("storeName")}</Label><Input id="store-name" value={name} maxLength={100} onChange={e => setName(e.target.value)} disabled={busy} /></div>
        <div><Label htmlFor="store-address">{t("address")}</Label><Input id="store-address" value={address} maxLength={160} onChange={e => { setAddress(e.target.value); setCoordinates(undefined); }} disabled={busy} /></div>
        <div><Label htmlFor="store-city">{t("city")}</Label><Input id="store-city" value={city} maxLength={80} onChange={e => { setCity(e.target.value); setCoordinates(undefined); }} disabled={busy} /></div>
        <Button variant="secondary" disabled={busy} onClick={locateStore}>{t("storePosition")}</Button><p className="text-xs text-ink-muted">{coordinates ? t("storePositionAdded") : t("storePositionHint")}</p>
        {error && <FieldError message={error} />}
      </div>
    </BottomSheet>
  </div>;
}
