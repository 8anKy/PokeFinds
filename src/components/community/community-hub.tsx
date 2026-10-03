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
import { IconNews, IconMapPin, IconPlus } from "@/components/ui/icons";
import { Input, Label, FieldError } from "@/components/ui/input";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useToast } from "@/components/ui/toast";
import { StoreMap } from "./store-map";
import type { MapPoint } from "@/lib/community-map";
import { GroupChips } from "./group-chips";
import { ThreadList, type FeedPage } from "./thread-list";
import { StoreReportSheet } from "./store-report-sheet";
import { requestForumRules } from "./forum-rules-gate";
import type { GroupSummary } from "@/services/community-groups";
import type { CommunityStoreDto } from "@/services/community-stores";

export function CommunityHub({ initial, stores: initialStores, groups }: { initial: FeedPage; stores: CommunityStoreDto[]; groups: GroupSummary[] }) {
  const t = useTranslations("LocalStores");
  const { toast } = useToast();
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
  useEffect(() => setStores(initialStores), [initialStores]);
  const [view, setView] = useState(search.get("view") === "nearby" || search.get("view") === "reports" ? "nearby" : "feed");
  const [statusStore, setStatusStore] = useState<string | null>(search.get("view") === "reports" || search.get("status") === "1" ? search.get("store") : null);
  useEffect(() => {
    const next = search.get("view");
    setView(next === "nearby" || next === "reports" ? "nearby" : "feed");
    setStatusStore(next === "reports" || search.get("status") === "1" ? search.get("store") : null);
  }, [search]);
  function selectView(next: string) {
    setView(next); setStatusStore(null);
    const params = new URLSearchParams(search.toString());
    params.set("view", next); params.delete("store"); params.delete("status");
    // ⛔ Flikbyte är klientläge: katalog och grupper är redan lästa.
    window.history.pushState(null, "", `${window.location.pathname}?${params}`);
  }
  function closeStatus() {
    setStatusStore(null);
    if (search.get("status") || search.get("view") === "reports") {
      const params = new URLSearchParams(search.toString());
      params.set("view", "nearby"); params.delete("status");
      window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    }
  }
  const [feedGroup, setFeedGroup] = useState("");
  const [feed, setFeed] = useState<FeedPage>(initial);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState("");
  useEffect(() => {
    if (!feedGroup) { setFeed(initial); setFeedError(""); setFeedLoading(false); return; }
    const controller = new AbortController();
    setFeedLoading(true); setFeedError("");
    apiFetch<FeedPage>(`/api/community/posts?group=${encodeURIComponent(feedGroup)}&pageSize=20`, { signal: controller.signal })
      .then(setFeed).catch(e => { if (!controller.signal.aborted) setFeedError(e instanceof Error ? e.message : t("error")); })
      .finally(() => { if (!controller.signal.aborted) setFeedLoading(false); });
    return () => controller.abort();
  }, [feedGroup, initial, t]);
  const [reports, setReports] = useState<FeedPage | null>(null);
  const [reportVersion, setReportVersion] = useState(0);
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
  // Bekräftelser ska inte lägga en extra rad ovanför den viewport-anpassade
  // kartan: då hamnar butikernas knappar bakom bottennavigationen efter delning.
  useEffect(() => {
    if (!notice) return;
    toast({ title: notice, variant: "success" }); setNotice("");
  }, [notice, toast]);
  const request = useRef(0);
  // Status läses först när användaren öppnar en butik, inte vid kartpanorering.
  const query = new URLSearchParams({ reports: "1", ...(statusStore ? { store: statusStore } : {}) }).toString();
  useEffect(() => {
    if (!statusStore) return;
    const generation = ++request.current;
    const controller = new AbortController();
    setReports(null); setError(undefined);
    apiFetch<FeedPage>(`/api/community/posts?${query}`, { signal: controller.signal }).then(data => {
      if (generation === request.current) setReports(data);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("error")); });
    return () => controller.abort();
  }, [query, statusStore, reportVersion, t]);

  function login(): boolean {
    if (loggedIn) return true;
    router.push(`/logga-in?callbackUrl=${encodeURIComponent("/forum")}`); return false;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(undefined); setNotice("");
    try { await action(); } catch (e) {
      if (apiErrorCode(e) === FORUM_RULES_CODE) requestForumRules();
      const message = e instanceof Error ? e.message : t("error");
      if (suggestOpen) setError(message);
      else toast({ title: message, variant: "error" });
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
  function showStoreReports(store: CommunityStoreDto) { setStatusStore(store.id); }
  function openSuggestion(point?: MapPoint) {
    if (!login()) return;
    setCoordinates(point); setError(undefined); setSuggestOpen(true);
  }
  const local = <div className="space-y-5">
    <StoreMap initialStoreId={search.get("store") ?? undefined} stores={stores} followed={followed} onlyFollowed={onlyFollowed} busy={busy}
      onReport={store => { if (login()) setReportStore(store); }} onReports={showStoreReports}
      onSuggest={openSuggestion} onFollow={follow}
      onFollowed={() => onlyFollowed ? setOnlyFollowed(false) : void loadFollows()} />
    {viewer && ["ADMIN", "SUPERADMIN"].includes(viewer.role) && <div className="space-y-3">
      <Button variant="secondary" disabled={busy} onClick={() => void run(async () => setPending((await apiFetch<{ items: CommunityStoreDto[] }>("/api/community/stores/moderate")).items))}>{t("reviewStores")}</Button>
      {pending?.length === 0 && <p className="text-sm text-ink-muted">{t("noPending")}</p>}
      {pending?.map(s => <div key={s.id} className="rounded-xl border border-surface-border p-3"><p className="text-sm text-ink">{s.name} · {s.address} · {s.city}</p><div className="mt-2 grid grid-cols-2 gap-2">{(["latitude", "longitude"] as const).map(field => <div key={field}><Label htmlFor={`pending-${s.id}-${field}`}>{t(field)}</Label><Input id={`pending-${s.id}-${field}`} type="number" step="any" min={field === "latitude" ? -90 : -180} max={field === "latitude" ? 90 : 180} value={s[field] ?? ""} onChange={e => setPending(p => p?.map(store => store.id === s.id ? { ...store, [field]: e.target.value === "" ? null : Number(e.target.value) } : store) ?? null)} /></div>)}</div><div className="mt-2 flex gap-2">{(["APPROVED", "REJECTED"] as const).map(status => <Button key={status} size="sm" variant="secondary" disabled={busy || (s.latitude == null) !== (s.longitude == null)} onClick={() => void run(async () => {
        await apiFetch("/api/community/stores/moderate", { method: "PATCH", body: { id: s.id, status, latitude: s.latitude, longitude: s.longitude } });
        setPending(p => p?.filter(i => i.id !== s.id) ?? null);
        if (status === "APPROVED") setStores(p => [...p, s]);
        router.refresh();
      })}>{t(status === "APPROVED" ? "approve" : "reject")}</Button>)}</div></div>)}
    </div>}
  </div>;
  const statusSelection = stores.find(s => s.id === statusStore);
  return <div className="space-y-4">
    <nav className="grid grid-cols-2 gap-1 rounded-full border border-surface-border p-1" aria-label={t("views")} role="tablist">{["feed", "nearby"].map(id => {
      const Icon = id === "feed" ? IconNews : IconMapPin;
      return <button key={id} type="button" id={`community-tab-${id}`} role="tab" aria-selected={view === id} aria-controls={`community-panel-${id}`} onClick={() => selectView(id)} className={`flex min-h-10 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors ${view === id ? "bg-surface-overlay text-ink" : "text-ink-muted hover:text-ink"}`}><Icon size={16} className={view === id ? "text-holo-cyan" : ""} />{t(id)}</button>;
    })}</nav>
    <section id={`community-panel-${view}`} role="tabpanel" aria-labelledby={`community-tab-${view}`}>
      {view === "feed" && <div className="space-y-4"><GroupChips groups={groups} activeSlug={feedGroup} onSelect={setFeedGroup} />
        {feedError ? <FieldError message={feedError} /> : feedLoading ? <p className="py-8 text-center text-sm text-ink-muted">{t("loading")}</p> : <ThreadList key={feedGroup} initial={feed} group={feedGroup || undefined} emptyText={t("noPosts")} visual />}
      </div>}
      {view === "nearby" && local}
    </section>
    <BottomSheet open={!!statusSelection && !reportStore} title={statusSelection?.name ?? t("latestReports")} closeLabel={t("close")} headerAction={{ label: t("close"), onClick: closeStatus }} onClose={closeStatus} panelClassName="h-[78dvh] sm:mx-auto sm:w-full sm:max-w-xl">
      <div className="space-y-4 pb-6">
        <p className="text-xs text-ink-muted">{statusSelection?.address} · {statusSelection?.city}</p>
        <button type="button" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-holo-cyan" onClick={() => { if (statusSelection && login()) setReportStore(statusSelection); }}><IconPlus size={16} />{t("addReport")}</button>
        <p className="text-xs text-ink-muted">{t("disclaimer")}</p>
        {error ? <FieldError message={error} /> : reports ? <ThreadList key={query + reportVersion} initial={reports} reportQuery={query} emptyText={t("noReports")} visual /> : <p role="status" className="py-6 text-center text-sm text-ink-muted">{t("loading")}</p>}
      </div>
    </BottomSheet>
    {reportStore && <StoreReportSheet key={reportStore.id} store={reportStore} onClose={() => setReportStore(null)} onSubmitted={() => { setReportVersion(v => v + 1); setNotice(t("reportShared")); }} />}
    <BottomSheet open={suggestOpen} title={t("suggestStore")} closeLabel={t("close")} onClose={() => !busy && setSuggestOpen(false)} footer={<Button className="w-full" disabled={busy || name.trim().length < 2 || address.trim().length < 3 || city.trim().length < 2} onClick={() => void suggest()}>{t(busy ? "saving" : "submitSuggestion")}</Button>}>
      <div className="space-y-4"><p className="text-sm text-ink-muted">{t("suggestHint")}</p>
        <div><Label htmlFor="store-name">{t("storeName")}</Label><Input id="store-name" value={name} maxLength={100} onChange={e => setName(e.target.value)} disabled={busy} /></div>
        <div><Label htmlFor="store-address">{t("address")}</Label><Input id="store-address" value={address} maxLength={160} onChange={e => setAddress(e.target.value)} disabled={busy} /></div>
        <div><Label htmlFor="store-city">{t("city")}</Label><Input id="store-city" value={city} maxLength={80} onChange={e => setCity(e.target.value)} disabled={busy} /></div>
        <Button variant="secondary" disabled={busy} onClick={locateStore}>{t("storePosition")}</Button><p className="text-xs text-ink-muted">{coordinates ? t("storePositionAdded") : t("storePositionHint")}</p>
        {error && <FieldError message={error} />}
      </div>
    </BottomSheet>
  </div>;
}
